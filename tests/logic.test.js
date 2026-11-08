import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  bookPageAt,
  changeProfile,
  computeStats,
  closePhoneLaunch,
  confirmPhoneTimer,
  continueTimer,
  dayKey,
  detachPhoneTimer,
  emptyState,
  expireTimer,
  goalsOn,
  normalizeState,
  launchPhoneTimer,
  levelFromXP,
  levelInfo,
  mergeStates,
  pauseTimer,
  PHONE_CONFIRM_MS,
  phoneTimerActive,
  phoneTimerUrl,
  presetMinutes,
  questsForDay,
  readPages,
  remainingMinutes,
  restoreFromBackup,
  resumeTimer,
  sessionXP,
  snoozeTimer,
  timerElapsed,
  TIMER_PRESETS,
  trainingId,
  trainingStats,
  walkStreak,
  weekTotals,
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
  // Nach „Weitermachen“ oder „+5 Min“ gehört der alte iPhone-Timer nicht mehr dazu
  const done = { kind: 'read', targetMin: 30, startedAt: 0, accMs: 30 * 60000, runStart: null, expired: true, phone: true, phoneOk: true };
  assert.equal(continueTimer(done, 1).phone, false);
  assert.equal(phoneTimerActive(snoozeTimer(done, 5, 1)), false);
});

test('iPhone-Timer: App-Wecker schweigt nur, wenn die Kurzbefehle-App direkt nach dem Start aufging', () => {
  const start = 1_000_000;
  const t = launchPhoneTimer({ kind: 'work', targetMin: 50, startedAt: start, accMs: 0, runStart: start }, start);
  assert.equal(phoneTimerActive(t), false);
  // Seite gleich danach verdeckt → Kurzbefehle ist aufgegangen
  const ok = confirmPhoneTimer(t, start + 2000);
  assert.equal(phoneTimerActive(ok), true);
  assert.equal(confirmPhoneTimer(ok, start + 3000), null);
  // Erst später verdeckt (z. B. gesperrt, nachdem iOS' Rückfrage abgebrochen wurde) → kein Beleg
  assert.equal(confirmPhoneTimer(t, start + PHONE_CONFIRM_MS + 1), null);
  // In der App getippt → ein späteres Verdecken zählt nicht mehr
  const touched = closePhoneLaunch(t);
  assert.equal(confirmPhoneTimer(touched, start + 3000), null);
  assert.equal(closePhoneLaunch(touched), null);
  // Ohne iPhone-Timer nichts zu bestätigen
  assert.equal(confirmPhoneTimer({ ...t, phone: false }, start + 1000), null);
  assert.equal(phoneTimerActive(detachPhoneTimer(ok)), false);
});

test('Pause und Weiter – mit neuem iPhone-Timer auf die volle Minute', () => {
  const start = 1_000_000;
  const t = { kind: 'work', targetMin: 50, startedAt: start, accMs: 0, runStart: start, phone: true, phoneOk: true };
  const paused = pauseTimer(t, start + 12 * 60000 + 37000);
  assert.equal(paused.runStart, null);
  assert.equal(paused.accMs, 12 * 60000 + 37000);
  assert.equal(timerElapsed(paused, start + 99 * 60000), paused.accMs);
  // 37:23 übrig → der iPhone-Timer bekommt 38 Minuten, der Countdown endet mit ihm
  const now = start + 20 * 60000;
  assert.equal(remainingMinutes(paused, now), 38);
  const resumed = resumeTimer(paused, now, 38);
  assert.equal(resumed.runStart, now);
  assert.equal(expireTimer(resumed, now + 38 * 60000 - 1), null);
  assert.equal(expireTimer(resumed, now + 38 * 60000).lateMs, 0);
  // Ohne iPhone-Timer bleibt die Zielzeit
  assert.equal(resumeTimer(paused, now).targetMin, 50);
  assert.equal(remainingMinutes({ ...paused, accMs: 50 * 60000 - 300 }, now), 1);
});

