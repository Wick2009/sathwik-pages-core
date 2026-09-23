// Where demo announcements are stored and delivered.
//
//   preview → localStorage, seeded with a sample week (no login, nothing leaves the browser)
//   live    → the same group chat the real announcements use (/api/groups + STOMP /ws-chat),
//             ported from _includes/announcement_chat.html, but on a separate
//             "<course>-announcements-demo" group so the real class feed is untouched.

const PREVIEW_LIMIT = 100;
const CHAT_SOCKET_PORT = 8589;
const SOCKJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/sockjs-client/1.5.1/sockjs.min.js';
const STOMP_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/stomp.js/2.3.3/stomp.min.js';

/* ── preview ──────────────────────────────────────────────────────── */

function readMessages(storageKey) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeMessages(storageKey, messages) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-PREVIEW_LIMIT))); } catch (_) { /* memory only */ }
}

export function createPreviewTransport({ storageKey, seedMessages = [] }) {
  let messages = readMessages(storageKey);
  if (!messages) {
    messages = seedMessages;
    writeMessages(storageKey, messages);
  }
  let deliver = () => {};

  return {
    mode: 'preview',
    async start(onMessage) {
      deliver = onMessage;
      messages.forEach(onMessage);
    },
    send({ sender, message }) {
      const entry = { sender, message, date: new Date().toISOString() };
      messages.push(entry);
      writeMessages(storageKey, messages);
      deliver(entry);
      return true;
    },
    stop() {},
  };
}

/* ── live ─────────────────────────────────────────────────────────── */

function loadScriptOnce(src) {
  window.__ocsChatScripts = window.__ocsChatScripts || {};
  if (!window.__ocsChatScripts[src]) {
    window.__ocsChatScripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(el);
    });
  }
  return window.__ocsChatScripts[src];
}

function chatSocketEndpoint(javaURI) {
  const uri = new URL(javaURI);
  if (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1') {
    return `${uri.protocol}//${uri.hostname}:${CHAT_SOCKET_PORT}/ws-chat`;
  }
  return `${javaURI}/ws-chat`;
}

export function createLiveTransport({ groupName, course, javaURI, fetchOptions }) {
  let groupId = null;
  let client = null;
  let connected = false;

  async function findGroup() {
    const res = await fetch(`${javaURI}/api/groups/search?name=${encodeURIComponent(groupName)}`, fetchOptions);
    if (!res.ok) throw new Error(`group lookup failed (HTTP ${res.status})`);
    const body = await res.json();
    const match = Array.isArray(body) ? body.find((g) => g?.name === groupName) : body;
    return Number(match?.id) || null;
  }

  // Groups create themselves on first use, like the real announcement chat.
  async function resolveGroup() {
    const existing = await findGroup();
    if (existing) return existing;
    const res = await fetch(`${javaURI}/api/groups`, {
      ...fetchOptions,
      method: 'POST',
      body: JSON.stringify({ name: groupName, period: '', course, memberIds: [] }),
    });
    if (res.status === 201) return Number((await res.json())?.id);
    const retry = await findGroup(); // 409: created by someone else a moment ago
    if (!retry) throw new Error(`could not create chat group ${groupName}`);
    return retry;
  }

  function connect(onMessage) {
    return new Promise((resolve, reject) => {
      const socket = new window.SockJS(chatSocketEndpoint(javaURI));
      client = window.Stomp.over(socket);
      client.debug = null;
      client.connect({}, () => {
        connected = true;
        client.subscribe(`/topic/group/${groupId}`, (frame) => {
          try {
            const event = JSON.parse(frame.body);
            if (event?.context === 'sendMessageServer') {
              onMessage({ sender: event.sender, message: event.message, date: event.date });
            }
          } catch (err) { console.warn('Announcement calendar demo: bad chat frame', err); }
        });
        resolve();
      }, (err) => reject(new Error(`chat socket failed: ${err}`)));
    });
  }

  return {
    mode: 'live',
    async start(onMessage) {
      groupId = await resolveGroup();
      const res = await fetch(`${javaURI}/api/groups/chat/${groupId}/messages`, fetchOptions);
      if (res.ok) {
        (await res.json() || []).forEach((m) => onMessage({ sender: m.name, message: m.message, date: m.date }));
      }
      await loadScriptOnce(SOCKJS_SRC);
      await loadScriptOnce(STOMP_SRC);
      await connect(onMessage);
    },
    send({ sender, message }) {
      if (!connected) return false;
      const payload = { context: 'sendMessage', groupId, sender, message, image: null, date: new Date().toISOString() };
      client.send('/app/groups.chat', {}, JSON.stringify(payload));
      return true;
    },
    stop() {
      try { if (connected) client.disconnect(); } catch (_) { /* already closed */ }
      connected = false;
    },
  };
}
