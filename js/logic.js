// Reine Logik ohne DOM: Datum, XP, Level, Streaks, Quests, Erfolge und das
// Zusammenführen von Datenständen (Sync). Alles hier ist deterministisch aus
// den gespeicherten Sessions ableitbar – dadurch kann nichts "auseinanderlaufen".

export const DEFAULT_GOALS = { workMin: 60, readPages: 20 };

export const XP_RULES = {
  workPerMinute: 1, // 1 XP pro Minute Deep Work
  readPerPage: 2, // 2 XP pro gelesener Seite (oder 1 XP/Min, je nachdem was mehr ist)
  goalBonus: 20, // pro erreichtem Tagesziel
  perfectBonus: 20, // alle Tagesziele an einem Tag
  bookFinished: 100, // Buch beendet
  streakPerDay: 2, // Streak-Bonus pro Streak-Tag …
  streakBonusMax: 30, // … gedeckelt
};

// Alle 7 Streak-Tage gibt es einen Joker, der einen verpassten Tag rettet.
export const FREEZE_EVERY = 7;
export const FREEZE_MAX = 2;

// Timer-Vorgaben in Minuten je Session-Art (0 = frei, ohne Countdown).
export const TIMER_PRESETS = {
  work: { options: [0, 25, 50, 90], default: 50 },
  read: { options: [0, 15, 30, 60], default: 30 },
};

// Gewählte Timer-Dauer je Art. Ältere Einstellungen hatten eine gemeinsame
// Dauer (focus.minutes) – sie gilt weiter, sofern sie zu den Vorgaben passt.
export function presetMinutes(focus, kind) {
  const preset = TIMER_PRESETS[kind];
  const value = focus?.[`${kind}Minutes`] ?? focus?.minutes;
  return preset.options.includes(value) ? value : preset.default;
}

// Erinnerungen kommen nur, wenn das jeweilige Ziel an dem Tag noch offen ist.
// Wochentage nach ISO: 1 = Montag … 7 = Sonntag.
export const REMINDER_TYPES = {
  focus: { icon: '🎯', title: 'Fokus-Start', desc: 'wenn dein Deep-Work-Ziel noch offen ist' },
  read: { icon: '📖', title: 'Lesezeit', desc: 'wenn dein Lese-Ziel noch offen ist' },
  streak: { icon: '🔥', title: 'Streak-Retter', desc: 'wenn heute noch kein Tagesziel geschafft ist' },
};

export const DEFAULT_REMINDERS = [
  { type: 'focus', time: '09:00', days: [1, 2, 3, 4, 5], enabled: true },
  { type: 'read', time: '20:30', days: [1, 2, 3, 4, 5, 6, 7], enabled: true },
  { type: 'streak', time: '21:30', days: [1, 2, 3, 4, 5, 6, 7], enabled: true },
];

export const LEVEL_TITLES = [
  { level: 1, title: 'Neuling', icon: '🌱' },
  { level: 3, title: 'Lehrling', icon: '📘' },
  { level: 5, title: 'Entdecker', icon: '🧭' },
  { level: 8, title: 'Fokus-Krieger', icon: '⚔️' },
  { level: 12, title: 'Gelehrter', icon: '🎓' },
  { level: 16, title: 'Meister', icon: '🏅' },
  { level: 20, title: 'Großmeister', icon: '👑' },
  { level: 25, title: 'Weiser', icon: '🦉' },
  { level: 30, title: 'Legende', icon: '🐉' },
  { level: 40, title: 'Mythos', icon: '✨' },
];

// ---------------------------------------------------------------- Datum

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

// Montag als Wochenbeginn
export function startOfWeek(key) {
  const wd = (parseDay(key).getDay() + 6) % 7;
  return addDays(key, -wd);
}

// 1 = Montag … 7 = Sonntag
export function isoWeekday(key) {
  return ((parseDay(key).getDay() + 6) % 7) + 1;
}

export function isValidDay(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dayKey(parseDay(key)) === key;
}

