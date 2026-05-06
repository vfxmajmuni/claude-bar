const { app, BrowserWindow, screen, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

let floatWin;
let scraperWin;
let pollInterval;
let isScraping = false;
let isLoggedIn = false;
let wasOnAuthPage = false;
let preventAutoLogin = false;
let cookiePath;
let settingsNavAttempts = 0;

const SETTINGS_URL = 'https://claude.ai/settings';
const AUTH_PATTERNS = ['/login', '/auth', 'accounts.google'];

async function saveCookies() {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' });
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    console.log(`cookies saved: ${cookies.length}`);
  } catch (e) {
    console.error('saveCookies error:', e.message);
  }
}

async function restoreCookies() {
  if (!fs.existsSync(cookiePath)) return false;
  try {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    for (const c of cookies) {
      const entry = {
        url: 'https://claude.ai',
        name: c.name,
        value: c.value,
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
      };
      if (c.domain) entry.domain = c.domain;
      if (c.expirationDate) entry.expirationDate = c.expirationDate;
      if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(c.sameSite)) {
        entry.sameSite = c.sameSite;
      }
      await session.defaultSession.cookies.set(entry);
    }
    console.log(`cookies restored: ${cookies.length}`);
    return true;
  } catch (e) {
    console.error('restoreCookies error:', e.message);
    return false;
  }
}

function clearCookies() {
  try { fs.unlinkSync(cookiePath); } catch {}
}

async function logout() {
  clearCookies();
  isLoggedIn = false;
  wasOnAuthPage = false;
  preventAutoLogin = true;
  try {
    // Без origin — чистить cookies/localStorage/IndexedDB для всього default session
    await session.defaultSession.clearStorageData();
    console.log('full session storage cleared');
  } catch (e) {
    console.error('logout error:', e.message);
  }
}

async function clickUsageTab() {
  return scraperWin.webContents.executeJavaScript(`
    (function() {
      // пробуємо за href
      let el = document.querySelector('a[href$="/settings/usage"], a[href$="usage"]');
      // якщо ні — за текстом
      if (!el) el = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
                       .find(e => e.textContent.trim() === 'Usage');
      if (el) { el.click(); return el.tagName + ':' + (el.href || el.textContent.trim()); }
      return null;
    })()
  `).catch(() => null);
}

async function runScrape() {
  if (isScraping) return;
  isScraping = true;

  const waits = [3000, 3000, 3000, 3000];
  let data = null;
  for (let i = 0; i < waits.length; i++) {
    await new Promise(r => setTimeout(r, waits[i]));
    data = await doScrape();
    console.log(`attempt ${i + 1}:`, JSON.stringify(data));
    if (data && data.found) break;
  }

  isScraping = false;

  if (data && data.found) {
    await saveCookies();
    scraperWin.hide();
    if (floatWin && !floatWin.isDestroyed()) {
      floatWin.webContents.send('usage-update', data);
    }
  } else {
    console.log('scrape failed, showing window');
    const currentUrl = scraperWin.webContents.getURL();
    // Якщо не вдалось дійти до /settings/usage — швидше за все проблема з авторизацією
    if (!currentUrl.includes('/settings/usage')) {
      isLoggedIn = false;
      clearCookies();
      scraperWin.loadURL('https://claude.ai/login');
    }
    scraperWin.show();
  }
}

