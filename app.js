/* Days to 2027 — IST countdown, calendar, pomodoro, todos. Vanilla JS, no deps. */
'use strict';

/* ————————————————— constants & helpers ————————————————— */

const IST = 'Asia/Kolkata';
const TARGET     = Date.parse('2027-01-01T00:00:00+05:30'); // midnight that starts 2027, IST
const BASE_TITLE = document.title;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const pad = (n) => String(n).padStart(2, '0');

/* IST wall-clock parts for any instant */
const istFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function istParts(ms = Date.now()) {
  const p = {};
  for (const { type, value } of istFmt.formatToParts(ms)) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    h: (+p.hour) % 24, min: +p.minute, s: +p.second,
  };
}

/* composed strings (order controlled, not locale-dependent) */
function partsOf(fmt, ms) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(ms)) {
    if (type !== 'literal') p[type] = value;
  }
  return p;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true, // no seconds
});

function istDateStr(ms) {
  const p = partsOf(dateFmt, ms);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}
function istTimeStr(ms) {
  const p = partsOf(timeFmt, ms);
  return `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/* fixed-width character cells so digits never jitter */
function setChars(el, str) {
  if (el.dataset.str === str) return;
  el.dataset.str = str;
  el.textContent = '';
  for (const ch of str) {
    const span = document.createElement('span');
    span.className = ch === ':' ? 'colon' : 'd';
    span.textContent = ch;
    el.appendChild(span);
  }
}

/* ————————————————— live IST clock (top of page) ————————————————— */

function renderNowLine(now) {
  $('nowLine').textContent = `${istDateStr(now)} · ${istTimeStr(now)} IST`;
}

/* ————————————————— countdown ————————————————— */

function renderCountdown(now) {
  const diff = Math.max(0, TARGET - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  setChars($('cdDays'), String(days).padStart(2, '0'));
  setChars($('cdHours'), pad(hours));
  setChars($('cdMins'), pad(mins));
  setChars($('cdSecs'), pad(secs));
}

/* ————————————————— calendar ————————————————— */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const cal = { y: 0, m: 0 }; // m: 0–11

function renderCalendar() {
  const today = istParts();
  $('calTitle').textContent = `${MONTHS[cal.m]} ${cal.y}`;

  const firstDow = new Date(Date.UTC(cal.y, cal.m, 1, 12)).getUTCDay();
  const dim = new Date(Date.UTC(cal.y, cal.m + 1, 0, 12)).getUTCDate();
  const prevDim = new Date(Date.UTC(cal.y, cal.m, 0, 12)).getUTCDate();
  const isCurrentMonth = cal.y === today.y && cal.m === today.m - 1;

  const grid = $('calDays');
  grid.textContent = '';

  const addCell = (num, cls) => {
    const el = document.createElement('div');
    el.className = 'day' + (cls ? ' ' + cls : '');
    el.textContent = num;
    grid.appendChild(el);
  };

  for (let i = firstDow - 1; i >= 0; i--) addCell(prevDim - i, 'out');
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(Date.UTC(cal.y, cal.m, d, 12)).getUTCDay();
    addCell(d, (isCurrentMonth && d === today.d ? 'today' : '') + (dow === 0 ? ' sun' : ''));
  }
  const trailing = (7 - ((firstDow + dim) % 7)) % 7;
  for (let d = 1; d <= trailing; d++) addCell(d, 'out');
}

$('calPrev').addEventListener('click', () => {
  cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; }
  renderCalendar();
});
$('calNext').addEventListener('click', () => {
  cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; }
  renderCalendar();
});

/* ————————————————— pomodoro ————————————————— */

const pomo = {
  state: 'idle',               // idle | running | paused
  durationMs: 30 * 60000,
  remainingMs: 30 * 60000,
  endAt: 0,
};

const focusKeyFor = (y) => `pomo:focus:${y}`;
const sessionsKeyFor = (y) => `pomo:sessions:${y}`;

/* focus time is logged only when a session completes */
function logFocus(year, ms) {
  const k = focusKeyFor(year);
  store.set(k, (store.get(k, 0) || 0) + ms);
}

function fmtHours(ms) {
  const h = Math.round((ms / 3600000) * 10) / 10;
  return `${h} hrs`;
}

function renderFocusFoot() {
  const year = String(istParts().y);
  $('focusTotal').textContent = fmtHours(store.get(focusKeyFor(year), 0) || 0);
  const sessions = store.get(sessionsKeyFor(year), 0) || 0;
  $('focusSessions').textContent = sessions > 0 ? ` · ${sessions} session${sessions === 1 ? '' : 's'}` : '';
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function renderPomo() {
  setChars($('pomoDisplay'), fmtClock(pomo.state === 'idle' ? pomo.durationMs : pomo.remainingMs));
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';

function updateControls() {
  const running = pomo.state === 'running';
  $('pomoCard').classList.toggle('running', running);
  $('pomoPlay').innerHTML = running ? ICON_STOP : ICON_PLAY;
  $('pomoPlay').setAttribute('aria-label', running ? 'Stop and reset timer' : 'Start timer');
}

let noteTimer = null;
function note(text) {
  const el = $('pomoNote');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

/* gentle three-note chime, no audio assets */
let sharedCtx = null;
function getCtx() {
  try {
    if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedCtx.state === 'suspended') sharedCtx.resume();
    return sharedCtx;
  } catch { return null; }
}
function ensureAudio() { getCtx(); }
function chime() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    [[659.25, 0], [880, 0.16], [1318.51, 0.32]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.16, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.1);
      o.connect(g).connect(ctx.destination);
      o.start(t + dt);
      o.stop(t + dt + 1.2);
    });
  } catch { /* ignore */ }
}

function setDurationFromMinutes(min) {
  pomo.durationMs = min * 60000;
  pomo.remainingMs = pomo.durationMs;
  pomo.state = 'idle';
  document.title = BASE_TITLE;
  markCurrentOption();
  updateControls();
  renderPomo();
}

/* dropdown attached to the timer display itself */
const ddMenu = $('pomoMenu');
const ddChevron = $('pomoDD');

function markCurrentOption() {
  const mins = Math.round(pomo.durationMs / 60000);
  ddMenu.querySelectorAll('.dd-option').forEach((o) => {
    o.classList.toggle('current', +o.dataset.min === mins);
  });
}

function openMenu() {
  markCurrentOption();
  ddMenu.hidden = false;
  ddChevron.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  ddMenu.hidden = true;
  ddChevron.setAttribute('aria-expanded', 'false');
}

ddChevron.addEventListener('click', () => {
  if (ddMenu.hidden) openMenu(); else closeMenu();
});

ddMenu.querySelectorAll('.dd-option').forEach((option) => {
  option.addEventListener('click', () => {
    setDurationFromMinutes(+option.dataset.min);
    closeMenu();
  });
});

document.addEventListener('click', (e) => {
  if (!ddMenu.hidden && !e.target.closest('.pomo-timer')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ddMenu.hidden) closeMenu();
});

/* play → running; stop → resets the timer */
$('pomoPlay').addEventListener('click', () => {
  const now = Date.now();
  if (pomo.state === 'running') {
    pomo.state = 'idle';
    pomo.remainingMs = pomo.durationMs;
    document.title = BASE_TITLE;
  } else {
    pomo.remainingMs = pomo.durationMs;
    pomo.endAt = now + pomo.remainingMs;
    pomo.state = 'running';
    ensureAudio();
  }
  updateControls();
  renderPomo();
});

function pomoTick(now) {
  if (pomo.state !== 'running') return;
  if (now >= pomo.endAt) {
    pomoComplete(now);
  } else {
    pomo.remainingMs = pomo.endAt - now;
    document.title = `${fmtClock(pomo.remainingMs)} · Focus — 2027`;
    renderPomo();
  }
}

/* ————————————————— Claude FM — the real stream, via YouTube audio ————————————————— */

const ICON_MUSIC = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
const CLAUDE_FM_VIDEO = 'tRsQsTMvPNg'; // the Claude FM stream
// Spotify alternative: swap the iframe src for
// https://open.spotify.com/embed/playlist/4Bt32Idh1LwwUkSruVmUse (needs one click inside the player)

let musicOn = false;
let musicFrame = null;

function toggleMusic() {
  if (!musicOn) {
    musicFrame = document.createElement('iframe');
    musicFrame.id = 'claudeFmPlayer';
    musicFrame.title = 'Claude FM';
    musicFrame.src = `https://www.youtube.com/embed/${CLAUDE_FM_VIDEO}?autoplay=1&playsinline=1&enablejsapi=1`;
    musicFrame.allow = 'autoplay; encrypted-media';
    musicFrame.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:320px;height:180px;opacity:0.01;pointer-events:none;border:0;';
    musicFrame.addEventListener('load', () => {
      try {
        musicFrame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
      } catch { /* cross-origin */ }
    });
    document.body.appendChild(musicFrame);
    musicOn = true;
  } else {
    musicFrame?.remove();
    musicFrame = null;
    musicOn = false;
  }

  const btn = $('musicBtn');
  btn.classList.toggle('on', musicOn);
  btn.setAttribute('aria-pressed', String(musicOn));
  btn.setAttribute('aria-label', musicOn ? 'Stop Claude FM' : 'Play Claude FM');
}

