// Renders the announcement log. Markup and grouping (day separators,
// consecutive-sender collapsing, avatars) mirror _includes/announcement_chat.html
// so the existing .announcement-chat styles apply unchanged. The one addition:
// event markers are stripped from the text and handed to `renderEvents`.

import { renderRichMessage } from '../rich-text.js';
import { extractEventMarkers } from './event-marker.js';

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayLabel(date) {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tintFor(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `tint-${(hash % 5) + 1}`;
}

export function createChatFeed({ messagesEl, getSelfName, renderEvents }) {
  const emptyHtml = messagesEl.innerHTML;
  let seen = new Set();
  let cursor = { day: null, sender: null, time: 0 };
  const messageListeners = new Set();

  function clearEmpty() {
    messagesEl.querySelector('.chat-empty')?.remove();
  }

  function append({ sender, message, date }) {
    const key = [sender, date, message].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    clearEmpty();

    const { html, events } = extractEventMarkers(message);
    const when = date ? new Date(date) : null;
    const isSelf = sender === getSelfName();
    const who = isSelf ? 'You' : (sender || 'Unknown');
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;

    if (when && String(startOfDay(when)) !== cursor.day) {
      const separator = document.createElement('div');
      separator.className = 'chat-day';
      separator.setAttribute('role', 'separator');
      separator.textContent = dayLabel(when);
      messagesEl.appendChild(separator);
      cursor = { day: String(startOfDay(when)), sender: null, time: 0 };
    }
    const continued = who === cursor.sender && when && (when.getTime() - cursor.time) < 5 * 60 * 1000;

    const row = document.createElement('div');
    row.className = ['chat-msg', isSelf && 'is-self', continued && 'is-continued'].filter(Boolean).join(' ');
    if (events.length) row.dataset.eventIds = events.map((e) => e.id).join(' ');

    const avatar = document.createElement('span');
    avatar.className = ['chat-avatar', !isSelf && tintFor(who)].filter(Boolean).join(' ');
    avatar.textContent = initialsFor(isSelf ? getSelfName() : who);
    avatar.setAttribute('aria-hidden', 'true');

    const main = document.createElement('div');
    main.className = 'chat-msg-main';
    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';
    const senderEl = document.createElement('span');
    senderEl.className = 'chat-msg-sender';
    senderEl.textContent = who;
    meta.appendChild(senderEl);
    if (when) {
      const timeEl = document.createElement('span');
      timeEl.className = 'chat-msg-time';
      timeEl.textContent = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      meta.appendChild(timeEl);
    }

    const body = document.createElement('span');
    body.className = 'chat-msg-body';
    renderRichMessage(body, html);
    main.append(meta, body);
    if (events.length) main.appendChild(renderEvents(events));

    row.append(avatar, main);
    messagesEl.appendChild(row);
    cursor.sender = who;
    cursor.time = when ? when.getTime() : 0;
    if (wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    messageListeners.forEach((listener) => listener({ sender, events }));
  }

  function appendSystem(text) {
    clearEmpty();
    const el = document.createElement('p');
    el.className = 'chat-system';
    el.textContent = text;
    messagesEl.appendChild(el);
    cursor.sender = null;
  }

  function reset() {
    messagesEl.innerHTML = emptyHtml;
    seen = new Set();
    cursor = { day: null, sender: null, time: 0 };
  }

  // Scroll to (and flash) the announcement that created a calendar event.
  function revealEvent(eventId) {
    const row = [...messagesEl.querySelectorAll('[data-event-ids]')]
      .find((el) => el.dataset.eventIds.split(' ').includes(String(eventId)));
    if (!row) return false;
    messagesEl.scrollTop += row.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top - 16;
    row.classList.remove('is-flash');
    void row.offsetWidth; // restart the animation
    row.classList.add('is-flash');
    return true;
  }

  return {
    append,
    appendSystem,
    reset,
    revealEvent,
    onMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
  };
}
