// Entry point for _includes/announcement_calendar_demo.html.
// Owns the pieces every version shares (composer, feed, store, transport)
// and swaps the version-specific UI in and out when the switcher changes.

import { fetchOptions, javaURI } from '../../api/config.js';
import { createRichComposer } from '../rich-text.js';
import { createLiveCalendarStore, createPreviewCalendarStore } from './calendar-store.js';
import { createChatFeed } from './chat-feed.js';
import { createLiveTransport, createPreviewTransport } from './chat-transport.js';
import { renderEventCards } from './event-card.js';
import { fetchLiveIdentity } from './identity.js';
import { buildPreviewSeed, DEMO_STUDENT, DEMO_TEACHER } from './preview-seed.js';
import { parseSchoolCalendar } from './school-weeks.js';
import { mountAttachForm } from './variants/attach-form.js';
import { mountQuickSyntax } from './variants/quick-syntax-panel.js';
import { mountWeekStrip } from './variants/week-strip.js';

const VERSIONS = {
  1: {
    mount: mountAttachForm,
    summary: 'Write the announcement as usual, click Add to calendar and pick a date. Send posts the message and creates the event together.',
  },
  2: {
    mount: mountQuickSyntax,
    summary: 'Type the weekly plan the way it used to go in Slack. Every [Day]: Title line is detected as you type, and each one becomes a calendar event when you send.',
  },
  3: {
    mount: mountWeekStrip,
    summary: 'The school week stays pinned above the announcements. Click a day to add an event, and the announcement for it posts automatically. Students click a day to jump to its announcement.',
  },
};

const root = document.getElementById('announcementCalendarDemo');
const course = root.dataset.course || 'csa';
const calendarUrl = `${root.dataset.baseurl || ''}/student/calendar`;
const sourceUrl = `${window.location.origin}${window.location.pathname}`;
const storagePrefix = `ocs-announcement-calendar-demo:${course}`;
const { schoolYear, weeks } = parseSchoolCalendar(
  JSON.parse(document.getElementById('announcementCalendarSchool').textContent),
);

const $ = (selector) => root.querySelector(selector);
const slots = {
  feedTop: $('[data-slot="feed-top"]'),
  composerTools: $('[data-slot="composer-tools"]'),
  composerPanel: $('[data-slot="composer-panel"]'),
};
const formEl = $('.chat-form');
const sendBtn = $('.chat-send');

const state = {
  version: Number(new URLSearchParams(window.location.search).get('v')) || 1,
  role: 'teacher',
  mode: 'preview',
  liveIdentity: null,
  store: null,
  transport: null,
  variant: null,
  sending: false,
};

const isTeacher = () => (state.mode === 'live' ? state.liveIdentity.isTeacher : state.role === 'teacher');
const selfName = () => (state.mode === 'live' ? state.liveIdentity.name : (state.role === 'teacher' ? DEMO_TEACHER : DEMO_STUDENT));

const composer = createRichComposer({
  placeholder: `Message the ${course.toUpperCase()} class…`,
  maxLength: 2000,
  onSubmit: submit,
  onInput: () => state.variant?.onComposerInput?.(),
});
formEl.classList.add('chat-form--rich');
formEl.insertBefore(composer.element, sendBtn);

const feed = createChatFeed({
  messagesEl: $('.chat-messages'),
  getSelfName: selfName,
  renderEvents: (events) => renderEventCards(events, {
    store: () => state.store, isTeacher, course, calendarUrl, sourceUrl,
  }),
});

function send(html) {
  return state.transport.send({ sender: selfName(), message: html });
}

async function submit() {
  if (state.sending || composer.isEmpty() || composer.isOverLimit()) return;
  state.sending = true;
  sendBtn.disabled = true;
  try {
    const html = composer.getHTML();
    const result = state.variant?.beforeSend ? await state.variant.beforeSend({ html }) : { html };
    if (result && send(result.html)) {
      composer.clear();
      state.variant?.afterSend?.();
    }
  } finally {
    state.sending = false;
    sendBtn.disabled = false;
  }
}

