// Einstiegspunkt: Routing, Rendering, Aktionen, Timer, Belohnungen und Sync.

import * as store from './store.js';
import {
  XP_RULES,
  canonical,
  computeStats,
  dayKey,
  isValidDay,
  isoWeekday,
  mergeStates,
  normalizeState,
  reminderContext,
  reminderMessage,
  sessionXP,
  widgetSummary,
} from './logic.js';
import { WIDGET_FILE, syncWithGist, widgetDataUrl } from './sync.js';
import { bookForm, projectForm, sessionForm, syncCard, views, widgetCard } from './views.js';
import { $, $$, chime, closeModal, confetti, confirmDialog, esc, fmtClock, fmtNum, initTooltips, openModal, toast, unlockAudio } from './ui.js';

const VERSION = '1.1.0';
const APP_URL = new URL('./', location.href).href;
const ROUTES = Object.keys(views);
const ui = { libraryTab: 'books', historyLimit: 30, syncStatus: 'idle', syncError: '' };
let stats = null;
let timer = store.getTimer();
let renderedDay = dayKey();
let celebrating = false;
let installPrompt = null;

// ---------------------------------------------------------------- Rendering

function route() {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'heute';
}

function context() {
  return {
    state: store.getState(),
    stats,
    prefs: store.getPrefs(),
    timer,
    ui,
    route: route(),
    version: VERSION,
    canInstall: !!installPrompt,
  };
}

function render() {
  renderedDay = dayKey();
  stats = computeStats(store.getState(), renderedDay);
  const ctx = context();
  const active = document.activeElement?.id;
  $('#view').innerHTML = views[ctx.route](ctx);
  if (active && document.getElementById(active) && !$('#modal').open) document.getElementById(active).focus();
  renderChrome(ctx);
  updateTimerUI();
  if (ctx.route === 'erinnerungen') loadWidgetScript().catch(() => {});
}

function renderChrome(ctx = context()) {
  for (const a of $$('[data-route]')) a.setAttribute('aria-current', a.dataset.route === ctx.route ? 'page' : 'false');
  const L = stats.level;
  const s = stats.streak;
  $('#chip-level').textContent = `Lv ${L.level}`;
  $('#chip-streak').textContent = `🔥 ${s.current}`;
  $('#chip-streak').classList.toggle('is-lit', s.todayMet);
  $('#side-level').innerHTML = `
    <div class="side-level-top"><span>${L.icon} Level ${L.level}</span><span>🔥 ${s.current}</span></div>
    <div class="xpbar small"><span style="width:${(L.pct * 100).toFixed(1)}%"></span></div>
    <div class="side-level-meta">${esc(L.title)} · ${fmtNum(L.toNext)} XP bis Lv ${L.level + 1}</div>`;
  const sync = ctx.prefs.sync;
  const syncEl = $('#sync-indicator');
  syncEl.hidden = !sync?.token;
  syncEl.dataset.status = ui.syncStatus;
  syncEl.title =
    ui.syncStatus === 'error'
      ? `Sync-Fehler: ${ui.syncError}`
      : ui.syncStatus === 'syncing'
        ? 'Synchronisiere …'
        : ui.syncStatus === 'offline'
          ? 'Offline'
          : 'Synchronisiert';
  $('#mini-timer').hidden = !timer || ctx.route === 'fokus';
  document.body.classList.toggle('has-mini-timer', !!timer && ctx.route !== 'fokus');
}

function applyTheme() {
  const theme = store.getPrefs().theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#121211' : '#f6f5f2');
}

// ---------------------------------------------------------------- Belohnungen

function withCelebration(mutate) {
  const before = stats || computeStats(store.getState(), dayKey());
  celebrating = true;
  try {
    mutate();
  } finally {
    celebrating = false;
  }
  celebrate(before, stats || computeStats(store.getState(), dayKey()));
}