test('Wochenvergleich: diese Woche ab Montag, Vorwoche komplett; Deep Work ohne Projekt zählt mit', () => {
  const MON = '2026-10-19';
  const st = stateWith(
    [
      session('2026-10-16', { kind: 'work', minutes: 90 }), // Fr, ohne Projekt
      session('2026-10-16', { kind: 'work', minutes: 30, projectId: 'p1' }),
      session('2026-10-18', { kind: 'work', minutes: 20, projectId: 'gone' }), // Projekt gelöscht
      session('2026-10-18', { kind: 'read', pages: 40 }), // So
      session(MON, { kind: 'read', pages: 26 }),
      session('2026-10-11', { kind: 'read', pages: 99 }), // vorletzte Woche
    ],
    { projects: { p1: { id: 'p1', name: 'Bachelorarbeit', updatedAt: 1 }, gone: { id: 'gone', name: 'Alt', deleted: true, updatedAt: 2 } } },
  );
  const stats = computeStats(st, MON);
  const w = weekTotals(stats.days, MON);
  assert.equal(w.start, MON);
  assert.deepEqual(w.now, { workMin: 0, readPages: 26, xp: stats.days.get(MON).xp });
  assert.equal(w.prev.workMin, 140);
  assert.equal(w.prev.readPages, 40);
  assert.equal(w.prev.xp, stats.days.get('2026-10-16').xp + stats.days.get('2026-10-18').xp);
  // Sonntag gehört noch zur Vorwoche, Montag beginnt die neue
  assert.equal(weekTotals(stats.days, '2026-10-18').start, '2026-10-12');
  assert.equal(weekTotals(stats.days, '2026-10-18').now.workMin, 140);
  assert.equal(stats.projects.p1.minutes, 30);
  assert.equal(stats.totals.noProjectMin, 110);
  assert.equal(stats.totals.workMin, 140);
});

test('Training: ein Eintrag je Tag und Art, zählt nicht für XP, wird synchronisiert', () => {
  const SUN = '2026-11-01';
  const rec = (day, type, extra = {}) => ({ id: trainingId(day, type), day, type, createdAt: 1, updatedAt: 1, ...extra });
  const trainings = Object.fromEntries(
    [
      rec('2026-10-26', 'upper'), // Mo dieser Woche
      rec('2026-10-28', 'run'),
      rec('2026-10-28', 'core'),
      rec('2026-10-30', 'upper', { deleted: true }), // wieder abgehakt
      rec('2026-10-22', 'lower'), // Vorwoche
      rec('2026-11-02', 'run'), // Zukunft (falsche Uhr) – zählt nicht
      { id: 'x', day: '2026-10-27', type: 'yoga', createdAt: 1, updatedAt: 1 }, // unbekannte Art
    ].map((t) => [t.id, t]),
  );
  const st = normalizeState({ ...emptyState(), trainings });
  assert.equal(Object.keys(st.trainings).length, 7);
  const ts = trainingStats(st, SUN);
  assert.deepEqual([...ts.byDay.keys()].sort(), ['2026-10-22', '2026-10-26', '2026-10-28']);
  assert.deepEqual(ts.types.upper, { last: '2026-10-26', week: 1, total: 1 });
  assert.deepEqual(ts.types.lower, { last: '2026-10-22', week: 0, total: 1 });
  assert.deepEqual(ts.types.run, { last: '2026-10-28', week: 1, total: 1 });
  assert.equal(ts.weekDays, 2);
  // Kein Einfluss auf XP und Streak
  const stats = computeStats(st, SUN);
  assert.equal(stats.totalXP, 0);
  assert.equal(stats.streak.current, 0);
  assert.equal(stats.training.types.core.week, 1);
  // Zwei Geräte haken denselben Tag ab: gleiche ID, neuere Änderung gewinnt
  const phone = { ...emptyState(), trainings: { [trainingId(SUN, 'run')]: rec(SUN, 'run', { updatedAt: 5 }) } };
  const laptop = {
    ...emptyState(),
    trainings: {
      [trainingId(SUN, 'run')]: rec(SUN, 'run', { deleted: true, updatedAt: 9 }),
      [trainingId(SUN, 'upper')]: rec(SUN, 'upper', { updatedAt: 3 }),
    },
  };
  const merged = mergeStates(phone, laptop);
  assert.equal(merged.trainings[trainingId(SUN, 'run')].deleted, true);
  assert.equal(merged.trainings[trainingId(SUN, 'upper')].type, 'upper');
  assert.deepEqual([...trainingStats(merged, SUN).byDay.get(SUN)], ['upper']);
});

