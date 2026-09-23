// V2 — Slack-style quick syntax.
// The teacher types the weekly plan the way they did in Slack; every
// "[Day]: Title" line is detected live and shown as a chip under the composer.
// Send posts the message as written and creates one calendar event per day.

import { appendEventMarkers } from '../event-marker.js';
import { parseQuickSyntax, QUICK_SYNTAX_EXAMPLE } from '../quick-syntax.js';
import { formatShortDate } from '../school-weeks.js';
import { TYPE_LABELS } from '../event-card.js';
import { escapeHtml } from '../html.js';

export function mountQuickSyntax(ctx) {
  if (!ctx.isTeacher()) return { unmount() {} };

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
        <li><code>Week of 9/28</code> or <code>Week 7</code> picks the week (default: this school week)</li>
        <li><code>[Mon]: Title</code> or <code>[Wed - Thu]: Title</code> adds an event on those days</li>
        <li>Asterisks set the priority. <code>[Fri]: Title</code> is P2 (normal), <code>[Fri]: * Title</code> is P1, and <code>[Fri]: ** Title</code> is P0 (top priority)</li>
        <li>Like in Slack, <code>*</code> also marks a check-in and <code>**</code> a graded item</li>
        <li><code>• detail</code> on the next line becomes the description</li>
        <li><kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line, <kbd>Enter</kbd> sends</li>
      </ul>
    </details>`;
  ctx.slots.composerPanel.appendChild(panel);

  const chipsEl = panel.querySelector('.quick-syntax-chips');
  const weekEl = panel.querySelector('.quick-syntax-week');
  const skipped = new Set();
  let parsed = { entries: [] };

  function render() {
    parsed = parseQuickSyntax(ctx.composer.editor.innerText, { weeks: ctx.weeks, schoolYear: ctx.schoolYear });
    weekEl.textContent = parsed.entries.length ? `Week starting ${formatShortDate(parsed.weekStart)} (${parsed.weekSource})` : '';
    chipsEl.innerHTML = '';
    if (!parsed.entries.length) {
      chipsEl.innerHTML = '<span class="quick-syntax-empty">Type <code>[Mon]: Title</code> on its own line to put it on the calendar.</span>';
      return;
    }
    parsed.entries.forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-syntax-chip';
      chip.dataset.priority = entry.priority;
      chip.setAttribute('aria-pressed', String(!skipped.has(entry.key)));
      chip.title = skipped.has(entry.key) ? 'Skipped — click to include' : 'Click to skip this one';
      const dates = entry.dates.map(formatShortDate).join(', ');
      chip.innerHTML = `<span class="quick-syntax-chip-day">${escapeHtml(entry.dayLabel)}</span>`
        + `<span class="quick-syntax-chip-title">${escapeHtml(entry.title)}</span>`
        + `<span class="quick-syntax-chip-meta">${entry.priority} · ${escapeHtml(TYPE_LABELS[entry.type] || entry.type)} · ${escapeHtml(dates)}</span>`;
      chip.addEventListener('click', () => {
        if (skipped.has(entry.key)) skipped.delete(entry.key); else skipped.add(entry.key);
        render();
      });
      chipsEl.appendChild(chip);
    });
  }

  panel.querySelector('.quick-syntax-example').addEventListener('click', () => {
    ctx.composer.editor.innerHTML = QUICK_SYNTAX_EXAMPLE.split('\n').map(escapeHtml).join('<br>');
    ctx.composer.editor.dispatchEvent(new Event('input'));
    ctx.composer.focus();
  });

  render();

  return {
    onComposerInput: render,
    async beforeSend({ html }) {
      const wanted = parsed.entries.filter((entry) => !skipped.has(entry.key));
      if (!wanted.length) return { html };
      try {
        const store = ctx.getStore();
        const created = [];
        // One add_event per day (not /add_events): the bulk endpoint forces the
        // events private to the sender, which would hide them from students.
        for (const entry of wanted) {
          for (const date of entry.dates) {
            created.push(await store.createEvent({
              title: entry.title, date, type: entry.type, priority: entry.priority, description: entry.description,
            }));
          }
        }
        return { html: appendEventMarkers(html, created) };
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
