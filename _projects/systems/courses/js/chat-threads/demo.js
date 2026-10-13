// Entry point for _includes/chat_threads_demo.html: replies and threads on a
// class chat, for feedback before they go into the real course chats.
//
// Preview (default) runs a sample conversation stored in this browser, and
// "Post as" switches between a teacher and a student so one person can play
// both sides. Live needs a sign-in and uses a separate "<course>-threads-demo"
// group on the Spring backend, over the same REST + STOMP endpoints as the
// announcement chat, so the real announcements are never touched.

import { fetchOptions, javaURI } from '../../api/config.js';
import { mountThreadedChat } from './thread-ui.js';
import { applyAdd, applyDelete, applyEdit, findMessage, linkProblem, normalizeMessage } from './thread-model.js';

const PREVIEW_KEY = 'ocs-chat-threads-demo:v1';
const CHAT_SOCKET_PORT = 8589;
const SOCKJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/sockjs-client/1.5.1/sockjs.min.js';
const STOMP_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/stomp.js/2.3.3/stomp.min.js';

const TEACHER = 'Demo Teacher';
const STUDENT = 'Ava Chen';
const PEOPLE = { teacher: TEACHER, student: STUDENT };

const root = document.getElementById('chatThreadsDemo');
const course = root.dataset.course || 'csa';
const title = `${course.toUpperCase()} Announcements`;
const liveGroup = `${course}-threads-demo`;
const $ = (selector) => root.querySelector(selector);
const statusPill = $('.chat-status-pill');
const statusText = $('.chat-status');
const note = $('.chat-preview-note');

const state = {
  mode: 'preview',
  postAs: 'teacher',
  live: null, // { name, pfp, groupId, client, subscription }
  pendingThreadSends: 0,
};

const chat = mountThreadedChat({
  container: $('[data-slot="chat"]'),
  title,
  me: () => (state.mode === 'live' && state.live
    ? { name: state.live.name, pfp: state.live.pfp }
    : { name: PEOPLE[state.postAs], pfp: null }),
  actions: {
    send: (draft) => (state.mode === 'live' ? liveSend(draft) : previewSend(draft)),
    edit: (id, html) => (state.mode === 'live' ? liveEdit(id, html) : previewEdit(id, html)),
    remove: (id) => (state.mode === 'live' ? liveRemove(id) : previewRemove(id)),
  },
  emptyAction: {
    label: 'Post the sample conversation',
    onClick: () => (state.mode === 'live' ? postSampleLive() : resetPreview()),
  },
});

function setStatus(text, tone) {
  statusText.textContent = text;
  statusPill.classList.remove('is-live', 'is-preview', 'is-error');
  if (tone) statusPill.classList.add(tone);
}

function showNote(nodes) {
  note.querySelector('span').replaceChildren(...nodes);
  note.hidden = false;
}

/* ── Sample conversation ──────────────────────────────────────────── */

// One announcement with a busy thread, a quick question answered with a
// reply, and a plain message, dated relative to now.
function sampleConversation(now = Date.now()) {
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
  return [
    { id: 's1', name: TEACHER, date: at(26), message: '<b>Unit 2 FRQ practice</b> is posted. Work with your table group and submit one copy by Friday.<br>Questions about it? Use <b>Reply in thread</b> on this message so they stay in one place.' },
    { id: 's2', name: STUDENT, date: at(25.5), threadId: 's1', message: 'Do we submit one per group or one each?' },
    { id: 's3', name: TEACHER, date: at(25), threadId: 's1', replyToId: 's2', message: 'One per group. Put everyone’s name at the top.' },
    { id: 's4', name: 'Leo Martinez', date: at(24), threadId: 's1', message: 'Can we use the code runner for part (b)?' },
    { id: 's5', name: TEACHER, date: at(23), threadId: 's1', replyToId: 's4', alsoInChannel: true, message: 'Yes, the runner is fine for testing. Write your final answer by hand, like on the AP exam.' },
    { id: 's6', name: 'Maya Singh', date: at(3), message: 'Is the lab open at lunch tomorrow?' },
    { id: 's7', name: TEACHER, date: at(2.5), replyToId: 's6', message: 'Yes, 12:10 to 12:40.' },
    { id: 's8', name: TEACHER, date: at(1), message: 'Reminder: the review session moved to <b>Thursday</b> after school.' },
  ].map(normalizeMessage);
}

/* ── Preview: this browser only ───────────────────────────────────── */

let preview = [];

function readPreview() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_KEY) || 'null');
    return Array.isArray(parsed) ? parsed.map(normalizeMessage) : null;
  } catch (_) {
    return null;
  }
}

function savePreview() {
  try { window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(preview)); } catch (_) { /* storage blocked: memory only */ }
}