async function createScraper() {
  scraperWin = new BrowserWindow({
    width: 480,
    height: 680,
    show: false,
    title: 'Claude — залогінься тут',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  await restoreCookies();
  // Завжди стартуємо з /settings — якщо не залогінений, claude.ai сам редіректне на /login
  scraperWin.loadURL(SETTINGS_URL);

  // OAuth-попапи (Google/Apple login) відкриваються через window.open() —
  // без цього хендлера Electron відкриває порожнє біле вікно
  scraperWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 480,
      height: 640,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    }
  }));

  // Після закриття OAuth-попапу перевіряємо авторизацію
  scraperWin.webContents.on('did-create-window', (popup) => {
    popup.once('closed', async () => {
      if (!isScraping && !preventAutoLogin) {
        await new Promise(r => setTimeout(r, 500));
        scraperWin.loadURL(SETTINGS_URL);
      }
    });
  });

  scraperWin.webContents.on('did-navigate-in-page', async (_, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.log('spa:', url);

    if (url.includes('/settings/usage') && !isScraping) {
      await runScrape();
      return;
    }

    // SPA-навігація на auth-сторінку: сесія протухла або ще не залогінений
    if (AUTH_PATTERNS.some(p => url.includes(p))) {
      wasOnAuthPage = true;
      if (isLoggedIn) {
        isLoggedIn = false;
        clearCookies();
      }
      scraperWin.show();
      scraperWin.focus();
      return;
    }

    // SPA-редірект з auth-сторінки = логін завершено (юзер сам залогінився)
    if (wasOnAuthPage && !isLoggedIn && !url.includes('/settings')) {
      wasOnAuthPage = false;
      preventAutoLogin = false;
      if (!isScraping) scraperWin.loadURL(SETTINGS_URL);
    }
  });

  scraperWin.webContents.on('did-navigate', (_, url) => {
    console.log('navigate:', url);
  });

  scraperWin.webContents.on('did-finish-load', async () => {
    const url = scraperWin.webContents.getURL();
    console.log('loaded:', url);

    // Не авторизований — показуємо вікно логіну
    if (AUTH_PATTERNS.some(p => url.includes(p))) {
      wasOnAuthPage = true;
      if (isLoggedIn) {
        isLoggedIn = false;
        clearCookies();
      }
      scraperWin.show();
      scraperWin.focus();
      return;
    }

    // Не на /settings (наприклад /new після логіну) — йдемо на /settings
    // Тільки якщо реально пройшли через auth-сторінку і юзер сам залогінився
    if (!url.includes('/settings')) {
      if (!wasOnAuthPage || preventAutoLogin) return;
      wasOnAuthPage = false;
      settingsNavAttempts++;
      if (settingsNavAttempts > 3) {
        console.log('redirect loop, stopping');
        scraperWin.show();
        return;
      }
      scraperWin.loadURL(SETTINGS_URL);
      return;
    }

    // На /settings — авторизація підтверджена
    settingsNavAttempts = 0;
    if (!isLoggedIn) {
      isLoggedIn = true;
      await saveCookies();
    }

    if (isScraping) return;

    // Клікаємо Usage tab
    await new Promise(r => setTimeout(r, 1500));
    const clicked = await clickUsageTab();
    console.log('usage tab click:', clicked);

    // якщо клік на <a> — SPA navigate спрацює → did-navigate-in-page
    // якщо <button> або URL не змінився — скрейпимо тут
    if (!clicked || !clicked.startsWith('A:')) {
      await runScrape();
    }
  });
}

async function doScrape() {
  if (!scraperWin || scraperWin.isDestroyed()) return null;
  try {
    return await scraperWin.webContents.executeJavaScript(`
      (function() {
        const r = {
          found: false, percent: null, resetMinutes: null, resetText: null,
          weeklyPercent: null, designPercent: null, timestamp: Date.now(),
          _url: location.pathname, _bars: 0
        };
        const bars = document.querySelectorAll('[role="progressbar"]');
        r._bars = bars.length;
        if (bars[0]) { const v=bars[0].getAttribute('aria-valuenow'),mx=bars[0].getAttribute('aria-valuemax')||'100'; if(v!==null){r.percent=Math.round(parseFloat(v)/parseFloat(mx)*100);r.found=true;} }
        if (bars[1]) { const v=bars[1].getAttribute('aria-valuenow'),mx=bars[1].getAttribute('aria-valuemax')||'100'; if(v!==null)r.weeklyPercent=Math.round(parseFloat(v)/parseFloat(mx)*100); }
        if (bars[2]) { const v=bars[2].getAttribute('aria-valuenow'),mx=bars[2].getAttribute('aria-valuemax')||'100'; if(v!==null)r.designPercent=Math.round(parseFloat(v)/parseFloat(mx)*100); }
        const m=(document.body.innerText||'').match(/Resets?\\s+in\\s+((\\d+)\\s*hr\\s*)?(\\d+)\\s*min/i);
        if(m){r.resetMinutes=parseInt(m[2]||'0')*60+parseInt(m[3]);r.resetText=m[0];r.found=true;}
        return r;
      })()
    `);
  } catch(e) { console.error('scrape error:', e.message); return null; }
}

async function poll() {
  if (!scraperWin || scraperWin.isDestroyed()) return;
  if (isScraping || !isLoggedIn) return;
  console.log('polling...');
  scraperWin.loadURL(SETTINGS_URL);
}

function createFloatWindow() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  floatWin = new BrowserWindow({
    width: 224,
    height: 130,
    x: sw - 240,
    y: 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  floatWin.loadFile('index.html');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
}

ipcMain.on('open-login', async () => {
  if (scraperWin && !scraperWin.isDestroyed()) {
    await logout();
    if (floatWin && !floatWin.isDestroyed()) {
      floatWin.webContents.send('usage-update', { found: false });
    }
    scraperWin.loadURL('https://claude.ai/login');
    scraperWin.show();
    scraperWin.focus();
  }
});

app.whenReady().then(async () => {
  cookiePath = path.join(app.getPath('userData'), 'claude-cookies.json');
  createFloatWindow();
  await createScraper();
  pollInterval = setInterval(poll, 30000);
});

app.on('window-all-closed', () => {
  if (pollInterval) clearInterval(pollInterval);
  app.quit();
});

app.on('activate', () => {
  if (floatWin && !floatWin.isDestroyed() && !floatWin.isVisible()) floatWin.show();
});
