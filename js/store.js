// Persistenz im Browser (localStorage). Die eigentlichen Fortschrittsdaten
// liegen unter DATA_KEY und werden synchronisiert; alles unter PREFS_KEY bzw.
// TIMER_KEY bleibt auf dem jeweiligen Gerät (Timer, Theme, Sync-Zugang …).

import { COLLECTIONS, changeProfile, dayKey, emptyState, normalizeState, uid } from './logic.js';

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
  state.profile = changeProfile(state.profile, patch);
  commit('profile');
}

export function upsert(collection, record) {
  const now = Date.now();
  const id = record.id || uid();
  const prev = state[collection][id];
  const next = { ...prev, ...record, id, createdAt: prev?.createdAt || now, updatedAt: now };
  delete next.reset; // eine Änderung ist keine Löschmarke des Zurücksetzens mehr
  state[collection][id] = next;
  commit(collection);
  return state[collection][id];
}

export function remove(collection, id) {
  const prev = state[collection][id];
  if (!prev) return;
  const next = { ...prev, deleted: true, updatedAt: Date.now() };
  delete next.reset;
  state[collection][id] = next;
  commit(collection);
}

// Löscht alles – als Grabsteine, damit die Löschung auch per Sync auf
// anderen Geräten ankommt und nicht vom Gist "zurückgemerged" wird.
export function resetAll() {
  const now = Date.now();
  const next = emptyState();
  // Auch der Zielverlauf: Sonst käme über den Sync der alte zurück
  const goalLog = [{ from: dayKey(new Date(now)), ...next.profile.goals, at: now }];
  Object.assign(next.profile, { updatedAt: now, nameUpdatedAt: now, goalsUpdatedAt: now, remindersUpdatedAt: now, goalLog });
  for (const key of COLLECTIONS) {
    for (const [id, rec] of Object.entries(state[key])) {
      next[key][id] = { id, deleted: true, reset: true, createdAt: rec.createdAt || now, updatedAt: now };
    }
  }
  state = next;
  commit('reset');
}

// Andere Tabs desselben Browsers: Änderungen übernehmen – auch die Geräte-Einstellungen,
// sonst schreibt ein alter Tab z. B. eine inzwischen verbundene Sync-Einstellung wieder weg
window.addEventListener('storage', (e) => {
  if (e.key === DATA_KEY) {
    state = normalizeState(readJSON(DATA_KEY, emptyState()));
    emit('external');
  } else if (e.key === PREFS_KEY) {
    prefs = { ...prefDefaults, ...readJSON(PREFS_KEY, {}) };
    emit('prefs');
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

// Frisch aus dem Speicher – falls ein anderer Tab gerade etwas geändert hat
export function freshPrefs() {
  prefs = { ...prefDefaults, ...readJSON(PREFS_KEY, {}) };
  return prefs;
}

// Frisch lesen, dann ändern: Was ein anderer Tab inzwischen gespeichert hat, bleibt erhalten
export function setPrefs(patch) {
  prefs = { ...prefDefaults, ...readJSON(PREFS_KEY, {}), ...patch };
  writeJSON(PREFS_KEY, prefs);
}

export function getTimer() {
  return readJSON(TIMER_KEY, null);
}

export function setTimer(timer) {
  writeJSON(TIMER_KEY, timer);
}
