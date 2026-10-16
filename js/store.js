// Persistenz im Browser (localStorage). Die eigentlichen Fortschrittsdaten
// liegen unter DATA_KEY und werden synchronisiert; alles unter PREFS_KEY bzw.
// TIMER_KEY bleibt auf dem jeweiligen Gerät (Timer, Theme, Sync-Zugang …).

import { emptyState, normalizeState, uid } from './logic.js';

const DATA_KEY = 'fortschritt:data:v1';
const PREFS_KEY = 'fortschritt:prefs:v1';
const TIMER_KEY = 'fortschritt:timer:v1';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Speichern fehlgeschlagen', err);
    return false;
  }
}

let state = normalizeState(readJSON(DATA_KEY, emptyState()));
const listeners = new Set();

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

function commit(reason) {
  writeJSON(DATA_KEY, state);
  emit(reason);
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// reason 'sync' bzw. 'import' signalisiert, dass kein erneuter Upload nötig ist.
export function replaceState(next, reason = 'replace') {
  state = normalizeState(next);
  commit(reason);
}

export function setProfile(patch) {
  state.profile = {
    ...state.profile,
    ...patch,
    goals: { ...state.profile.goals, ...(patch.goals || {}) },
    updatedAt: Date.now(),
  };
  commit('profile');
}

export function upsert(collection, record) {
  const now = Date.now();
  const id = record.id || uid();
  const prev = state[collection][id];
  state[collection][id] = { ...prev, ...record, id, createdAt: prev?.createdAt || now, updatedAt: now };
  commit(collection);
  return state[collection][id];
}

export function remove(collection, id) {
  const prev = state[collection][id];
  if (!prev) return;
  state[collection][id] = { ...prev, deleted: true, updatedAt: Date.now() };
  commit(collection);
}

// Löscht alles – als Grabsteine, damit die Löschung auch per Sync auf
// anderen Geräten ankommt und nicht vom Gist "zurückgemerged" wird.
export function resetAll() {
  const now = Date.now();
  const next = emptyState();
  next.profile.updatedAt = now;
  for (const key of ['books', 'projects', 'sessions']) {
    for (const [id, rec] of Object.entries(state[key])) {
      next[key][id] = { id, deleted: true, createdAt: rec.createdAt || now, updatedAt: now };
    }
  }
  state = next;
  commit('reset');
}

// Andere Tabs desselben Browsers: Änderungen übernehmen
window.addEventListener('storage', (e) => {
  if (e.key === DATA_KEY) {
    state = normalizeState(readJSON(DATA_KEY, emptyState()));
    emit('external');
  }
});

// ---------------------------------------------------------------- Geräte-Einstellungen

const prefDefaults = {
  theme: 'system',
  sync: null, // { token, gistId, lastSync }
  seenAchievements: null,
  lastLevel: null,
  focus: { kind: 'work', workRef: '', readRef: '' }, // Timer-Dauern: workMinutes/readMinutes, siehe presetMinutes()
  wakeLock: true,
  phoneTimer: false, // beim Start den iPhone-Timer per Kurzbefehl mitstarten
  localReminders: false, // Erinnerungen anzeigen, solange die App offen ist
  reminderLog: {}, // bereits gezeigte Erinnerungen { "read:2026-10-15": 1 }
};

let prefs = { ...prefDefaults, ...readJSON(PREFS_KEY, {}) };

export function getPrefs() {
  return prefs;
}

export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  writeJSON(PREFS_KEY, prefs);
}

export function getTimer() {
  return readJSON(TIMER_KEY, null);
}

export function setTimer(timer) {
  writeJSON(TIMER_KEY, timer);
}
