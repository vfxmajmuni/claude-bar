# claude-bar

Electron-застосунок: маленька прозора плашка поверх всіх вікон macOS, яка кожні 30 секунд показує usage limit сесії Claude.

## Запуск

```bash
npm install
npm start
```

## Архітектура

Два `BrowserWindow`:

| Вікно | Файл | Роль |
|-------|------|------|
| `floatWin` | `index.html` + `renderer.js` | Прозора плашка 224×130, `alwaysOnTop`, без рамки |
| `scraperWin` | — | Прихований браузер, scraping `claude.ai/settings/usage` |

**IPC-потік:**
```
scraperWin → did-navigate-in-page('/settings/usage') → runScrape() → ipcMain → floatWin ('usage-update') → renderer.js
```

**Polling:** `setInterval(poll, 30000)` в `main.js` — перезавантажує `/settings` кожні 30с.

## Файли

| Файл | Призначення |
|------|-------------|
| `main.js` | Головний процес: два вікна, scraping логіка, polling |
| `index.html` | UI плашки (CSS + розмітка) |
| `renderer.js` | Логіка рендерингу: форматування часу, кольори прогрес-барів |
| `preload.js` | Bridge для floatWin: `claudeBar.onUpdate`, `claudeBar.openLogin` |
| `preload-scraper.js` | No-op (зарезервовано для scraperWin) |

## Scraping логіка

`doScrape()` читає зі сторінки `/settings/usage`:
- `[role="progressbar"]` — перші чотири бари: `percent` (сесія), `weeklyPercent`, `designPercent`
- Регулярка `/Resets? in \d+ hr \d+ min/i` → `resetMinutes` та `resetText`

Колір dots/bars:
- `crit` (<15хв або ≥90%) — червоний, блимає
- `warn` (≤45хв або ≥70%) — жовтий
- `ok` — зелений

## SPA navigation — ключовий інсайт

`/settings/usage` як прямий URL redirectить на main page (SPA не ініціалізований). Правильний flow:
1. Завантажити `/settings` (full URL — працює)
2. Клікнути вкладку "Usage": `a[href$="/settings/usage"]`
3. Клік тригерить SPA навігацію → `did-navigate-in-page` з `/settings/usage`
4. `runScrape()` на `/settings/usage`

Після логіну Electron сесія робить SPA redirect з `/login` → `/new` (не HTTP!), тому треба слухати `did-navigate-in-page`, а не тільки `did-finish-load`.

| Event | Коли |
|-------|------|
| `did-navigate` | Зовнішня навігація (`loadURL`), HTTP redirects |
| `did-finish-load` | Кінцева сторінка після full page load |
| `did-navigate-in-page` | SPA navigation (React Router / `history.pushState`) |

## Відомі проблеми

### 1. ~~LevelDB LOCK при `partition: 'persist:claude'`~~ — ВИРІШЕНО

`partition` прибрано назавжди. Натомість реалізована ручна cookie persistence:
- **Save:** `saveCookies()` одразу після підтвердження логіну І після успішного scrape → `{userData}/claude-cookies.json`
- **Restore:** `restoreCookies()` при старті через `session.defaultSession.cookies.set()`
- **Clear:** `clearCookies()` при редіректі на `/login` (якщо `isLoggedIn`) або через кнопку "логін"
- Фільтр cookies: `{ url: 'https://claude.ai' }` — НЕ `{ domain: 'claude.ai' }` (не матчить `.claude.ai`)

### 2. ~~SPA navigation після логіну~~ — ВИРІШЕНО

`did-navigate-in-page` ловить SPA redirect `/login` → `/new` після auth check з валідною сесією. Далі переходимо на `/settings`, клікаємо "Usage" tab → `did-navigate-in-page` з `/settings/usage` → scrape.

### 3. Стан `isLoggedIn`

`isLoggedIn` — глобальний boolean, скидається тільки вручну (через `open-login` IPC або redirect на `/login`). Якщо cookie протухли між сесіями — наступний poll це виявить через redirect на `/login`.

## Cookie persistence (реалізовано)

Файл: `{app.getPath('userData')}/claude-cookies.json` (~19 cookies)

Функції в `main.js`: `saveCookies()`, `restoreCookies()`, `clearCookies()`.

`sameSite` поле фільтрується — Electron приймає тільки `'unspecified'|'no_restriction'|'lax'|'strict'`.

## Залежності

- `electron` ^28 (Chromium-based, підтримує `executeJavaScript`, `webContents.session`)
- Без зовнішніх npm залежностей для runtime
