// Diagramme als HTML/SVG-Strings: Fortschrittsringe, Säulen, Heatmap, Balkenliste.
// Werte und Beschriftungen für Tooltips stehen in data-tv / data-tl und werden
// erst im Tooltip per textContent eingesetzt.

import { addDays, startOfWeek } from './logic.js';
import { esc, fmtDay, fmtMonth, fmtNum, fmtWeekday } from './ui.js';

export function ring({ value, goal, kind, size = 116, stroke = 11 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const mid = size / 2;
  return `
    <svg class="ring ring-${kind}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" />
      <circle class="ring-fill" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}"
        transform="rotate(-90 ${mid} ${mid})" ${pct === 0 ? 'opacity="0"' : ''} />
    </svg>`;
}

function niceMax(v) {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * exp >= v) return m * exp;
  }
  return 10 * exp;
}

// Tagessäulen der letzten n Tage, eine Serie, optional mit Ziel-Linie.
export function columnChart({ days, today, n = 14, kind, field, unit, goal = 0 }) {
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    const d = days.get(key);
    rows.push({ key, value: d ? Math.round(d[field]) : 0 });
  }
  const max = niceMax(Math.max(goal, ...rows.map((r) => r.value)));
  // Das Ziel steht an der Achse statt im Plot, damit es keine Säule verdeckt;
  // Achsenwerte, die zu nah am Ziel liegen, entfallen.
  const ticks = [max, max / 2, 0].filter((t) => goal <= 0 || t === 0 || Math.abs(t - goal) / max > 0.12);
  const goalPct = ((goal / max) * 100).toFixed(2);
  const goalLine = goal > 0 ? `<div class="cc-goal" style="bottom:${goalPct}%"></div>` : '';
  const goalTick = goal > 0 ? `<span class="is-goal" style="bottom:${goalPct}%">${fmtNum(goal)}</span>` : '';
  const cols = rows
    .map((r) => {
      const h = (r.value / max) * 100;
      const label = `${fmtDay(r.key, today)}${goal > 0 && r.value >= goal ? ' · Ziel erreicht' : ''}`;
      return `
        <div class="cc-col${r.key === today ? ' is-today' : ''}" tabindex="0"
          data-tv="${esc(`${fmtNum(r.value)} ${unit}`)}" data-tl="${esc(label)}">
          <div class="cc-bar cc-${kind}" style="height:${h.toFixed(2)}%"></div>
        </div>`;
    })
    .join('');
  const labels = rows
    .map((r, i) => {
      const show = r.key === today || (n - 1 - i) % 2 === 0;
      return `<span class="${r.key === today ? 'is-today' : ''}">${show ? (r.key === today ? 'Heute' : esc(fmtWeekday(r.key))) : ''}</span>`;
    })
    .join('');
  const sum = rows.reduce((a, r) => a + r.value, 0);
  return `
    <div class="colchart" style="--n:${n}" role="img" aria-label="${esc(`${fmtNum(sum)} ${unit} in den letzten ${n} Tagen`)}">
      <div class="cc-y">${ticks.map((t) => `<span style="bottom:${((t / max) * 100).toFixed(2)}%">${fmtNum(t)}</span>`).join('')}${goalTick}</div>
      <div class="cc-plot">
        <div class="cc-grid"><i style="bottom:100%"></i><i style="bottom:50%"></i></div>
        ${goalLine}
        <div class="cc-cols">${cols}</div>
      </div>
      <div></div>
      <div class="cc-x">${labels}</div>
    </div>`;
}

const HEAT_STEPS = [1, 50, 100, 160, 240];

function heatLevel(xp) {
  let lvl = 0;
  for (let i = 0; i < HEAT_STEPS.length; i++) if (xp >= HEAT_STEPS[i]) lvl = i + 1;
  return lvl;
}

// GitHub-artige Aktivitäts-Heatmap (XP pro Tag), Spalten = Wochen.
export function heatmap({ days, today, weeks = 24 }) {
  const start = addDays(startOfWeek(today), -(weeks - 1) * 7);
  const cells = [];
  const months = [];
  let lastMonth = '';
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(start, w * 7);
    const m = weekStart.slice(0, 7);
    if (m !== lastMonth) {
      months.push(`<span style="grid-column:${w + 1}">${esc(fmtMonth(weekStart))}</span>`);
      lastMonth = m;
    }
    for (let dow = 0; dow < 7; dow++) {
      const key = addDays(weekStart, dow);
      if (key > today) {
        cells.push('<i class="hm-cell hm-future"></i>');
        continue;
      }
      const d = days.get(key);
      const xp = d ? d.xp : 0;
      const parts = [];
      if (d?.workMin) parts.push(`${fmtNum(d.workMin)} Min Fokus`);
      if (d?.readPages) parts.push(`${fmtNum(d.readPages)} Seiten`);
      const tl = [fmtDay(key, today), ...parts].join(' · ');
      cells.push(
        `<i class="hm-cell hm-${heatLevel(xp)}${key === today ? ' is-today' : ''}" tabindex="-1" data-tv="${esc(`${fmtNum(xp)} XP`)}" data-tl="${esc(tl)}"></i>`,
      );
    }
  }
  const legend = [0, 1, 2, 3, 4, 5].map((l) => `<i class="hm-cell hm-${l}"></i>`).join('');
  return `
    <div class="heatmap" style="--weeks:${weeks}">
      <div class="hm-months">${months.join('')}</div>
      <div class="hm-days"><span>Mo</span><span></span><span>Mi</span><span></span><span>Fr</span><span></span><span></span></div>
      <div class="hm-grid">${cells.join('')}</div>
    </div>
    <div class="hm-legend"><span>weniger</span>${legend}<span>mehr XP</span></div>`;
}

// Horizontale Balken (z. B. Stunden je Projekt), Wert am Balkenende.
export function barList(items, { kind = 'work', format = (v) => fmtNum(v) } = {}) {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<ul class="barlist">${items
    .map(
      (i) => `
      <li>
        <span class="bl-label">${esc(i.label)}</span>
        <span class="bl-track"><span class="bl-bar bl-${kind}" style="width:${Math.max(1.5, (i.value / max) * 100).toFixed(2)}%"></span></span>
        <span class="bl-value">${esc(format(i.value))}</span>
      </li>`,
    )
    .join('')}</ul>`;
}