function resetPreview() {
  preview = sampleConversation();
  savePreview();
  chat.setMessages(preview);
}

function previewSend({ message, replyToId, threadId, alsoInChannel }) {
  const problem = linkProblem(preview, { replyToId, threadId });
  if (problem) return problem;
  const posted = normalizeMessage({
    id: `p${Date.now().toString(36)}`, name: PEOPLE[state.postAs], date: new Date().toISOString(),
    message, replyToId, threadId, alsoInChannel,
  });
  preview = applyAdd(preview, posted);
  savePreview();
  chat.add(posted);
  return true;
}

function previewEdit(id, html) {
  const target = findMessage(preview, id);
  if (!target || target.name !== PEOPLE[state.postAs]) return 'You can only edit your own messages.';
  preview = applyEdit(preview, id, html);
  savePreview();
  chat.edit(id, html);
  return true;
}

function previewRemove(id) {
  const target = findMessage(preview, id);
  if (!target || target.name !== PEOPLE[state.postAs]) return 'You can only delete your own messages.';
  preview = applyDelete(preview, id);
  savePreview();
  chat.remove(id);
  return true;
}

function enterPreview(reasonNodes) {
  disconnectLive();
  state.mode = 'preview';
  preview = readPreview() || sampleConversation();
  savePreview();
  chat.setMessages(preview);
  chat.setEnabled(true);
  setStatus('preview', 'is-preview');
  showNote(reasonNodes || ['Preview: a sample conversation stored in this browser. Nothing is sent to the class.']);
  syncToolbar();
}

/* ── Live: the Spring backend ─────────────────────────────────────── */

function loadScriptOnce(src) {
  window.__ocsChatScripts = window.__ocsChatScripts || {};
  if (!window.__ocsChatScripts[src]) {
    window.__ocsChatScripts[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(script);
    });
  }
  return window.__ocsChatScripts[src];
}

function socketEndpoint() {
  const uri = new URL(javaURI);
  if (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1') {
    return `${uri.protocol}//${uri.hostname}:${CHAT_SOCKET_PORT}/ws-chat`;
  }
  return `${javaURI}/ws-chat`;
}

async function api(path, init = {}) {
  const res = await fetch(`${javaURI}${path}`, { ...fetchOptions, ...init });
  if (!res.ok) throw Object.assign(new Error(`${init.method || 'GET'} ${path}: HTTP ${res.status}`), { status: res.status });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Finds the demo group, creating it the first time (same as the announcement chat).
async function resolveGroup() {
  const search = () => api(`/api/groups/search?name=${encodeURIComponent(liveGroup)}`)
    .then((body) => (Array.isArray(body) ? body : [body]).find((g) => g?.name === liveGroup));
  let group = await search();
  for (let attempt = 0; !group?.id && attempt < 2; attempt += 1) {
    try {
      group = await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: liveGroup, period: '', course, memberIds: [] }),
      });
    } catch (_) {
      // 409: someone created it a moment ago. Anything else (a busy local
      // SQLite database, say): look again, then try once more.
      group = await search();
    }
  }
  if (!group?.id) throw new Error(`could not find or create the ${liveGroup} group`);
  return Number(group.id);
}

function connectSocket(groupId) {
  return new Promise((resolve, reject) => {
    const client = window.Stomp.over(new window.SockJS(socketEndpoint()));
    client.debug = null;
    client.connect({}, () => {
      const subscription = client.subscribe(`/topic/group/${groupId}`, (frame) => {
        try { handleLiveEvent(JSON.parse(frame.body)); } catch (err) { console.warn('Threads demo: bad frame', err); }
      });
      resolve({ client, subscription });
    }, reject);
  });
}

function handleLiveEvent(event) {
  if (!event || state.mode !== 'live' || !state.live) return;
  switch (event.context) {
    case 'sendMessageServer': {
      const posted = normalizeMessage({ ...event, id: event.messageId, name: event.sender });
      // An older backend drops the thread fields, so a thread reply would land in the main chat.
      if (posted.name === state.live.name && state.pendingThreadSends > 0) {
        state.pendingThreadSends -= 1;
        if (!posted.threadId) {
          showNote(['This backend ignored the thread. Run the Spring branch with reply and thread support (feature/chat-replies-threads).']);
        }
      }
      chat.add(posted);
      break;
    }
    case 'editMessageServer': chat.edit(event.messageId, event.message); break;
    case 'deleteMessageServer': chat.remove(event.messageId); break;
    case 'errorServer':
      if (event.sender === state.live.name) chat.showError(event.error || 'The server rejected that message.');
      break;
    default: break; // presence, typing
  }
}

function disconnectLive() {
  const live = state.live;
  state.live = null;
  try {
    live?.subscription?.unsubscribe();
    live?.client?.disconnect();
  } catch (_) { /* already closed */ }
}

