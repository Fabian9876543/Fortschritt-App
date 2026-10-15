// Fortschritt – Widget & Erinnerungen für Scriptable (iPhone)
//
// Dieses Skript wird in der Fortschritt-App unter Einstellungen → iPhone-Widget
// mit deinem persönlichen Daten-Link vorbereitet und kopiert. Es
//   • zeigt Level, Streak und Tagesziele als Widget (Home- und Sperrbildschirm),
//   • plant deine Erinnerungen als iPhone-Mitteilungen – und lässt sie weg,
//     wenn das jeweilige Ziel an dem Tag schon geschafft ist.
// Einmal in Scriptable ausführen (▶), danach aktualisiert es sich über das Widget.

const DATA_URL = '__DATA_URL__';

const PREFIX = 'fortschritt:';
const CACHE_FILE = 'fortschritt-widget.json';

// ---------------------------------------------------------------- Farben

const dyn = (light, dark) => Color.dynamic(new Color(light), new Color(dark));
const COLORS = {
  bg: dyn('#fcfcfb', '#1a1a19'),
  text: dyn('#0b0b0b', '#f0efec'),
  text2: dyn('#52514e', '#c3c2b7'),
  muted: dyn('#6f6e69', '#9a998f'),
  track: dyn('#e6e4de', '#2e2e2b'),
  work: dyn('#6250d6', '#9085e9'),
  read: dyn('#eb6834', '#d95926'),
  xp: dyn('#eda100', '#e9a81c'),
};

// ---------------------------------------------------------------- Datum & Zahlen

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;
const fmt = (n) => Math.round(n).toLocaleString('de-DE');

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ---------------------------------------------------------------- Daten

async function loadData() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
  try {
    if (DATA_URL.includes('__')) throw new Error('Kein Daten-Link');
    const req = new Request(`${DATA_URL}?t=${Date.now()}`);
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (!data || data.v !== 1) throw new Error('Unbekanntes Format');
    fm.writeString(cache, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    console.log(`Laden fehlgeschlagen: ${err}`);
    if (fm.fileExists(cache)) return { data: JSON.parse(fm.readString(cache)), offline: true };
    return { data: null, offline: true };
  }
}

// Stand für "heute" – auch wenn die Zusammenfassung von gestern stammt.
function todayContext(data, now) {
  const t = data.today;
  const s = data.streak;
  if (data.day === dayKey(now)) {
    return { ...t, streak: s.current, todayMet: s.todayMet, freezes: s.freezes, fresh: true };
  }
  let streak = 0;
  let freezes = s.freezes;
  if (data.day === dayKey(addDays(now, -1))) {
    if (s.todayMet) streak = s.current;
    else if (s.current > 0 && s.freezes > 0) {
      streak = s.current;
      freezes = s.freezes - 1;
    }
  }
  return {
    workMin: 0,
    workGoal: t.workGoal,
    readPages: 0,
    readGoal: t.readGoal,
    xp: 0,
    questsDone: 0,
    questsTotal: t.questsTotal,
    streak,
    todayMet: false,
    freezes,
    fresh: false,
  };
}

