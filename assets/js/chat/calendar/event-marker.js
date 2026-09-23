// Links a chat message to the calendar events it created.
//
// The chat sanitizer (assets/js/chat/rich-text.js) strips every attribute and
// unknown tag, so structured data can't ride along as HTML. Instead the event
// is appended as a plain-text marker, the same trick _includes/lesson_chat.html
// uses with [[lesson:<url>]], and stripped again before the message renders:
//
//   [[event:<id>|<YYYY-MM-DD>|<P0-P3>|<type>|<title>|<periods, e.g. 3,4>|<description>]]
//
// type, title and description are URL-encoded. The last two fields are
// optional so older markers still parse.

const MARKER_PATTERN = /\[\[event:([^|\]]+)\|(\d{4}-\d{2}-\d{2})\|(P[0-3])\|([^|\]]*)\|([^|\]]*)(?:\|([\d,]*))?(?:\|([^\]]*))?\]\]/g;

function safeDecode(value) {
  try { return decodeURIComponent(value || ''); } catch (_) { return value || ''; }
}

export function encodeEventMarker(event) {
  const fields = [
    event.id,
    event.date,
    event.priority || 'P2',
    encodeURIComponent(event.type || 'event'),
    encodeURIComponent(event.title),
    (event.periods || []).join(','),
    encodeURIComponent(event.description || ''),
  ];
  return `[[event:${fields.join('|')}]]`;
}

export function appendEventMarkers(html, events) {
  if (!events.length) return html;
  return `${html} ${events.map(encodeEventMarker).join(' ')}`;
}

// → { html: message without markers, events: [{ id, date, priority, type, title, periods, description }] }
export function extractEventMarkers(raw) {
  const events = [];
  const html = String(raw || '').replace(MARKER_PATTERN, (_, id, date, priority, type, title, periods, description) => {
    events.push({
      id,
      date,
      priority,
      type: safeDecode(type),
      title: safeDecode(title),
      periods: periods ? periods.split(',').filter(Boolean) : [],
      description: safeDecode(description),
    });
    return '';
  }).replace(/(?:\s|<br>)+$/g, '').trim();
  return { html, events };
}
