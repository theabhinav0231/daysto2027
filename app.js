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

/* rebuild the lights when the viewport size changes (rotation etc.) */
let lightsResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(lightsResizeTimer);
  lightsResizeTimer = setTimeout(() => {
    const svg = document.querySelector('.lights');
    if (!svg) return;
    svg.querySelectorAll('.bulb, defs').forEach((n) => n.remove());
    buildLights();
  }, 250);
});

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

/* ————————————————— snow (full-sky, three depths) ————————————————— */

function buildSnow() {
  const layer = $('snow');
  if (!layer || REDUCED) return;
  layer.textContent = '';

  const vw = window.innerWidth;
  const count = Math.round(Math.min(112, Math.max(40, (vw * window.innerHeight) / 17500)));
  const rand = (min, max) => min + Math.random() * (max - min);
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const depth = roll < 0.38 ? 0 : roll < 0.81 ? 1 : 2; // 0 far, 1 mid, 2 near

    const size = depth === 0 ? rand(1.4, 2.4) : depth === 1 ? rand(2.4, 4.2) : rand(4.5, 8);
    const dur = depth === 0 ? rand(22, 34) : depth === 1 ? rand(15, 23) : rand(9, 16);
    const delay = rand(-dur, 0);
    const opacity = depth === 0 ? rand(0.3, 0.5) : depth === 1 ? rand(0.5, 0.75) : rand(0.68, 0.95);
    const drift = rand(0.15, 1) * (0.06 + depth * 0.04) * vw; // a steady breeze, not a swirl
    const sway = depth === 0 ? rand(3, 9) : depth === 1 ? rand(8, 20) : rand(16, 36);
    const swayDur = rand(3.2, 7.2);
    const swayDelay = rand(-swayDur, 0);
    const glow = depth === 0 ? 2 : depth === 1 ? 5 : 9;

    const flake = document.createElement('i');
    flake.style.cssText =
      `--x:${rand(0, 100).toFixed(2)}%;` +
      `--size:${size.toFixed(1)}px;` +
      `--dur:${dur.toFixed(1)}s;` +
      `--delay:${delay.toFixed(1)}s;` +
      `--drift:${drift.toFixed(1)}px;` +
      `--sway:${sway.toFixed(1)}px;` +
      `--sway-dur:${swayDur.toFixed(1)}s;` +
      `--sway-delay:${swayDelay.toFixed(1)}s;` +
      `--o:${opacity.toFixed(2)};` +
      `--glow:${glow}px`;

    if (depth === 2 && Math.random() < 0.13) flake.classList.add('star');
    if (depth > 0 && Math.random() < 0.3) {
      flake.classList.add('twinkle');
      flake.style.setProperty('--twinkle-dur', `${rand(2.6, 5.2).toFixed(1)}s`);
      flake.style.setProperty('--twinkle-delay', `${rand(-5, 0).toFixed(1)}s`);
    }

    frag.appendChild(flake);
  }

  // a few large, out-of-focus flakes for depth
  const bokehCount = vw > 900 ? 4 : 2;
  for (let i = 0; i < bokehCount; i++) {
    const size = rand(10, 17);
    const dur = rand(18, 28);
    const flake = document.createElement('i');
    flake.classList.add('bokeh');
    flake.style.cssText =
      `--x:${rand(0, 100).toFixed(2)}%;` +
      `--size:${size.toFixed(1)}px;` +
      `--dur:${dur.toFixed(1)}s;` +
      `--delay:${rand(-dur, 0).toFixed(1)}s;` +
      `--drift:${(rand(0.2, 1) * 0.08 * vw).toFixed(1)}px;` +
      `--sway:${rand(18, 40).toFixed(1)}px;` +
      `--sway-dur:${rand(4.5, 8).toFixed(1)}s;` +
      `--sway-delay:${rand(-8, 0).toFixed(1)}s;` +
      `--o:${rand(0.12, 0.22).toFixed(2)};` +
      `--glow:0px`;
    frag.appendChild(flake);
  }

  layer.appendChild(frag);
}

