// Sample data for Preview mode so the demo opens on a realistic class week
// instead of an empty feed. Dates are computed from the real school calendar
// relative to today, so the seed never goes stale.

import { encodeEventMarker } from './event-marker.js';
import { addDays, findSchoolWeek, neighborWeek, nextSchoolDay, todayIso } from './school-weeks.js';

export const DEMO_TEACHER = 'Demo Teacher';
export const DEMO_STUDENT = 'Demo Student';

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export function buildPreviewSeed({ weeks, course, periods = [], today = todayIso() }) {
  const week = findSchoolWeek(weeks, today);
  if (!week) return { events: [], messages: [] };
  const following = neighborWeek(weeks, week, 1) || week;

  const events = [
    { id: 'seed-1', date: nextSchoolDay(weeks, week.monday), title: 'Live Reviews', type: 'daily plan', priority: 'P2',
      description: 'Review project progress with teacher' },
    { id: 'seed-2', date: nextSchoolDay(weeks, addDays(today, 1)), title: 'Code review office hours', type: 'event', priority: 'P3',
      description: 'Drop in during tutorial with your PR open' },
    { id: 'seed-3', date: week.friday, title: 'Unit 3 Quiz', type: 'grade', priority: 'P0',
      description: 'One page of handwritten notes allowed' },
    { id: 'seed-4', date: nextSchoolDay(weeks, following.monday), title: 'Sprint kickoff', type: 'check-in', priority: 'P1',
      description: 'Bring your team board' },
  ].map((event) => ({ ...event, course, periods: [...periods] }));
  // With more than one period (CSP meets 3 and 4), office hours is only for the
  // last one, so the Period filter has something to show.
  if (periods.length > 1) events[1].periods = [periods[periods.length - 1]];

  const [reviews, officeHours, quiz, kickoff] = events;
  const messages = [
    {
      sender: DEMO_TEACHER,
      date: hoursAgo(49),
      message: `<b>Week ${week.index} plan</b><br>Live reviews to start the week, office hours, and the Unit 3 quiz on Friday. `
        + `Everything below is already on the class calendar. ${[reviews, officeHours, quiz].map(encodeEventMarker).join(' ')}`,
    },
    { sender: DEMO_STUDENT, date: hoursAgo(26), message: 'Is the Unit 3 quiz open-note?' },
    {
      sender: DEMO_TEACHER,
      date: hoursAgo(3),
      message: `Yes, one page of handwritten notes. Also, the next sprint kicks off soon: ${encodeEventMarker(kickoff)}`,
    },
  ];
  return { events, messages };
}