$('musicBtn').addEventListener('click', toggleMusic);

/* ————————————————— block browser zoom (pinch, ctrl+wheel, ctrl+±) ————————————————— */

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function pomoComplete(now) {
  const year = String(istParts(now).y);
  logFocus(year, pomo.durationMs);
  const sk = sessionsKeyFor(year);
  store.set(sk, (store.get(sk, 0) || 0) + 1);

  chime();
  note(`Session complete — ${Math.round(pomo.durationMs / 60000)} min logged.`);
  pomo.state = 'idle';
  pomo.remainingMs = pomo.durationMs;
  document.title = BASE_TITLE;
  updateControls();
  renderPomo();
  renderFocusFoot();
}

/* ————————————————— todos ————————————————— */

let todos = store.get('todos:v1', []);
if (!Array.isArray(todos)) todos = [];

const saveTodos = () => store.set('todos:v1', todos);
const todoList = $('todoList');
let lastAddedId = null;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function buildTodoList() {
  todoList.textContent = '';
  $('todoEmpty').hidden = todos.length > 0;

  const active = todos.filter((t) => !t.done).sort((a, b) => b.createdAt - a.createdAt);
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const makeItem = (t) => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (t.done ? ' done' : '') + (t.id === lastAddedId ? ' just-added' : '');
    li.dataset.id = t.id;

    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!t.done;
    input.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
    const tick = document.createElement('span');
    tick.className = 'tick';
    label.append(input, tick);

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = t.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete task');

    li.append(label, text, del);
    return li;
  };

  active.forEach((t) => todoList.appendChild(makeItem(t)));

  if (done.length > 0) {
    const divider = document.createElement('li');
    divider.className = 'todo-divider';
    divider.textContent = 'Completed';
    todoList.appendChild(divider);
    done.forEach((t) => todoList.appendChild(makeItem(t)));
  }

  lastAddedId = null;
  $('todoCount').textContent = `${done.length}/${todos.length}`;
}

