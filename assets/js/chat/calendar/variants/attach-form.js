// V1 — "Add to calendar" button in the composer.
// The teacher writes the announcement as usual, clicks 📅, fills a small form,
// and Send posts the message and creates the calendar event together.
// Pattern follows the /calendar modal in _includes/group_dashboard.html.

import { appendEventMarkers } from '../event-marker.js';
import { addDays, formatShortDate, nextSchoolDay, quickDateChoices, todayIso } from '../school-weeks.js';
import { TYPE_LABELS } from '../event-card.js';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TYPES = ['event', 'assignment', 'check-in', 'grade'];

function firstLine(text) {
  return String(text || '').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 80) || '';
}

export function mountAttachForm(ctx) {
  // Students keep the plain composer; only teachers can put things on the class calendar.
  if (!ctx.isTeacher()) return { unmount() {} };

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'calendar-attach-toggle';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = '<i class="fas fa-calendar-plus" aria-hidden="true"></i><span>Add to calendar</span>';
  ctx.slots.composerTools.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'calendar-attach-panel';
  panel.hidden = true;
  const defaultDate = nextSchoolDay(ctx.weeks, addDays(todayIso(), 1));
  panel.innerHTML = `
    <div class="calendar-attach-header">
      <span><i class="fas fa-calendar-plus" aria-hidden="true"></i> Calendar event for this announcement</span>
      <button type="button" class="calendar-attach-close" aria-label="Remove calendar event">&times;</button>
    </div>
    <div class="calendar-attach-grid">
      <label class="calendar-field calendar-field--wide">Title
        <input type="text" name="title" maxlength="120" placeholder="e.g. Unit 3 Quiz">
      </label>
      <label class="calendar-field">Date
        <input type="date" name="date" value="${defaultDate}">
      </label>
      <label class="calendar-field">Type
        <select name="type">${TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join('')}</select>
      </label>
    </div>
    <div class="calendar-quick-dates" role="group" aria-label="Quick dates"></div>
    <div class="calendar-priority" role="radiogroup" aria-label="Priority">
      <span class="calendar-priority-label">Priority</span>
      ${PRIORITIES.map((p) => `<button type="button" class="calendar-priority-option" data-priority="${p}" role="radio" aria-checked="${p === 'P2'}">${p}</button>`).join('')}
    </div>
    <p class="calendar-attach-hint">Send posts the announcement <em>and</em> adds an all-day event to the ${ctx.course.toUpperCase()} calendar.</p>
    <p class="calendar-attach-error" role="alert" hidden></p>`;
  ctx.slots.composerPanel.appendChild(panel);

  const titleInput = panel.querySelector('[name="title"]');
  const dateInput = panel.querySelector('[name="date"]');
  const typeSelect = panel.querySelector('[name="type"]');
  const errorEl = panel.querySelector('.calendar-attach-error');
  let priority = 'P2';

  quickDateChoices(ctx.weeks).forEach(({ label, date }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'calendar-quick-date';
    chip.textContent = `${label} · ${formatShortDate(date)}`;
    chip.addEventListener('click', () => { dateInput.value = date; });
    panel.querySelector('.calendar-quick-dates').appendChild(chip);
  });

  panel.querySelectorAll('.calendar-priority-option').forEach((option) => {
    option.addEventListener('click', () => {
      priority = option.dataset.priority;
      panel.querySelectorAll('.calendar-priority-option')
        .forEach((o) => o.setAttribute('aria-checked', String(o === option)));
    });
  });

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-pressed', String(open));
    toggle.classList.toggle('is-active', open);
    errorEl.hidden = true;
    if (open && !titleInput.value) titleInput.value = firstLine(ctx.composer.editor.innerText);
    if (open) titleInput.focus();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('.calendar-attach-close').addEventListener('click', () => setOpen(false));

  function showError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
  }

  return {
    async beforeSend({ html }) {
      if (panel.hidden) return { html };
      const title = titleInput.value.trim();
      if (!title) { showError('Give the calendar event a title (or close the panel to send without one).'); return null; }
      if (!dateInput.value) { showError('Pick a date for the event.'); return null; }
      try {
        const event = await ctx.getStore().createEvent({
          title, date: dateInput.value, type: typeSelect.value, priority, description: firstLine(ctx.composer.editor.innerText),
        });
        return { html: appendEventMarkers(html, [event]) };
      } catch (err) {
        console.error('Announcement calendar demo: create event failed', err);
        showError(`Couldn't create the calendar event: ${err.message}`);
        return null;
      }
    },
    afterSend() {
      titleInput.value = '';
      dateInput.value = defaultDate;
      setOpen(false);
    },
    unmount() {
      toggle.remove();
      panel.remove();
    },
  };
}
