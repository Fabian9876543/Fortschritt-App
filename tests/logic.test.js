import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  computeStats,
  continueTimer,
  dayKey,
  emptyState,
  expireTimer,
  levelFromXP,
  levelInfo,
  mergeStates,
  phoneTimerUrl,
  presetMinutes,
  questsForDay,
  sessionXP,
  snoozeTimer,
  timerElapsed,
  TIMER_PRESETS,
  walkStreak,
  xpForLevel,
} from '../js/logic.js';

const TODAY = '2026-10-15';

let n = 0;
function session(day, fields) {
  n++;
  return { id: `s${n}`, day, createdAt: n, updatedAt: n, ...fields };
}

function stateWith(sessions, extra = {}) {
  const s = emptyState();
  for (const x of sessions) s.sessions[x.id] = x;
  return Object.assign(s, extra);
}

test('Datumshilfen rechnen über Monats- und Zeitumstellungsgrenzen', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-29', -1), '2026-03-28');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('XP pro Session', () => {
  assert.equal(sessionXP({ kind: 'work', minutes: 50 }), 50);
  assert.equal(sessionXP({ kind: 'read', pages: 20, minutes: 30 }), 40);
  assert.equal(sessionXP({ kind: 'read', pages: 0, minutes: 30 }), 30);
  assert.equal(sessionXP({ kind: 'work', minutes: 50, deleted: true }), 0);
});

test('Level-Kurve', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 100);
  assert.equal(xpForLevel(5), 1000);
  assert.equal(levelFromXP(0), 1);
  assert.equal(levelFromXP(99), 1);
  assert.equal(levelFromXP(100), 2);
  assert.equal(levelFromXP(999), 4);
  assert.equal(levelFromXP(1000), 5);
  for (let xp = 0; xp < 50000; xp += 37) {
    const L = levelFromXP(xp);
    assert.ok(xpForLevel(L) <= xp && xpForLevel(L + 1) > xp, `xp ${xp}`);
  }
  const info = levelInfo(150);
  assert.equal(info.level, 2);
  assert.equal(info.into, 50);
  assert.equal(info.span, 200);
});

test('Streak: offener heutiger Tag bricht nicht, verpasster Tag schon', () => {
  const met = new Set(['2026-10-12', '2026-10-13', '2026-10-14']);
  const r = walkStreak('2026-10-12', TODAY, (k) => met.has(k));
  assert.equal(r.current, 3);
  assert.equal(r.todayMet, false);

  const gap = new Set(['2026-10-11', '2026-10-12', '2026-10-14']);
  const r2 = walkStreak('2026-10-11', TODAY, (k) => gap.has(k));
  assert.equal(r2.current, 1);
  assert.equal(r2.best, 2);
});

test('Streak: Joker nach 7 Tagen rettet einen verpassten Tag', () => {
  const met = new Set();
  for (let i = 0; i < 7; i++) met.add(addDays('2026-10-01', i)); // 1.–7.
  // 8. verpasst, 9.–10. erfüllt
  met.add('2026-10-09');
  met.add('2026-10-10');
  const r = walkStreak('2026-10-01', '2026-10-10', (k) => met.has(k));
  assert.equal(r.current, 9);
  assert.equal(r.freezes, 0);
  assert.ok(r.frozen.has('2026-10-08'));
});

