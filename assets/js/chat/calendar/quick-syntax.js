// V2 "quick syntax": the Slack weekly-plan format teachers already use,
// parsed in the browser. The day-line regex and the asterisk markers are
// ported from Open-Coding-Society/spring CalendarEventService.extractEventsFromText
// so an announcement produces the same events a Slack post used to. On top of
// that it can set everything the V1 form can (any date, every type, P0–P3):
//
//   Week of 9/28                       (or "Week 7"; optional, defaults to this school week)
//   [Mon]: Live Reviews
//   • Review project progress with teacher
//   [Wed - Thu]: ** Unit 3 Quiz        (* = P1 check-in, ** = P0 graded)
//   [10/9]: Unit 4 FRQ #due #P3        (a date, and #tags for type / priority)

import { DEFAULT_PRIORITY, EVENT_TYPES, PRIORITIES } from './event-options.js';
import { addDays, dayOffset, findSchoolWeek, mondayOf, toIsoDate, todayIso } from './school-weeks.js';

const DAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const DAY_LINE = new RegExp(`^\\s*\\[${DAY}(?:\\s*-\\s*${DAY})?\\]:\\s*(\\*\\*|\\*)?\\s*(.+)$`, 'i');
const DATE_LINE = /^\s*\[(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\]:\s*(\*\*|\*)?\s*(.+)$/;
const BULLET_LINE = /^\s*(\*\*|\*)?\s*[•·]\s*(.+)$|^\s*-\s+(.+)$/;
const WEEK_OF = /week of\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
const WEEK_NUMBER = /^\s*week\s+(\d{1,2})\b/im;
const TAG = /(^|\s)#([\w-]+)/g;

export const QUICK_SYNTAX_EXAMPLE = [
  'Week of 9/28',
  '[Mon]: Live Reviews',
  '• Review project progress with teacher',
  '[Wed - Thu]: ** Unit 3 Quiz',
  '[Fri]: * Sprint check-in',
  '[10/9]: Unit 4 FRQ #due #P3',
].join('\n');

// Asterisks are a shortcut for priority (and, as in Slack, for the type).
const MARKERS = {
  '**': { priority: 'P0', type: 'grade' },
  '*': { priority: 'P1', type: 'check-in' },
};
const PLAIN = { priority: DEFAULT_PRIORITY, type: 'daily plan' };

const TYPE_BY_TAG = new Map(EVENT_TYPES.flatMap((type) => type.tags.map((tag) => [tag, type.value])));

function capitalize(label) {
  return label.charAt(0).toUpperCase() + label.slice(1, 3).toLowerCase();
}

// "9/28" has no year: pick the one that keeps it inside the school year
// ("2026-2027" → Aug–Dec is 2026, Jan–Jul is 2027).
function inferYear(month, schoolYear, today) {
  const [firstYear, secondYear] = String(schoolYear || '').split('-').map(Number);
  if (firstYear && secondYear) return month >= 7 ? firstYear : secondYear;
  return Number(today.slice(0, 4));
}

function isoFromMonthDay(month, day, year, { schoolYear, today }) {
  let fullYear = year ? Number(year) : inferYear(Number(month), schoolYear, today);
  if (fullYear < 100) fullYear += 2000;
  return toIsoDate(new Date(fullYear, Number(month) - 1, Number(day)));
}

export function resolveWeekStart(text, { weeks = [], schoolYear = '', today = todayIso() } = {}) {
  const weekOf = text.match(WEEK_OF);
  if (weekOf) {
    const iso = isoFromMonthDay(weekOf[1], weekOf[2], weekOf[3], { schoolYear, today });
    return { monday: mondayOf(iso), source: `Week of ${Number(weekOf[1])}/${Number(weekOf[2])}` };
  }
  const weekNumber = text.match(WEEK_NUMBER);
  const numbered = weekNumber && weeks.find((w) => w.index === Number(weekNumber[1]));
  if (numbered) return { monday: numbered.monday, source: `Week ${numbered.index}` };

  const current = findSchoolWeek(weeks, today);
  return { monday: current ? current.monday : mondayOf(today), source: 'this school week' };
}

function datesBetween(monday, startLabel, endLabel) {
  const start = dayOffset(startLabel);
  const end = dayOffset(endLabel);
  if (end < start) return [addDays(monday, start)];
  const dates = [];
  for (let offset = start; offset <= end; offset += 1) dates.push(addDays(monday, offset));
  return dates;
}

// "Unit 4 FRQ #due #P3" → { title: 'Unit 4 FRQ', type: 'assignment', priority: 'P3' }.
// Unknown tags ("Quiz #2") stay in the title. Tags win over asterisks.
function readTitleAndTags(rawTitle, marker) {
  const fields = { ...(MARKERS[marker] || PLAIN) };
  const title = rawTitle.replace(TAG, (match, lead, word) => {
    const tag = word.toLowerCase();
    const priority = tag.toUpperCase();
    if (PRIORITIES.includes(priority)) { fields.priority = priority; return lead; }
    if (TYPE_BY_TAG.has(tag)) { fields.type = TYPE_BY_TAG.get(tag); return lead; }
    return match;
  }).replace(/\*+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return { title, ...fields };
}

function parseEventLine(line, week, options) {
  const day = line.match(DAY_LINE);
  if (day) {
    const startLabel = capitalize(day[1]);
    const endLabel = day[2] ? capitalize(day[2]) : startLabel;
    return {
      ...readTitleAndTags(day[4], day[3]),
      fromWeekday: true,
      dayLabel: startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`,
      dates: datesBetween(week.monday, startLabel, endLabel),
    };
  }
  const dated = line.match(DATE_LINE);
  if (dated) {
    return {
      ...readTitleAndTags(dated[5], dated[4]),
      fromWeekday: false,
      dayLabel: `${Number(dated[1])}/${Number(dated[2])}`,
      dates: [isoFromMonthDay(dated[1], dated[2], dated[3], options)],
    };
  }
  return null;
}

// Returns one entry per event line; a range line carries several dates and
// becomes one calendar event per day, like the Slack importer did.
export function parseQuickSyntax(text, options = {}) {
  const context = { schoolYear: options.schoolYear || '', today: options.today || todayIso() };
  const week = resolveWeekStart(text, { ...options, ...context });
  const entries = [];

  String(text || '').split(/\r?\n/).forEach((line) => {
    const entry = parseEventLine(line, week, context);
    if (entry) {
      if (entry.title) entries.push({ key: `line-${entries.length}`, description: '', ...entry });
      return;
    }
    const bullet = line.match(BULLET_LINE);
    const last = entries[entries.length - 1];
    if (bullet && last) {
      const detail = (bullet[2] || bullet[3] || '').trim();
      last.description = last.description ? `${last.description}\n${detail}` : detail;
      if (MARKERS[bullet[1]]) Object.assign(last, MARKERS[bullet[1]]);
    }
  });

  return { weekStart: week.monday, weekSource: week.source, entries };
}
