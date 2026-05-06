function colorClass(mins) {
  if (mins === null || mins === undefined) return '';
  if (mins <= 15) return 'crit';
  if (mins <= 45) return 'warn';
  return '';
}
function barColor(pct) {
  if (pct >= 90) return 'crit';
  if (pct >= 70) return 'warn';
  return '';
}
function fmt(mins) {
  if (mins === null || mins === undefined) return '--:--';
  if (mins <= 0) return '0:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `0:${String(m).padStart(2,'0')}`;
}
function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `оновлено ${s}с тому`;
  return `оновлено ${Math.round(s/60)}хв тому`;
}

let lastTs = null;

function render(data) {
  const dot     = document.getElementById('dot');
  const timer   = document.getElementById('timer');
  const bars    = document.getElementById('bars');
  const updated = document.getElementById('updated');

  const loginBtn = document.getElementById('loginBtn');
  if (!data || !data.found) {
    lastTs = null;
    dot.className = 'dot load';
    timer.textContent = '--:--';
    timer.className = 'timer';
    bars.innerHTML = '<div class="no-data">Чекаємо дані...</div>';
    updated.textContent = 'оновлення кожні 30с';
    loginBtn.textContent = '↗ логін';
    return;
  }
  loginBtn.textContent = '↗ вийти';

  lastTs = data.timestamp;
  const tc = colorClass(data.resetMinutes);
  dot.className = 'dot' + (tc ? ' ' + tc : ' ok');
  timer.textContent = fmt(data.resetMinutes);
  timer.className = 'timer' + (tc ? ' ' + tc : '');
  updated.textContent = timeAgo(data.timestamp);

  const rows = [
    { name: 'Сесія',   pct: data.percent },
    { name: 'Тиждень', pct: data.weeklyPercent },
    { name: 'Design',  pct: data.designPercent },
  ].filter(r => r.pct !== null && r.pct !== undefined);

  bars.innerHTML = rows.map(r => `
    <div class="bar-row">
      <span class="bar-name">${r.name}</span>
      <div class="track"><div class="fill ${barColor(r.pct)}" style="width:${r.pct}%"></div></div>
      <span class="pct">${r.pct}%</span>
    </div>`).join('');
}

window.claudeBar.onUpdate((data) => render(data));

document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.getElementById('loginBtn').addEventListener('click', () => window.claudeBar.openLogin());

setInterval(() => {
  if (lastTs) document.getElementById('updated').textContent = timeAgo(lastTs);
}, 60000);