test('„Bis Seite“: absolute Seite, nichts zählt doppelt – auch nach dem Sync zweier Geräte', () => {
  const book = { id: 'zb', title: 'Der Zauberberg', totalPages: 320, startPage: 0, updatedAt: 1 };
  const at = (iso) => new Date(iso).getTime();
  const s0 = { id: 's0', kind: 'read', bookId: 'zb', day: '2026-10-18', toPage: 16, pages: 16, createdAt: at('2026-10-18T10:00:00'), updatedAt: 1 };
  // Laptop (noch nicht hochgeladen): So 23:00 bis Seite 30
  const s1 = { id: 's1', kind: 'read', bookId: 'zb', day: '2026-10-18', toPage: 30, pages: 14, createdAt: at('2026-10-18T23:00:00'), updatedAt: 2 };
  // Handy kannte s1 nicht: Mo bis Seite 42 → hat lokal 26 Seiten gerechnet
  const s2 = { id: 's2', kind: 'read', bookId: 'zb', day: '2026-10-19', toPage: 42, pages: 26, createdAt: at('2026-10-19T12:30:00'), updatedAt: 3 };
  const merged = mergeStates({ ...emptyState(), books: { zb: book }, sessions: { s0, s1 } }, { ...emptyState(), books: { zb: book }, sessions: { s0, s2 } });
  const st = computeStats(merged, '2026-10-19');
  assert.equal(st.totals.readPages, 42);
  assert.equal(st.days.get('2026-10-19').readPages, 12);
  assert.equal(st.pagesBySession.s2, 12);
  assert.equal(st.books.zb.currentPage, 42);
  // Stand vor einer Stelle im Verlauf: beim Bearbeiten von s1 zählt nur s0
  assert.equal(bookPageAt(merged, 'zb', '2026-10-18', s1.createdAt, 's1'), 16);
  assert.equal(bookPageAt(merged, 'zb', '2026-10-19'), 42);
  // Nachtragen für Samstag: Stand am Ende von Samstag = Startseite
  assert.equal(bookPageAt(merged, 'zb', '2026-10-17'), 0);
  const back = { id: 'sb', kind: 'read', bookId: 'zb', day: '2026-10-17', toPage: 10, pages: 10, createdAt: at('2026-11-01T09:00:00'), updatedAt: 4 };
  const st2 = computeStats({ ...merged, sessions: { ...merged.sessions, sb: back } }, '2026-10-19');
  assert.equal(st2.pagesBySession.sb, 10);
  assert.equal(st2.pagesBySession.s0, 6);
  assert.equal(st2.totals.readPages, 42);
  // Ohne toPage zählt die eingetragene Seitenzahl wie bisher
  assert.equal(readPages({ pages: 7 }, 100), 7);
  assert.equal(readPages({ pages: 7, toPage: 90 }, 100), 0);
  assert.equal(readPages({ pages: 7, toPage: 120 }, null), 7);
});

test('Bücher: gelöschte behalten Abschluss und XP, fertig eingetragene zählen ohne XP', () => {
  const st = stateWith([session('2026-10-16', { kind: 'read', pages: 30, bookId: 'v' })], {
    books: {
      v: { id: 'v', title: 'Die Verwandlung', totalPages: 70, startPage: 40, deleted: true, updatedAt: 5 },
      p: { id: 'p', title: 'Der Prozess', totalPages: 240, startPage: 240, updatedAt: 1 },
    },
  });
  const stats = computeStats(st, '2026-10-19');
  assert.equal(stats.days.get('2026-10-16').bonus.books, 100);
  assert.equal(stats.totals.booksFinished, 2);
  assert.equal(stats.books.p.finished, true);
  assert.equal(stats.books.p.finishedDay, null);
});

