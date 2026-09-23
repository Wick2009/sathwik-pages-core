// School-week date helpers for the announcement ↔ calendar demos.
// Pure functions over the JSON that _includes/announcement_calendar_demo.html
// embeds from _data/school_calendar.yml (same shape as _includes/calendar.html).

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKDAY_OFFSETS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Local-time ISO date (YYYY-MM-DD). toISOString() would shift to UTC and can
// land on the wrong day in the evening, which matters for all-day events.
export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromIsoDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = fromIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function todayIso() {
  return toIsoDate(new Date());
}

// Monday of the calendar week containing `iso`.
export function mondayOf(iso) {
  const date = fromIsoDate(iso);
  const shift = (date.getDay() + 6) % 7; // Sun=6, Mon=0
  date.setDate(date.getDate() - shift);
  return toIsoDate(date);
}

export function dayOffset(label) {
  return WEEKDAY_OFFSETS[label];
}

// "Thu, Oct 1"
export function formatShortDate(iso) {
  return fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function parseSchoolCalendar(raw) {
  const weeks = Object.entries(raw?.weeks || {})
    .map(([index, week]) => ({ index: Number(index), ...week }))
    .filter((week) => week.monday)
    .sort((a, b) => a.monday.localeCompare(b.monday));
  return { schoolYear: raw?.schoolYear || '', weeks };
}

// The school week whose Mon–Sun span contains `iso`; if `iso` falls in a gap
// (break), the next school week after it; past the end of the year, the last.
export function findSchoolWeek(weeks, iso) {
  if (!weeks.length) return null;
  const monday = mondayOf(iso);
  return weeks.find((week) => week.monday === monday)
    || weeks.find((week) => week.monday > iso)
    || weeks[weeks.length - 1];
}

export function neighborWeek(weeks, week, step) {
  const position = weeks.indexOf(week);
  return weeks[position + step] || null;
}

// Days before school starts in the week (e.g. week 0 starts Thursday) and
// Monday holidays are marked closed. `holiday_adjustment` in the YAML names the
// first school day of that week.
function firstSchoolDayOffset(week) {
  const adjustment = String(week.holidayAdjustment || '').slice(0, 3);
  const label = adjustment.charAt(0).toUpperCase() + adjustment.slice(1);
  return WEEKDAY_OFFSETS[label] ?? 0;
}

export function schoolWeekDays(week) {
  const firstOpen = firstSchoolDayOffset(week);
  const holidayName = (week.holidays || [])[0] || (firstOpen > 0 ? 'No school' : '');
  return WEEKDAY_LABELS.map((label, offset) => ({
    label,
    date: addDays(week.monday, offset),
    closed: Boolean(week.skipWeek) || offset < firstOpen,
    closedReason: week.skipWeek ? 'Break' : (offset < firstOpen ? holidayName : ''),
  }));
}

// First open school day on or after `iso` (skips weekends, closed days and breaks).
export function nextSchoolDay(weeks, iso) {
  for (let step = 0; step < 21; step += 1) {
    const candidate = addDays(iso, step);
    const week = weeks.find((w) => w.monday === mondayOf(candidate));
    if (!week) continue;
    const day = schoolWeekDays(week).find((d) => d.date === candidate);
    if (day && !day.closed) return candidate;
  }
  return iso;
}

// Quick picks for the V1 date field: tomorrow, this Friday, next week's
// first school day — all snapped to real school days.
export function quickDateChoices(weeks, iso = todayIso()) {
  const current = findSchoolWeek(weeks, iso);
  const choices = [{ label: 'Next school day', date: nextSchoolDay(weeks, addDays(iso, 1)) }];
  if (current && current.friday >= iso) choices.push({ label: 'This Fri', date: current.friday });
  const following = current && neighborWeek(weeks, current, current.monday > iso ? 0 : 1);
  if (following) {
    choices.push({ label: 'Next week', date: nextSchoolDay(weeks, following.monday) });
    choices.push({ label: 'Next Fri', date: following.friday });
  }
  return choices;
}