/* ————————————————— string lights (top-left swags) ————————————————— */

function buildLights() {
  const svg = document.querySelector('.lights');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const palette = [
    ['#FF4D4D', '#FFC4C4', '#C22F3C'],  // red
    ['#FFC94D', '#FFEBB0', '#D79B22'],  // warm yellow
    ['#4DE28C', '#B6F5D2', '#21A65C'],  // green
    ['#4DA8FF', '#C4E2FF', '#2676C9'],  // blue
    ['#C77DFF', '#E9C9FF', '#8B4CC4'],  // purple
    ['#FF9E4D', '#FFD6B5', '#D76F1F'],  // orange
  ];
  const counts = [6, 6, 10, 6, 9];
  const rand = (min, max) => min + Math.random() * (max - min);

  // bulbs scale up on small screens so they stay visible in phone UI
  const scale = (svg.clientWidth || 700) / 780;
  const s = Math.min(2.4, Math.max(1, 1 / Math.max(scale, 0.01)));

  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  const defs = el('defs', {});

  // shared white-hot bloom + core gradients
  const bloomGrad = el('radialGradient', { id: 'bulb-bloom' });
  [['0%', 0.98], ['14%', 0.78], ['34%', 0.46], ['58%', 0.18], ['80%', 0.05], ['100%', 0]].forEach(([o, op]) => {
    bloomGrad.appendChild(el('stop', { offset: o, 'stop-color': '#FFFFFF', 'stop-opacity': op }));
  });
  const coreGrad = el('radialGradient', { id: 'bulb-core' });
  [['0%', 1], ['28%', 0.98], ['55%', 0.62], ['78%', 0.18], ['100%', 0]].forEach(([o, op]) => {
    coreGrad.appendChild(el('stop', { offset: o, 'stop-color': '#FFFFFF', 'stop-opacity': op }));
  });
  const washGrad = el('radialGradient', { id: 'bulb-wash' });
  [['0%', 0.55], ['30%', 0.26], ['62%', 0.07], ['100%', 0]].forEach(([o, op]) => {
    washGrad.appendChild(el('stop', { offset: o, 'stop-color': '#FFFFFF', 'stop-opacity': op }));
  });
  defs.append(bloomGrad, coreGrad, washGrad);

  // one glass gradient, halo and wide aura per color
  palette.forEach(([base, light, deep], i) => {
    const glass = el('radialGradient', { id: `bulb-glass-${i}`, fx: '32%', fy: '28%' });
    [
      ['0%', light, 1],
      ['32%', base, 1],
      ['70%', base, 0.97],
      ['100%', deep, 1],
    ].forEach(([o, c, op]) => {
      glass.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }));
    });

    const halo = el('radialGradient', { id: `bulb-halo-${i}` });
    [
      ['0%', light, 0.98],
      ['16%', base, 0.7],
      ['40%', base, 0.34],
      ['66%', base, 0.12],
      ['84%', base, 0.04],
      ['100%', base, 0],
    ].forEach(([o, c, op]) => {
      halo.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }));
    });

    const aura = el('radialGradient', { id: `bulb-aura-${i}` });
    [
      ['0%', base, 0.35],
      ['30%', base, 0.15],
      ['62%', base, 0.045],
      ['100%', base, 0],
    ].forEach(([o, c, op]) => {
      aura.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }));
    });

    defs.append(glass, halo, aura);
  });
  svg.appendChild(defs);

  svg.querySelectorAll('path.wire').forEach((path, pi) => {
    const len = path.getTotalLength();
    const n = counts[pi] || 5;
    for (let i = 0; i < n; i++) {
      const pt = path.getPointAtLength(len * (0.06 + 0.88 * (i / (n - 1))));
      const ci = (i + pi * 2) % palette.length;
      const x = pt.x;
      const yTop = pt.y + 2;             // socket hangs just under the cable
      const cy = yTop + 12 * s;
      const tw = rand(3.2, 6.4);         // each bulb breathes on its own clock
      const td = rand(-tw, 0);
      const swayDur = rand(5.5, 10);
      const swayDelay = rand(-swayDur, 0);

      const g = el('g', { class: 'bulb' });
      g.style.setProperty('--tw', `${tw.toFixed(2)}s`);
      g.style.setProperty('--td', `${td.toFixed(2)}s`);
      g.style.setProperty('--peak', rand(0.72, 1).toFixed(2));
      g.style.setProperty('--sway-dur', `${swayDur.toFixed(2)}s`);
      g.style.setProperty('--sway-delay', `${swayDelay.toFixed(2)}s`);
      g.style.setProperty('--pivot', `${x.toFixed(1)}px ${yTop.toFixed(1)}px`);
      if (Math.random() < 0.18) g.classList.add('steady');

      // wide white wash that lets the string light the sky around it
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (30 * s).toFixed(1), fill: 'url(#bulb-wash)', class: 'wash' }));
      // wide ambient tint
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (32 * s).toFixed(1), fill: `url(#bulb-aura-${ci})`, class: 'aura' }));
      // soft colored halo
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (18 * s).toFixed(1), fill: `url(#bulb-halo-${ci})`, class: 'halo' }));
      // socket: dark cap + faint metal highlight
      g.appendChild(el('rect', { x: (x - 2.6 * s).toFixed(1), y: yTop.toFixed(1), width: (5.2 * s).toFixed(1), height: (7 * s).toFixed(1), rx: (1.4 * s).toFixed(1), fill: '#1B2A35' }));
      g.appendChild(el('rect', { x: (x - 2.3 * s).toFixed(1), y: (yTop + 0.5 * s).toFixed(1), width: (4.6 * s).toFixed(1), height: (1.2 * s).toFixed(1), rx: (0.6 * s).toFixed(1), fill: '#5A6E7C', opacity: '0.55' }));
      // white bloom behind the glass
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (12 * s).toFixed(1), fill: 'url(#bulb-bloom)', class: 'bloom' }));
      // glass bulb + specular glint
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (6.8 * s).toFixed(1), fill: `url(#bulb-glass-${ci})`, stroke: palette[ci][2], 'stroke-opacity': '0.5', 'stroke-width': (0.6 * s).toFixed(2), class: 'glass' }));
      const specX = x - 2.4 * s;
      const specY = cy - 2.8 * s;
      g.appendChild(el('ellipse', { cx: specX.toFixed(1), cy: specY.toFixed(1), rx: (1.5 * s).toFixed(1), ry: (2.2 * s).toFixed(1), fill: '#FFFFFF', opacity: '0.58', transform: `rotate(-30 ${specX.toFixed(1)} ${specY.toFixed(1)})`, class: 'spec' }));
      // white-hot center
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (4 * s).toFixed(1), fill: 'url(#bulb-core)', class: 'core' }));
      g.appendChild(el('circle', { cx: x.toFixed(1), cy: cy.toFixed(1), r: (1.2 * s).toFixed(1), fill: '#FFFFFF', class: 'filament' }));

      // occasional star glint at the brightest part of the cycle
      if (Math.random() < 0.72) {
        const gg = el('g', { transform: `translate(${x.toFixed(1)}, ${cy.toFixed(1)}) scale(${(s * 0.8).toFixed(2)})` });
        gg.appendChild(el('path', {
          d: 'M0,-7 C1,-2 2,-1 7,0 C2,1 1,2 0,7 C-1,2 -2,1 -7,0 C-2,-1 -1,-2 0,-7 Z',
          fill: '#FFFFFF',
          class: 'glint',
        }));
        g.appendChild(gg);
      }

      svg.appendChild(g);
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
  buildSnow();
  buildLights();
  $('musicBtn').innerHTML = ICON_MUSIC;

  tick();
  setInterval(tick, 250);
})();
