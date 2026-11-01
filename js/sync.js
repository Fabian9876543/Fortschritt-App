// Geräteübergreifender Sync über ein privates (secret) GitHub-Gist.
// Kein eigener Server nötig: Laptop und Handy nutzen denselben Token und
// dasselbe Gist; beim Sync werden beide Stände pro Datensatz zusammengeführt.

import { canonical, mergeStates, normalizeState } from './logic.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'fortschritt-data.json';
export const WIDGET_FILE = 'fortschritt-widget.json';
const KEEPALIVE_MAX = 60000; // Browser schicken keepalive-Anfragen nur bis 64 KB

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, token, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new SyncError('Keine Verbindung – Sync später erneut.', 0);
  }
  if (res.status === 401) throw new SyncError('Token ungültig oder abgelaufen.', 401);
  if (res.status === 403) throw new SyncError('Zugriff verweigert – hat der Token Gist-Rechte?', 403);
  if (res.status === 404) throw new SyncError('Gist nicht gefunden.', 404);
  if (!res.ok) throw new SyncError(`GitHub-Fehler (${res.status}).`, res.status);
  return res.json();
}

// Alle Gists mit Fortschritt-Daten (über alle Seiten der Liste), das älteste zuerst.
// Haben zwei Geräte je ein eigenes angelegt, wählen so beide dasselbe als Haupt-Gist.
async function findDataGists(token) {
  const found = [];
  for (let page = 1; page <= 10; page++) {
    const list = await request(`/gists?per_page=100&page=${page}`, token);
    for (const g of list) if (g.files && g.files[GIST_FILE]) found.push(g);
    if (list.length < 100) break;
  }
  const key = (g) => `${g.created_at || ''}|${g.id}`;
  return found.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

async function fileContent(file) {
  if (!file.truncated || !file.raw_url) return file.content;
  const raw = await fetch(file.raw_url, { cache: 'no-store' });
  return raw.text();
}

async function parseGist(gist) {
  const files = {};
  for (const [name, file] of Object.entries(gist.files || {})) files[name] = await fileContent(file);
  let state = null;
  if (files[GIST_FILE] !== undefined) {
    try {
      state = normalizeState(JSON.parse(files[GIST_FILE]));
    } catch {
      throw new SyncError('Die Daten im Gist sind beschädigt.', 0);
    }
  }
  return { state, files, owner: gist.owner?.login || null, version: gist.history?.[0]?.version || null };
}

const readGist = async (id, token) => parseGist(await request(`/gists/${id}`, token));

// Zusatzdateien (z. B. die Widget-Zusammenfassung) gelten als unverändert,
// wenn sich nur ihr Zeitstempel geändert hat.
function sameExtra(oldContent, newContent) {
  if (oldContent === undefined) return false;
  const strip = (text) => {
    const obj = JSON.parse(text);
    delete obj.generatedAt;
    return canonical(obj);
  };
  try {
    return strip(oldContent) === strip(newContent);
  } catch {
    return oldContent === newContent;
  }
}

// Stände, die ein anderes Gerät zwischen unserem Lesen und Schreiben hochgeladen
// hat (die Revisionen zwischen der gelesenen und unserer neuen).
function missedVersions(history, readVersion) {
  if (!readVersion || !Array.isArray(history)) return [];
  const i = history.findIndex((h) => h.version === readVersion);
  return i > 1 ? history.slice(1, i).map((h) => h.version) : [];
}

// getState wird erst nach dem Download aufgerufen, damit Änderungen, die
// währenddessen lokal entstanden sind, nicht verloren gehen.
// extraFiles(merged) liefert weitere Dateien { name: inhalt } für das Gist.
// discover: auch nach weiteren Daten-Gists suchen und sie einbeziehen.
export async function syncWithGist({ token, gistId, pinned }, getState, { extraFiles, discover = false, keepalive = false } = {}) {
  if (!token) throw new SyncError('Kein Token hinterlegt.', 0);
  let id = gistId || null;
  const others = [];
  if (!id || (discover && !pinned)) {
    const found = (await findDataGists(token)).map((g) => g.id);
    if (found.length) {
      if (id && !found.includes(id)) found.push(id);
      [id] = found;
      others.push(...found.slice(1));
    }
  }
  const remote = id ? await readGist(id, token) : null;
  let base = remote?.state || null;
  // Weitere Daten-Gists (z. B. von zwei gleichzeitig verbundenen Geräten) einmischen
  for (const other of others) {
    const extra = await readGist(other, token).catch(() => null);
    if (extra?.state) base = base ? mergeStates(base, extra.state) : extra.state;
  }
  let merged = base ? mergeStates(getState(), base) : normalizeState(getState());
  const files = {};
  if (!remote?.state || canonical(remote.state) !== canonical(merged)) files[GIST_FILE] = JSON.stringify(merged);
  for (const [name, content] of Object.entries(extraFiles ? extraFiles(merged) : {})) {
    if (!sameExtra(remote?.files[name], content)) files[name] = content;
  }
  let owner = remote?.owner || null;
  let created = false;
  const body = (f) => JSON.stringify({ files: Object.fromEntries(Object.entries(f).map(([name, content]) => [name, { content }])) });

  if (!id) {
    files[GIST_FILE] = JSON.stringify(merged);
    const made = await request('/gists', token, {
      method: 'POST',
      body: JSON.stringify({
        description: 'Fortschritt-App – Daten (automatisch verwaltet)',
        public: false,
        files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }])),
      }),
    });
    id = made.id;
    owner = made.owner?.login || null;
    created = true;
  } else if (Object.keys(files).length) {
    let payload = body(files);
    let saved = await request(`/gists/${id}`, token, { method: 'PATCH', body: payload, keepalive: keepalive && payload.length < KEEPALIVE_MAX });
    // Hat ein anderes Gerät dazwischen geschrieben, hätten wir dessen Änderungen überschrieben:
    // die verpassten Stände nachholen und den zusammengeführten Stand noch einmal schreiben.
    const missed = missedVersions(saved.history, remote?.version);
    if (missed.length) {
      let combined = merged;
      for (const v of missed) {
        const lost = await parseGist(await request(`/gists/${id}/${v}`, token)).catch(() => null);
        if (lost?.state) combined = mergeStates(combined, lost.state);
      }
      if (canonical(combined) !== canonical(merged)) {
        merged = combined;
        payload = body({ [GIST_FILE]: JSON.stringify(merged) });
        saved = await request(`/gists/${id}`, token, { method: 'PATCH', body: payload });
      }
    }
  }
  return { state: merged, gistId: id, owner, created };
}

// Tab oder Fenster wird geschlossen: Für einen Abgleich ist keine Zeit mehr. Der lokale Stand
// enthält alles bis zum letzten Abgleich und wird direkt geschrieben; was ein anderes Gerät
// inzwischen hochgeladen hat, ergänzt dieses beim nächsten Abgleich wieder (Zusammenführen).
export function pushOnClose({ token, gistId }, state) {
  if (!token || !gistId) return false;
  const payload = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(normalizeState(state)) } } });
  if (payload.length >= KEEPALIVE_MAX) return false;
  fetch(`${API}/gists/${gistId}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload,
  }).catch(() => {});
  return true;
}

// Öffentlich lesbarer Link (nur mit Kenntnis der Gist-ID) auf die Widget-Datei.
export function widgetDataUrl(owner, gistId) {
  return `https://gist.githubusercontent.com/${owner}/${gistId}/raw/${WIDGET_FILE}`;
}
