// The card shown under an announcement that created calendar events. It is
// the same in every demo version: everyone can open the event on the OCS
// calendar, and teachers can also take it back off the class calendar.

import { TYPE_LABELS } from './event-options.js';
import { fromIsoDate } from './school-weeks.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function viewOnCalendarLink(calendarUrl) {
  const link = el('a', 'event-card-action');
  link.href = calendarUrl;
  link.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i>';
  link.appendChild(el('span', '', 'View on OCS calendar'));
  return link;
}

function removeButton(event, store, onRemoved, status) {
  const button = el('button', 'event-card-action event-card-action--remove');
  button.type = 'button';
  button.title = 'Remove from calendar';
  button.setAttribute('aria-label', 'Remove from calendar');
  button.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>';
  button.addEventListener('click', async () => {
    if (!window.confirm(`Remove "${event.title}" from the class calendar?`)) return;
    try {
      await store().deleteEvent(event.id);
      onRemoved();
    } catch (err) {
      console.error('Announcement calendar demo: delete failed', err);
      status.textContent = 'Could not remove — see console';
    }
  });
  return button;
}

function renderCard(event, { store, isTeacher, calendarUrl }, compact) {
  const card = el('div', `event-card${compact ? ' is-compact' : ''}`);
  card.dataset.priority = event.priority;

  const info = el('div', 'event-card-info');
  info.appendChild(el('div', 'event-card-title', event.title));
  const tags = el('div', 'event-card-tags');
  const status = el('span', 'event-card-status', 'On class calendar');
  tags.append(
    el('span', 'event-card-chip event-card-chip--priority', event.priority),
    el('span', 'event-card-chip', TYPE_LABELS[event.type] || event.type),
    status,
  );
  info.appendChild(tags);

  const markRemoved = () => {
    card.classList.add('is-removed');
    status.textContent = 'Removed from calendar';
  };

  const actions = el('div', 'event-card-actions');
  actions.appendChild(viewOnCalendarLink(calendarUrl));
  if (isTeacher()) actions.appendChild(removeButton(event, store, markRemoved, status));
  info.appendChild(actions);

  card.append(dateBlock(event.date), info);
  if (store().status(event.id) === 'removed') markRemoved();
  return card;
}

// context: { store: () => calendarStore, isTeacher: () => bool, calendarUrl }
export function renderEventCards(events, context) {
  const wrapper = el('div', 'event-cards');
  const compact = events.length > 1;
  [...events]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((event) => wrapper.appendChild(renderCard(event, context, compact)));
  return wrapper;
}
