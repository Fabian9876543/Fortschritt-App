// Die einzelnen Seiten der App als HTML-Strings. Nutzereingaben laufen immer
// durch esc(). Interaktion läuft über data-action-Attribute (siehe app.js).

import { LEVEL_TITLES, XP_RULES, FREEZE_EVERY, FREEZE_MAX, addDays, daysBetween, sessionXP, startOfWeek } from './logic.js';
import { barList, columnChart, heatmap, ring } from './charts.js';
import { esc, fmtAgo, fmtDate, fmtDay, fmtHours, fmtLongDay, fmtMin, fmtNum } from './ui.js';

// ---------------------------------------------------------------- Hilfen

const byRecent = (stats, kind) => (a, b) => {
  const la = (kind === 'book' ? stats.books[a.id] : stats.projects[a.id])?.lastDay || '';
  const lb = (kind === 'book' ? stats.books[b.id] : stats.projects[b.id])?.lastDay || '';
  if (la !== lb) return la < lb ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
};

export function activeBooks(state, stats) {
  return Object.values(state.books)
    .filter((b) => !b.deleted && stats.books[b.id] && !stats.books[b.id].finished)
    .sort(byRecent(stats, 'book'));
}

export function finishedBooks(state, stats) {
  return Object.values(state.books)
    .filter((b) => !b.deleted && stats.books[b.id]?.finished)
    .sort((a, b) => (stats.books[b.id].finishedDay || '').localeCompare(stats.books[a.id].finishedDay || ''));
}

export function activeProjects(state, stats) {
  return Object.values(state.projects)
    .filter((p) => !p.deleted && !p.archived)
    .sort(byRecent(stats, 'project'));
}

export const projectLabel = (p) => `${p.emoji || '🎯'} ${p.name}`;