async function enterLive() {
  state.mode = 'live';
  syncToolbar();
  chat.setEnabled(false);
  setStatus('connecting…');
  let person;
  try {
    person = await api('/api/person/get');
  } catch (err) {
    const signIn = document.createElement('a');
    signIn.href = `${root.dataset.baseurl || ''}/login`;
    signIn.textContent = 'Sign in';
    enterPreview(['Live needs a sign-in on the backend (', javaURI, '). ', signIn, ', then pick Live again.']);
    return;
  }
  try {
    const groupId = await resolveGroup();
    const history = await api(`/api/groups/chat/${groupId}/messages`);
    await loadScriptOnce(SOCKJS_SRC);
    await loadScriptOnce(STOMP_SRC);
    const socket = await connectSocket(groupId);
    state.live = { name: person.name, pfp: person.pfp, groupId, ...socket };
    chat.setMessages((history || []).map(normalizeMessage));
    chat.setEnabled(true);
    setStatus('connected', 'is-live');
    showNote([`Live: signed in as ${person.name}, posting to the separate “${liveGroup}” chat. Open this page in a second browser with another account to see replies and threads arrive in real time.`]);
  } catch (err) {
    console.warn('Threads demo: live mode failed', err);
    enterPreview([`Live couldn’t connect to ${javaURI} (${err.message}). Showing the preview instead.`]);
    setStatus('preview', 'is-preview');
  }
}

function liveSend({ message, replyToId, threadId, alsoInChannel }) {
  const live = state.live;
  if (!live) return 'Not connected.';
  const problem = linkProblem(chat.messages, { replyToId, threadId });
  if (problem) return problem;
  if (threadId) state.pendingThreadSends += 1;
  live.client.send('/app/groups.chat', {}, JSON.stringify({
    context: 'sendMessage', groupId: live.groupId, sender: live.name, message, image: null,
    date: new Date().toISOString(), replyToId, threadId, alsoInChannel,
  }));
  return true; // the message appears when the server echoes it back
}

async function liveEdit(id, html) {
  try {
    await api(`/api/groups/chat/${state.live.groupId}/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ message: html }),
    });
    chat.edit(id, html);
    return true;
  } catch (err) {
    return err.status === 403 ? 'You can only edit your own messages.' : 'Could not save your edit. Try again.';
  }
}

async function liveRemove(id) {
  try {
    await api(`/api/groups/chat/${state.live.groupId}/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    chat.remove(id);
    return true;
  } catch (err) {
    return err.status === 403 ? 'You can only delete your own messages.' : 'Could not delete the message. Try again.';
  }
}

// Posts the sample conversation to the demo group in order, mapping the
// sample ids to the ids the server gives back. Uses POST /messages, which
// takes the sender's name from the request.
async function postSampleLive() {
  const live = state.live;
  if (!live) return;
  chat.setEnabled(false);
  const ids = {};
  try {
    for (const sample of sampleConversation()) {
      const saved = await api(`/api/groups/chat/${live.groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          name: sample.name, message: sample.message,
          replyToId: ids[sample.replyToId] || null, threadId: ids[sample.threadId] || null,
          alsoInChannel: sample.alsoInChannel,
        }),
      });
      ids[sample.id] = saved[saved.length - 1].id;
    }
  } catch (err) {
    chat.showError(`Could not post the sample conversation (${err.message}).`);
  } finally {
    chat.setEnabled(true);
  }
}

/* ── Toolbar ──────────────────────────────────────────────────────── */

function select(buttons, isSelected) {
  buttons.forEach((b) => {
    const on = isSelected(b);
    b.classList.toggle('accent', on);
    b.classList.toggle('fill', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function syncToolbar() {
  select(root.querySelectorAll('[data-mode]'), (b) => b.dataset.mode === state.mode);
  select(root.querySelectorAll('[data-as]'), (b) => b.dataset.as === state.postAs);
  // Wrapper divs without display classes, so `hidden` isn't overridden by .ocs__btn / .ocs__links.
  root.querySelectorAll('[data-preview-only]').forEach((node) => { node.hidden = state.mode !== 'preview'; });
}

root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === state.mode) return;
  if (b.dataset.mode === 'live') enterLive();
  else enterPreview();
}));

root.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', () => {
  state.postAs = b.dataset.as;
  syncToolbar();
  chat.refresh();
}));

$('[data-hook="reset"]').addEventListener('click', () => {
  if (window.confirm('Restore the sample conversation? Your preview messages will be cleared.')) resetPreview();
});

window.addEventListener('beforeunload', disconnectLive);

if (new URLSearchParams(window.location.search).get('mode') === 'live') enterLive();
else enterPreview();