test('Tagesziele, Boni und Bücher', () => {
  const book = { id: 'b1', title: 'Test', totalPages: 30, startPage: 0, updatedAt: 1 };
  const st = stateWith(
    [
      session(TODAY, { kind: 'work', minutes: 60 }),
      session(TODAY, { kind: 'read', pages: 25, minutes: 30, bookId: 'b1' }),
      session(addDays(TODAY, -1), { kind: 'read', pages: 10, bookId: 'b1' }),
    ],
    { books: { b1: book } },
  );
  const s = computeStats(st, TODAY);
  const d = s.todayAgg;
  assert.equal(d.workGoal, true);
  assert.equal(d.readGoal, true);
  assert.equal(d.perfect, true);
  assert.equal(d.baseXP, 60 + 50);
  assert.equal(d.bonus.goals, 40);
  assert.equal(d.bonus.perfect, 20);
  assert.equal(d.bonus.books, 100);
  assert.deepEqual(d.booksFinished, ['b1']);
  assert.equal(s.books.b1.finished, true);
  assert.equal(s.books.b1.finishedDay, TODAY);
  assert.equal(s.totals.booksFinished, 1);
  // gestern: 10 Seiten < 20 → kein Ziel → Streak 1 (nur heute)
  assert.equal(s.streak.current, 1);
  assert.equal(
    s.totalXP,
    [...s.days.values()].reduce((a, x) => a + x.xp, 0),
  );
});

test('Streak-Bonus wächst mit der Serie', () => {
  const list = [];
  for (let i = 4; i >= 0; i--) list.push(session(addDays(TODAY, -i), { kind: 'work', minutes: 60 }));
  const s = computeStats(stateWith(list), TODAY);
  assert.equal(s.streak.current, 5);
  assert.equal(s.todayAgg.bonus.streak, 10);
  assert.equal(s.days.get(addDays(TODAY, -4)).bonus.streak, 0);
});

test('Tages-Quests sind pro Tag stabil und respektieren deaktivierte Ziele', () => {
  const g = { workMin: 60, readPages: 20 };
  const a = questsForDay(TODAY, g).map((q) => q.id);
  const b = questsForDay(TODAY, g).map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
  for (let i = 0; i < 60; i++) {
    const ids = questsForDay(addDays(TODAY, i), { workMin: 60, readPages: 0 }).map((q) => q.id);
    assert.ok(!ids.some((id) => ['readx2', 'read30', 'perfect', 'combo'].includes(id)), ids.join());
  }
});

test('Merge: neuere Änderung gewinnt, Löschungen bleiben gelöscht, nichts geht verloren', () => {
  const base = emptyState();
  base.sessions.a = { id: 'a', day: TODAY, kind: 'work', minutes: 30, updatedAt: 10 };
  const laptop = structuredClone(base);
  const phone = structuredClone(base);
  laptop.sessions.b = { id: 'b', day: TODAY, kind: 'work', minutes: 20, updatedAt: 20 };
  phone.sessions.c = { id: 'c', day: TODAY, kind: 'read', pages: 5, updatedAt: 21 };
  phone.sessions.a = { ...phone.sessions.a, deleted: true, updatedAt: 30 };
  laptop.profile = { ...laptop.profile, name: 'Laptop', updatedAt: 5 };
  phone.profile = { ...phone.profile, name: 'Handy', updatedAt: 6 };

  const m1 = mergeStates(laptop, phone);
  const m2 = mergeStates(phone, laptop);
  assert.deepEqual(Object.keys(m1.sessions).sort(), ['a', 'b', 'c']);
  assert.equal(m1.sessions.a.deleted, true);
  assert.equal(m1.profile.name, 'Handy');
  assert.deepEqual(m1, { ...m2, sessions: m1.sessions, books: m1.books, projects: m1.projects });
  for (const id of ['a', 'b', 'c']) assert.deepEqual(m1.sessions[id], m2.sessions[id]);
});

test('Erfolge werden freigeschaltet', () => {
  const s = computeStats(stateWith([session(TODAY, { kind: 'work', minutes: 95, startedAt: new Date(2026, 9, 15, 6, 30).getTime() })]), TODAY);
  const done = new Set(s.achievements.filter((a) => a.done).map((a) => a.id));
  assert.ok(done.has('first'));
  assert.ok(done.has('deep90'));
  assert.ok(done.has('early'));
  assert.ok(!done.has('book1'));
});