function celebrate(before, after) {
  let party = false;
  const gained = after.totalXP - before.totalXP;
  if (gained > 0)
    toast({ icon: '✨', title: `+${fmtNum(gained)} XP`, text: `${fmtNum(after.level.toNext)} XP bis Level ${after.level.level + 1}`, kind: 'xp' });

  const bt = before.todayAgg;
  const at = after.todayAgg;
  if (!bt.workGoal && at.workGoal) toast({ icon: '🎯', title: 'Fokus-Ziel erreicht!', text: `+${XP_RULES.goalBonus} XP Bonus`, kind: 'xp' });
  if (!bt.readGoal && at.readGoal) toast({ icon: '📖', title: 'Lese-Ziel erreicht!', text: `+${XP_RULES.goalBonus} XP Bonus`, kind: 'xp' });
  if (!bt.perfect && at.perfect && after.goals.workMin > 0 && after.goals.readPages > 0) {
    toast({ icon: '💎', title: 'Perfekter Tag!', text: 'Alle Tagesziele geschafft.', kind: 'xp' });
    party = true;
  }
  if (!before.streak.todayMet && after.streak.todayMet && after.streak.current > 1) {
    toast({ icon: '🔥', title: `${after.streak.current} Tage Streak!`, text: 'Weiter so – morgen wieder.', kind: 'xp' });
  }
  const doneBefore = new Set(bt.quests.filter((q) => q.done).map((q) => q.id));
  for (const q of at.quests) {
    if (q.done && !doneBefore.has(q.id)) toast({ icon: q.icon, title: `Quest erfüllt: ${q.title}`, text: `+${q.xp} XP`, kind: 'xp' });
  }
  if (after.totals.booksFinished > before.totals.booksFinished) {
    const id = Object.keys(after.books).find((k) => after.books[k].finished && !before.books[k]?.finished);
    const book = id && store.getState().books[id];
    toast({ icon: '🎉', title: 'Buch beendet!', text: `${book ? `„${book.title}“ · ` : ''}+${XP_RULES.bookFinished} XP`, kind: 'xp', timeout: 5000 });
    party = true;
  }
  const seen = new Set(before.achievements.filter((a) => a.done).map((a) => a.id));
  for (const a of after.achievements) {
    if (a.done && !seen.has(a.id)) {
      toast({ icon: a.icon, title: `Abzeichen: ${a.title}`, text: a.desc, kind: 'badge', timeout: 5000 });
      party = true;
    }
  }
  if (after.level.level > before.level.level) {
    levelUp(after);
    party = true;
  }
  if (party) confetti();
  rememberSeen(after);
}

function levelUp(s) {
  const L = s.level;
  openModal({
    title: 'Level-Up!',
    body: `
      <div class="levelup">
        <div class="levelup-badge">${L.icon}</div>
        <p class="levelup-level">Level ${L.level}</p>
        <p class="levelup-title">${esc(L.title)}</p>
        <p class="muted">${L.nextTitle ? `Nächster Rang: ${L.nextTitle.icon} ${esc(L.nextTitle.title)} ab Level ${L.nextTitle.level}` : 'Du hast den höchsten Rang erreicht.'}</p>
      </div>`,
    submitLabel: 'Weiter so!',
    cancel: false,
  });
}

function rememberSeen(s) {
  store.setPrefs({ seenAchievements: s.achievements.filter((a) => a.done).map((a) => a.id), lastLevel: s.level.level });
}

// Für Änderungen, die nicht durch eine eigene Aktion entstehen (Sync, Import, anderer Tab)
function checkSeen() {
  if (celebrating) return;
  const prefs = store.getPrefs();
  if (prefs.seenAchievements === null || prefs.lastLevel === null) return rememberSeen(stats);
  const seen = new Set(prefs.seenAchievements);
  for (const a of stats.achievements) {
    if (a.done && !seen.has(a.id)) toast({ icon: a.icon, title: `Abzeichen: ${a.title}`, text: a.desc, kind: 'badge' });
  }
  if (stats.level.level > prefs.lastLevel)
    toast({ icon: stats.level.icon, title: `Level ${stats.level.level} erreicht!`, text: stats.level.title, kind: 'xp' });
  rememberSeen(stats);
}

// ---------------------------------------------------------------- Timer

const elapsedMs = (t, now = Date.now()) => t.accMs + (t.runStart ? now - t.runStart : 0);

function saveTimer(next) {
  timer = next;
  store.setTimer(next);
  updateWakeLock();
}

function startTimer(kind, ref, minutes) {
  if (timer) {
    toast({ icon: '⏱️', title: 'Es läuft bereits eine Session', text: 'Beende sie zuerst.' });
    location.hash = '#/fokus';
    return;
  }
  unlockAudio();
  const now = Date.now();
  saveTimer({ kind, ref: ref || '', targetMin: minutes || 0, startedAt: now, accMs: 0, runStart: now, alerted: false });
  if (route() === 'fokus') render();
  else location.hash = '#/fokus';
}

