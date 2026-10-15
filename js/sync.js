// Geräteübergreifender Sync über ein privates (secret) GitHub-Gist.
// Kein eigener Server nötig: Laptop und Handy nutzen denselben Token und
// dasselbe Gist; beim Sync werden beide Stände pro Datensatz zusammengeführt.

import { canonical, mergeStates, normalizeState } from './logic.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'fortschritt-data.json';
export const WIDGET_FILE = 'fortschritt-widget.json';

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

async function findGist(token) {
  const list = await request('/gists?per_page=100', token);
  const hit = list.find((g) => g.files && g.files[GIST_FILE]);
  return hit ? hit.id : null;
}

async function fileContent(file) {
  if (!file.truncated || !file.raw_url) return file.content;
  const raw = await fetch(file.raw_url, { cache: 'no-store' });
  return raw.text();
}

async function readGist(id, token) {
  const gist = await request(`/gists/${id}`, token);
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
  return { state, files, owner: gist.owner?.login || null };
}

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

// getState wird erst nach dem Download aufgerufen, damit Änderungen, die
// währenddessen lokal entstanden sind, nicht verloren gehen.
// extraFiles(merged) liefert weitere Dateien { name: inhalt } für das Gist.
export async function syncWithGist({ token, gistId }, getState, { extraFiles } = {}) {
  if (!token) throw new SyncError('Kein Token hinterlegt.', 0);
  let id = gistId || (await findGist(token));
  const remote = id ? await readGist(id, token) : null;
  const merged = remote?.state ? mergeStates(getState(), remote.state) : normalizeState(getState());
  const files = {};
  if (!remote?.state || canonical(remote.state) !== canonical(merged)) files[GIST_FILE] = JSON.stringify(merged);
  for (const [name, content] of Object.entries(extraFiles ? extraFiles(merged) : {})) {
    if (!sameExtra(remote?.files[name], content)) files[name] = content;
  }
  let owner = remote?.owner || null;

  if (!id) {
    files[GIST_FILE] = JSON.stringify(merged);
    const created = await request('/gists', token, {
      method: 'POST',
      body: JSON.stringify({
        description: 'Fortschritt-App – Daten (automatisch verwaltet)',
        public: false,
        files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }])),
      }),
    });
    id = created.id;
    owner = created.owner?.login || null;
  } else if (Object.keys(files).length) {
    await request(`/gists/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }])) }),
    });
  }
  return { state: merged, gistId: id, owner };
}

// Öffentlich lesbarer Link (nur mit Kenntnis der Gist-ID) auf die Widget-Datei.
export function widgetDataUrl(owner, gistId) {
  return `https://gist.githubusercontent.com/${owner}/${gistId}/raw/${WIDGET_FILE}`;
}
