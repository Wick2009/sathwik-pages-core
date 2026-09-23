// V2 "quick syntax": the Slack weekly-plan format teachers already use,
// parsed in the browser. The day-line regex and the type markers are ported
// from Open-Coding-Society/spring CalendarEventService.extractEventsFromText so an
// announcement produces the same events a Slack post used to.
//
//   Week of 9/28            (or "Week 7"; optional, defaults to this school week)
//   [Mon]: Live Reviews
//   • Review project progress with teacher
//   [Wed - Thu]: ** Unit 3 Quiz
//
// Asterisks set the priority, more meaning more important: none = P2,
// * = P1, ** = P0. As in the Slack importer they also mark the type
// (* = check-in, ** = graded).

import { addDays, dayOffset, findSchoolWeek, mondayOf, toIsoDate, todayIso } from './school-weeks.js';

const DAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const DAY_LINE = new RegExp(`^\\s*\\[${DAY}(?:\\s*-\\s*${DAY})?\\]:\\s*(\\*\\*|\\*)?\\s*(.+)$`, 'i');
const BULLET_LINE = /^\s*(\*\*|\*)?\s*[•·]\s*(.+)$|^\s*-\s+(.+)$/;
const WEEK_OF = /week of\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
const WEEK_NUMBER = /^\s*week\s+(\d{1,2})\b/im;

export const QUICK_SYNTAX_EXAMPLE = [
  'Week of 9/28',
  '[Mon]: Live Reviews',
  '• Review project progress with teacher',
  '[Wed - Thu]: ** Unit 3 Quiz',
  '[Fri]: * Sprint check-in',
].join('\n');

function capitalize(label) {
  return label.charAt(0).toUpperCase() + label.slice(1, 3).toLowerCase();
}

const MARKERS = {
  '**': { priority: 'P0', type: 'grade' },
  '*': { priority: 'P1', type: 'check-in' },
};
const PLAIN = { priority: 'P2', type: 'daily plan' };

// "9/28" has no year: pick the one that keeps it inside the school year
// ("2026-2027" → Aug–Dec is 2026, Jan–Jul is 2027).
function inferYear(month, schoolYear, today) {
  const [firstYear, secondYear] = String(schoolYear || '').split('-').map(Number);
  if (firstYear && secondYear) return month >= 7 ? firstYear : secondYear;
  return Number(today.slice(0, 4));
}

export function resolveWeekStart(text, { weeks = [], schoolYear = '', today = todayIso() } = {}) {
  const weekOf = text.match(WEEK_OF);
  if (weekOf) {
    const month = Number(weekOf[1]);
    const day = Number(weekOf[2]);
    let year = weekOf[3] ? Number(weekOf[3]) : inferYear(month, schoolYear, today);
    if (year < 100) year += 2000;
    return { monday: mondayOf(toIsoDate(new Date(year, month - 1, day))), source: `Week of ${month}/${day}` };
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

// Returns one entry per [Day] line; a range line carries several dates and
// becomes one calendar event per day, like the Slack importer did.
export function parseQuickSyntax(text, options = {}) {
  const week = resolveWeekStart(text, options);
  const entries = [];

  String(text || '').split(/\r?\n/).forEach((line) => {
    const day = line.match(DAY_LINE);
    if (day) {
      const startLabel = capitalize(day[1]);
      const endLabel = day[2] ? capitalize(day[2]) : startLabel;
      const title = day[4].replace(/\*+\s*$/, '').trim();
      if (!title) return;
      entries.push({
        key: `line-${entries.length}`,
        title,
        ...(MARKERS[day[3]] || PLAIN),
        description: '',
        dayLabel: startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`,
        dates: datesBetween(week.monday, startLabel, endLabel),
      });
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