function toggleTimer() {
  if (!timer) return;
  const now = Date.now();
  if (timer.runStart) saveTimer({ ...timer, accMs: timer.accMs + (now - timer.runStart), runStart: null });
  else {
    unlockAudio();
    saveTimer({ ...timer, runStart: now });
  }
  render();
}

function updateTimerUI() {
  const mini = $('#mini-timer');
  if (!timer) {
    document.title = 'Fortschritt';
    return;
  }
  const ms = elapsedMs(timer);
  const target = timer.targetMin * 60000;
  const countdown = target > 0;
  const over = countdown && ms >= target;
  const shown = countdown && !over ? target - ms : ms - (over ? target : 0);
  const clock = `${over ? '+' : ''}${fmtClock(shown)}`;
  const xp = sessionXP({ kind: timer.kind, minutes: Math.floor(ms / 60000), pages: 0 });

  const time = $('#timer-time');
  if (time) {
    time.textContent = clock;
    const sub = $('#timer-sub');
    const goalText = countdown ? (over ? 'Zeit um – super! Beende, wenn du so weit bist.' : `von ${fmtClock(target)}`) : 'freie Session';
    sub.textContent = `${goalText} · +${xp} XP`;
    const ringEl = $('#timer-progress');
    const c = Number(ringEl.dataset.c);
    const frac = countdown ? Math.min(1, ms / target) : (ms % 3600000) / 3600000;
    ringEl.setAttribute('stroke-dashoffset', (c * (1 - frac)).toFixed(2));
    $('#timer-card').classList.toggle('is-over', over);
  }
  if (!mini.hidden) {
    $('#mini-time').textContent = clock;
    $('#mini-kind').textContent = timer.kind === 'work' ? '🎯' : '📖';
    $('#mini-toggle').textContent = timer.runStart ? '⏸' : '▶';
    $('#mini-toggle').setAttribute('aria-label', timer.runStart ? 'Pause' : 'Weiter');
  }
  document.title = `${timer.runStart ? '⏱' : '⏸'} ${clock} · Fortschritt`;

  if (over && !timer.alerted) {
    saveTimer({ ...timer, alerted: true });
    chime();
    toast({ icon: '⏰', title: 'Zeit um!', text: 'Beende die Session, um deine XP einzusammeln.', kind: 'xp', timeout: 8000 });
    notify('Zeit um! ⏰', 'Deine Fokus-Session ist vorbei. Sammle deine XP ein.');
  }
}

async function systemNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag });
    else new Notification(title, { body, icon: 'icons/icon-192.png', tag });
    return true;
  } catch {
    return false;
  }
}

function notify(title, body) {
  if (document.hidden) systemNotification(title, body, 'timer');
}