function setStatus(text, tone) {
  $('.chat-status').textContent = text;
  const pill = $('.chat-status-pill');
  pill.classList.remove('is-live', 'is-preview', 'is-error');
  pill.classList.add(tone);
}

function showNote(text) {
  $('.chat-preview-note span').textContent = text;
  $('.chat-preview-note').hidden = !text;
}

function mountVersion() {
  state.variant?.unmount();
  Object.values(slots).forEach((slot) => { slot.innerHTML = ''; });
  state.variant = VERSIONS[state.version].mount({
    course, weeks, schoolYear, slots, composer, feed, send, isTeacher, getStore: () => state.store,
  });
}

async function startMode(mode) {
  state.transport?.stop();
  feed.reset();
  state.mode = mode;
  if (mode === 'preview') {
    const seed = buildPreviewSeed({ weeks, course });
    state.store = createPreviewCalendarStore({ course, storageKey: `${storagePrefix}:events`, seedEvents: seed.events });
    state.transport = createPreviewTransport({ storageKey: `${storagePrefix}:messages`, seedMessages: seed.messages });
    setStatus('preview', 'is-preview');
    showNote('Preview mode: sample data kept in this browser. Nothing is sent to the class or the real calendar.');
  } else {
    state.store = createLiveCalendarStore({ course, javaURI, fetchOptions, sourceUrl });
    state.transport = createLiveTransport({ groupName: `${course}-announcements-demo`, course, javaURI, fetchOptions });
    setStatus('connecting…', 'is-preview');
    showNote(`Live mode as ${state.liveIdentity.name}${state.liveIdentity.isTeacher ? ' (teacher)' : ''}: messages go to the "${course}-announcements-demo" chat and events go on the real ${course.toUpperCase()} calendar.`);
  }
  syncControls();
  mountVersion();
  try {
    await state.transport.start(feed.append);
    if (mode === 'live') setStatus('live', 'is-live');
  } catch (err) {
    console.error('Announcement calendar demo: live mode failed', err);
    setStatus('offline', 'is-error');
    feed.appendSystem(`Live mode is unavailable (${err.message}).`);
  }
}

function syncControls() {
  root.querySelectorAll('[data-version]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(Number(tab.dataset.version) === state.version));
  });
  root.querySelectorAll('[data-role]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.role === state.role));
    button.disabled = state.mode === 'live';
  });
  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.mode === state.mode));
  });
  $('.announcement-calendar-summary').textContent = VERSIONS[state.version].summary;
  root.dataset.version = String(state.version);
}

root.querySelectorAll('[data-version]').forEach((tab) => tab.addEventListener('click', () => {
  state.version = Number(tab.dataset.version);
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(state.version));
  window.history.replaceState(null, '', url);
  syncControls();
  mountVersion();
}));

// Switching role re-renders the feed so "You" and the teacher-only controls follow.
root.querySelectorAll('[data-role]').forEach((button) => button.addEventListener('click', () => {
  state.role = button.dataset.role;
  startMode('preview');
}));

root.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
  if (button.dataset.mode === state.mode) return;
  if (button.dataset.mode === 'preview') { startMode('preview'); return; }
  state.liveIdentity = await fetchLiveIdentity({ javaURI, fetchOptions });
  if (!state.liveIdentity) {
    showNote('Live mode needs you to be signed in to the Spring backend (Login on the site nav). Staying in Preview.');
    return;
  }
  startMode('live');
}));

$('.announcement-calendar-reset').addEventListener('click', () => {
  try {
    window.localStorage.removeItem(`${storagePrefix}:events`);
    window.localStorage.removeItem(`${storagePrefix}:messages`);
  } catch (_) { /* storage blocked: the reseed below is still in memory */ }
  startMode('preview');
});

formEl.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
window.addEventListener('beforeunload', () => state.transport?.stop());

if (!VERSIONS[state.version]) state.version = 1;
startMode('preview');
