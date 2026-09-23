// The event fields a teacher can set, shared by both composer versions so the
// V1 form and the V2 quick syntax stay equivalent: same types, same
// priorities, same class periods. `tags` are the #words quick syntax accepts
// (the first one is shown in the help).

export const EVENT_TYPES = [
  { value: 'event', label: 'Event', tags: ['event'] },
  { value: 'daily plan', label: 'Daily plan', tags: ['plan', 'daily-plan'] },
  { value: 'assignment', label: 'Due', tags: ['due', 'assignment'] },
  { value: 'check-in', label: 'Check-in', tags: ['check-in', 'checkin'] },
  { value: 'grade', label: 'Graded', tags: ['graded', 'grade'] },
];

// Values stay P0–P3 because that's what the OCS calendar and sprint cards
// store ("[P2] Title"); the UI shows words so they don't read as class periods.
export const PRIORITIES = [
  { value: 'P0', label: 'Urgent', tags: ['urgent'] },
  { value: 'P1', label: 'High', tags: ['high'] },
  { value: 'P2', label: 'Normal', tags: ['normal'] },
  { value: 'P3', label: 'Low', tags: ['low'] },
];
export const DEFAULT_PRIORITY = 'P2';

// Class periods 1–5. Which periods each course meets in; an event defaults
// to its course's periods and can be narrowed or widened.
export const CLASS_PERIODS = ['1', '2', '3', '4', '5'];
export const COURSES = [
  { value: 'csa', label: 'CSA', periods: ['2'] },
  { value: 'csh', label: 'CSH', periods: ['2'] },
  { value: 'csp', label: 'CSP', periods: ['3', '4'] },
  { value: 'csse', label: 'CSSE', periods: ['1'] },
];

export const TYPE_LABELS = Object.fromEntries(EVENT_TYPES.map((type) => [type.value, type.label]));
export const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));

export function coursePeriods(course) {
  return COURSES.find((c) => c.value === course)?.periods || [];
}

// ['3', '4'] → "Periods 3 & 4"; ['2'] → "Period 2"; [] → ""
export function formatPeriods(periods = []) {
  const sorted = [...periods].sort();
  if (!sorted.length) return '';
  if (sorted.length === 1) return `Period ${sorted[0]}`;
  return `Periods ${sorted.slice(0, -1).join(', ')} & ${sorted[sorted.length - 1]}`;
}

// An event with no periods applies to the whole class.
export function eventMatchesPeriod(event, period) {
  return period === 'all' || !event.periods?.length || event.periods.includes(period);
}