let wakeLock = null;
async function updateWakeLock() {
  const want = !!timer?.runStart && store.getPrefs().wakeLock && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

function stopTimer() {
  if (!timer) return;
  const now = Date.now();
  if (timer.runStart) saveTimer({ ...timer, accMs: timer.accMs + (now - timer.runStart), runStart: null });
  const minutes = Math.max(1, Math.round(timer.accMs / 60000));
  const pref = { kind: timer.kind, day: dayKey(new Date(timer.startedAt)), minutes };
  if (timer.kind === 'work') pref.projectId = timer.ref;
  else pref.bookId = timer.ref;
  sessionDialog(pref, { mode: 'timer' });
  render();
}

async function discardTimer() {
  if (!timer) return;
  const ok = await confirmDialog('Die laufende Session wird nicht gespeichert.', { title: 'Session verwerfen?', okLabel: 'Verwerfen', danger: true });
  if (!ok) return;
  saveTimer(null);
  render();
}

// ---------------------------------------------------------------- Dialoge

function currentPageOf(bookId, excludeSession) {
  const bs = stats.books[bookId];
  if (!bs) return null;
  let page = bs.currentPage;
  if (excludeSession && excludeSession.bookId === bookId && !excludeSession.deleted) page -= Number(excludeSession.pages) || 0;
  return page;
}

function sessionDialog(preset, { mode }) {
  const editing = mode === 'edit' ? store.getState().sessions[preset.id] : null;
  const ctx = context();
  let lastBook = null;
  const title = mode === 'timer' ? 'Session speichern' : mode === 'edit' ? 'Session bearbeiten' : 'Session nachtragen';
  const sync = (form, e) => {
    const kind = form.elements.kind.value || 'work';
    form.querySelector('.form-session').dataset.kind = kind;
    const bookId = form.elements.bookId.value;
    const base = bookId ? currentPageOf(bookId, editing) : null;
    const book = bookId ? store.getState().books[bookId] : null;
    const toPage = form.elements.toPage;
    const pages = form.elements.pages;
    toPage.closest('.field').hidden = base === null;
    if (base !== null) {
      if (e?.target === toPage) {
        pages.value = toPage.value === '' ? '' : Math.max(0, Number(toPage.value) - base);
      } else if (e?.target === pages || bookId !== lastBook) {
        toPage.value = pages.value === '' ? '' : base + Number(pages.value);
      }
      toPage.placeholder = String(base);
      form.querySelector('[data-out="page-hint"]').textContent =
        `Du warst auf Seite ${fmtNum(base)}${book?.totalPages ? ` von ${fmtNum(book.totalPages)}` : ''}.`;
    } else {
      form.querySelector('[data-out="page-hint"]').textContent = '';
    }
    lastBook = bookId;
    const xp = sessionXP({ kind, minutes: Number(form.elements.minutes.value) || 0, pages: Number(pages.value) || 0 });
    form.querySelector('[data-out="xp"]').textContent = `+${fmtNum(xp)} XP`;
  };
  openModal({
    title,
    body: sessionForm(ctx, preset, { mode }),
    submitLabel: mode === 'timer' ? 'XP einsammeln' : 'Speichern',
    cancel: mode === 'manual',
    extra:
      mode === 'edit'
        ? '<button type="button" class="btn btn-danger-ghost" data-modal-action="delete">Löschen</button>'
        : mode === 'timer'
          ? '<button type="button" class="btn btn-ghost" data-modal-action="resume">Weiter machen</button>'
          : '',
    onInput: sync,
    onAction: async (action) => {
      if (action === 'resume') {
        closeModal();
        toggleTimer();
      } else if (action === 'delete') {
        closeModal();
        if (await confirmDialog('Die Session und ihre XP werden entfernt.', { title: 'Session löschen?', okLabel: 'Löschen', danger: true })) {
          store.remove('sessions', preset.id);
          toast({ icon: '🗑️', title: 'Session gelöscht' });
        }
      }
    },
    onSubmit: (form) => {
      const f = form.elements;
      const kind = f.kind.value === 'read' ? 'read' : 'work';
      const minutes = Math.round(Number(f.minutes.value) || 0);
      const pages = Math.round(Number(f.pages.value) || 0);
      const day = f.day.value;
      const err = form.querySelector('[data-out="error"]');
      if (!isValidDay(day) || day > dayKey()) return ((err.textContent = 'Bitte ein gültiges Datum (nicht in der Zukunft) wählen.'), false);
      if (minutes < 0 || pages < 0) return ((err.textContent = 'Negative Werte gehen nicht.'), false);
      if (kind === 'work' && minutes < 1) return ((err.textContent = 'Wie viele Minuten hast du gearbeitet?'), false);
      if (kind === 'read' && minutes < 1 && pages < 1) return ((err.textContent = 'Trag Seiten oder Minuten ein.'), false);
      const record = {
        ...(editing || {}),
        id: editing?.id,
        kind,
        day,
        minutes,
        pages: kind === 'read' ? pages : 0,
        projectId: kind === 'work' ? f.projectId.value : '',
        bookId: kind === 'read' ? f.bookId.value : '',
        note: f.note.value.trim(),
        startedAt: editing ? editing.startedAt || null : mode === 'timer' ? timer?.startedAt || null : null,
      };
      if (mode === 'timer') saveTimer(null);
      withCelebration(() => store.upsert('sessions', record));
      return true;
    },
  });
}

function bookDialog(id, { then } = {}) {
  const book = id ? store.getState().books[id] : null;
  openModal({
    title: book ? 'Buch bearbeiten' : 'Neues Buch',
    body: bookForm(book || {}),
    cancel: !book,
    extra: book ? '<button type="button" class="btn btn-danger-ghost" data-modal-action="delete">Löschen</button>' : '',
    onAction: async (action) => {
      if (action !== 'delete') return;
      closeModal();
      const ok = await confirmDialog('Das Buch wird entfernt. Bereits gelesene Seiten und XP bleiben erhalten.', {
        title: `„${book.title}“ löschen?`,
        okLabel: 'Löschen',
        danger: true,
      });
      if (ok) store.remove('books', book.id);
    },
    onSubmit: (form) => {
      const f = form.elements;
      const title = f.title.value.trim();
      const totalPages = Math.max(0, Math.round(Number(f.totalPages.value) || 0));
      const startPage = Math.max(0, Math.round(Number(f.startPage.value) || 0));
      const err = form.querySelector('[data-out="error"]');
      if (!title) return ((err.textContent = 'Wie heißt das Buch?'), false);
      if (totalPages && startPage > totalPages) return ((err.textContent = 'Die Startseite liegt hinter dem Buchende.'), false);
      let saved;
      withCelebration(() => {
        saved = store.upsert('books', { ...(book || {}), title, author: f.author.value.trim(), totalPages, startPage });
      });
      if (then === 'focus') {
        store.setPrefs({ focus: { ...store.getPrefs().focus, kind: 'read', readRef: saved.id } });
        render();
      }
      if (!book) toast({ icon: '📚', title: 'Buch hinzugefügt', text: 'Viel Spaß beim Lesen!' });
      return true;
    },
  });
}

function projectDialog(id, { then } = {}) {
  const project = id ? store.getState().projects[id] : null;
  openModal({
    title: project ? 'Projekt bearbeiten' : 'Neues Projekt',
    body: projectForm(project || {}),
    cancel: !project,
    extra: project ? '<button type="button" class="btn btn-danger-ghost" data-modal-action="delete">Löschen</button>' : '',
    onAction: async (action) => {
      if (action !== 'delete') return;
      closeModal();
      const ok = await confirmDialog('Das Projekt wird entfernt. Die erfassten Stunden und XP bleiben erhalten.', {
        title: `„${project.name}“ löschen?`,
        okLabel: 'Löschen',
        danger: true,
      });
      if (ok) store.remove('projects', project.id);
    },
    onSubmit: (form) => {
      const f = form.elements;
      const name = f.name.value.trim();
      if (!name) return ((form.querySelector('[data-out="error"]').textContent = 'Wie heißt das Projekt?'), false);
      const record = {
        ...(project || {}),
        name,
        emoji: f.emoji.value || '🎯',
        targetHours: Math.max(0, Math.round(Number(f.targetHours.value) || 0)),
        archived: f.archived ? f.archived.checked : false,
      };
      const saved = store.upsert('projects', record);
      if (then === 'focus') {
        store.setPrefs({ focus: { ...store.getPrefs().focus, kind: 'work', workRef: saved.id } });
        render();
      }
      if (!project) toast({ icon: saved.emoji, title: 'Projekt angelegt', text: 'Zeit für die erste Session!' });
      return true;
    },
  });
}

function logBookDialog(id) {
  sessionDialog({ kind: 'read', bookId: id, day: dayKey() }, { mode: 'manual' });
}

// ---------------------------------------------------------------- Daten

function exportData() {
  const blob = new Blob([JSON.stringify(store.getState(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fortschritt-backup-${dayKey()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast({ icon: '⬇', title: 'Backup exportiert' });
}

async function importFile(file) {
  try {
    const data = normalizeState(JSON.parse(await file.text()));
    const count = Object.values(data.sessions).filter((s) => !s.deleted).length;
    const ok = await confirmDialog(`Die Datei enthält ${count} Sessions. Sie werden mit deinen Daten zusammengeführt – doppelte Einträge werden erkannt.`, {
      title: 'Backup importieren?',
      okLabel: 'Importieren',
    });
    if (!ok) return;
    store.replaceState(mergeStates(store.getState(), data), 'import');
    toast({ icon: '⬆', title: 'Import abgeschlossen' });
  } catch {
    toast({ icon: '⚠️', title: 'Import fehlgeschlagen', text: 'Die Datei ist kein gültiges Backup.', kind: 'error' });
  }
}

async function resetData() {
  const synced = store.getPrefs().sync?.token ? ' Auch auf deinen synchronisierten Geräten.' : '';
  const ok = await confirmDialog(`Alle Bücher, Projekte, Sessions und XP werden gelöscht.${synced} Das lässt sich nicht rückgängig machen.`, {
    title: 'Wirklich alles löschen?',
    okLabel: 'Alles löschen',
    danger: true,
  });
  if (!ok) return;
  store.resetAll();
  store.setPrefs({ seenAchievements: null, lastLevel: null });
  toast({ icon: '🧹', title: 'Alle Daten gelöscht' });
}

// ---------------------------------------------------------------- Erinnerungen (solange die App offen ist)

let lastReminderCheck = 0;
const REMINDER_LATE_MS = 90 * 60000; // verpasste Erinnerungen nicht später als 90 Min nachholen

function checkLocalReminders() {
  const prefs = store.getPrefs();
  const now = new Date();
  if (!prefs.localReminders || now - lastReminderCheck < 20000) return;
  lastReminderCheck = +now;
  const today = dayKey(now);
  const log = Object.fromEntries(Object.entries(prefs.reminderLog || {}).filter(([key]) => key.slice(-10) >= dayKey(new Date(now - 7 * 86400000))));
  let changed = Object.keys(log).length !== Object.keys(prefs.reminderLog || {}).length;
  for (const r of store.getState().profile.reminders) {
    const key = `${r.type}:${today}`;
    if (!r.enabled || !r.days.includes(isoWeekday(today)) || log[key]) continue;
    const [h, m] = r.time.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (now < at) continue;
    log[key] = 1;
    changed = true;
    if (now - at > REMINDER_LATE_MS) continue;
    const msg = reminderMessage(r.type, reminderContext(stats));
    if (msg) showReminder(msg, r.type);
  }
  if (changed) store.setPrefs({ reminderLog: log });
}

async function showReminder({ title, body }, tag) {
  const looking = document.visibilityState === 'visible' && document.hasFocus();
  if (looking || !(await systemNotification(title, body, `reminder-${tag}`))) {
    toast({ icon: '⏰', title, text: body, kind: 'xp', timeout: 10000 });
  }
}

// ---------------------------------------------------------------- iPhone-Widget

let widgetScript = null;

async function loadWidgetScript() {
  const sync = store.getPrefs().sync;
  if (!sync?.owner || !sync.gistId) return null;
  if (!widgetScript) {
    const res = await fetch('widget/fortschritt-scriptable.js');
    if (!res.ok) throw new Error('Skript nicht gefunden');
    widgetScript = await res.text();
  }
  return widgetScript.replace("'__DATA_URL__'", JSON.stringify(widgetDataUrl(sync.owner, sync.gistId)));
}

// Kopieren muss direkt in der Tipp-Geste starten (sonst blockiert Safari);
// ClipboardItem darf den Text aber nachliefern.
function copyWidgetScript() {
  if (!store.getPrefs().sync?.owner) return toast({ icon: '☁️', title: 'Bitte zuerst synchronisieren', kind: 'error' });
  const textPromise = loadWidgetScript();
  const copy =
    window.ClipboardItem && navigator.clipboard?.write
      ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then((t) => new Blob([t], { type: 'text/plain' })) })])
      : textPromise.then((t) => navigator.clipboard.writeText(t));
  copy
    .then(() => toast({ icon: '📋', title: 'Skript kopiert', text: 'Jetzt in Scriptable einfügen.' }))
    .catch(async () => {
      // Zwischenablage blockiert → zum manuellen Kopieren anzeigen
      const text = await textPromise.catch(() => '');
      openModal({
        title: 'Skript kopieren',
        body: `<p>Markiere den ganzen Text, kopiere ihn und füge ihn in Scriptable ein.</p><textarea class="script-box" readonly rows="10">${esc(text)}</textarea>`,
        submitLabel: 'Fertig',
        cancel: false,
      });
    });
}

// ---------------------------------------------------------------- Sync

let syncTimeout = 0;
let syncing = false;
let syncAgain = false;

function scheduleSync(delay = 2500) {
  if (!store.getPrefs().sync?.token) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => runSync(), delay);
}

async function runSync({ manual = false } = {}) {
  const cfg = store.getPrefs().sync;
  if (!cfg?.token) return false;
  if (syncing) {
    syncAgain = true;
    return false;
  }
  if (!navigator.onLine) {
    ui.syncStatus = 'offline';
    renderChrome();
    if (manual) toast({ icon: '📴', title: 'Offline', text: 'Sync passiert automatisch, sobald du wieder online bist.' });
    return false;
  }
  syncing = true;
  ui.syncStatus = 'syncing';
  renderChrome();
  let ok = false;
  try {
    const { state, gistId, owner } = await syncWithGist(cfg, store.getState, {
      extraFiles: (merged) => ({ [WIDGET_FILE]: JSON.stringify(widgetSummary(merged, computeStats(merged, dayKey()), APP_URL)) }),
    });
    // Was während des Uploads lokal dazukam, bleibt erhalten
    const merged = mergeStates(store.getState(), state);
    store.setPrefs({ sync: { ...store.getPrefs().sync, gistId, owner: owner || store.getPrefs().sync.owner || null, lastSync: Date.now() } });
    ui.syncStatus = 'ok';
    ui.syncError = '';
    if (canonical(merged) !== canonical(normalizeState(store.getState()))) store.replaceState(merged, 'sync');
    if (manual) toast({ icon: '☁️', title: 'Synchronisiert' });
    ok = true;
  } catch (err) {
    ui.syncStatus = 'error';
    ui.syncError = err.message || 'Unbekannter Fehler';
    if (manual) toast({ icon: '⚠️', title: 'Sync fehlgeschlagen', text: ui.syncError, kind: 'error', timeout: 6000 });
  } finally {
    syncing = false;
    // Nur die Sync-Karte aktualisieren, damit Eingaben in anderen Feldern bleiben
    const card = $('#sync-card');
    if (card) card.outerHTML = syncCard(context());
    const wcard = $('#widget-card');
    if (wcard) wcard.outerHTML = widgetCard(context());
    renderChrome();
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(300);
    }
  }
  return ok;
}