function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function trunc(s, n = 60) {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function sessionLabel(s, state) {
  if (s.kind === 'work') {
    const p = state.projects[s.projectId];
    return p && !p.deleted ? projectLabel(p) : '🎯 Deep Work';
  }
  const b = state.books[s.bookId];
  return b && !b.deleted ? `📖 ${b.title}` : '📖 Lesen';
}

function sessionDetail(s) {
  if (s.kind === 'work') return fmtMin(s.minutes || 0);
  return [s.pages ? `${fmtNum(s.pages)} Seiten` : '', s.minutes ? fmtMin(s.minutes) : ''].filter(Boolean).join(' · ');
}

function sessionRow(s, state, { editable = false } = {}) {
  const note = s.note ? ` · „${esc(trunc(s.note))}“` : '';
  return `
    <li class="session-row kind-${s.kind}">
      <span class="session-dot" aria-hidden="true"></span>
      <div class="session-main">
        <div class="session-title">${esc(sessionLabel(s, state))}</div>
        <div class="session-meta">${esc(sessionDetail(s))}${note}</div>
      </div>
      <span class="session-xp">+${fmtNum(sessionXP(s))} XP</span>
      ${editable ? `<button class="icon-btn" data-action="edit-session" data-id="${esc(s.id)}" aria-label="Session bearbeiten">✎</button>` : ''}
    </li>`;
}

function progressBar(pct, kind, label = '') {
  const v = Math.round(Math.min(1, Math.max(0, pct)) * 100);
  return `<div class="progress progress-${kind}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" ${label ? `aria-label="${esc(label)}"` : ''}><span style="width:${v}%"></span></div>`;
}

function emptyState(icon, title, text, actions = '') {
  return `<div class="empty"><div class="empty-icon">${icon}</div><strong>${esc(title)}</strong><p>${esc(text)}</p>${actions}</div>`;
}

// ---------------------------------------------------------------- Chrome

export function levelCard(stats) {
  const L = stats.level;
  const s = stats.streak;
  const flameState = s.todayMet ? 'is-lit' : s.current > 0 ? 'is-pending' : 'is-out';
  const jokers = s.freezes ? `<span class="joker" data-tv="${s.freezes}× Joker" data-tl="Rettet einen verpassten Tag" tabindex="0">🧊×${s.freezes}</span>` : '';
  return `
    <article class="card level-card">
      <div class="level-badge" aria-hidden="true"><span>${L.icon}</span></div>
      <div class="level-main">
        <div class="level-title"><span>Level ${L.level}</span> · ${esc(L.title)}</div>
        <div class="xpbar" role="progressbar" aria-label="Fortschritt zum nächsten Level" aria-valuemin="0" aria-valuemax="${L.span}" aria-valuenow="${L.into}">
          <span style="width:${(L.pct * 100).toFixed(1)}%"></span>
        </div>
        <div class="level-meta">
          <span><strong>${fmtNum(L.into)}</strong> / ${fmtNum(L.span)} XP</span>
          <span>noch ${fmtNum(L.toNext)} XP bis Level ${L.level + 1}</span>
        </div>
      </div>
      <div class="streak-box ${flameState}">
        <span class="flame" aria-hidden="true">🔥</span>
        <div><strong>${s.current}</strong><span>${s.current === 1 ? 'Tag' : 'Tage'} Streak</span></div>
        ${jokers}
      </div>
    </article>`;
}

// ---------------------------------------------------------------- Heute

function nudge(stats, timer) {
  if (timer) return '';
  const t = stats.todayAgg;
  const g = stats.goals;
  const s = stats.streak;
  if (stats.totals.sessions === 0) return '';
  if (t.perfect) {
    return `<div class="nudge nudge-good"><span>💎</span><p><strong>Alles geschafft heute!</strong> Jede weitere Minute bringt trotzdem XP.</p></div>`;
  }
  const workLeft = g.workMin > 0 ? g.workMin - t.workMin : Infinity;
  const readLeft = g.readPages > 0 ? g.readPages - t.readPages : Infinity;
  if (s.current > 0 && !s.todayMet) {
    const joker = s.freezes ? ' Sonst springt ein Joker 🧊 ein.' : '';
    return `<div class="nudge nudge-warn"><span>🔥</span><p><strong>Dein ${s.current}-Tage-Streak wartet auf dich.</strong> Erreiche heute ein Tagesziel, um ihn zu verlängern.${joker}</p></div>`;
  }
  if (workLeft > 0 && workLeft <= 20) {
    return `<div class="nudge"><span>⚡</span><p><strong>Nur noch ${fmtMin(workLeft)}</strong> bis zum Fokus-Ziel – das schaffst du!</p></div>`;
  }
  if (readLeft > 0 && readLeft <= 8) {
    return `<div class="nudge"><span>📖</span><p><strong>Nur noch ${readLeft} ${readLeft === 1 ? 'Seite' : 'Seiten'}</strong> bis zum Lese-Ziel.</p></div>`;
  }
  return '';
}

function onboarding(state) {
  const hasBooks = Object.values(state.books).some((b) => !b.deleted);
  const hasProjects = Object.values(state.projects).some((p) => !p.deleted);
  return `
    <article class="card onboarding">
      <h2>👋 Willkommen! So funktioniert's</h2>
      <ol class="steps">
        <li class="${hasBooks || hasProjects ? 'done' : ''}">
          <strong>Lege an, woran du dranbleiben willst.</strong>
          <span>Ein Buch, das du liest, oder ein Projekt für deine Deep-Work-Zeit.</span>
          <div class="row-actions">
            <button class="btn btn-sm btn-read" data-action="add-book">＋ Buch</button>
            <button class="btn btn-sm btn-work" data-action="add-project">＋ Projekt</button>
          </div>
        </li>
        <li><strong>Starte eine Session.</strong><span>Timer an, Handy weg. Jede Minute Deep Work = ${XP_RULES.workPerMinute} XP, jede Seite = ${XP_RULES.readPerPage} XP.</span></li>
        <li><strong>Erreiche deine Tagesziele.</strong><span>Das hält deinen 🔥 Streak am Leben und bringt Bonus-XP. Ziele passt du in den <a href="#/einstellungen">Einstellungen</a> an.</span></li>
      </ol>
    </article>`;
}

function ringItem({ kind, value, goal, unit, label, streak }) {
  const done = goal > 0 && value >= goal;
  return `
    <div class="ring-item ${done ? 'is-done' : ''}">
      <div class="ring-wrap">
        ${ring({ value, goal, kind })}
        <div class="ring-center">
          <strong>${fmtNum(value)}</strong>
          <span>/ ${fmtNum(goal)} ${unit}</span>
        </div>
      </div>
      <div class="ring-label"><span class="key key-${kind}"></span>${label}${done ? ' ✓' : ''}</div>
      <div class="ring-sub">${streak.current ? `🔥 ${streak.current} ${streak.current === 1 ? 'Tag' : 'Tage'}` : 'kein Streak'}</div>
    </div>`;
}

function questList(quests) {
  return `<ul class="quest-list">${quests
    .map(
      (q) => `
      <li class="quest ${q.done ? 'is-done' : ''}">
        <span class="quest-icon" aria-hidden="true">${q.done ? '✅' : q.icon}</span>
        <div class="quest-main">
          <div class="quest-title">${esc(q.title)}</div>
          <div class="quest-desc">${esc(q.desc)}</div>
          ${q.target > 1 && !q.done ? progressBar(q.value / q.target, 'xp', q.title) : ''}
        </div>
        <span class="quest-xp">+${q.xp} XP</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function continueCard(state, stats) {
  const books = activeBooks(state, stats).slice(0, 3);
  const projects = activeProjects(state, stats).slice(0, 3);
  if (!books.length && !projects.length) return '';
  const bookRows = books
    .map((b) => {
      const bs = stats.books[b.id];
      return `
        <li class="cont-row">
          <div class="cont-main">
            <div class="cont-title">📖 ${esc(b.title)}</div>
            ${progressBar(bs.pct, 'read', b.title)}
            <div class="cont-meta">Seite ${fmtNum(bs.shown)}${b.totalPages ? ` / ${fmtNum(b.totalPages)}` : ''}</div>
          </div>
          <button class="play play-read" data-action="start-book" data-id="${esc(b.id)}" aria-label="${esc(`${b.title} lesen`)}">▶</button>
        </li>`;
    })
    .join('');
  const projectRows = projects
    .map((p) => {
      const ps = stats.projects[p.id];
      return `
        <li class="cont-row">
          <div class="cont-main">
            <div class="cont-title">${esc(projectLabel(p))}</div>
            <div class="cont-meta">${fmtHours(ps.minutes)} gesamt · ${fmtMin(ps.weekMinutes)} diese Woche</div>
          </div>
          <button class="play play-work" data-action="start-project" data-id="${esc(p.id)}" aria-label="${esc(`Fokus auf ${p.name}`)}">▶</button>
        </li>`;
    })
    .join('');
  return `
    <article class="card">
      <header class="card-head"><h2>Weitermachen</h2><a href="#/bibliothek" class="link">Alle</a></header>
      <ul class="cont-list">${projectRows}${bookRows}</ul>
    </article>`;
}

export function viewToday(ctx) {
  const { state, stats, timer } = ctx;
  const t = stats.todayAgg;
  const g = stats.goals;
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const name = state.profile.name ? `, ${esc(state.profile.name)}` : '';
  const isNew = stats.totals.sessions === 0;

  const rings = [];
  if (g.workMin > 0) rings.push(ringItem({ kind: 'work', value: t.workMin, goal: g.workMin, unit: 'Min', label: 'Deep Work', streak: stats.workStreak }));
  if (g.readPages > 0) rings.push(ringItem({ kind: 'read', value: t.readPages, goal: g.readPages, unit: 'Seiten', label: 'Lesen', streak: stats.readStreak }));

  const bonus = t.bonus.goals + t.bonus.perfect + t.bonus.streak + t.bonus.quests + t.bonus.books;
  const xpTip = `${fmtNum(t.baseXP)} XP aus Sessions + ${fmtNum(bonus)} XP Boni`;
  const todaySessions = [...t.sessions].reverse();
  const questsDone = t.quests.filter((q) => q.done).length;

  return `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${esc(fmtLongDay(stats.today))}</p>
        <h1>${greet}${name}</h1>
      </header>
      ${nudge(stats, timer)}
      ${isNew ? onboarding(state) : ''}
      <div class="grid grid-today">
        ${levelCard(stats)}
        <article class="card today-card">
          <header class="card-head">
            <h2>Heute</h2>
            <span class="xp-pill" tabindex="0" data-tv="+${fmtNum(t.xp)} XP" data-tl="${esc(xpTip)}">+${fmtNum(t.xp)} XP</span>
          </header>
          <div class="rings">${rings.join('') || '<p class="muted">Keine Tagesziele aktiv – lege sie in den Einstellungen fest.</p>'}</div>
          <div class="actions">
            <button class="btn btn-work" data-action="quick-start" data-kind="work">▶ Fokus starten</button>
            <button class="btn btn-read" data-action="quick-start" data-kind="read">▶ Lesen starten</button>
            <button class="btn btn-ghost" data-action="log-session">＋ Nachtragen</button>
          </div>
        </article>
        <article class="card">
          <header class="card-head"><h2>Tages-Quests</h2><span class="muted">${questsDone}/${t.quests.length}</span></header>
          ${questList(t.quests)}
          <p class="hint">Jeden Tag gibt es neue Quests.</p>
        </article>
        ${continueCard(state, stats)}
        <article class="card">
          <header class="card-head"><h2>Heute erledigt</h2><span class="muted">${todaySessions.length ? `${todaySessions.length} ${todaySessions.length === 1 ? 'Session' : 'Sessions'}` : ''}</span></header>
          ${
            todaySessions.length
              ? `<ul class="session-list">${todaySessions.map((s) => sessionRow(s, state, { editable: true })).join('')}</ul>`
              : emptyState('🌱', 'Noch nichts geloggt', 'Starte mit 25 Minuten – der Anfang ist das Schwerste.')
          }
        </article>
      </div>
    </section>`;
}

// ---------------------------------------------------------------- Fokus

// Die aktuelle Auswahl bleibt wählbar, auch wenn das Projekt archiviert bzw.
// das Buch beendet ist – sonst ginge beim Bearbeiten die Zuordnung verloren.
export function refOptions(ctx, kind, selected) {
  const { state, stats } = ctx;
  if (kind === 'work') {
    const list = activeProjects(state, stats);
    const sel = state.projects[selected];
    if (sel && !sel.deleted && !list.includes(sel)) list.unshift(sel);
    return [
      `<option value="">Ohne Projekt</option>`,
      ...list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(projectLabel(p))}</option>`),
    ].join('');
  }
  const list = activeBooks(state, stats);
  const sel = state.books[selected];
  if (sel && !sel.deleted && !list.includes(sel)) list.unshift(sel);
  return [
    `<option value="">Ohne Buch</option>`,
    ...list.map((b) => `<option value="${esc(b.id)}" ${b.id === selected ? 'selected' : ''}>${esc(b.title)}</option>`),
  ].join('');
}

const DURATIONS = [
  { v: 0, label: 'Frei' },
  { v: 25, label: '25 Min' },
  { v: 50, label: '50 Min' },
  { v: 90, label: '90 Min' },
];

export function viewFocus(ctx) {
  const { prefs, timer, stats } = ctx;
  if (timer) return viewTimer(ctx);
  const f = prefs.focus;
  const kind = f.kind === 'read' ? 'read' : 'work';
  const ref = kind === 'work' ? f.workRef : f.readRef;
  const t = stats.todayAgg;
  const g = stats.goals;
  const left =
    kind === 'work'
      ? g.workMin > 0 && t.workMin < g.workMin
        ? `Heute noch ${fmtMin(g.workMin - t.workMin)} bis zum Fokus-Ziel.`
        : 'Fokus-Ziel für heute erreicht – alles weitere ist Bonus.'
      : g.readPages > 0 && t.readPages < g.readPages
        ? `Heute noch ${g.readPages - t.readPages} Seiten bis zum Lese-Ziel.`
        : 'Lese-Ziel für heute erreicht – alles weitere ist Bonus.';
  return `
    <section class="page focus-page">
      <header class="page-head"><h1>Fokus</h1><p class="sub">${esc(left)}</p></header>
      <article class="card focus-setup kind-${kind}">
        <div class="segmented" role="tablist" aria-label="Art der Session">
          <button role="tab" aria-selected="${kind === 'work'}" data-action="focus-kind" data-kind="work">🎯 Deep Work</button>
          <button role="tab" aria-selected="${kind === 'read'}" data-action="focus-kind" data-kind="read">📖 Lesen</button>
        </div>
        <label class="field">
          <span>${kind === 'work' ? 'Projekt' : 'Buch'}</span>
          <div class="field-row">
            <select id="focus-ref" data-change="focus-ref">${refOptions(ctx, kind, ref)}</select>
            <button class="btn btn-ghost" data-action="${kind === 'work' ? 'add-project' : 'add-book'}" data-then="focus">＋ Neu</button>
          </div>
        </label>
        <div class="field">
          <span>Dauer</span>
          <div class="chips" role="radiogroup" aria-label="Dauer">
            ${DURATIONS.map((d) => `<button role="radio" aria-checked="${f.minutes === d.v}" class="chip" data-action="focus-minutes" data-minutes="${d.v}">${d.label}</button>`).join('')}
          </div>
        </div>
        <button class="btn btn-xl btn-${kind}" data-action="timer-start">▶ Session starten</button>
        <p class="hint">${kind === 'work' ? 'Handy weg, Benachrichtigungen aus, ein einziges Ziel. Jede Minute = 1 XP.' : 'Nach der Session trägst du ein, bis zu welcher Seite du gekommen bist. Jede Seite = 2 XP.'}</p>
      </article>
      <article class="card tips">
        <h2>Warum das wirkt</h2>
        <ul>
          <li><strong>Kleiner Start:</strong> Schon 25 Minuten zählen – Hauptsache, du fängst an.</li>
          <li><strong>Deep Dive:</strong> Ab 45–90 Minuten am Stück gibt's oft Quest-Boni.</li>
          <li><strong>Streak:</strong> Ein erreichtes Tagesziel pro Tag hält die Flamme am Leben.</li>
        </ul>
      </article>
    </section>`;
}

function viewTimer(ctx) {
  const { timer, state } = ctx;
  const kind = timer.kind;
  const ref = kind === 'work' ? state.projects[timer.ref] : state.books[timer.ref];
  const label = ref && !ref.deleted ? (kind === 'work' ? projectLabel(ref) : `📖 ${ref.title}`) : kind === 'work' ? '🎯 Deep Work' : '📖 Lesen';
  const paused = !timer.runStart;
  const size = 280;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `
    <section class="page focus-page">
      <article class="card timer-card kind-${kind} ${paused ? 'is-paused' : 'is-running'}" id="timer-card">
        <div class="timer-ring-wrap">
          <svg class="timer-ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
            <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" />
            <circle id="timer-progress" class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
              stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-c="${c.toFixed(2)}"
              transform="rotate(-90 ${size / 2} ${size / 2})" />
          </svg>
          <div class="timer-center">
            <div class="timer-label">${esc(label)}</div>
            <div class="timer-time" id="timer-time" aria-live="off">00:00</div>
            <div class="timer-sub" id="timer-sub"></div>
          </div>
        </div>
        <div class="timer-actions">
          <button class="btn btn-ghost btn-lg" data-action="timer-toggle">${paused ? '▶ Weiter' : '⏸ Pause'}</button>
          <button class="btn btn-primary btn-lg" data-action="timer-stop">■ Fertig</button>
        </div>
        <button class="link-btn" data-action="timer-discard">Session verwerfen</button>
      </article>
      <p class="hint center">Du kannst die App schließen – der Timer läuft weiter und ist beim nächsten Öffnen wieder da.</p>
    </section>`;
}

// ---------------------------------------------------------------- Bibliothek

function bookCard(b, bs, goals) {
  const pct = Math.round(bs.pct * 100);
  const left = b.totalPages ? Math.max(0, b.totalPages - bs.read) : 0;
  const eta = left && goals.readPages > 0 ? ` · ca. ${Math.ceil(left / goals.readPages)} Tage bei ${goals.readPages} Seiten/Tag` : '';
  const initial = [...String(b.title).trim()][0] || '?';
  return `
    <article class="card book-card ${bs.finished ? 'is-finished' : ''}">
      <div class="book-spine" style="--h:${hue(b.title)}" aria-hidden="true"><span>${esc(initial.toUpperCase())}</span></div>
      <div class="book-main">
        <h3>${esc(b.title)}</h3>
        ${b.author ? `<p class="muted">${esc(b.author)}</p>` : ''}
        ${b.totalPages ? progressBar(bs.pct, 'read', b.title) : ''}
        <div class="book-meta">
          <span>${bs.finished ? `Beendet ${bs.finishedDay ? `am ${esc(fmtDate(bs.finishedDay))}` : ''}` : `Seite ${fmtNum(bs.shown)}${b.totalPages ? ` von ${fmtNum(b.totalPages)}` : ''}`}</span>
          ${b.totalPages ? `<strong>${pct} %</strong>` : ''}
        </div>
        ${!bs.finished && left ? `<p class="hint">Noch ${fmtNum(left)} Seiten${eta}</p>` : ''}
      </div>
      <div class="card-actions">
        ${
          bs.finished
            ? ''
            : `<button class="btn btn-read btn-sm" data-action="start-book" data-id="${esc(b.id)}">▶ Lesen</button>
        <button class="btn btn-ghost btn-sm" data-action="log-book" data-id="${esc(b.id)}">＋ Seiten</button>`
        }
        <button class="icon-btn" data-action="edit-book" data-id="${esc(b.id)}" aria-label="${esc(`${b.title} bearbeiten`)}">✎</button>
      </div>
    </article>`;
}

function projectCard(p, ps) {
  const target = Number(p.targetHours) || 0;
  return `
    <article class="card project-card ${p.archived ? 'is-archived' : ''}">
      <div class="project-emoji" aria-hidden="true">${esc(p.emoji || '🎯')}</div>
      <div class="book-main">
        <h3>${esc(p.name)}</h3>
        <p class="muted">${fmtHours(ps.minutes)} gesamt · ${fmtMin(ps.weekMinutes)} diese Woche · ${ps.sessions} ${ps.sessions === 1 ? 'Session' : 'Sessions'}</p>
        ${target ? `${progressBar(ps.minutes / 60 / target, 'work', p.name)}<div class="book-meta"><span>Ziel: ${fmtNum(target)} h</span><strong>${Math.min(100, Math.round((ps.minutes / 60 / target) * 100))} %</strong></div>` : ''}
      </div>
      <div class="card-actions">
        ${p.archived ? '' : `<button class="btn btn-work btn-sm" data-action="start-project" data-id="${esc(p.id)}">▶ Fokus</button>`}
        <button class="icon-btn" data-action="edit-project" data-id="${esc(p.id)}" aria-label="${esc(`${p.name} bearbeiten`)}">✎</button>
      </div>
    </article>`;
}

export function viewLibrary(ctx) {
  const { state, stats, ui } = ctx;
  const tab = ui.libraryTab;
  const reading = activeBooks(state, stats);
  const done = finishedBooks(state, stats);
  const projects = activeProjects(state, stats);
  const archived = Object.values(state.projects).filter((p) => !p.deleted && p.archived);

  const books = `
    <div class="section-head"><h2>Lese ich gerade</h2><button class="btn btn-read btn-sm" data-action="add-book">＋ Buch</button></div>
    ${reading.length ? `<div class="grid grid-cards">${reading.map((b) => bookCard(b, stats.books[b.id], stats.goals)).join('')}</div>` : emptyState('📚', 'Noch kein Buch', 'Füge das Buch hinzu, das du gerade liest – mit Seitenzahl siehst du deinen Fortschritt.', '<button class="btn btn-read" data-action="add-book">＋ Buch hinzufügen</button>')}
    ${done.length ? `<div class="section-head"><h2>Gelesen ✓ <span class="muted">${done.length}</span></h2></div><div class="grid grid-cards">${done.map((b) => bookCard(b, stats.books[b.id], stats.goals)).join('')}</div>` : ''}`;

  const projectsHtml = `
    <div class="section-head"><h2>Aktive Projekte</h2><button class="btn btn-work btn-sm" data-action="add-project">＋ Projekt</button></div>
    ${projects.length ? `<div class="grid grid-cards">${projects.map((p) => projectCard(p, stats.projects[p.id])).join('')}</div>` : emptyState('🎯', 'Noch kein Projekt', 'Lege an, woran du in deiner Deep-Work-Zeit arbeitest – so siehst du, wo deine Stunden hinfließen.', '<button class="btn btn-work" data-action="add-project">＋ Projekt anlegen</button>')}
    ${archived.length ? `<details class="archived"><summary>Archiviert (${archived.length})</summary><div class="grid grid-cards">${archived.map((p) => projectCard(p, stats.projects[p.id])).join('')}</div></details>` : ''}`;

  return `
    <section class="page">
      <header class="page-head"><h1>Bibliothek</h1></header>
      <div class="segmented wide" role="tablist" aria-label="Bibliothek">
        <button role="tab" aria-selected="${tab === 'books'}" data-action="lib-tab" data-tab="books">📖 Bücher <span class="count">${reading.length + done.length}</span></button>
        <button role="tab" aria-selected="${tab === 'projects'}" data-action="lib-tab" data-tab="projects">🎯 Projekte <span class="count">${projects.length}</span></button>
      </div>
      ${tab === 'books' ? books : projectsHtml}
    </section>`;
}

// ---------------------------------------------------------------- Statistik

function weekCompare(stats) {
  const today = stats.today;
  const ws = startOfWeek(today);
  const span = daysBetween(ws, today);
  const prevStart = addDays(ws, -7);
  const sum = (from, len) => {
    const out = { workMin: 0, readPages: 0, xp: 0 };
    for (let i = 0; i <= len; i++) {
      const d = stats.days.get(addDays(from, i));
      if (!d) continue;
      out.workMin += d.workMin;
      out.readPages += d.readPages;
      out.xp += d.xp;
    }
    return out;
  };
  const now = sum(ws, span);
  const prev = sum(prevStart, span);
  const row = (label, a, b, fmt) => {
    const diff = a - b;
    const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const icon = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝';
    const text = dir === 'flat' ? 'wie letzte Woche' : `${fmt(Math.abs(diff))} ${dir === 'up' ? 'mehr' : 'weniger'}`;
    return `<li><span class="wc-label">${label}</span><strong>${fmt(a)}</strong><span class="delta delta-${dir}">${icon} ${text}</span></li>`;
  };
  return `
    <ul class="week-compare">
      ${row('Deep Work', now.workMin, prev.workMin, fmtMin)}
      ${row('Seiten', now.readPages, prev.readPages, fmtNum)}
      ${row('XP', now.xp, prev.xp, fmtNum)}
    </ul>
    <p class="hint">Verglichen mit demselben Zeitraum der Vorwoche (Montag bis heute).</p>`;
}

export function viewStats(ctx) {
  const { state, stats, ui } = ctx;
  const T = stats.totals;
  const tiles = [
    { label: 'Gesamt-XP', value: fmtNum(stats.totalXP) },
    { label: 'Deep Work', value: fmtHours(T.workMin) },
    { label: 'Gelesene Seiten', value: fmtNum(T.readPages) },
    { label: 'Bücher beendet', value: fmtNum(T.booksFinished) },
    { label: 'Aktive Tage', value: fmtNum(T.activeDays) },
    { label: 'Bester Streak', value: `${stats.streak.best} ${stats.streak.best === 1 ? 'Tag' : 'Tage'}` },
  ];
  const projectItems = Object.values(state.projects)
    .filter((p) => !p.deleted && stats.projects[p.id]?.minutes > 0)
    .map((p) => ({ label: projectLabel(p), value: stats.projects[p.id].minutes }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const all = Object.values(state.sessions)
    .filter((s) => !s.deleted && s.day)
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0)));
  const shown = all.slice(0, ui.historyLimit);
  let lastDay = '';
  const history = shown
    .map((s) => {
      const head = s.day !== lastDay ? `<li class="history-day">${esc(fmtDay(s.day, stats.today))}</li>` : '';
      lastDay = s.day;
      return head + sessionRow(s, state, { editable: true });
    })
    .join('');

  return `
    <section class="page">
      <header class="page-head"><h1>Statistik</h1></header>
      <div class="tiles">${tiles.map((t) => `<div class="tile"><span class="tile-label">${t.label}</span><strong class="tile-value">${t.value}</strong></div>`).join('')}</div>
      <div class="grid grid-2">
        <article class="card">
          <header class="card-head"><div><h2>Deep Work</h2><p class="sub">Minuten pro Tag · letzte 14 Tage · Linie = Tagesziel</p></div></header>
          ${columnChart({ days: stats.days, today: stats.today, kind: 'work', field: 'workMin', unit: 'Min', goal: stats.goals.workMin })}
        </article>
        <article class="card">
          <header class="card-head"><div><h2>Lesen</h2><p class="sub">Seiten pro Tag · letzte 14 Tage · Linie = Tagesziel</p></div></header>
          ${columnChart({ days: stats.days, today: stats.today, kind: 'read', field: 'readPages', unit: 'Seiten', goal: stats.goals.readPages })}
        </article>
      </div>
      <article class="card">
        <header class="card-head"><div><h2>Aktivität</h2><p class="sub">XP pro Tag · letzte 24 Wochen</p></div></header>
        ${heatmap({ days: stats.days, today: stats.today })}
      </article>
      <div class="grid grid-2">
        <article class="card">
          <header class="card-head"><h2>Diese Woche</h2></header>
          ${weekCompare(stats)}
        </article>
        <article class="card">
          <header class="card-head"><div><h2>Zeit je Projekt</h2><p class="sub">Deep Work gesamt</p></div></header>
          ${projectItems.length ? barList(projectItems, { kind: 'work', format: fmtHours }) : '<p class="muted">Noch keine Projekt-Zeit erfasst.</p>'}
        </article>
      </div>
      <article class="card">
        <header class="card-head"><h2>Verlauf</h2><button class="btn btn-ghost btn-sm" data-action="log-session">＋ Nachtragen</button></header>
        ${all.length ? `<ul class="session-list">${history}</ul>` : '<p class="muted">Noch keine Sessions.</p>'}
        ${all.length > shown.length ? `<button class="btn btn-ghost full" data-action="more-history">Mehr anzeigen (${all.length - shown.length} weitere)</button>` : ''}
      </article>
    </section>`;
}

// ---------------------------------------------------------------- Erfolge

export function viewAchievements(ctx) {
  const { stats } = ctx;
  const L = stats.level;
  const done = stats.achievements.filter((a) => a.done).length;
  const ladder = LEVEL_TITLES.map((t) => {
    const cls = L.level >= t.level ? (L.title === t.title ? 'is-current' : 'is-reached') : '';
    return `<li class="${cls}"><span class="ladder-icon">${t.icon}</span><strong>${esc(t.title)}</strong><span>ab Level ${t.level}</span></li>`;
  }).join('');
  const fmtVal = (a) =>
    a.id.startsWith('work') || a.id === 'marathon' ? (Math.floor(a.current * 10) / 10).toLocaleString('de-DE') : fmtNum(Math.floor(a.current));
  const badges = stats.achievements
    .map(
      (a) => `
      <li class="badge ${a.done ? 'is-done' : ''}">
        <span class="badge-icon" aria-hidden="true">${a.icon}</span>
        <div class="badge-main">
          <strong>${esc(a.title)}</strong>
          <span>${esc(a.desc)}</span>
          ${a.done ? '<span class="badge-done">✓ Freigeschaltet</span>' : `${progressBar(a.pct, 'xp', a.title)}<span class="badge-progress">${fmtVal(a)} / ${fmtNum(a.target)}</span>`}
        </div>
      </li>`,
    )
    .join('');
  return `
    <section class="page">
      <header class="page-head"><h1>Erfolge</h1></header>
      ${levelCard(stats)}
      <article class="card">
        <header class="card-head"><h2>Rangleiter</h2><span class="muted">${fmtNum(stats.totalXP)} XP gesamt</span></header>
        <ol class="ladder">${ladder}</ol>
      </article>
      <article class="card">
        <header class="card-head"><h2>Abzeichen</h2><span class="muted">${done}/${stats.achievements.length}</span></header>
        <ul class="badges">${badges}</ul>
      </article>
      <article class="card rules">
        <h2>So sammelst du XP</h2>
        <ul>
          <li><span>🎯</span><div><strong>${XP_RULES.workPerMinute} XP pro Minute Deep Work</strong></div></li>
          <li><span>📖</span><div><strong>${XP_RULES.readPerPage} XP pro gelesener Seite</strong><small>oder 1 XP pro Lese-Minute, falls das mehr ist</small></div></li>
          <li><span>✅</span><div><strong>+${XP_RULES.goalBonus} XP pro erreichtem Tagesziel</strong><small>+${XP_RULES.perfectBonus} XP extra für einen perfekten Tag</small></div></li>
          <li><span>🔥</span><div><strong>Streak-Bonus: +${XP_RULES.streakPerDay} XP pro Streak-Tag</strong><small>bis max. +${XP_RULES.streakBonusMax} XP täglich. Ein Tag zählt, wenn du mind. ein Tagesziel erreichst.</small></div></li>
          <li><span>🧊</span><div><strong>Joker</strong><small>Alle ${FREEZE_EVERY} Streak-Tage bekommst du einen Joker (max. ${FREEZE_MAX}). Er rettet automatisch einen verpassten Tag.</small></div></li>
          <li><span>🗡️</span><div><strong>Tages-Quests: +10 bis +40 XP</strong><small>Drei wechselnde Herausforderungen pro Tag.</small></div></li>
          <li><span>🎉</span><div><strong>+${XP_RULES.bookFinished} XP pro beendetem Buch</strong></div></li>
        </ul>
      </article>
    </section>`;
}

// ---------------------------------------------------------------- Einstellungen

export function syncCard(ctx) {
  const sync = ctx.prefs.sync;
  const { ui } = ctx;
  if (sync?.token) {
    const status =
      ui.syncStatus === 'syncing'
        ? '⏳ Synchronisiere …'
        : ui.syncStatus === 'error'
          ? `⚠️ ${esc(ui.syncError)}`
          : sync.lastSync
            ? `✓ Zuletzt synchronisiert ${esc(fmtAgo(sync.lastSync))}`
            : 'Noch nicht synchronisiert';
    return `
      <article class="card" id="sync-card">
        <header class="card-head"><h2>☁️ Sync zwischen deinen Geräten</h2></header>
        <p class="sync-status ${ui.syncStatus === 'error' ? 'is-error' : ''}">${status}</p>
        ${sync.gistId ? `<p class="muted small">Gist-ID: <code>${esc(sync.gistId)}</code> – auf dem anderen Gerät reicht derselbe Token, die ID wird automatisch gefunden.</p>` : ''}
        <div class="row-actions">
          <button class="btn btn-primary" data-action="sync-now">Jetzt synchronisieren</button>
          <button class="btn btn-ghost" data-action="sync-disconnect">Trennen</button>
        </div>
      </article>`;
  }
  return `
    <article class="card" id="sync-card">
      <header class="card-head"><h2>☁️ Sync zwischen Laptop & Handy</h2></header>
      <p>Deine Daten liegen zunächst nur auf diesem Gerät. Damit Laptop und Handy denselben Stand haben, speichert die App eine Kopie in einem <strong>geheimen GitHub-Gist</strong> – nicht öffentlich gelistet und nur über deinen Account bzw. den genauen Link erreichbar.</p>
      <ol class="small-steps">
        <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Fortschritt-App" target="_blank" rel="noopener">Token auf GitHub erstellen</a> – nur das Häkchen bei <code>gist</code> setzen, Ablaufdatum nach Wunsch.</li>
        <li>Token hier einfügen und verbinden.</li>
        <li>Auf dem anderen Gerät genau dasselbe – fertig. Ab dann wird automatisch synchronisiert.</li>
      </ol>
      <form class="stack" data-form="sync-connect">
        <label class="field"><span>GitHub-Token</span><input name="token" type="password" autocomplete="off" placeholder="ghp_…" required /></label>
        <label class="field"><span>Gist-ID <small class="muted">(optional, wird sonst automatisch gefunden)</small></span><input name="gistId" type="text" autocomplete="off" /></label>
        <button class="btn btn-primary" type="submit">Verbinden</button>
      </form>
      <p class="hint">Der Token wird nur auf diesem Gerät gespeichert und ausschließlich an api.github.com gesendet.</p>
    </article>`;
}

export function viewSettings(ctx) {
  const { state, prefs } = ctx;
  const g = state.profile.goals;
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
    <section class="page">
      <header class="page-head"><h1>Einstellungen</h1></header>
      <div class="grid grid-2">
        <article class="card">
          <header class="card-head"><h2>Profil & Tagesziele</h2></header>
          <form class="stack" data-form="profile">
            <label class="field"><span>Dein Name</span><input id="set-name" name="name" type="text" maxlength="40" value="${esc(state.profile.name)}" placeholder="optional" /></label>
            <label class="field"><span>Deep Work pro Tag (Minuten)</span><input id="set-work" name="workMin" type="number" inputmode="numeric" min="0" max="1440" step="5" value="${g.workMin}" /></label>
            <label class="field"><span>Lesen pro Tag (Seiten)</span><input id="set-read" name="readPages" type="number" inputmode="numeric" min="0" max="5000" step="1" value="${g.readPages}" /></label>
            <p class="hint">Setze ein Ziel auf 0, um es auszublenden. Realistische Ziele schlagen ehrgeizige – lieber jeden Tag schaffen.</p>
          </form>
        </article>
        <article class="card">
          <header class="card-head"><h2>Darstellung & Timer</h2></header>
          <div class="field">
            <span>Design</span>
            <div class="segmented" role="radiogroup" aria-label="Design">
              ${[
                ['system', 'System'],
                ['light', 'Hell'],
                ['dark', 'Dunkel'],
              ]
                .map(([v, l]) => `<button role="radio" aria-checked="${prefs.theme === v}" data-action="set-theme" data-theme-value="${v}">${l}</button>`)
                .join('')}
            </div>
          </div>
          <label class="check"><input type="checkbox" data-change="wake-lock" ${prefs.wakeLock ? 'checked' : ''} /> Bildschirm während einer Session anlassen</label>
          <div class="field">
            <span>Benachrichtigung bei Timer-Ende</span>
            ${
              notif === 'granted'
                ? '<p class="muted">✓ Erlaubt</p>'
                : notif === 'denied'
                  ? '<p class="muted">Blockiert – in den Browser-Einstellungen änderbar.</p>'
                  : notif === 'unsupported'
                    ? '<p class="muted">Von diesem Browser nicht unterstützt (auf dem iPhone: App zum Home-Bildschirm hinzufügen).</p>'
                    : '<button class="btn btn-ghost" data-action="notify-permission">Benachrichtigungen erlauben</button>'
            }
          </div>
        </article>
      </div>
      ${syncCard(ctx)}
      <article class="card">
        <header class="card-head"><h2>Daten</h2></header>
        <p class="muted">Alles wird lokal im Browser gespeichert. Mach ab und zu ein Backup – oder nutze den Sync.</p>
        <div class="row-actions">
          <button class="btn btn-ghost" data-action="export">⬇ Backup exportieren</button>
          <button class="btn btn-ghost" data-action="import">⬆ Backup importieren</button>
          <button class="btn btn-danger-ghost" data-action="reset">Alle Daten löschen</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden />
      </article>
      <article class="card install-help">
        <header class="card-head"><h2>📲 Als App installieren</h2></header>
        <ul>
          <li><strong>iPhone/iPad (Safari):</strong> Teilen-Symbol → „Zum Home-Bildschirm“.</li>
          <li><strong>Android (Chrome):</strong> Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</li>
          <li><strong>Laptop (Chrome/Edge):</strong> Installations-Symbol rechts in der Adressleiste.</li>
        </ul>
        ${ctx.canInstall ? '<button class="btn btn-primary" data-action="install">Jetzt installieren</button>' : ''}
      </article>
      <p class="hint center">Fortschritt · Version ${esc(ctx.version)}</p>
    </section>`;
}

// ---------------------------------------------------------------- Formulare

export function sessionForm(ctx, s, { mode }) {
  const kind = s.kind === 'read' ? 'read' : 'work';
  const today = ctx.stats.today;
  return `
    <div class="form-session" data-kind="${kind}">
      ${
        mode === 'timer'
          ? `<input type="hidden" name="kind" value="${kind}" />`
          : `<div class="segmented" role="radiogroup" aria-label="Art">
              <label><input type="radio" name="kind" value="work" ${kind === 'work' ? 'checked' : ''} /><span>🎯 Deep Work</span></label>
              <label><input type="radio" name="kind" value="read" ${kind === 'read' ? 'checked' : ''} /><span>📖 Lesen</span></label>
            </div>`
      }
      <div class="form-grid">
        <label class="field"><span>Datum</span><input name="day" type="date" value="${esc(s.day || today)}" max="${today}" required /></label>
        <label class="field"><span>Minuten</span><input name="minutes" type="number" inputmode="numeric" min="0" max="1440" step="1" value="${s.minutes ?? ''}" placeholder="z. B. 45" ${mode !== 'timer' ? 'autofocus' : ''} /></label>
      </div>
      <label class="field only-work"><span>Projekt</span><select name="projectId">${refOptions(ctx, 'work', s.projectId)}</select></label>
      <label class="field only-read"><span>Buch</span><select name="bookId">${refOptions(ctx, 'read', s.bookId)}</select></label>
      <div class="form-grid only-read">
        <label class="field page-to"><span>Bis Seite</span><input name="toPage" type="number" inputmode="numeric" min="0" step="1" ${mode === 'timer' ? 'autofocus' : ''} /></label>
        <label class="field"><span>Gelesene Seiten</span><input name="pages" type="number" inputmode="numeric" min="0" max="5000" step="1" value="${s.pages ?? ''}" /></label>
      </div>
      <p class="hint only-read" data-out="page-hint"></p>
      <label class="field"><span>Notiz <small class="muted">(optional – was hast du geschafft oder gelernt?)</small></span><textarea name="note" rows="2" maxlength="500">${esc(s.note || '')}</textarea></label>
      <div class="xp-preview" aria-live="polite"><span>Dafür gibt's</span><strong data-out="xp">+0 XP</strong></div>
      <p class="form-error" data-out="error" role="alert"></p>
    </div>`;
}

export function bookForm(b = {}) {
  return `
    <div class="stack">
      <label class="field"><span>Titel</span><input name="title" type="text" maxlength="120" required value="${esc(b.title || '')}" autofocus /></label>
      <label class="field"><span>Autor:in <small class="muted">(optional)</small></span><input name="author" type="text" maxlength="80" value="${esc(b.author || '')}" /></label>
      <div class="form-grid">
        <label class="field"><span>Seiten gesamt</span><input name="totalPages" type="number" inputmode="numeric" min="0" max="20000" value="${b.totalPages || ''}" placeholder="z. B. 320" /></label>
        <label class="field"><span>Bereits gelesen bis Seite</span><input name="startPage" type="number" inputmode="numeric" min="0" max="20000" value="${b.startPage || ''}" placeholder="0" /></label>
      </div>
      <p class="form-error" data-out="error" role="alert"></p>
    </div>`;
}

const EMOJIS = ['🎯', '💻', '🚀', '✍️', '🎓', '🎨', '📈', '🧪', '🎵', '🏗️', '📝', '🧠'];

export function projectForm(p = {}) {
  const current = p.emoji || '🎯';
  return `
    <div class="stack">
      <label class="field"><span>Name</span><input name="name" type="text" maxlength="80" required value="${esc(p.name || '')}" autofocus placeholder="z. B. Bachelorarbeit" /></label>
      <div class="field">
        <span>Symbol</span>
        <div class="emoji-pick" role="radiogroup" aria-label="Symbol">
          ${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === current ? 'checked' : ''} /><span>${e}</span></label>`).join('')}
          ${EMOJIS.includes(current) ? '' : `<label><input type="radio" name="emoji" value="${esc(current)}" checked /><span>${esc(current)}</span></label>`}
        </div>
      </div>
      <label class="field"><span>Ziel in Stunden <small class="muted">(optional)</small></span><input name="targetHours" type="number" inputmode="numeric" min="0" max="100000" value="${p.targetHours || ''}" placeholder="z. B. 100" /></label>
      ${p.id ? `<label class="check"><input type="checkbox" name="archived" ${p.archived ? 'checked' : ''} /> Archiviert (abgeschlossen oder pausiert)</label>` : ''}
      <p class="form-error" data-out="error" role="alert"></p>
    </div>`;
}

export const views = {
  heute: viewToday,
  fokus: viewFocus,
  bibliothek: viewLibrary,
  statistik: viewStats,
  erfolge: viewAchievements,
  einstellungen: viewSettings,
};
