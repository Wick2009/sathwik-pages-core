// "Save it to my own calendar" helpers: an .ics download (works with Apple,
// Outlook and Google import) and a pre-filled Google Calendar link. The .ics
// layout matches _projects/systems/calendar/js/EventBuilder.js generateICSFile
// (all-day VALUE=DATE events), since the backend stores dates without times.

import { addDays } from './school-weeks.js';

function compactDate(iso) {
  return iso.replaceAll('-', '');
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcs(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function buildIcs(events, { course = '', calendarName = 'Class Announcements' } = {}) {
  const stamp = utcStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Coding Society//Announcement Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];
  events.forEach((event) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}-${compactDate(event.date)}@opencodingsociety.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(event.date, 1))}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(event.description || '')}`,
    );
    if (course) lines.push(`CATEGORIES:${escapeIcs(course.toUpperCase())}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(events, options = {}) {
  const blob = new Blob([buildIcs(events, options)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options.filename || 'announcement-event.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// All-day Google event: end date is exclusive, so it's the following day.
export function googleCalendarUrl(event, { details = '' } = {}) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compactDate(event.date)}/${compactDate(addDays(event.date, 1))}`,
    details: details || event.description || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
