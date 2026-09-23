// The card shown under an announcement that created calendar events. It is
// the same in every demo version: students can save the event to their own
// calendar, and teachers can also take it back off the class calendar.

import { downloadIcs, googleCalendarUrl } from './event-links.js';
import { fromIsoDate } from './school-weeks.js';

export const TYPE_LABELS = {
  event: 'Event',
  'daily plan': 'Daily plan',
  'check-in': 'Check-in',
  grade: 'Graded',
  assignment: 'Due',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(icon, label, onClick, { iconOnly = false } = {}) {
  const button = el('button', 'event-card-action');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
  if (!iconOnly) button.appendChild(el('span', '', label));
  button.addEventListener('click', onClick);
  return button;
}

function actionLink(icon, label, href, { iconOnly = false, external = false } = {}) {
  const link = el('a', 'event-card-action');
  link.href = href;
  link.title = label;
  link.setAttribute('aria-label', label);
  if (external) { link.target = '_blank'; link.rel = 'noopener'; }
  link.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
  if (!iconOnly) link.appendChild(el('span', '', label));
  return link;
}

function dateBlock(iso) {
  const date = fromIsoDate(iso);
  const block = el('div', 'event-card-date');
  block.append(
    el('span', 'event-card-month', date.toLocaleDateString(undefined, { month: 'short' })),
    el('span', 'event-card-day', String(date.getDate())),
    el('span', 'event-card-weekday', date.toLocaleDateString(undefined, { weekday: 'short' })),
  );
  return block;
}

function renderCard(event, context, compact) {
  const { store, isTeacher, course, calendarUrl, sourceUrl } = context;
  const details = `Posted in ${course.toUpperCase()} announcements: ${sourceUrl}`;
  const card = el('div', `event-card${compact ? ' is-compact' : ''}`);
  card.dataset.priority = event.priority;

  const info = el('div', 'event-card-info');
  info.appendChild(el('div', 'event-card-title', event.title));
  const tags = el('div', 'event-card-tags');
  tags.append(
    el('span', 'event-card-chip event-card-chip--priority', event.priority),
    el('span', 'event-card-chip', TYPE_LABELS[event.type] || event.type),
  );
  const status = el('span', 'event-card-status', 'On class calendar');
  tags.appendChild(status);
  info.appendChild(tags);

  const markRemoved = () => {
    card.classList.add('is-removed');
    status.textContent = 'Removed from calendar';
  };

  const actions = el('div', 'event-card-actions');
  actions.append(
    actionButton('fas fa-download', 'Add to my calendar',
      () => downloadIcs([{ ...event, description: details }], { course, filename: `${event.date}-${course}.ics` }),
      { iconOnly: compact }),
    actionLink('fab fa-google', 'Google Calendar', googleCalendarUrl(event, { details }), { iconOnly: compact, external: true }),
    actionLink('fas fa-calendar-alt', 'View on calendar', calendarUrl, { iconOnly: compact }),
  );
  if (isTeacher()) {
    actions.appendChild(actionButton('fas fa-trash-alt', 'Remove from calendar', async () => {
      if (!window.confirm(`Remove "${event.title}" from the class calendar?`)) return;
      try {
        await store().deleteEvent(event.id);
        markRemoved();
      } catch (err) {
        console.error('Announcement calendar demo: delete failed', err);
        status.textContent = 'Could not remove — see console';
      }
    }, { iconOnly: true }));
  }
  info.appendChild(actions);

  card.append(dateBlock(event.date), info);
  if (store().status(event.id) === 'removed') markRemoved();
  return card;
}

// context: { store: () => calendarStore, isTeacher: () => bool, course, calendarUrl, sourceUrl }
export function renderEventCards(events, context) {
  const wrapper = el('div', 'event-cards');
  const compact = events.length > 1;
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  sorted.forEach((event) => wrapper.appendChild(renderCard(event, context, compact)));

  if (compact) {
    const footer = el('div', 'event-cards-footer');
    footer.appendChild(actionButton('fas fa-download', `Add all ${events.length} to my calendar`, () => {
      const details = `Posted in ${context.course.toUpperCase()} announcements: ${context.sourceUrl}`;
      downloadIcs(sorted.map((e) => ({ ...e, description: details })), { course: context.course, filename: `${context.course}-announcement.ics` });
    }));
    wrapper.appendChild(footer);
  }
  return wrapper;
}