/* FLIP: after re-render, items glide from their previous position */
function renderTodos(flip = false) {
  const prevTops = new Map();
  if (flip && !REDUCED) {
    todoList.querySelectorAll('.todo-item').forEach((el) => {
      prevTops.set(el.dataset.id, el.getBoundingClientRect().top);
    });
  }

  buildTodoList();

  if (flip && !REDUCED && prevTops.size) {
    requestAnimationFrame(() => {
      todoList.querySelectorAll('.todo-item').forEach((el) => {
        const before = prevTops.get(el.dataset.id);
        if (before == null) return;
        const dy = before - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 2) return;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.35s cubic-bezier(0.22, 0.9, 0.3, 1)';
          el.style.transform = '';
        });
      });
    });
  }
}

$('todoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('todoInput');
  const text = input.value.trim();
  if (!text) return;
  lastAddedId = uid();
  todos.unshift({ id: lastAddedId, text, done: false, createdAt: Date.now(), doneAt: null });
  input.value = '';
  saveTodos();
  renderTodos(true);
});

todoList.addEventListener('change', (e) => {
  const item = e.target.closest('.todo-item');
  if (!item || e.target.type !== 'checkbox') return;
  const t = todos.find((x) => x.id === item.dataset.id);
  if (!t) return;
  t.done = e.target.checked;
  t.doneAt = t.done ? Date.now() : null;
  saveTodos();
  if (t.done && !REDUCED) {
    // let the strike-through draw itself first, then glide it to the bottom
    item.classList.add('done');
    setTimeout(() => renderTodos(true), 380);
  } else {
    renderTodos(true);
  }
});

todoList.addEventListener('click', (e) => {
  const del = e.target.closest('.todo-del');
  if (!del) return;
  const item = del.closest('.todo-item');
  todos = todos.filter((x) => x.id !== item.dataset.id);
  saveTodos();
  renderTodos(true);
});

/* ————————————————— string lights (top-left swags) ————————————————— */

function buildLights() {
  const svg = document.querySelector('.lights');
  if (!svg) return;
  const palette = ['#FF4D4D', '#FFD24D', '#4DE28C', '#4DA8FF', '#C77DFF', '#FF9E4D'];
  const counts = [6, 6, 10, 6, 9];
  svg.querySelectorAll('path.wire').forEach((path, pi) => {
    const len = path.getTotalLength();
    const n = counts[pi] || 5;
    for (let i = 0; i < n; i++) {
      const pt = path.getPointAtLength(len * (0.06 + 0.88 * (i / (n - 1))));
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', pt.x.toFixed(1));
      c.setAttribute('cy', (pt.y + 7).toFixed(1));
      c.setAttribute('r', '5');
      const col = palette[(i + pi * 2) % palette.length];
      c.setAttribute('fill', col);
      c.setAttribute('class', 'bulb');
      c.style.color = col;
      c.style.filter = `drop-shadow(0 0 6px ${col}) drop-shadow(0 0 14px ${col})`;
      c.style.animationDelay = `${(Math.random() * -2.8).toFixed(2)}s`;
      svg.appendChild(c);
    }
  });
}

/* ————————————————— main loop & boot ————————————————— */

let lastSecKey = '';

function tick() {
  const now = Date.now();
  const ist = istParts(now);
  const secKey = `${ist.y}-${ist.m}-${ist.d}-${ist.h}-${ist.min}-${ist.s}`;

  if (secKey !== lastSecKey) {
    lastSecKey = secKey;
    renderNowLine(now);
    renderCountdown(now);
  }
  pomoTick(now);
}

(function boot() {
  const ist = istParts();
  cal.y = ist.y;
  cal.m = ist.m - 1;

  renderNowLine(Date.now());
  renderCountdown(Date.now());
  renderCalendar();
  setDurationFromMinutes(30); // default 30 min
  renderFocusFoot();
  buildTodoList();
  buildLights();
  $('musicBtn').innerHTML = ICON_MUSIC;

  tick();
  setInterval(tick, 250);
})();