// Gleiche Logik wie reminderMessage() in js/logic.js der App.
function reminderMessage(type, c) {
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

// ---------------------------------------------------------------- Erinnerungen

// Plant die Erinnerungen der nächsten 7 Tage. Für heute mit aktuellem Stand,
// für die folgenden Tage allgemein – sie werden bei jedem Lauf aktualisiert.
async function scheduleReminders(data, c, now) {
  const wanted = new Map();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (const r of data.reminders || []) {
    if (!r.enabled) continue;
    const [h, m] = String(r.time).split(':').map(Number);
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      if (!(r.days || []).includes(isoWeekday(day))) continue;
      const at = new Date(day);
      at.setHours(h, m, 0, 0);
      if (at <= now) continue;
      const ctx = i === 0 ? c : { ...c, workMin: 0, readPages: 0, todayMet: false, streak: null };
      const msg = reminderMessage(r.type, ctx);
      if (msg) wanted.set(`${PREFIX}${r.type}:${dayKey(day)}`, { ...msg, at });
    }
  }

  const pending = await Notification.allPending();
  const existing = new Map(pending.filter((n) => String(n.identifier).startsWith(PREFIX)).map((n) => [n.identifier, n]));
  const stale = [...existing.keys()].filter((id) => !wanted.has(id));
  if (stale.length) await Notification.removePending(stale);

  for (const [id, w] of wanted) {
    const old = existing.get(id);
    if (old && old.title === w.title && old.body === w.body && old.nextTriggerDate && Math.abs(old.nextTriggerDate - w.at) < 60000) continue;
    const n = new Notification();
    n.identifier = id;
    n.title = w.title;
    n.body = w.body;
    n.sound = 'default';
    n.threadIdentifier = 'fortschritt';
    n.setTriggerDate(w.at);
    await n.schedule();
  }
  return wanted.size;
}

// ---------------------------------------------------------------- Bausteine

function addLabel(stack, str, font, color, lines = 1) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.7;
  return t;
}

function addBar(stack, pct, color, width, height = 6) {
  const track = stack.addStack();
  track.size = new Size(width, height);
  track.cornerRadius = height / 2;
  track.backgroundColor = COLORS.track;
  track.layoutHorizontally();
  const fillWidth = Math.round(width * Math.max(0, Math.min(1, pct)));
  if (fillWidth > 0) {
    const fill = track.addStack();
    fill.size = new Size(Math.max(height, fillWidth), height);
    fill.cornerRadius = height / 2;
    fill.backgroundColor = color;
  }
  track.addSpacer();
}

function goalRow(stack, label, value, goal, unit, color, width) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.size = new Size(width, 0);
  addLabel(row, label, Font.semiboldSystemFont(11), COLORS.text2);
  row.addSpacer();
  const done = goal > 0 && value >= goal;
  addLabel(row, `${fmt(value)}/${fmt(goal)}${unit}${done ? ' ✓' : ''}`, Font.boldSystemFont(11), COLORS.text);
  stack.addSpacer(4);
  addBar(stack, goal > 0 ? value / goal : 0, color, width);
}

function goalRows(stack, c, width) {
  let rows = 0;
  if (c.workGoal > 0) {
    goalRow(stack, 'Deep Work', c.workMin, c.workGoal, ' Min', COLORS.work, width);
    rows++;
  }
  if (c.readGoal > 0) {
    if (rows) stack.addSpacer(8);
    goalRow(stack, 'Lesen', c.readPages, c.readGoal, ' S.', COLORS.read, width);
  }
}

// ⏳ = Streak läuft, aber heute noch kein Ziel geschafft
function streakText(c) {
  return `🔥 ${c.streak}${!c.todayMet && c.streak > 0 ? ' ⏳' : ''}`;
}

