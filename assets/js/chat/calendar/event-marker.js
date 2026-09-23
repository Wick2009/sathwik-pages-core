// Links a chat message to the calendar events it created.
//
// The chat sanitizer (assets/js/chat/rich-text.js) strips every attribute and
// unknown tag, so structured data can't ride along as HTML. Instead the event
// is appended as a plain-text marker, the same trick _includes/lesson_chat.html
// uses with [[lesson:<url>]], and stripped again before the message renders:
//
//   [[event:<id>|<YYYY-MM-DD>|<P0-P3>|<type>|<url-encoded title>]]

const MARKER_PATTERN = /\[\[event:([^|\]]+)\|(\d{4}-\d{2}-\d{2})\|(P[0-3])\|([^|\]]*)\|([^\]]*)\]\]/g;

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

export function encodeEventMarker(event) {
  const type = encodeURIComponent(event.type || 'event');
  return `[[event:${event.id}|${event.date}|${event.priority || 'P2'}|${type}|${encodeURIComponent(event.title)}]]`;
}

export function appendEventMarkers(html, events) {
  if (!events.length) return html;
  return `${html} ${events.map(encodeEventMarker).join(' ')}`;
}

// → { html: message without markers, events: [{ id, date, priority, type, title }] }
export function extractEventMarkers(raw) {
  const events = [];
  const html = String(raw || '').replace(MARKER_PATTERN, (_, id, date, priority, type, title) => {
    events.push({ id, date, priority, type: safeDecode(type), title: safeDecode(title) });
    return '';
  }).replace(/(?:\s|<br>)+$/g, '').trim();
  return { html, events };
}
