// Kleine UI-Bausteine: Formatierung, Toasts, Dialoge, Tooltip, Konfetti, Ton.

import { addDays, parseDay } from './logic.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// ---------------------------------------------------------------- Formatierung

const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export const fmtNum = (n) => nf.format(Math.round(n));

export function fmtMin(m) {
  m = Math.round(m);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} Min` : `${h} h`;
}

// Unter 10 Stunden genau ("2 h 15 Min"), darüber kompakt ("12,5 h")
export function fmtHours(m) {
  if (m < 600) return fmtMin(m);
  const h = m / 60;
  return `${h < 100 ? nf1.format(h) : nf.format(Math.round(h))} h`;
}

export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const dfShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const dfLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const dfDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const dfWd = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const dfMonth = new Intl.DateTimeFormat('de-DE', { month: 'short' });

export function fmtDay(key, today) {
  if (key === today) return 'Heute';
  if (key === addDays(today, -1)) return 'Gestern';
  return dfShort.format(parseDay(key));
}
export const fmtLongDay = (key) => dfLong.format(parseDay(key));
export const fmtDate = (key) => dfDate.format(parseDay(key));
export const fmtWeekday = (key) => dfWd.format(parseDay(key)).replace('.', '');
export const fmtMonth = (key) => dfMonth.format(parseDay(key)).replace('.', '');

export function fmtAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

// ---------------------------------------------------------------- Toasts

export function toast({ icon = '✨', title, text = '', kind = 'info', timeout = 3600 }) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const i = document.createElement('span');
  i.className = 'toast-icon';
  i.textContent = icon;
  const body = document.createElement('div');
  const t = document.createElement('strong');
  t.textContent = title;
  body.append(t);
  if (text) {
    const p = document.createElement('span');
    p.textContent = text;
    body.append(p);
  }
  el.append(i, body);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', close);
  setTimeout(close, timeout);
}

// ---------------------------------------------------------------- Dialoge

// Öffnet den Haupt-Dialog. onSubmit(form, submitter) → true schließt den Dialog.
export function openModal({
  title,
  body,
  submitLabel = 'Speichern',
  submitClass = 'btn-primary',
  extra = '',
  cancel = true,
  onSubmit,
  onInput,
  onAction,
  onClose,
  wide = false,
}) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  dlg.innerHTML = `
    <form class="modal-inner" novalidate>
      <header class="modal-head">
        <h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      <footer class="modal-foot">
        ${extra}
        <span class="spacer"></span>
        ${cancel ? '<button type="button" class="btn btn-ghost" data-close>Abbrechen</button>' : ''}
        ${submitLabel ? `<button type="submit" class="btn ${submitClass}">${esc(submitLabel)}</button>` : ''}
      </footer>
    </form>`;
  const form = dlg.querySelector('form');
  const close = () => {
    if (dlg.open) dlg.close();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    // Hat onSubmit einen neuen Dialog geöffnet (z. B. Level-Up), bleibt dieser offen
    if ((await onSubmit(form, e.submitter)) && dlg.contains(form)) close();
  });
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-close')) close();
    else if (btn.dataset.modalAction && onAction) onAction(btn.dataset.modalAction, form, btn);
  });
  if (onInput) {
    form.addEventListener('input', (e) => onInput(form, e));
    form.addEventListener('change', (e) => onInput(form, e));
  }
  dlg.onclose = () => onClose?.();
  if (!dlg.open) dlg.showModal();
  if (onInput) onInput(form, null);
  const first = form.querySelector('[autofocus]');
  if (first) first.focus();
  return { dlg, form, close };
}

export function closeModal() {
  const dlg = $('#modal');
  if (dlg.open) dlg.close();
}

export function confirmDialog(message, { title = 'Sicher?', okLabel = 'OK', danger = false } = {}) {
  const dlg = $('#confirm');
  dlg.innerHTML = `
    <form method="dialog" class="modal-inner">
      <header class="modal-head"><h2 id="confirm-title">${esc(title)}</h2></header>
      <div class="modal-body"><p>${esc(message)}</p></div>
      <footer class="modal-foot">
        <span class="spacer"></span>
        <button value="no" class="btn btn-ghost">Abbrechen</button>
        <button value="yes" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(okLabel)}</button>
      </footer>
    </form>`;
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === 'yes');
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- Tooltip

// Elemente mit data-tv (Wert) und data-tl (Beschriftung) zeigen beim Hover,
// Fokus oder Antippen einen Tooltip. Inhalte werden per textContent gesetzt.
export function initTooltips() {
  const tip = $('#tip');
  let current = null;
  const show = (el) => {
    current = el;
    tip.replaceChildren();
    const v = document.createElement('strong');
    v.textContent = el.dataset.tv || '';
    const l = document.createElement('span');
    l.textContent = el.dataset.tl || '';
    tip.append(v, l);
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.classList.add('hot');
  };
  const hide = () => {
    current?.classList.remove('hot');
    current = null;
    tip.hidden = true;
  };
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tv]');
    if (el) show(el);
    else if (current) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tv]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

// ---------------------------------------------------------------- Konfetti

const CONFETTI_COLORS = ['#6250d6', '#eb6834', '#eda100', '#1baf7a', '#e87ba4', '#2a78d6'];
let particles = [];
let rafId = 0;

export function confetti(count = 140) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('#confetti');
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.38,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 13 - 5,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
  if (rafId) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const step = () => {
    ctx.clearRect(0, 0, w, h);
    particles = particles.filter((p) => p.y < h + 20);
    for (const p of particles) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (particles.length) rafId = requestAnimationFrame(step);
    else {
      rafId = 0;
      ctx.clearRect(0, 0, w, h);
    }
  };
  rafId = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- Ton

let audioCtx = null;

function audio() {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Ohne vorherige Interaktion blockiert der Browser Ton und Vibration ohnehin
const mayPlay = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;

function tone(ctx, freq, at, { length = 0.6, volume = 0.25, type = 'sine' } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
  return osc;
}

export function chime() {
  if (!mayPlay()) return;
  try {
    const ctx = audio();
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone(ctx, freq, ctx.currentTime + i * 0.16));
  } catch {
    /* Ton ist optional */
  }
  navigator.vibrate?.([200, 100, 200, 100, 400]);
}

// Wecker: klingelt alle 2 Sekunden, bis stopAlarm() kommt (spätestens nach `seconds`).
// Alle Töne werden sofort im Audio-Thread eingeplant – so klingeln sie auch dann
// pünktlich weiter, wenn der Browser die Seite im Hintergrund drosselt.
let alarm = null;

export function startAlarm({ seconds = 60, onEnd } = {}) {
  stopAlarm();
  const nodes = [];
  if (mayPlay()) {
    try {
      // Wie der iPhone-Wecker auch im Lautlos-Modus hörbar
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      const ctx = audio();
      const t0 = ctx.currentTime + 0.05;
      for (let ring = 0; ring * 2 < seconds; ring++) {
        [880, 1108.73, 1318.51, 880, 1108.73, 1318.51].forEach((freq, i) => {
          nodes.push(tone(ctx, freq, t0 + ring * 2 + i * 0.13 + (i >= 3 ? 0.12 : 0), { length: 0.22, volume: 0.35, type: 'triangle' }));
        });
      }
    } catch {
      /* Ton ist optional */
    }
    navigator.vibrate?.([600, 300, 600, 300, 600, 300, 600, 300, 600]);
  }
  alarm = { nodes, onEnd, timeout: setTimeout(stopAlarm, seconds * 1000) };
}

export function stopAlarm() {
  if (!alarm) return;
  const { nodes, onEnd, timeout } = alarm;
  alarm = null;
  clearTimeout(timeout);
  for (const node of nodes) {
    try {
      node.stop();
      node.disconnect();
    } catch {
      /* schon beendet */
    }
  }
  navigator.vibrate?.(0);
  if (navigator.audioSession) navigator.audioSession.type = 'auto';
  onEnd?.();
}

export const alarmRinging = () => alarm !== null;

// Muss einmal durch eine Nutzeraktion "entsperrt" werden (v. a. iOS).
export function unlockAudio() {
  try {
    audio();
  } catch {
    /* ignorieren */
  }
}
