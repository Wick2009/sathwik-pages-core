// Week view: a compact, read-only look at the current school week, pinned
// above the announcements. It works with either composer version and can be
// toggled from the chat header. Clicking an event jumps to the announcement
// that created it.

import { escapeHtml } from './html.js';
import { findSchoolWeek, fromIsoDate, neighborWeek, schoolWeekDays, todayIso } from './school-weeks.js';

const MAX_CHIPS_PER_DAY = 3;

function weekRangeLabel(week) {
  const format = (iso) => fromIsoDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week ${week.index} · ${format(week.monday)} – ${format(week.friday)}`;
}

export function mountWeekView({ slot, weeks, getStore, feed }) {
  const today = todayIso();
  let week = findSchoolWeek(weeks, today);

  const root = document.createElement('div');
  root.className = 'week-view';
  root.innerHTML = `
    <div class="week-view-header">
      <button type="button" class="week-view-nav" data-step="-1" aria-label="Previous week"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
      <div class="week-view-heading"><span class="week-view-range"></span><span class="week-view-note"></span></div>
      <button type="button" class="week-view-nav" data-step="1" aria-label="Next week"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
    </div>
    <div class="week-view-days" role="list"></div>`;
  slot.appendChild(root);
  const daysEl = root.querySelector('.week-view-days');

  function eventChip(event) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'week-view-event';
    chip.dataset.priority = event.priority;
    chip.title = `${event.title}: show the announcement`;
    chip.textContent = event.title;
    chip.addEventListener('click', () => {
      if (!feed.revealEvent(event.id)) chip.title = `${event.title}: no announcement for this one`;
    });
    return chip;
  }

  async function refresh() {
    if (!week) return;
    root.querySelector('.week-view-range').textContent = weekRangeLabel(week);
    root.querySelector('.week-view-note').textContent = [week.theme, week.notes].filter(Boolean).join(' · ');
    const store = getStore();
    const [events, breaks] = await Promise.all([
      store.listRange(week.monday, week.friday),
      store.listBreaks().catch(() => []),
    ]);
    const breakByDate = new Map(breaks.map((b) => [b.date, b.name]));

    daysEl.innerHTML = '';
    schoolWeekDays(week).forEach((day) => {
      const closedReason = day.closedReason || breakByDate.get(day.date) || '';
      const dayEvents = events.filter((e) => e.date === day.date);
      const cell = document.createElement('div');
      cell.setAttribute('role', 'listitem');
      cell.className = ['week-view-day', day.date === today && 'is-today', (day.closed || closedReason) && 'is-closed']
        .filter(Boolean).join(' ');
      cell.innerHTML = `<span class="week-view-day-label">${day.label} <b>${fromIsoDate(day.date).getDate()}</b></span>`
        + (closedReason ? `<span class="week-view-closed">${escapeHtml(closedReason)}</span>` : '');
      dayEvents.slice(0, MAX_CHIPS_PER_DAY).forEach((event) => cell.appendChild(eventChip(event)));
      if (dayEvents.length > MAX_CHIPS_PER_DAY) {
        cell.insertAdjacentHTML('beforeend', `<span class="week-view-more">+${dayEvents.length - MAX_CHIPS_PER_DAY} more</span>`);
      }
      daysEl.appendChild(cell);
    });
  }

  root.querySelectorAll('.week-view-nav').forEach((button) => {
    button.addEventListener('click', () => {
      week = neighborWeek(weeks, week, Number(button.dataset.step)) || week;
      refresh();
    });
  });

  const load = () => refresh().catch((err) => console.error('Announcement calendar demo: week view load failed', err));
  const unsubscribe = getStore().subscribe(load);
  const unlisten = feed.onMessage(({ events }) => { if (events.length) load(); });
  load();

  return {
    unmount() {
      unsubscribe();
      unlisten();
      root.remove();
    },
  };
}