function footer(stack, data, c, offline) {
  let text = `+${fmt(c.xp)} XP heute`;
  if (!c.fresh || offline) {
    const at = new Date(data.generatedAt);
    text = `Stand ${at.toLocaleDateString('de-DE', { weekday: 'short' })} ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }
  addLabel(stack, text, Font.mediumSystemFont(10), COLORS.muted);
}

function combinedPct(c) {
  const parts = [];
  if (c.workGoal > 0) parts.push(Math.min(1, c.workMin / c.workGoal));
  if (c.readGoal > 0) parts.push(Math.min(1, c.readPages / c.readGoal));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

// ---------------------------------------------------------------- Widgets

function buildSmall(w, data, c, offline) {
  w.setPadding(14, 14, 12, 14);
  const top = w.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  addLabel(top, `${data.level.icon} Lv ${data.level.level}`, Font.boldRoundedSystemFont(15), COLORS.text);
  top.addSpacer();
  addLabel(top, streakText(c), Font.boldRoundedSystemFont(15), COLORS.text);
  w.addSpacer();
  goalRows(w, c, 128);
  w.addSpacer();
  footer(w, data, c, offline);
}

function buildMedium(w, data, c, offline, large = false) {
  w.setPadding(14, 16, 14, 16);
  const top = w.addStack();
  top.layoutHorizontally();

  const left = top.addStack();
  left.layoutVertically();
  const head = left.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  addLabel(head, data.level.icon, Font.systemFont(26), COLORS.text);
  head.addSpacer(8);
  const names = head.addStack();
  names.layoutVertically();
  addLabel(names, `Level ${data.level.level}`, Font.boldRoundedSystemFont(16), COLORS.text);
  addLabel(names, data.level.title, Font.mediumSystemFont(11), COLORS.text2);
  left.addSpacer(10);
  addBar(left, data.level.pct, COLORS.xp, 128, 7);
  left.addSpacer(4);
  addLabel(left, `${fmt(data.level.into)} / ${fmt(data.level.span)} XP`, Font.mediumSystemFont(10), COLORS.muted);
  left.addSpacer();
  const streak = c.streak === 1 ? 'Tag' : 'Tage';
  addLabel(left, `🔥 ${c.streak} ${streak}${c.freezes ? `  🧊${c.freezes}` : ''}`, Font.boldRoundedSystemFont(14), COLORS.text);
  addLabel(left, c.todayMet ? 'heute gesichert ✓' : c.streak > 0 ? 'heute noch offen' : 'starte heute', Font.mediumSystemFont(10), COLORS.muted);

  top.addSpacer(16);
  const right = top.addStack();
  right.layoutVertically();
  addLabel(right, 'Heute', Font.boldRoundedSystemFont(13), COLORS.text);
  right.addSpacer(8);
  goalRows(right, c, 140);
  right.addSpacer();
  addLabel(right, `Quests ${c.questsDone}/${c.questsTotal}`, Font.mediumSystemFont(10), COLORS.muted);
  footer(right, data, c, offline);

  if (large && data.book) {
    w.addSpacer(14);
    const book = w.addStack();
    book.layoutVertically();
    addLabel(book, `📖 ${data.book.title}`, Font.semiboldSystemFont(13), COLORS.text);
    book.addSpacer(4);
    addBar(book, data.book.pct, COLORS.read, 296);
    book.addSpacer(3);
    addLabel(book, `Seite ${fmt(data.book.page)}${data.book.total ? ` von ${fmt(data.book.total)}` : ''}`, Font.mediumSystemFont(10), COLORS.muted);
    w.addSpacer();
  }
}

function ringImage(pct, size = 64, line = 6) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setLineWidth(line);
  ctx.setStrokeColor(new Color('#ffffff', 0.25));
  ctx.strokeEllipse(new Rect(line / 2, line / 2, size - line, size - line));
  if (pct > 0) {
    const r = (size - line) / 2;
    const steps = Math.max(2, Math.ceil(72 * pct));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * pct * (i / steps);
      points.push(new Point(size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a)));
    }
    const path = new Path();
    path.addLines(points);
    ctx.addPath(path);
    ctx.setStrokeColor(Color.white());
    ctx.strokePath();
  }
  return ctx.getImage();
}

function buildCircular(w, data, c) {
  w.addAccessoryWidgetBackground = true;
  w.backgroundImage = ringImage(Math.min(1, combinedPct(c)));
  w.addSpacer();
  const symbol = SFSymbol.named(c.todayMet ? 'flame.fill' : 'flame');
  if (symbol) {
    symbol.applyFont(Font.boldSystemFont(11));
    const img = w.addImage(symbol.image);
    img.imageSize = new Size(11, 11);
    img.tintColor = Color.white();
    img.centerAlignImage();
  }
  const t = addLabel(w, String(c.streak), Font.boldRoundedSystemFont(17), Color.white());
  t.centerAlignText();
  w.addSpacer();
}

function buildRectangular(w, data, c) {
  addLabel(w, `🔥 ${c.streak} ${c.streak === 1 ? 'Tag' : 'Tage'} · Lv ${data.level.level}`, Font.boldRoundedSystemFont(13), Color.white());
  if (c.workGoal > 0)
    addLabel(w, `Fokus ${fmt(c.workMin)}/${fmt(c.workGoal)} Min${c.workMin >= c.workGoal ? ' ✓' : ''}`, Font.mediumSystemFont(12), Color.white());
  if (c.readGoal > 0)
    addLabel(w, `Lesen ${fmt(c.readPages)}/${fmt(c.readGoal)} Seiten${c.readPages >= c.readGoal ? ' ✓' : ''}`, Font.mediumSystemFont(12), Color.white());
}

function buildInline(w, data, c) {
  const parts = [`🔥${c.streak}`];
  if (c.workGoal > 0) parts.push(`${fmt(c.workMin)}/${fmt(c.workGoal)} Min`);
  if (c.readGoal > 0) parts.push(`${fmt(c.readPages)}/${fmt(c.readGoal)} S.`);
  addLabel(w, parts.join(' · '), Font.mediumSystemFont(12), Color.white());
}

function buildError(w, family) {
  const msg = DATA_URL.includes('__')
    ? 'Bitte das Skript in der Fortschritt-App unter Einstellungen kopieren.'
    : 'Noch keine Daten. Öffne die App, verbinde den Sync und versuche es erneut.';
  if (family && family.startsWith('accessory')) {
    addLabel(w, 'Fortschritt: keine Daten', Font.mediumSystemFont(12), Color.white());
    return;
  }
  w.setPadding(14, 14, 14, 14);
  addLabel(w, 'Fortschritt', Font.boldRoundedSystemFont(15), COLORS.text);
  w.addSpacer(6);
  addLabel(w, msg, Font.systemFont(12), COLORS.text2, 5);
}

// ---------------------------------------------------------------- Ablauf

const now = new Date();
const { data, offline } = await loadData();
const family = config.widgetFamily || (config.runsInWidget ? 'small' : 'medium');
const widget = new ListWidget();
if (!family.startsWith('accessory')) widget.backgroundColor = COLORS.bg;

let planned = 0;
let planError = null;
if (data) {
  const c = todayContext(data, now);
  try {
    planned = await scheduleReminders(data, c, now);
  } catch (err) {
    planError = err;
    console.log(`Erinnerungen konnten nicht geplant werden: ${err}`);
  }
  if (family === 'small') buildSmall(widget, data, c, offline);
  else if (family === 'medium') buildMedium(widget, data, c, offline);
  else if (family === 'large' || family === 'extraLarge') buildMedium(widget, data, c, offline, true);
  else if (family === 'accessoryCircular') buildCircular(widget, data, c);
  else if (family === 'accessoryRectangular') buildRectangular(widget, data, c);
  else buildInline(widget, data, c);
} else {
  buildError(widget, family);
}

widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  const alert = new Alert();
  if (data) {
    alert.title = 'Fortschritt ist eingerichtet ✓';
    alert.message = planError
      ? 'Das Widget funktioniert. Erinnerungen konnten nicht geplant werden – erlaube Scriptable Mitteilungen in den iPhone-Einstellungen.'
      : `${planned} Erinnerungen für die nächsten 7 Tage geplant. Jetzt noch das Widget zum Home-Bildschirm hinzufügen.`;
  } else {
    alert.title = 'Noch keine Daten';
    alert.message = DATA_URL.includes('__')
      ? 'Kopiere das Skript bitte direkt aus der Fortschritt-App (Einstellungen → iPhone-Widget).'
      : 'Öffne die Fortschritt-App, verbinde den Sync und starte das Skript dann erneut.';
  }
  alert.addAction('Vorschau anzeigen');
  await alert.present();
  await widget.presentMedium();
}
Script.complete();