// ---------------------------------------------------------------- Daten

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function emptyState() {
  return {
    schema: 1,
    profile: { name: '', goals: { ...DEFAULT_GOALS }, reminders: DEFAULT_REMINDERS.map((r) => ({ ...r, days: [...r.days] })), updatedAt: 0 },
    books: {},
    projects: {},
    sessions: {},
  };
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  const p = raw.profile;
  if (p && typeof p === 'object') {
    s.profile.name = String(p.name || '').slice(0, 60);
    s.profile.updatedAt = Number(p.updatedAt) || 0;
    const g = p.goals || {};
    s.profile.goals = {
      workMin: clampInt(g.workMin, 0, 1440, DEFAULT_GOALS.workMin),
      readPages: clampInt(g.readPages, 0, 5000, DEFAULT_GOALS.readPages),
    };
    if (Array.isArray(p.reminders)) s.profile.reminders = normalizeReminders(p.reminders);
  }
  for (const key of ['books', 'projects', 'sessions']) {
    const src = raw[key];
    if (!src || typeof src !== 'object') continue;
    for (const [id, rec] of Object.entries(src)) {
      if (rec && typeof rec === 'object' && rec.id === id) s[key][id] = rec;
    }
  }
  return s;
}

// Genau eine Erinnerung pro Typ, in fester Reihenfolge; Ungültiges fällt auf Standardwerte zurück.
export function normalizeReminders(list) {
  return DEFAULT_REMINDERS.map((def) => {
    const r = list.find((x) => x && x.type === def.type) || {};
    const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : def.time;
    const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [...def.days];
    return { type: def.type, time, days, enabled: typeof r.enabled === 'boolean' ? r.enabled : def.enabled };
  });
}

// Stabile JSON-Darstellung (sortierte Schlüssel) zum Vergleichen von Ständen.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function newer(a, b) {
  const ta = Number(a?.updatedAt) || 0;
  const tb = Number(b?.updatedAt) || 0;
  if (ta !== tb) return ta > tb ? a : b;
  // Gleichstand: deterministisch entscheiden, damit beide Geräte dasselbe wählen
  return canonical(a) >= canonical(b) ? a : b;
}

// Zwei Datenstände zusammenführen: pro Datensatz gewinnt die neueste Änderung.
// Gelöschte Einträge bleiben als "Grabstein" (deleted: true) erhalten.
export function mergeStates(a, b) {
  const A = normalizeState(a);
  const B = normalizeState(b);
  const out = emptyState();
  out.profile = newer(A.profile, B.profile);
  for (const key of ['books', 'projects', 'sessions']) {
    const merged = { ...A[key] };
    for (const [id, rec] of Object.entries(B[key])) {
      merged[id] = merged[id] ? newer(merged[id], rec) : rec;
    }
    out[key] = merged;
  }
  return out;
}

// ---------------------------------------------------------------- XP & Level

export function sessionXP(s) {
  if (!s || s.deleted) return 0;
  const min = Math.max(0, Number(s.minutes) || 0);
  if (s.kind === 'work') return Math.round(min * XP_RULES.workPerMinute);
  const pages = Math.max(0, Number(s.pages) || 0);
  return Math.round(Math.max(pages * XP_RULES.readPerPage, min));
}

// Gesamt-XP, die man für ein Level braucht: L2 = 100, L3 = 300, L4 = 600, L5 = 1000 …
export function xpForLevel(level) {
  return 50 * level * (level - 1);
}

export function levelFromXP(xp) {
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2));
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

export function titleFor(level) {
  let t = LEVEL_TITLES[0];
  for (const entry of LEVEL_TITLES) if (level >= entry.level) t = entry;
  return t;
}