test('Zieländerung gilt ab heute: vergangene Tage, Streak und Abzeichen bleiben', () => {
  const MON = '2026-10-19';
  const days = Array.from({ length: 9 }, (_, i) => addDays('2026-10-11', i));
  const base = stateWith(days.map((d) => session(d, { kind: 'read', pages: 22 })));
  const before = computeStats(base, MON);
  assert.equal(before.streak.current, 9);
  const at = new Date('2026-10-19T20:00:00').getTime();
  const raised = { ...base, profile: changeProfile(base.profile, { name: '', goals: { workMin: 60, readPages: 25 } }, at, MON) };
  assert.deepEqual(goalsOn(raised.profile, '2026-10-18'), { workMin: 60, readPages: 20 });
  assert.deepEqual(goalsOn(raised.profile, MON), { workMin: 60, readPages: 25 });
  const after = computeStats(raised, MON);
  assert.equal(after.goals.readPages, 25);
  assert.equal(after.days.get('2026-10-18').xp, before.days.get('2026-10-18').xp);
  // Heute (22 < 25) ist noch offen; die 8 Tage davor zählen weiter (vorher wäre alles weg gewesen)
  assert.equal(after.streak.current, 8);
  assert.equal(after.streak.best, 8);
  assert.equal(after.todayAgg.readGoal, false);
  // Nur der Name geändert: kein neuer Zielverlauf, eigener Zeitstempel
  const named = changeProfile(base.profile, { name: 'Fabian', goals: { workMin: 60, readPages: 20 } }, at, MON);
  assert.equal(named.goalLog, undefined);
  assert.equal(named.nameUpdatedAt, at);
  assert.equal(named.goalsUpdatedAt, 0);
});

test('Profil-Abgleich Feld für Feld: Erinnerung auf dem Handy überschreibt nicht das Ziel vom Laptop', () => {
  const p0 = emptyState().profile;
  const laptop = changeProfile(p0, { goals: { workMin: 30, readPages: 10 } }, 1000, '2026-10-10');
  const reminders = p0.reminders.map((r) => (r.type === 'read' ? { ...r, time: '21:15' } : r));
  const phone = changeProfile(p0, { reminders }, 2000, '2026-10-12'); // kannte das neue Ziel noch nicht
  const merged = mergeStates({ ...emptyState(), profile: laptop }, { ...emptyState(), profile: phone }).profile;
  assert.deepEqual(merged.goals, { workMin: 30, readPages: 10 });
  assert.equal(merged.reminders.find((r) => r.type === 'read').time, '21:15');
  assert.equal(merged.goalLog.length, 2);
  assert.deepEqual(mergeStates({ ...emptyState(), profile: phone }, { ...emptyState(), profile: laptop }).profile, merged);
  // Übersteht das Speichern (normalizeState) und ältere Profile ohne eigene Zeitstempel
  assert.deepEqual(normalizeState({ profile: merged }).profile.goalLog, merged.goalLog);
  const old = { ...p0, name: 'Alt', goals: { workMin: 45, readPages: 15 }, updatedAt: 5000 };
  const m2 = mergeStates({ ...emptyState(), profile: merged }, { ...emptyState(), profile: old }).profile;
  assert.equal(m2.name, 'Alt');
  assert.deepEqual(m2.goals, { workMin: 45, readPages: 15 });
  assert.equal(m2.goalLog.length, 2);
});

test('Backup nach „Alle Daten löschen“: Einträge kommen zurück, gezielt Gelöschtes nicht', () => {
  const backup = stateWith([session('2026-10-20', { kind: 'work', minutes: 30 }), session('2026-10-21', { kind: 'read', pages: 10 })]);
  backup.trainings['2026-10-20:run'] = { id: '2026-10-20:run', day: '2026-10-20', type: 'run', createdAt: 1, updatedAt: 1 };
  const [a, b] = Object.keys(backup.sessions);
  // Lokal: alles zurückgesetzt (Löschmarken mit reset), eine Session davor gezielt gelöscht
  const local = emptyState();
  local.sessions[a] = { id: a, deleted: true, reset: true, createdAt: 1, updatedAt: 900 };
  local.sessions[b] = { id: b, deleted: true, createdAt: 1, updatedAt: 900 };
  local.trainings['2026-10-20:run'] = { id: '2026-10-20:run', deleted: true, reset: true, createdAt: 1, updatedAt: 900 };
  const merged = mergeStates(local, restoreFromBackup(local, backup, 1000));
  assert.equal(merged.sessions[a].deleted, undefined);
  assert.equal(merged.sessions[a].updatedAt, 1000);
  assert.equal(merged.sessions[b].deleted, true);
  assert.equal(merged.trainings['2026-10-20:run'].type, 'run');
  assert.equal(computeStats(merged, '2026-10-21').totals.workMin, 30);
});
