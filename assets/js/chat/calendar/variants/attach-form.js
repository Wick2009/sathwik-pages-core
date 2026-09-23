// V1 — "Add to calendar" button in the composer.
// The teacher writes the announcement as usual, clicks 📅, fills a small form,
// and Send posts the message and creates the calendar event together.
// Pattern follows the /calendar modal in _includes/group_dashboard.html.

import { appendEventMarkers } from '../event-marker.js';
import {
  CLASS_PERIODS, DEFAULT_PRIORITY, EVENT_TYPES, PRIORITIES,
} from '../event-options.js';
import { addDays, formatShortDate, nextSchoolDay, quickDateChoices, todayIso } from '../school-weeks.js';

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
        <select name="type">${EVENT_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
      </label>
      <label class="calendar-field calendar-field--full">Details (optional)
        <input type="text" name="description" maxlength="300" placeholder="e.g. One page of handwritten notes allowed">
      </label>
    </div>
    <div class="calendar-quick-dates" role="group" aria-label="Quick dates"></div>
    <div class="calendar-choice-row" role="radiogroup" aria-label="Priority">
      <span class="calendar-choice-label">Priority</span>
      ${PRIORITIES.map((p) => `<button type="button" class="calendar-priority-option" data-priority="${p.value}" role="radio" aria-checked="${p.value === DEFAULT_PRIORITY}">${p.label}</button>`).join('')}
    </div>
    <div class="calendar-choice-row" role="group" aria-label="Class periods">
      <span class="calendar-choice-label">Periods</span>
      ${CLASS_PERIODS.map((p) => `<button type="button" class="calendar-period-option" data-period="${p}" aria-pressed="${ctx.coursePeriods.includes(p)}">${p}</button>`).join('')}
      <span class="calendar-choice-hint">none selected = every period</span>
    </div>
    <p class="calendar-attach-hint">Send posts the announcement <em>and</em> adds an all-day event to the ${ctx.course.toUpperCase()} calendar.</p>
    <p class="calendar-attach-error" role="alert" hidden></p>`;
  ctx.slots.composerPanel.appendChild(panel);

  const titleInput = panel.querySelector('[name="title"]');
  const dateInput = panel.querySelector('[name="date"]');
  const typeSelect = panel.querySelector('[name="type"]');
  const descriptionInput = panel.querySelector('[name="description"]');
  const errorEl = panel.querySelector('.calendar-attach-error');
  let priority = DEFAULT_PRIORITY;

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

  const periodButtons = [...panel.querySelectorAll('.calendar-period-option')];
  periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    });
  });
  const selectedPeriods = () => periodButtons
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.period);

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
          title,
          date: dateInput.value,
          type: typeSelect.value,
          priority,
          periods: selectedPeriods(),
          description: descriptionInput.value.trim(),
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
      descriptionInput.value = '';
      dateInput.value = defaultDate;
      setOpen(false);
    },
    unmount() {
      toggle.remove();
      panel.remove();
    },
  };
}