test('Timer-Vorgaben je Session-Art', () => {
  assert.deepEqual(TIMER_PRESETS.work.options, [0, 25, 50, 90]);
  assert.deepEqual(TIMER_PRESETS.read.options, [0, 15, 30, 60]);
  // Standard ohne gespeicherte Auswahl
  assert.equal(presetMinutes({}, 'work'), 50);
  assert.equal(presetMinutes({}, 'read'), 30);
  // Getrennte Auswahl je Art
  assert.equal(presetMinutes({ workMinutes: 90, readMinutes: 15 }, 'work'), 90);
  assert.equal(presetMinutes({ workMinutes: 90, readMinutes: 15 }, 'read'), 15);
  // Alte gemeinsame Einstellung: gilt, wenn sie passt – sonst Standard
  assert.equal(presetMinutes({ minutes: 25 }, 'work'), 25);
  assert.equal(presetMinutes({ minutes: 25 }, 'read'), 30);
  assert.equal(presetMinutes({ minutes: 0 }, 'read'), 0);
  // Ungültige Werte fallen auf den Standard zurück
  assert.equal(presetMinutes({ readMinutes: 50 }, 'read'), 30);
});

test('Timer hält bei Ablauf an – wie ein Wecker', () => {
  const start = 1_000_000;
  const t = { kind: 'read', targetMin: 15, startedAt: start, accMs: 0, runStart: start };
  assert.equal(expireTimer(t, start + 14 * 60000), null);
  // 2 s nach Ablauf erkannt: Zeit auf genau 15 Min begrenzt, Timer steht
  const r = expireTimer(t, start + 15 * 60000 + 2000);
  assert.equal(r.lateMs, 2000);
  assert.equal(r.timer.accMs, 15 * 60000);
  assert.equal(r.timer.runStart, null);
  assert.equal(r.timer.expired, true);
  assert.equal(timerElapsed(r.timer, start + 60 * 60000), 15 * 60000);
  // Erst viel später bemerkt (App war im Hintergrund): trotzdem nur 15 Min
  assert.equal(expireTimer(t, start + 40 * 60000).timer.accMs, 15 * 60000);
  // Bereits abgelaufen oder freier Modus: nichts zu tun
  assert.equal(expireTimer(r.timer, start + 20 * 60000), null);
  assert.equal(expireTimer({ ...t, targetMin: 0 }, start + 99 * 60000), null);
});

test('Nach Ablauf: +5 Min oder ohne Limit weitermachen', () => {
  const now = 5_000_000;
  const done = { kind: 'work', targetMin: 25, startedAt: 0, accMs: 25 * 60000, runStart: null, expired: true };
  const snoozed = snoozeTimer(done, 5, now);
  assert.equal(snoozed.expired, false);
  assert.equal(snoozed.targetMin, 30);
  assert.equal(expireTimer(snoozed, now + 4 * 60000), null);
  assert.equal(expireTimer(snoozed, now + 5 * 60000).timer.accMs, 30 * 60000);
  const open = continueTimer(done, now);
  assert.equal(open.targetMin, 0);
  assert.equal(timerElapsed(open, now + 10 * 60000), 35 * 60000);
  assert.equal(expireTimer(open, now + 99 * 60000), null);
});

test('iPhone-Timer: Link zum Kurzbefehl mit Minuten als Eingabe', () => {
  assert.equal(phoneTimerUrl(15), 'shortcuts://run-shortcut?name=Fortschritt-Timer&input=text&text=15');
  assert.equal(phoneTimerUrl(5), 'shortcuts://run-shortcut?name=Fortschritt-Timer&input=text&text=5');
  assert.equal(phoneTimerUrl(30, 'Mein Timer ä'), 'shortcuts://run-shortcut?name=Mein%20Timer%20%C3%A4&input=text&text=30');
  // Nach „Weitermachen“ (ohne Limit) gehört kein iPhone-Timer mehr dazu
  const done = { kind: 'read', targetMin: 30, startedAt: 0, accMs: 30 * 60000, runStart: null, expired: true, phone: true };
  assert.equal(continueTimer(done, 1).phone, false);
});
