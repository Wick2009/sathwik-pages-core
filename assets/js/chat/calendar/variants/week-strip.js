// V3 — Calendar-first.
// A strip for the current school week sits above the announcements. Teachers
// click a day to add an event, which also posts the announcement for it.
// Students click a day to see what's on it and jump to the announcement.

import { appendEventMarkers } from '../event-marker.js';
import { TYPE_LABELS } from '../event-card.js';
import { escapeHtml } from '../html.js';
import {
  addDays, findSchoolWeek, formatShortDate, fromIsoDate, neighborWeek, schoolWeekDays, todayIso,
} from '../school-weeks.js';

const TYPES = ['event', 'assignment', 'check-in', 'grade'];

function weekRangeLabel(week) {
  const start = fromIsoDate(week.monday).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const end = fromIsoDate(week.friday).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week ${week.index} · ${start} – ${end}`;
}

export function mountWeekStrip(ctx) {
  const today = todayIso();
  let week = findSchoolWeek(ctx.weeks, today);
  let selectedDate = null;
  let weekEvents = [];

  const root = document.createElement('div');
  root.className = 'week-strip';
  root.innerHTML = `
    <div class="week-strip-header">
      <button type="button" class="week-strip-nav" data-step="-1" aria-label="Previous week"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
      <div class="week-strip-heading"><span class="week-strip-range"></span><span class="week-strip-note"></span></div>
      <button type="button" class="week-strip-nav" data-step="1" aria-label="Next week"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
    </div>
    <div class="week-strip-days" role="list"></div>
    <div class="week-strip-day-panel" hidden></div>
    <div class="week-strip-aside">
      <div class="week-strip-tomorrow"></div>
      <div class="week-strip-upcoming"></div>
    </div>`;
  ctx.slots.feedTop.appendChild(root);

  const daysEl = root.querySelector('.week-strip-days');
  const panelEl = root.querySelector('.week-strip-day-panel');

  function eventChip(event) {
    return `<span class="week-strip-event" data-priority="${event.priority}" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</span>`;
  }

  async function refresh() {
    if (!week) return;
    root.querySelector('.week-strip-range').textContent = weekRangeLabel(week);
    root.querySelector('.week-strip-note').textContent = [week.theme, week.notes].filter(Boolean).join(' · ');
    const store = ctx.getStore();
    const [events, breaks] = await Promise.all([
      store.listRange(week.monday, week.friday),
      store.listBreaks().catch(() => []),
    ]);
    weekEvents = events;
    const breakByDate = new Map(breaks.map((b) => [b.date, b.name]));

    daysEl.innerHTML = '';
    schoolWeekDays(week).forEach((day) => {
      const closedReason = day.closedReason || breakByDate.get(day.date) || '';
      const dayEvents = events.filter((e) => e.date === day.date);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('role', 'listitem');
      cell.className = ['week-strip-day', day.date === today && 'is-today', (day.closed || closedReason) && 'is-closed',
        day.date === selectedDate && 'is-selected'].filter(Boolean).join(' ');
      cell.innerHTML = `<span class="week-strip-day-label">${day.label} <b>${fromIsoDate(day.date).getDate()}</b></span>`
        + (closedReason ? `<span class="week-strip-closed">${escapeHtml(closedReason)}</span>` : '')
        + dayEvents.slice(0, 3).map(eventChip).join('')
        + (dayEvents.length > 3 ? `<span class="week-strip-more">+${dayEvents.length - 3} more</span>` : '');
      cell.addEventListener('click', () => selectDay(day.date === selectedDate ? null : day.date));
      daysEl.appendChild(cell);
    });

    await renderAside(store);
    if (selectedDate) renderDayPanel();
  }

  async function renderAside(store) {
    const tomorrow = await store.listNextDay().catch(() => []);
    root.querySelector('.week-strip-tomorrow').innerHTML = tomorrow.length
      ? `<i class="fas fa-bell" aria-hidden="true"></i> <b>Tomorrow:</b> ${tomorrow.map((e) => escapeHtml(e.title)).join(', ')}`
      : '<i class="fas fa-bell-slash" aria-hidden="true"></i> Nothing on the calendar tomorrow';
    const upcoming = (await store.listRange(today, addDays(today, 30))).slice(0, 3);
    root.querySelector('.week-strip-upcoming').innerHTML = upcoming.length
      ? `<b>Upcoming:</b> ${upcoming.map((e) => `<span class="week-strip-upcoming-item" data-priority="${e.priority}">${escapeHtml(e.title)} <em>${formatShortDate(e.date)}</em></span>`).join('')}`
      : '';
  }

  function renderDayPanel() {
    const dayEvents = weekEvents.filter((e) => e.date === selectedDate);
    panelEl.hidden = false;
    panelEl.innerHTML = `<div class="week-strip-day-title">${formatShortDate(selectedDate)}</div>`;

    const list = document.createElement('div');
    list.className = 'week-strip-day-events';
    if (!dayEvents.length) list.innerHTML = '<p class="week-strip-day-empty">Nothing scheduled.</p>';
    dayEvents.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'week-strip-day-event';
      row.dataset.priority = event.priority;
      row.innerHTML = `<span class="week-strip-day-event-title">${escapeHtml(event.title)}</span>`
        + `<span class="week-strip-day-event-type">${escapeHtml(TYPE_LABELS[event.type] || event.type)}</span>`;
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'week-strip-jump';
      jump.innerHTML = '<i class="fas fa-comment-dots" aria-hidden="true"></i> Announcement';
      jump.addEventListener('click', () => {
        if (!ctx.feed.revealEvent(event.id)) jump.textContent = 'No announcement for this one';
      });
      row.appendChild(jump);
      list.appendChild(row);
    });
    panelEl.appendChild(list);
    if (ctx.isTeacher()) panelEl.appendChild(quickAddForm());
  }

  function quickAddForm() {
    const form = document.createElement('form');
    form.className = 'week-strip-add';
    form.innerHTML = `
      <input type="text" name="title" maxlength="120" required placeholder="Add an event on ${formatShortDate(selectedDate)}…" aria-label="Event title">
      <select name="type" aria-label="Type">${TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join('')}</select>
      <select name="priority" aria-label="Priority"><option>P0</option><option>P1</option><option selected>P2</option><option>P3</option></select>
      <button type="submit" class="week-strip-add-submit"><i class="fas fa-bullhorn" aria-hidden="true"></i> Add &amp; announce</button>
      <p class="week-strip-add-error" role="alert" hidden></p>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const title = String(data.get('title')).trim();
      if (!title) return;
      try {
        const event = await ctx.getStore().createEvent({
          title, date: selectedDate, type: String(data.get('type')), priority: String(data.get('priority')),
        });
        const text = `📅 <b>New:</b> ${escapeHtml(title)} on ${formatShortDate(selectedDate)}`;
        ctx.send(appendEventMarkers(text, [event]));
      } catch (err) {
        console.error('Announcement calendar demo: quick add failed', err);
        const errorEl = form.querySelector('.week-strip-add-error');
        errorEl.textContent = `Couldn't add the event: ${err.message}`;
        errorEl.hidden = false;
      }
    });
    return form;
  }

  function selectDay(date) {
    selectedDate = date;
    panelEl.hidden = !date;
    refresh();
  }

  root.querySelectorAll('.week-strip-nav').forEach((button) => {
    button.addEventListener('click', () => {
      week = neighborWeek(ctx.weeks, week, Number(button.dataset.step)) || week;
      selectDay(null);
    });
  });

  const unsubscribe = ctx.getStore().subscribe(refresh);
  const unlisten = ctx.feed.onMessage(({ events }) => { if (events.length) refresh(); });
  refresh().catch((err) => console.error('Announcement calendar demo: week strip load failed', err));

  return {
    unmount() {
      unsubscribe();
      unlisten();
      root.remove();
    },
  };
}