async function connectSync(form) {
  const token = form.elements.token.value.trim();
  const gistId = form.elements.gistId.value.trim().replace(/^.*\//, '');
  if (!token) return toast({ icon: '🔑', title: 'Bitte Token einfügen', kind: 'error' });
  store.setPrefs({ sync: { token, gistId: gistId || null, lastSync: 0 } });
  const ok = await runSync({ manual: true });
  if (!ok) {
    store.setPrefs({ sync: null });
    ui.syncStatus = 'idle';
    render();
  }
}

// ---------------------------------------------------------------- Ereignisse

const actions = {
  'quick-start': (el) => {
    const f = store.getPrefs().focus;
    const kind = el.dataset.kind;
    startTimer(kind, kind === 'work' ? f.workRef : f.readRef, f.minutes);
  },
  'start-book': (el) => {
    store.setPrefs({ focus: { ...store.getPrefs().focus, kind: 'read', readRef: el.dataset.id } });
    startTimer('read', el.dataset.id, store.getPrefs().focus.minutes);
  },
  'start-project': (el) => {
    store.setPrefs({ focus: { ...store.getPrefs().focus, kind: 'work', workRef: el.dataset.id } });
    startTimer('work', el.dataset.id, store.getPrefs().focus.minutes);
  },
  'focus-kind': (el) => {
    store.setPrefs({ focus: { ...store.getPrefs().focus, kind: el.dataset.kind } });
    render();
  },
  'focus-minutes': (el) => {
    store.setPrefs({ focus: { ...store.getPrefs().focus, minutes: Number(el.dataset.minutes) } });
    render();
  },
  'timer-start': () => {
    const f = store.getPrefs().focus;
    const ref = $('#focus-ref')?.value || '';
    startTimer(f.kind, ref, f.minutes);
  },
  'timer-toggle': toggleTimer,
  'timer-stop': stopTimer,
  'timer-discard': discardTimer,
  'mini-open': () => (location.hash = '#/fokus'),
  'log-session': () => sessionDialog({ kind: store.getPrefs().focus.kind, day: dayKey() }, { mode: 'manual' }),
  'edit-session': (el) => {
    const s = store.getState().sessions[el.dataset.id];
    if (s) sessionDialog(s, { mode: 'edit' });
  },
  'add-book': (el) => bookDialog(null, { then: el.dataset.then }),
  'edit-book': (el) => bookDialog(el.dataset.id),
  'log-book': (el) => logBookDialog(el.dataset.id),
  'add-project': (el) => projectDialog(null, { then: el.dataset.then }),
  'edit-project': (el) => projectDialog(el.dataset.id),
  'lib-tab': (el) => {
    ui.libraryTab = el.dataset.tab;
    render();
  },
  'more-history': () => {
    ui.historyLimit += 50;
    render();
  },
  'set-theme': (el) => {
    store.setPrefs({ theme: el.dataset.themeValue });
    applyTheme();
    render();
  },
  'notify-permission': async () => {
    await Notification.requestPermission();
    render();
  },
  'sync-now': () => runSync({ manual: true }),
  'rem-day': (el) => {
    const day = Number(el.dataset.day);
    updateReminder(el.dataset.rem, (r) => ({ ...r, days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day].sort() }));
  },
  'copy-widget': copyWidgetScript,
  'test-notification': async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    const msg = reminderMessage('streak', { ...reminderContext(stats), todayMet: false }) || { title: '🔔 Test', body: 'So sehen deine Erinnerungen aus.' };
    if (!(await systemNotification(msg.title, msg.body, 'test'))) {
      toast({ icon: '🔔', title: 'Mitteilungen nicht erlaubt', text: 'Erlaube sie in den Einstellungen deines Browsers bzw. iPhones.', kind: 'error' });
    }
    render();
  },
  'sync-disconnect': async () => {
    const ok = await confirmDialog('Die Daten bleiben auf diesem Gerät und im Gist erhalten, es wird nur nicht mehr synchronisiert.', {
      title: 'Sync trennen?',
      okLabel: 'Trennen',
    });
    if (!ok) return;
    store.setPrefs({ sync: null });
    ui.syncStatus = 'idle';
    render();
  },
  export: exportData,
  import: () => $('#import-file').click(),
  reset: resetData,
  install: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('#modal, #confirm')) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.closest('#modal, #confirm')) return;
  if (el.id === 'import-file' && el.files?.[0]) {
    importFile(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.change === 'focus-ref') {
    const f = store.getPrefs().focus;
    store.setPrefs({ focus: { ...f, [f.kind === 'read' ? 'readRef' : 'workRef']: el.value } });
  } else if (el.dataset.rem) {
    const field = el.dataset.field;
    updateReminder(el.dataset.rem, (r) => ({ ...r, [field]: field === 'enabled' ? el.checked : el.value || r.time }));
  } else if (el.dataset.change === 'local-reminders') {
    const enable = el.checked;
    store.setPrefs({ localReminders: enable, reminderLog: {} });
    lastReminderCheck = 0;
    // Erinnerungen, deren Zeit heute schon vorbei ist, nicht sofort nachholen
    if (enable) {
      const today = dayKey();
      store.setPrefs({
        reminderLog: Object.fromEntries(
          store
            .getState()
            .profile.reminders.filter((r) => r.time <= new Date().toTimeString().slice(0, 5))
            .map((r) => [`${r.type}:${today}`, 1]),
        ),
      });
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(render);
    }
  } else if (el.dataset.change === 'wake-lock') {
    store.setPrefs({ wakeLock: el.checked });
    updateWakeLock();
  } else if (el.form?.dataset.form === 'profile') {
    const f = el.form.elements;
    const workMin = Math.max(0, Math.min(1440, Math.round(Number(f.workMin.value) || 0)));
    const readPages = Math.max(0, Math.min(5000, Math.round(Number(f.readPages.value) || 0)));
    withCelebration(() => store.setProfile({ name: f.name.value.trim(), goals: { workMin, readPages } }));
    toast({ icon: '✓', title: 'Gespeichert' });
  }
});

