// Geräteübergreifender Sync über ein privates (secret) GitHub-Gist.
// Kein eigener Server nötig: Laptop und Handy nutzen denselben Token und
// dasselbe Gist; beim Sync werden beide Stände pro Datensatz zusammengeführt.

import { canonical, mergeStates, normalizeState } from './logic.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'fortschritt-data.json';
export const WIDGET_FILE = 'fortschritt-widget.json';
// Beim Schließen hinterlegte Änderungen, je Gerät und Zeitpunkt eine Datei (siehe pushOnClose)
const PENDING_PREFIX = 'fortschritt-pending-';
const KEEPALIVE_MAX = 60000; // Browser schicken keepalive-Anfragen nur bis 64 KB
const TIMEOUT_MS = 20000; // eine hängende Anfrage soll nicht jeden weiteren Sync blockieren

const bytes = (text) => new TextEncoder().encode(text).length;

// fetch mit Zeitlimit (AbortController läuft auch auf älteren iPhones)
async function fetchWithTimeout(url, options = {}) {
  if (options.keepalive) return fetch(url, options);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, token, options = {}) {
  let res;
  try {
    res = await fetchWithTimeout(`${API}${path}`, {
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
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    throw new SyncError('GitHub-Limit erreicht – Sync später erneut.', res.status);
  }
  if (res.status === 403) throw new SyncError('Zugriff verweigert – hat der Token Gist-Rechte?', 403);
  if (res.status === 404) throw new SyncError('Gist nicht gefunden.', 404);
  if (!res.ok) throw new SyncError(`GitHub-Fehler (${res.status}).`, res.status);
  return res.json();
}

// Alle privaten Gists mit Fortschritt-Daten (über alle Seiten der Liste), das älteste zuerst.
// Öffentliche Gists bleiben außen vor – dort sollen keine persönlichen Daten landen.
async function findDataGists(token) {
  const found = [];
  for (let page = 1; page <= 10; page++) {
    const list = await request(`/gists?per_page=100&page=${page}`, token);
    for (const g of list) if (g.public !== true && g.files && g.files[GIST_FILE]) found.push(g);
    if (list.length < 100) break;
  }
  const key = (g) => `${g.created_at || ''}|${g.id}`;
  return found.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

async function fileContent(file) {
  if (!file.truncated || !file.raw_url) return file.content;
  const raw = await fetchWithTimeout(file.raw_url, { cache: 'no-store' });
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

// Zusatzdateien (z. B. die Widget-Zusammenfassung) gelten als unverändert, wenn sich nur
// ihr Zeitstempel oder der App-Link (je Gerät verschieden) geändert hat.
function sameExtra(oldContent, newContent) {
  if (oldContent === undefined) return false;
  const strip = (text) => {
    const obj = JSON.parse(text);
    delete obj.generatedAt;
    delete obj.appUrl;
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

const filesBody = (files) =>
  JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content === null ? null : { content }])) });

// getState wird erst nach dem Download aufgerufen, damit Änderungen, die
// währenddessen lokal entstanden sind, nicht verloren gehen.
// extraFiles(merged) liefert weitere Dateien { name: inhalt } für das Gist.
// discover: nach weiteren Daten-Gists suchen; others: schon bekannte weitere Daten-Gists.
// Deren Daten werden eingemischt, damit zwei Gists nicht auseinanderlaufen.
export async function syncWithGist({ token, gistId }, getState, { extraFiles, discover = false, keepalive = false, others: known = [] } = {}) {
  if (!token) throw new SyncError('Kein Token hinterlegt.', 0);
  let id = gistId || null;
  let others = known.filter((other) => other !== id);
  // Erste Verbindung: das älteste vorhandene Daten-Gist nehmen – zwei Geräte finden so dasselbe.
  // Danach bleibt jedes Gerät bei seinem Gist (ein Wechsel ließe das iPhone-Widget auf dem alten
  // zurück) und liest weitere Daten-Gists nur mit ein.
  if (!id || discover) {
    let found = [];
    try {
      found = (await findDataGists(token)).map((g) => g.id);
    } catch (err) {
      if (!id) throw err; // ist das Gist bekannt, klappt der Abgleich auch ohne die Liste
    }
    if (!id && found.length) [id] = found;
    others = found.filter((other) => other !== id);
  }
  const remote = id ? await readGist(id, token) : null;
  let base = remote?.state || null;
  const add = (state) => (base = base ? mergeStates(base, state) : state);
  for (const other of others) {
    const extra = await readGist(other, token).catch(() => null);
    if (extra?.state) add(extra.state);
  }
  // Beim Schließen hinterlegte Änderungen (pushOnClose) einmischen; danach werden sie gelöscht
  const pending = Object.keys(remote?.files || {}).filter((name) => name.startsWith(PENDING_PREFIX));
  for (const name of pending) {
    try {
      add(normalizeState(JSON.parse(remote.files[name])));
    } catch {
      // unlesbare Zwischendatei: einfach entfernen
    }
  }
  let merged = base ? mergeStates(getState(), base) : normalizeState(getState());
  const files = {};
  if (!remote?.state || canonical(remote.state) !== canonical(merged)) files[GIST_FILE] = JSON.stringify(merged);
  for (const [name, content] of Object.entries(extraFiles ? extraFiles(merged) : {})) {
    if (!sameExtra(remote?.files[name], content)) files[name] = content;
  }
  for (const name of pending) files[name] = null;
  let owner = remote?.owner || null;
  let created = false;

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
    const payload = filesBody(files);
    const saved = await request(`/gists/${id}`, token, { method: 'PATCH', body: payload, keepalive: keepalive && bytes(payload) < KEEPALIVE_MAX });
    // Hat ein anderes Gerät dazwischen geschrieben, hätten wir dessen Änderungen überschrieben:
    // die verpassten Stände nachholen und den zusammengeführten Stand noch einmal schreiben.
    const missed = missedVersions(saved.history, remote?.version);
    if (missed.length) {
      let combined = merged;
      for (const v of missed) {
        const lost = await request(`/gists/${id}/${v}`, token)
          .then(parseGist)
          .catch(() => null);
        if (lost?.state) combined = mergeStates(combined, lost.state);
      }
      if (canonical(combined) !== canonical(merged)) {
        merged = combined;
        await request(`/gists/${id}`, token, { method: 'PATCH', body: filesBody({ [GIST_FILE]: JSON.stringify(merged) }) });
      }
    }
  }
  return { state: merged, gistId: id, owner, created, others };
}

// Tab oder Fenster wird geschlossen: Für einen Abgleich bleibt keine Zeit. Die Daten-Datei
// zu ersetzen könnte frische Einträge eines anderen Geräts verdrängen – darum landen nur die
// Änderungen in einer eigenen kleinen Datei, die der nächste Sync (egal welches Gerät) einmischt.
export function pushOnClose({ token, gistId }, changes, deviceId) {
  if (!token || !gistId || !changes) return false;
  const name = `${PENDING_PREFIX}${deviceId}-${Date.now()}.json`;
  const payload = filesBody({ [name]: JSON.stringify(changes) });
  if (bytes(payload) >= KEEPALIVE_MAX) return false;
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
