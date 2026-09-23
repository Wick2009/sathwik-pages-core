// Data layer for the announcement ↔ calendar demos. One interface, two backends:
//
//   live    → the existing Spring endpoints under /api/calendar (no backend changes)
//   preview → sample events in localStorage, so the demo runs signed out
//
// Both return events normalized to { id, date, title, description, type, priority, periods, course }.

const PRIORITY_PREFIX = /^\[(P[0-3])\]\s*/;
const TITLE_EMOJI = '📅';

// Spring serializes LocalDate as "YYYY-MM-DD"; tolerate the [y, m, d] array form too.
function normalizeDate(value) {
  if (Array.isArray(value)) return value.map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-');
  return String(value || '').slice(0, 10);
}

// Class periods go in the backend's existing classPeriod string ("P3,P4").
const toClassPeriod = (periods = []) => periods.map((p) => `P${p}`).join(',');
const fromClassPeriod = (value) => (String(value || '').match(/\d/g) || []);

// /student/calendar reads priority from a "[Px]" title prefix, so events are
// stored as "[P2] 📅 Title" and unwrapped here for display.
export function normalizeBackendEvent(raw) {
  const title = String(raw?.title || '');
  const priority = title.match(PRIORITY_PREFIX)?.[1] || raw?.priority || 'P2';
  return {
    id: String(raw?.id),
    date: normalizeDate(raw?.date),
    title: title.replace(PRIORITY_PREFIX, '').replace(TITLE_EMOJI, '').trim(),
    description: raw?.description || '',
    type: raw?.type || 'event',
    priority,
    periods: fromClassPeriod(raw?.classPeriod),
    course: String(raw?.period || '').toLowerCase(),
    isBreak: Boolean(raw?.break || raw?.isBreak),
  };
}

function createListeners() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify() { listeners.forEach((listener) => listener()); },
  };
}

/* ── live ─────────────────────────────────────────────────────────── */

export function createLiveCalendarStore({ course, javaURI, fetchOptions, sourceUrl }) {
  const period = course.toUpperCase();
  const removed = new Set();
  const listeners = createListeners();

  async function request(path, init = {}) {
    const res = await fetch(`${javaURI}/api/calendar${path}`, { ...fetchOptions, ...init });
    const text = await res.text();
    const body = text ? (() => { try { return JSON.parse(text); } catch (_) { return text; } })() : null;
    if (!res.ok) {
      const reason = body?.message || body?.error || (typeof body === 'string' ? body : '');
      throw new Error(`Calendar ${init.method || 'GET'} ${path} failed (HTTP ${res.status}) ${reason}`.trim());
    }
    return body;
  }

  const forThisCourse = (events) => (events || [])
    .map(normalizeBackendEvent)
    .filter((event) => !event.isBreak && (!event.course || event.course === course));

  return {
    mode: 'live',
    async createEvent({ title, date, description = '', type = 'event', priority = 'P2', periods = [] }) {
      const saved = await request('/add_event', {
        method: 'POST',
        body: JSON.stringify({
          title: `[${priority}] ${TITLE_EMOJI} ${title}`,
          date,
          description: [description, sourceUrl ? `Posted in ${period} announcements: ${sourceUrl}` : '']
            .filter(Boolean).join('\n\n'),
          type,
          period,
          classPeriod: toClassPeriod(periods),
          // Blank = visible to everyone. Omitting it makes the backend default to
          // the teacher's uid, which hides the event from students.
          individual: '',
        }),
      });
      listeners.notify();
      return normalizeBackendEvent(saved);
    },
    async listRange(start, end) {
      return forThisCourse(await request(`/events/range?start=${start}&end=${end}`));
    },
    async listBreaks() {
      const breaks = await request('/breaks');
      return (Array.isArray(breaks) ? breaks : []).map((b) => ({ date: normalizeDate(b.date), name: b.name || 'Break' }));
    },
    async deleteEvent(id) {
      await request(`/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
      removed.add(String(id));
      listeners.notify();
    },
    status(id) { return removed.has(String(id)) ? 'removed' : 'unknown'; },
    subscribe: listeners.subscribe,
  };
}

/* ── preview ──────────────────────────────────────────────────────── */

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode: memory only */ }
}

export function createPreviewCalendarStore({ course, storageKey, seedEvents = [] }) {
  let events = readJson(storageKey, null);
  if (!Array.isArray(events)) {
    events = seedEvents;
    writeJson(storageKey, events);
  }
  const listeners = createListeners();
  const save = () => { writeJson(storageKey, events); listeners.notify(); };
  const inRange = (start, end) => events.filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    mode: 'preview',
    async createEvent({ title, date, description = '', type = 'event', priority = 'P2', periods = [] }) {
      const event = {
        id: `p${Date.now().toString(36)}${events.length}`, date, title, description, type, priority, periods, course,
      };
      // Same upsert rule as the backend: same title + date replaces instead of duplicating.
      events = events.filter((e) => !(e.title === title && e.date === date)).concat(event);
      save();
      return event;
    },
    async listRange(start, end) { return inRange(start, end); },
    async listBreaks() { return []; },
    async deleteEvent(id) { events = events.filter((e) => e.id !== String(id)); save(); },
    status(id) { return events.some((e) => e.id === String(id)) ? 'active' : 'removed'; },
    subscribe: listeners.subscribe,
  };
}
