// Geräteübergreifender Sync über ein privates (secret) GitHub-Gist.
// Kein eigener Server nötig: Laptop und Handy nutzen denselben Token und
// dasselbe Gist; beim Sync werden beide Stände pro Datensatz zusammengeführt.

import { canonical, mergeStates, normalizeState } from './logic.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'fortschritt-data.json';

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

async function readGist(id, token) {
  const gist = await request(`/gists/${id}`, token);
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  let content = file.content;
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, { cache: 'no-store' });
    content = await raw.text();
  }
  try {
    return normalizeState(JSON.parse(content));
  } catch {
    throw new SyncError('Die Daten im Gist sind beschädigt.', 0);
  }
}

// getState wird erst nach dem Download aufgerufen, damit Änderungen, die
// währenddessen lokal entstanden sind, nicht verloren gehen.
export async function syncWithGist({ token, gistId }, getState) {
  if (!token) throw new SyncError('Kein Token hinterlegt.', 0);
  let id = gistId || (await findGist(token));
  const remote = id ? await readGist(id, token) : null;
  const merged = remote ? mergeStates(getState(), remote) : normalizeState(getState());
  const content = JSON.stringify(merged);

  if (!id) {
    const created = await request('/gists', token, {
      method: 'POST',
      body: JSON.stringify({
        description: 'Fortschritt-App – Daten (automatisch verwaltet)',
        public: false,
        files: { [GIST_FILE]: { content } },
      }),
    });
    id = created.id;
  } else if (!remote || canonical(remote) !== canonical(merged)) {
    await request(`/gists/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
    });
  }
  return { state: merged, gistId: id };
}