export function levelInfo(xp) {
  const level = levelFromXP(xp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const t = titleFor(level);
  const nextTitle = LEVEL_TITLES.find((e) => e.level > level) || null;
  return {
    level,
    xp,
    into: xp - floor,
    span: next - floor,
    toNext: next - xp,
    pct: (xp - floor) / (next - floor),
    title: t.title,
    icon: t.icon,
    nextTitle,
  };
}

// ---------------------------------------------------------------- Streaks

// Läuft Tag für Tag vom ersten Tag bis heute. Heute zählt nur, wenn erfüllt –
// ein noch offener heutiger Tag bricht den Streak nicht.
export function walkStreak(firstDay, today, isMet) {
  const byDay = new Map();
  const frozen = new Set();
  let current = 0;
  let best = 0;
  let freezes = 0;
  let since = 0;
  if (!firstDay || firstDay > today) {
    return { current, best, freezes, byDay, frozen, todayMet: false };
  }
  for (let k = firstDay; k <= today; k = addDays(k, 1)) {
    if (isMet(k)) {
      current++;
      since++;
      if (since >= FREEZE_EVERY) {
        since = 0;
        if (freezes < FREEZE_MAX) freezes++;
      }
      byDay.set(k, current);
      if (current > best) best = current;
    } else if (k !== today) {
      if (current > 0 && freezes > 0) {
        freezes--;
        frozen.add(k);
      } else {
        current = 0;
        since = 0;
      }
    }
  }
  return { current, best, freezes, byDay, frozen, todayMet: isMet(today) };
}

// ---------------------------------------------------------------- Tages-Quests

const QUEST_POOL = [
  {
    id: 'deep45',
    icon: '🌊',
    title: 'Deep Dive',
    xp: 20,
    needs: 'work',
    desc: () => 'Eine Fokus-Session mit mind. 45 Min am Stück',
    progress: (d) => [d.maxWork, 45],
  },
  {
    id: 'deep90',
    icon: '🐋',
    title: 'Tiefsee',
    xp: 40,
    needs: 'work',
    weight: 0.5,
    desc: () => 'Eine Fokus-Session mit mind. 90 Min am Stück',
    progress: (d) => [d.maxWork, 90],
  },
  {
    id: 'pomo4',
    icon: '🍅',
    title: 'Viererpack',
    xp: 30,
    needs: 'work',
    desc: () => '4 Fokus-Sessions mit je mind. 25 Min',
    progress: (d) => [d.workSessions.filter((m) => m >= 25).length, 4],
  },
  {
    id: 'workx15',
    icon: '⚡',
    title: 'Extrameile',
    xp: 30,
    needs: 'work',
    desc: (g) => `${Math.ceil(g.workMin * 1.5)} Min Deep Work (150 % deines Ziels)`,
    progress: (d, g) => [d.workMin, Math.ceil(g.workMin * 1.5)],
  },
  {
    id: 'readx2',
    icon: '📚',
    title: 'Leseratte',
    xp: 30,
    needs: 'read',
    desc: (g) => `${g.readPages * 2} Seiten lesen (doppeltes Ziel)`,
    progress: (d, g) => [d.readPages, g.readPages * 2],
  },
  {
    id: 'read30',
    icon: '☕',
    title: 'Lesepause',
    xp: 20,
    needs: 'read',
    desc: () => '30 Min am Stück lesen',
    progress: (d) => [d.maxRead, 30],
  },
  {
    id: 'early',
    icon: '🌅',
    title: 'Frühstart',
    xp: 15,
    desc: () => 'Eine Timer-Session vor 9 Uhr starten',
    progress: (d) => [d.firstHour !== null && d.firstHour < 9 ? 1 : 0, 1],
  },
  {
    id: 'note',
    icon: '✍️',
    title: 'Reflexion',
    xp: 10,
    desc: () => 'Eine Notiz zu einer Session schreiben',
    progress: (d) => [d.sessions.some((s) => String(s.note || '').trim().length >= 3) ? 1 : 0, 1],
  },
  {
    id: 'combo',
    icon: '🔀',
    title: 'Zwei Welten',
    xp: 15,
    needs: 'both',
    desc: () => 'Heute sowohl lesen als auch fokussiert arbeiten',
    progress: (d) => [(d.workMin > 0 ? 1 : 0) + (d.readPages > 0 || d.readMin > 0 ? 1 : 0), 2],
  },
  {
    id: 'perfect',
    icon: '💎',
    title: 'Perfekter Tag',
    xp: 25,
    needs: 'both',
    desc: () => 'Beide Tagesziele erreichen',
    progress: (d) => [(d.workGoal ? 1 : 0) + (d.readGoal ? 1 : 0), 2],
  },
];

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function questsForDay(key, goals, count = 3) {
  const hasWork = goals.workMin > 0;
  const hasRead = goals.readPages > 0;
  const pool = QUEST_POOL.filter((q) => {
    if (q.needs === 'work') return hasWork;
    if (q.needs === 'read') return hasRead;
    if (q.needs === 'both') return hasWork && hasRead;
    return true;
  });
  const rand = mulberry32(hashStr(`quest:${key}`));
  const picked = [];
  const left = [...pool];
  while (picked.length < count && left.length) {
    const total = left.reduce((sum, q) => sum + (q.weight ?? 1), 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < left.length - 1; idx++) {
      r -= left[idx].weight ?? 1;
      if (r < 0) break;
    }
    picked.push(left.splice(idx, 1)[0]);
  }
  return picked;
}

function evalQuests(key, day, goals) {
  return questsForDay(key, goals).map((q) => {
    const [value, target] = q.progress(day, goals);
    return {
      id: q.id,
      icon: q.icon,
      title: q.title,
      desc: q.desc(goals),
      xp: q.xp,
      value: Math.min(value, target),
      target,
      done: value >= target,
    };
  });
}

// ---------------------------------------------------------------- Erfolge

export const ACHIEVEMENTS = [
  { id: 'first', icon: '👣', title: 'Erster Schritt', desc: 'Logge deine erste Session', target: 1, value: (s) => s.totals.sessions },
  { id: 'pages100', icon: '📄', title: 'Seitenwender', desc: '100 Seiten gelesen', target: 100, value: (s) => s.totals.readPages },
  { id: 'pages1000', icon: '📚', title: 'Seitenfresser', desc: '1.000 Seiten gelesen', target: 1000, value: (s) => s.totals.readPages },
  { id: 'pages5000', icon: '🏛️', title: 'Bibliothekar', desc: '5.000 Seiten gelesen', target: 5000, value: (s) => s.totals.readPages },
  { id: 'book1', icon: '🐛', title: 'Bücherwurm', desc: 'Dein erstes Buch beendet', target: 1, value: (s) => s.totals.booksFinished },
  { id: 'book5', icon: '🦉', title: 'Belesen', desc: '5 Bücher beendet', target: 5, value: (s) => s.totals.booksFinished },
  { id: 'book12', icon: '🗓️', title: 'Ein Jahr voller Bücher', desc: '12 Bücher beendet', target: 12, value: (s) => s.totals.booksFinished },
  { id: 'work10', icon: '⏳', title: 'Zehn Stunden', desc: '10 Stunden Deep Work', target: 10, value: (s) => s.totals.workMin / 60 },
  { id: 'work100', icon: '⚙️', title: 'Hundert Stunden', desc: '100 Stunden Deep Work', target: 100, value: (s) => s.totals.workMin / 60 },
  { id: 'work500', icon: '🏔️', title: 'Meister der Tiefe', desc: '500 Stunden Deep Work', target: 500, value: (s) => s.totals.workMin / 60 },
  { id: 'deep90', icon: '🤿', title: 'Tiefenrausch', desc: 'Eine Fokus-Session mit 90+ Minuten', target: 90, value: (s) => s.totals.longestWork },
  { id: 'marathon', icon: '🏃', title: 'Marathon', desc: '4 Stunden Deep Work an einem Tag', target: 4, value: (s) => s.totals.maxDayWork / 60 },
  { id: 'streak3', icon: '🔥', title: 'Warmgelaufen', desc: '3 Tage Streak', target: 3, value: (s) => s.streak.best },
  { id: 'streak7', icon: '🔥', title: 'Eine Woche stark', desc: '7 Tage Streak', target: 7, value: (s) => s.streak.best },
  { id: 'streak30', icon: '☄️', title: 'Monatsmensch', desc: '30 Tage Streak', target: 30, value: (s) => s.streak.best },
  { id: 'streak100', icon: '🌋', title: 'Unaufhaltsam', desc: '100 Tage Streak', target: 100, value: (s) => s.streak.best },
  { id: 'perfect1', icon: '💎', title: 'Perfekter Tag', desc: 'Alle Tagesziele an einem Tag', target: 1, value: (s) => s.totals.perfectDays },
  { id: 'perfect7', icon: '👑', title: 'Perfekte Woche', desc: '7 perfekte Tage in Folge', target: 7, value: (s) => s.totals.bestPerfectRun },
  { id: 'early', icon: '🌅', title: 'Frühaufsteher', desc: 'Eine Session vor 7 Uhr gestartet', target: 1, value: (s) => s.totals.earlySessions },
  { id: 'night', icon: '🌙', title: 'Nachteule', desc: 'Eine Session nach 23 Uhr gestartet', target: 1, value: (s) => s.totals.nightSessions },
  { id: 'quests10', icon: '🗡️', title: 'Questjäger', desc: '10 Tages-Quests erfüllt', target: 10, value: (s) => s.totals.questsDone },
  { id: 'quests50', icon: '🛡️', title: 'Abenteurer', desc: '50 Tages-Quests erfüllt', target: 50, value: (s) => s.totals.questsDone },
  { id: 'level5', icon: '⭐', title: 'Aufsteiger', desc: 'Level 5 erreicht', target: 5, value: (s) => s.level.level },
  { id: 'level10', icon: '🌟', title: 'Zweistellig', desc: 'Level 10 erreicht', target: 10, value: (s) => s.level.level },
];

// ---------------------------------------------------------------- Auswertung

function newDay(key) {
  return {
    key,
    workMin: 0,
    readPages: 0,
    readMin: 0,
    maxWork: 0,
    maxRead: 0,
    workSessions: [],
    sessions: [],
    firstHour: null,
    baseXP: 0,
    bonus: { goals: 0, perfect: 0, streak: 0, quests: 0, books: 0 },
    booksFinished: [],
    workGoal: false,
    readGoal: false,
    active: false,
    perfect: false,
    quests: [],
    xp: 0,
  };
}

function sessionOrder(a, b) {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return (a.startedAt || a.createdAt || 0) - (b.startedAt || b.createdAt || 0);
}

export function liveSessions(state) {
  return Object.values(state.sessions)
    .filter((s) => !s.deleted && isValidDay(s.day))
    .sort(sessionOrder);
}

export function computeStats(state, today = dayKey()) {
  const goals = state.profile.goals;
  const hasWork = goals.workMin > 0;
  const hasRead = goals.readPages > 0;
  const sessions = liveSessions(state);
  const days = new Map();
  const getDay = (k) => {
    let d = days.get(k);
    if (!d) days.set(k, (d = newDay(k)));
    return d;
  };

  const books = {};
  for (const b of Object.values(state.books)) {
    if (b.deleted) continue;
    const start = Math.max(0, Number(b.startPage) || 0);
    books[b.id] = { read: start, total: Math.max(0, Number(b.totalPages) || 0), finishedDay: null, minutes: 0, lastDay: null };
  }
  const projects = {};
  for (const p of Object.values(state.projects)) {
    if (p.deleted) continue;
    projects[p.id] = { minutes: 0, sessions: 0, weekMinutes: 0, last7: 0, lastDay: null };
  }

  const weekStart = startOfWeek(today);
  const last7Start = addDays(today, -6);
  const totals = {
    sessions: 0,
    workMin: 0,
    readPages: 0,
    readMin: 0,
    longestWork: 0,
    maxDayWork: 0,
    earlySessions: 0,
    nightSessions: 0,
    booksFinished: 0,
    perfectDays: 0,
    bestPerfectRun: 0,
    questsDone: 0,
    activeDays: 0,
  };

  for (const s of sessions) {
    const d = getDay(s.day);
    const min = Math.max(0, Number(s.minutes) || 0);
    d.sessions.push(s);
    d.baseXP += sessionXP(s);
    totals.sessions++;
    if (s.startedAt) {
      const hour = new Date(s.startedAt).getHours();
      if (d.firstHour === null || hour < d.firstHour) d.firstHour = hour;
      if (hour < 7 && hour >= 4) totals.earlySessions++;
      if (hour >= 23 || hour < 4) totals.nightSessions++;
    }
    if (s.kind === 'work') {
      d.workMin += min;
      d.workSessions.push(min);
      d.maxWork = Math.max(d.maxWork, min);
      totals.workMin += min;
      totals.longestWork = Math.max(totals.longestWork, min);
      const p = projects[s.projectId];
      if (p) {
        p.minutes += min;
        p.sessions++;
        if (s.day >= weekStart && s.day <= today) p.weekMinutes += min;
        if (s.day >= last7Start && s.day <= today) p.last7 += min;
        if (!p.lastDay || s.day > p.lastDay) p.lastDay = s.day;
      }
    } else {
      const pages = Math.max(0, Number(s.pages) || 0);
      d.readPages += pages;
      d.readMin += min;
      d.maxRead = Math.max(d.maxRead, min);
      totals.readPages += pages;
      totals.readMin += min;
      const b = books[s.bookId];
      if (b) {
        const before = b.read;
        b.read += pages;
        b.minutes += min;
        if (!b.lastDay || s.day > b.lastDay) b.lastDay = s.day;
        if (!b.finishedDay && b.total > 0 && before < b.total && b.read >= b.total) {
          b.finishedDay = s.day;
          d.booksFinished.push(s.bookId);
          d.bonus.books += XP_RULES.bookFinished;
          totals.booksFinished++;
        }
      }
    }
  }

  for (const d of days.values()) {
    d.workGoal = hasWork && d.workMin >= goals.workMin;
    d.readGoal = hasRead && d.readPages >= goals.readPages;
    const enabled = (hasWork ? 1 : 0) + (hasRead ? 1 : 0);
    const met = (d.workGoal ? 1 : 0) + (d.readGoal ? 1 : 0);
    d.active = enabled === 0 ? d.sessions.length > 0 : met > 0;
    d.perfect = enabled > 0 && met === enabled;
    d.bonus.goals = met * XP_RULES.goalBonus;
    d.bonus.perfect = enabled === 2 && d.perfect ? XP_RULES.perfectBonus : 0;
    d.quests = evalQuests(d.key, d, goals);
    d.bonus.quests = d.quests.reduce((sum, q) => sum + (q.done ? q.xp : 0), 0);
    totals.questsDone += d.quests.filter((q) => q.done).length;
    totals.maxDayWork = Math.max(totals.maxDayWork, d.workMin);
    if (d.perfect) totals.perfectDays++;
    if (d.sessions.length) totals.activeDays++;
  }

  const firstDay = sessions.length ? sessions[0].day : null;
  const isMet = (pred) => (k) => {
    const d = days.get(k);
    return d ? pred(d) : false;
  };
  const streak = walkStreak(
    firstDay,
    today,
    isMet((d) => d.active),
  );
  const workStreak = walkStreak(
    firstDay,
    today,
    isMet((d) => d.workGoal),
  );
  const readStreak = walkStreak(
    firstDay,
    today,
    isMet((d) => d.readGoal),
  );
  const perfectRun = walkStreak(
    firstDay,
    today,
    isMet((d) => d.perfect),
  );
  totals.bestPerfectRun = perfectRun.best;

  let totalXP = 0;
  for (const d of days.values()) {
    const s = streak.byDay.get(d.key) || 0;
    d.bonus.streak = d.active && s > 1 ? Math.min(XP_RULES.streakBonusMax, s * XP_RULES.streakPerDay) : 0;
    d.xp = d.baseXP + d.bonus.goals + d.bonus.perfect + d.bonus.streak + d.bonus.quests + d.bonus.books;
    totalXP += d.xp;
  }

  const todayAgg =
    days.get(today) ||
    (() => {
      const d = newDay(today);
      d.quests = evalQuests(today, d, goals);
      return d;
    })();

  const bookStats = {};
  for (const [id, b] of Object.entries(books)) {
    const shown = b.total > 0 ? Math.min(b.read, b.total) : b.read;
    bookStats[id] = {
      ...b,
      currentPage: b.read,
      pct: b.total > 0 ? Math.min(1, b.read / b.total) : 0,
      finished: b.total > 0 && b.read >= b.total,
      shown,
    };
  }

  const stats = {
    today,
    goals,
    days,
    todayAgg,
    totalXP,
    level: levelInfo(totalXP),
    streak,
    workStreak,
    readStreak,
    totals,
    books: bookStats,
    projects,
  };
  stats.achievements = ACHIEVEMENTS.map((a) => {
    const value = a.value(stats);
    return { ...a, current: value, done: value >= a.target, pct: Math.min(1, value / a.target) };
  });
  return stats;
}

// ---------------------------------------------------------------- Erinnerungen & Widget

// Kompakter Tagesstand, aus dem Erinnerungstexte entstehen. Dieselbe Form
// liefert das iPhone-Widget-Skript aus der Zusammenfassung im Gist.
export function reminderContext(stats) {
  const t = stats.todayAgg;
  return {
    workMin: Math.round(t.workMin),
    workGoal: stats.goals.workMin,
    readPages: Math.round(t.readPages),
    readGoal: stats.goals.readPages,
    streak: stats.streak.current,
    todayMet: stats.streak.todayMet,
    freezes: stats.streak.freezes,
  };
}

// Text einer Erinnerung – oder null, wenn sie heute nicht nötig ist.
// streak === null steht für "unbekannt" (z. B. für Tage in der Zukunft).
// Gleiche Logik steckt in widget/fortschritt-scriptable.js – bei Änderungen beide anpassen.
export function reminderMessage(type, c) {
  if (type === 'focus') {
    if (!(c.workGoal > 0) || c.workMin >= c.workGoal) return null;
    const left = c.workGoal - c.workMin;
    return {
      title: '🎯 Zeit für Deep Work',
      body:
        c.workMin > 0
          ? `Noch ${left} Min bis zu deinem Fokus-Ziel. Schaffst du die nächste Session?`
          : `Starte deine erste Fokus-Session – ${c.workGoal} Min sind heute dein Ziel.`,
    };
  }
  if (type === 'read') {
    if (!(c.readGoal > 0) || c.readPages >= c.readGoal) return null;
    const left = c.readGoal - c.readPages;
    return {
      title: '📖 Lesezeit',
      body:
        c.readPages > 0
          ? `Noch ${left} ${left === 1 ? 'Seite' : 'Seiten'} bis zu deinem Lese-Ziel.`
          : `${c.readGoal} Seiten warten auf dich – ein Kapitel vorm Schlafen zählt.`,
    };
  }
  if (type === 'streak') {
    if (c.todayMet) return null;
    if (c.streak === null) return { title: '🔥 Halte deinen Streak am Leben', body: 'Erreiche heute noch ein Tagesziel.' };
    if (c.streak > 0) {
      return {
        title: `🔥 Dein ${c.streak}-Tage-Streak ist in Gefahr`,
        body:
          c.freezes > 0
            ? 'Erreiche heute noch ein Tagesziel – sonst kostet es dich einen Joker.'
            : 'Erreiche heute noch ein Tagesziel, sonst ist er um Mitternacht weg.',
      };
    }
    return { title: '🔥 Starte heute einen Streak', body: 'Ein erreichtes Tagesziel reicht für Tag 1.' };
  }
  return null;
}

// Zusammenfassung für das Widget (wird beim Sync als eigene Datei ins Gist geschrieben).
export function widgetSummary(state, stats, appUrl = '') {
  const t = stats.todayAgg;
  const L = stats.level;
  const book = Object.values(state.books)
    .filter((b) => !b.deleted && stats.books[b.id] && !stats.books[b.id].finished && stats.books[b.id].lastDay)
    .sort((a, b) => (stats.books[b.id].lastDay < stats.books[a.id].lastDay ? -1 : 1))[0];
  const bs = book && stats.books[book.id];
  return {
    v: 1,
    generatedAt: Date.now(),
    day: stats.today,
    name: state.profile.name,
    appUrl,
    level: { level: L.level, title: L.title, icon: L.icon, pct: Math.round(L.pct * 1000) / 1000, into: L.into, span: L.span, totalXP: stats.totalXP },
    streak: { current: stats.streak.current, best: stats.streak.best, todayMet: stats.streak.todayMet, freezes: stats.streak.freezes },
    today: {
      workMin: Math.round(t.workMin),
      workGoal: stats.goals.workMin,
      readPages: Math.round(t.readPages),
      readGoal: stats.goals.readPages,
      xp: t.xp,
      questsDone: t.quests.filter((q) => q.done).length,
      questsTotal: t.quests.length,
    },
    book: book ? { title: book.title, page: bs.shown, total: Number(book.totalPages) || 0, pct: Math.round(bs.pct * 1000) / 1000 } : null,
    reminders: state.profile.reminders.filter((r) => r.enabled),
  };
}
