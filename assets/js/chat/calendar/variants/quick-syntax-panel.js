// V2 — Slack-style quick syntax.
// The teacher types the weekly plan the way they did in Slack; every
// "[Day]: Title" line is detected live and shown as a chip under the composer.
// Send creates one calendar event per day and posts the message without the
// syntax lines: the teacher's own words stay, the events show as cards.

import { appendEventMarkers } from '../event-marker.js';
import {
  EVENT_TYPES, formatPeriods, PRIORITIES, PRIORITY_LABELS, TYPE_LABELS,
} from '../event-options.js';
import { escapeHtml } from '../html.js';
import { buildQuickSyntaxExample, parseQuickSyntax } from '../quick-syntax.js';
import { formatShortDate } from '../school-weeks.js';

const tagList = (options) => options.map((o) => `<code>#${o.tags[0]}</code> ${o.label}`).join(', ');

function htmlToText(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder.textContent;
}

// Split the composer HTML into lines on <br>, drop the ones the parser marks
// as syntax, and keep whatever else the teacher wrote (formatting included).
function withoutSyntaxLines(html, parseOptions) {
  const segments = html.split(/<br\s*\/?>/i);
  const { syntaxLines } = parseQuickSyntax(segments.map(htmlToText).join('\n'), parseOptions);
  const kept = segments.filter((_, i) => !syntaxLines[i]);
  while (kept.length && !htmlToText(kept[0]).trim()) kept.shift();
  while (kept.length && !htmlToText(kept[kept.length - 1]).trim()) kept.pop();
  return kept.join('<br>');
}

export function mountQuickSyntax(ctx) {
  if (!ctx.isTeacher()) return { unmount() {} };

  const parseOptions = { weeks: ctx.weeks, schoolYear: ctx.schoolYear, defaultPeriods: ctx.coursePeriods };
  const defaultPeriodsLabel = formatPeriods(ctx.coursePeriods) || 'every period';

  const panel = document.createElement('div');
  panel.className = 'quick-syntax';
  panel.innerHTML = `
    <div class="quick-syntax-header">
      <span class="quick-syntax-title"><i class="fas fa-magic" aria-hidden="true"></i> Detected events</span>
      <span class="quick-syntax-week"></span>
      <button type="button" class="quick-syntax-example">Insert example</button>
    </div>
    <div class="quick-syntax-chips" aria-live="polite"></div>
    <details class="quick-syntax-help">
      <summary>Syntax</summary>
      <ul>
        <li><b>When:</b> <code>[Mon]: Title</code>, a range <code>[Wed - Thu]: Title</code>, or a date <code>[10/9]: Title</code>. <code>Week of 9/28</code> or <code>Week 7</code> picks the week for day names (default: this school week)</li>
        <li><b>Priority:</b> <code>*</code> = High and <code>**</code> = Urgent before the title, or ${tagList(PRIORITIES)} anywhere. Default Normal</li>
        <li><b>Type:</b> ${tagList(EVENT_TYPES)}. Default Daily plan; like in Slack, <code>*</code> also means Check-in and <code>**</code> Graded. Tags win over asterisks</li>
        <li><b>Periods:</b> <code>#P1</code>–<code>#P5</code>, several for more than one (<code>#P3 #P4</code>). Default ${escapeHtml(defaultPeriodsLabel)}</li>
        <li><b>Details:</b> <code>• detail</code> on the next line</li>
        <li><b>Posting:</b> these lines become event cards and are left out of the message; anything else you write is posted as is</li>
        <li><kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line, <kbd>Enter</kbd> sends</li>
      </ul>
    </details>`;
  ctx.slots.composerPanel.appendChild(panel);

  const chipsEl = panel.querySelector('.quick-syntax-chips');
  const weekEl = panel.querySelector('.quick-syntax-week');
  const skipped = new Set();
  let parsed = { entries: [] };

  function render() {
    parsed = parseQuickSyntax(ctx.composer.editor.innerText, parseOptions);
    weekEl.textContent = parsed.entries.some((e) => e.fromWeekday)
      ? `Day names = week of ${formatShortDate(parsed.weekStart)} (${parsed.weekSource})` : '';
    chipsEl.innerHTML = '';
    if (!parsed.entries.length) {
      chipsEl.innerHTML = '<span class="quick-syntax-empty">Type <code>[Mon]: Title</code> on its own line to put it on the calendar.</span>';
      return;
    }
    parsed.entries.forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-syntax-chip';
      chip.setAttribute('aria-pressed', String(!skipped.has(entry.key)));
      chip.title = skipped.has(entry.key) ? 'Skipped — click to include' : 'Click to skip this one';
      const meta = [
        PRIORITY_LABELS[entry.priority],
        TYPE_LABELS[entry.type] || entry.type,
        formatPeriods(entry.periods),
        entry.dates.map(formatShortDate).join(', '),
      ].filter(Boolean).join(' · ');
      chip.innerHTML = `<span class="quick-syntax-chip-day">${escapeHtml(entry.dayLabel)}</span>`
        + `<span class="quick-syntax-chip-title">${escapeHtml(entry.title)}</span>`
        + `<span class="quick-syntax-chip-meta">${escapeHtml(meta)}</span>`;
      chip.addEventListener('click', () => {
        if (skipped.has(entry.key)) skipped.delete(entry.key); else skipped.add(entry.key);
        render();
      });
      chipsEl.appendChild(chip);
    });
  }

  panel.querySelector('.quick-syntax-example').addEventListener('click', () => {
    const example = buildQuickSyntaxExample(ctx.weeks, { periods: ctx.coursePeriods });
    ctx.composer.editor.innerHTML = example.split('\n').map(escapeHtml).join('<br>');
    ctx.composer.editor.dispatchEvent(new Event('input'));
    ctx.composer.focus();
  });

  render();

  return {
    onComposerInput: render,
    async beforeSend({ html }) {
      const wanted = parsed.entries.filter((entry) => !skipped.has(entry.key));
      // Nothing detected, or every chip switched off: post the message as written.
      if (!wanted.length) return { html };
      try {
        const store = ctx.getStore();
        const created = [];
        // One add_event per day (not /add_events): the bulk endpoint forces the
        // events private to the sender, which would hide them from students.
        for (const entry of wanted) {
          for (const date of entry.dates) {
            created.push(await store.createEvent({
              title: entry.title,
              date,
              type: entry.type,
              priority: entry.priority,
              periods: entry.periods,
              description: entry.description,
            }));
          }
        }
        const words = withoutSyntaxLines(html, parseOptions);
        const count = `${created.length} ${created.length === 1 ? 'event' : 'events'}`;
        return { html: appendEventMarkers(words || `📅 Added ${count} to the calendar`, created) };
      } catch (err) {
        console.error('Announcement calendar demo: quick syntax create failed', err);
        chipsEl.insertAdjacentHTML('afterbegin', `<span class="quick-syntax-error" role="alert">Couldn't create events: ${escapeHtml(err.message)}</span>`);
        return null;
      }
    },
    afterSend() { skipped.clear(); render(); },
    unmount() { panel.remove(); },
  };
}