function updateReminder(type, change) {
  const reminders = store.getState().profile.reminders.map((r) => (r.type === type ? change(r) : r));
  store.setProfile({ reminders });
}

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.closest('#modal, #confirm')) return;
  e.preventDefault();
  if (form.dataset.form === 'sync-connect') connectSync(form);
});

store.subscribe((reason) => {
  render();
  if (reason === 'sync' || reason === 'external' || reason === 'import') checkSeen();
  if (reason !== 'sync' && reason !== 'external') scheduleSync();
});

window.addEventListener('hashchange', () => {
  closeModal();
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  timer = store.getTimer();
  if (dayKey() !== renderedDay) render();
  else updateTimerUI();
  updateWakeLock();
  scheduleSync(300);
});
window.addEventListener('online', () => scheduleSync(300));
window.addEventListener('offline', () => {
  if (store.getPrefs().sync?.token) {
    ui.syncStatus = 'offline';
    renderChrome();
  }
});
window.addEventListener('storage', (e) => {
  if (e.key === 'fortschritt:timer:v1') {
    timer = store.getTimer();
    render();
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (route() === 'einstellungen') render();
});

setInterval(() => {
  if (dayKey() !== renderedDay) render();
  else if (timer) updateTimerUI();
  checkLocalReminders();
}, 1000);

// ---------------------------------------------------------------- Start

applyTheme();
initTooltips();
render();
checkSeen();
scheduleSync(800);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Für Tests und Debugging
window.fortschritt = { store, render, version: VERSION };
