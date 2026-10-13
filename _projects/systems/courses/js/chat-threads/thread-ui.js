// The chat view for replies and threads: message rows with a hover toolbar,
// Discord-style reply quotes, Slack-style thread summaries and a thread side
// panel, and a "Replying to" bar over each composer. Rendering only: the
// caller owns the data source and passes the actions (send, edit, remove).
//
// Rows reuse the announcement chat's classes (chat-msg, chat-avatar, …) so a
// threaded chat looks like the real one. What those classes can't do lives in
// the threads element, _sass/open-coding/elements/threads.

import { createRichComposer, renderDeletedMessage, renderRichMessage } from '../rich-text.js';
import {
  applyAdd, applyDelete, applyEdit, channelMessages, findMessage, lastOwnMessage,
  relativeTime, snippet, threadReplies, threadSummary,
} from './thread-model.js';

const FLASH_MS = 1600;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name) {
  const i = el('i', `fas ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function button(className, label, onClick) {
  const b = el('button', className);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayLabel(date) {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function divider(text) {
  const row = el('div', 'chat-day', text);
  row.setAttribute('role', 'separator');
  return row;
}

// Same initials and per-sender tint as the announcement chat.
function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tintFor(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return `tint-${(hash % 5) + 1}`;
}

// Person.pfp is a path/URL or raw base64 with no "data:" prefix.
function pfpSrc(pfp) {
  if (!pfp) return null;
  if (/^(https?:)?\/\//.test(pfp) || pfp.startsWith('/') || pfp.startsWith('data:')) return pfp;
  return `data:image/png;base64,${pfp}`;
}

function avatar(name, { isSelf = false, pfp = null } = {}) {
  const node = el('span', isSelf ? 'chat-avatar' : `chat-avatar ${tintFor(name)}`);
  node.setAttribute('aria-hidden', 'true');
  const src = isSelf ? pfpSrc(pfp) : null;
  if (src) {
    const img = el('img');
    img.src = src;
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); node.textContent = initialsFor(name); }, { once: true });
    node.appendChild(img);
  } else {
    node.textContent = initialsFor(name);
  }
  return node;
}

// container: an element to fill. title: the chat's name ("CSA Announcements").
// me(): { name, pfp } of whoever is posting. actions: send({ message,
// replyToId, threadId, alsoInChannel }), edit(id, html) and remove(id), each
// resolving to true, or an error message to show. emptyAction: an optional
// { label, onClick } button for an empty chat.
export function mountThreadedChat({ container, title, me, actions, emptyAction = null }) {
  let messages = [];
  let openThreadId = null;
  let enabled = true;

  const layout = el('div', 'ocs__thread-layout');
  const main = el('div', 'ocs__thread-main');
  const channelLog = el('div', 'chat-messages');
  channelLog.setAttribute('role', 'log');
  channelLog.setAttribute('aria-live', 'polite');
  channelLog.setAttribute('aria-label', `${title} messages`);
  const channel = createComposerArea({ placeholder: `Message ${title}…`, inThread: false });
  main.append(channelLog, channel.root);

  const panel = el('aside', 'ocs__thread-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Thread');
  const panelHeader = el('div', 'ocs__thread-panel-header');
  const back = button('ocs__btn small pill ocs__thread-back', 'Back to the main chat', () => closeThread());
  back.append(icon('fa-arrow-left'), ' Back');
  const heading = el('div');
  heading.append(el('h3', 'ocs__thread-panel-title', 'Thread'), el('span', 'ocs__team-label', `in ${title}`));
  const close = button('ocs__btn small pill', 'Close thread (Esc)', () => closeThread());
  close.append(icon('fa-times'));
  panelHeader.append(back, heading, close);
  const threadLog = el('div', 'chat-messages');
  threadLog.setAttribute('role', 'log');
  threadLog.setAttribute('aria-live', 'polite');
  threadLog.setAttribute('aria-label', 'Thread messages');
  const thread = createComposerArea({ placeholder: 'Reply in thread…', inThread: true });
  panel.append(panelHeader, threadLog, thread.root);

  layout.append(main, panel);
  container.replaceChildren(layout);

  /* ── Composers ──────────────────────────────────────────────────── */

  function createComposerArea({ placeholder, inThread }) {
    const area = { inThread, replyTo: null, editingId: null, busy: false };
    area.root = el('div', 'ocs__thread-composer');
    area.bar = el('div');
    area.form = el('form', 'chat-form chat-form--rich');
    area.form.autocomplete = 'off';
    area.composer = createRichComposer({ placeholder, maxLength: 2000, onSubmit: () => submit(area) });
    area.send = el('button', 'chat-send');
    area.send.type = 'submit';
    area.form.append(area.composer.element, area.send);
    area.form.addEventListener('submit', (e) => { e.preventDefault(); submit(area); });
    area.composer.element.addEventListener('keydown', (e) => onComposerKey(area, e));
    area.root.append(area.bar, area.form);
    if (inThread) {
      const toggle = el('label', 'ocs__toggle ocs__thread-also');
      area.also = el('input', 'ocs__toggle-input');
      area.also.type = 'checkbox';
      const track = el('span', 'ocs__toggle-track');
      track.setAttribute('aria-hidden', 'true');
      toggle.append(area.also, track, el('span', 'ocs__toggle-label', `Also send to ${title}`));
      area.root.append(toggle);
    }
    area.status = el('p', 'dm-form-status');
    area.status.setAttribute('role', 'alert');
    area.status.hidden = true;
    area.root.append(area.status);
    updateSendButton(area);
    return area;
  }

  function updateSendButton(area) {
    const editing = Boolean(area.editingId);
    area.send.replaceChildren(icon(editing ? 'fa-save' : 'fa-paper-plane'), el('span', '', editing ? 'Save' : 'Send'));
    area.send.disabled = !enabled;
  }

  function showStatus(area, text) {
    area.status.textContent = text || '';
    area.status.hidden = !text;
  }

  // The bar over a composer: "Replying to Ava · One per group?" or "Editing your message".
  function renderBar(area) {
    const target = findMessage(messages, area.editingId || area.replyTo);
    if (!target || target.deleted) {
      if (area.editingId) area.composer.clear();
      area.editingId = null;
      area.replyTo = null;
    }
    area.bar.replaceChildren();
    if (!area.editingId && !area.replyTo) { updateSendButton(area); return; }

    const bar = el('div', 'ocs__callout ocs__reply-bar');
    const text = el('span', 'ocs__reply-bar-text');
    if (area.editingId) {
      text.append('Editing your message');
    } else {
      text.append('Replying to ', el('strong', '', target.name));
      const quote = snippet(target.message, 70);
      if (quote) text.append(` · ${quote}`);
    }
    const cancel = button('ocs__btn small pill', 'Cancel (Esc)', () => { cancelMode(area); area.composer.focus(); });
    cancel.textContent = 'Cancel';
    bar.append(icon(area.editingId ? 'fa-pen' : 'fa-reply'), text, cancel);
    area.bar.append(bar);
    updateSendButton(area);
  }

  function startReply(area, message) {
    if (area.editingId) area.composer.clear();
    area.editingId = null;
    area.replyTo = message.id;
    renderBar(area);
    area.composer.focus();
  }

  function startEdit(area, message) {
    area.replyTo = null;
    area.editingId = message.id;
    area.composer.setHTML(message.message || '');
    showStatus(area, '');
    renderBar(area);
    area.composer.focus();
    // Caret at the end of the old text, as in Discord and Slack.
    const range = document.createRange();
    range.selectNodeContents(area.composer.editor);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }

  function cancelMode(area) {
    if (area.editingId) area.composer.clear();
    area.editingId = null;
    area.replyTo = null;
    showStatus(area, '');
    renderBar(area);
  }

  function onComposerKey(area, e) {
    if (e.key === 'Escape') {
      if (area.editingId || area.replyTo) {
        e.preventDefault();
        cancelMode(area);
      } else if (area.inThread) {
        e.preventDefault();
        closeThread();
      }
    } else if (e.key === 'ArrowUp' && !area.editingId && area.composer.isEmpty()) {
      // ↑ in an empty composer edits your last message, as in Discord and Slack.
      const mine = lastOwnMessage(messages, me().name, area.inThread ? openThreadId : null);
      if (mine) {
        e.preventDefault();
        startEdit(area, mine);
      }
    }
  }

  async function submit(area) {
    if (!enabled || area.busy || area.composer.isEmpty() || area.composer.isOverLimit()) return;
    if (area.inThread && !openThreadId) return;
    const html = area.composer.getHTML();
    area.busy = true;
    showStatus(area, '');
    try {
      if (area.editingId) {
        const result = await actions.edit(area.editingId, html);
        if (result === true) cancelMode(area);
        else showStatus(area, typeof result === 'string' ? result : 'Could not save your edit. Try again.');
        return;
      }
      const result = await actions.send({
        message: html,
        replyToId: area.replyTo,
        threadId: area.inThread ? openThreadId : null,
        alsoInChannel: Boolean(area.inThread && area.also.checked),
      });
      if (result === true) {
        area.composer.clear();
        area.replyTo = null;
        if (area.also) area.also.checked = false;
        renderBar(area);
      } else {
        showStatus(area, typeof result === 'string' ? result : 'Could not send. Try again.');
      }
    } finally {
      area.busy = false;
    }
  }

  async function removeMessage(area, message) {
    if (!window.confirm('Delete this message? This can’t be undone.')) return;
    const result = await actions.remove(message.id);
    if (result !== true) showStatus(area, typeof result === 'string' ? result : 'Could not delete the message. Try again.');
  }

  /* ── Message rows ───────────────────────────────────────────────── */

  // Discord-style quote line above a reply. Clicking it jumps to the original.
  function replyRef(message, inThread) {
    const target = findMessage(messages, message.replyToId);
    if (!target || target.deleted) {
      const missing = el('span', 'ocs__reply-ref is-missing');
      missing.append(el('span', 'ocs__reply-ref-text', 'Original message was deleted'));
      return missing;
    }
    const quote = snippet(target.message);
    const ref = button('ocs__reply-ref', `Show the message from ${target.name} this replies to: ${quote}`, () => jumpTo(target.id, inThread));
    const self = target.name === me().name;
    ref.append(avatar(target.name, { isSelf: self, pfp: self ? me().pfp : null }), el('strong', '', target.name),
      el('span', 'ocs__reply-ref-text', quote));
    return ref;
  }

  // Slack's "replied to a thread" line on a thread reply also sent to the main chat.
  function threadOrigin(message) {
    const root = findMessage(messages, message.threadId);
    let rootText = 'a message';
    if (root) rootText = root.deleted ? 'a deleted message' : snippet(root.message, 70);
    const line = button('ocs__reply-ref ocs__reply-ref--thread', `Open the thread this replied in: ${rootText}`,
      () => openThread(message.threadId, { flashId: message.id }));
    line.append(icon('fa-comment-dots'), el('span', '', 'replied to a thread:'), el('span', 'ocs__reply-ref-text', rootText));
    return line;
  }

  function summaryButton(message, summary) {
    const replies = `${summary.count} ${summary.count === 1 ? 'reply' : 'replies'}`;
    const last = relativeTime(summary.lastDate);
    const b = button('ocs__thread-summary', `Open thread: ${replies}, last reply ${last}`, () => openThread(message.id));
    b.setAttribute('aria-expanded', String(openThreadId === message.id));
    const faces = el('span', 'ocs__thread-summary-avatars');
    summary.participants.forEach((name) => {
      const self = name === me().name;
      faces.append(avatar(name, { isSelf: self, pfp: self ? me().pfp : null }));
    });
    b.append(faces, el('span', 'ocs__thread-summary-count', replies), el('span', 'ocs__thread-summary-last', `Last reply ${last}`));
    return b;
  }

  function toolbar(message, { inThread, self }) {
    const area = inThread ? thread : channel;
    const bar = el('div', 'ocs__msg-toolbar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Message actions');
    const reply = button('', 'Reply', () => startReply(area, message));
    reply.append(icon('fa-reply'));
    bar.append(reply);
    if (!inThread) {
      // A thread reply shown in the main chat opens its own thread.
      const rootId = message.threadId || message.id;
      const label = message.threadId ? 'View thread' : 'Reply in thread';
      const open = button('', label, () => openThread(rootId, { flashId: message.threadId ? message.id : null }));
      open.append(icon('fa-comment-dots'));
      bar.append(open);
    }
    if (self) {
      const edit = button('', 'Edit', () => startEdit(area, message));
      edit.append(icon('fa-pen'));
      const del = button('', 'Delete', () => removeMessage(area, message));
      del.append(icon('fa-trash'));
      bar.append(edit, del);
    }
    return bar;
  }

  function renderRow(message, { inThread }) {
    const self = message.name === me().name;
    const row = el('div', 'chat-msg ocs__thread-msg');
    row.dataset.messageId = message.id;
    // Focusable by a tap but not by Tab, so touch screens can show the toolbar.
    row.tabIndex = -1;
    if (self) row.classList.add('is-self');
    if (message.deleted) row.classList.add('is-deleted');
    if (!inThread && message.id === openThreadId) row.classList.add('is-thread-open');

    const body = el('div', 'chat-msg-main');
    // The quote line goes last, right above the name, so its connector meets the avatar.
    const refs = [];
    if (!inThread && message.alsoInChannel) refs.push(threadOrigin(message));
    if (message.replyToId) refs.push(replyRef(message, inThread));
    if (refs.length) row.dataset.refs = String(refs.length);

    const meta = el('div', 'chat-msg-meta');
    meta.append(el('span', 'chat-msg-sender', message.name));
    const when = new Date(message.date);
    if (!Number.isNaN(when.getTime())) {
      const time = el('time', 'chat-msg-time', formatTime(when));
      time.dateTime = message.date;
      meta.append(time);
    }
    if (message.edited && !message.deleted) meta.append(el('span', 'chat-msg-edited', '(edited)'));

    const text = el('span', 'chat-msg-body');
    if (message.deleted) renderDeletedMessage(text);
    else renderRichMessage(text, message.message);

    body.append(...refs, meta, text);
    if (!inThread && !message.threadId) {
      const summary = threadSummary(messages, message.id);
      if (summary) body.append(summaryButton(message, summary));
    }

    row.append(avatar(message.name, { isSelf: self, pfp: self ? me().pfp : null }), body);
    if (!message.deleted) row.append(toolbar(message, { inThread, self }));
    return row;
  }

  /* ── Logs ───────────────────────────────────────────────────────── */

  // Rebuilds a log, staying pinned to the bottom only if the reader was there.
  function fillLog(log, nodes) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const top = log.scrollTop;
    log.replaceChildren(...nodes);
    log.scrollTop = atBottom ? log.scrollHeight : top;
  }

  function emptyState() {
    const empty = el('div', 'chat-empty');
    empty.append(icon('fa-comments'), el('p', 'chat-empty-title', 'No messages yet'),
      el('span', 'chat-empty-hint', 'Messages, replies and threads will appear here.'));
    if (emptyAction) {
      const action = button('ocs__btn small pill accent fill', emptyAction.label, emptyAction.onClick);
      action.textContent = emptyAction.label;
      empty.append(action);
    }
    return empty;
  }

  function renderChannel() {
    const list = channelMessages(messages);
    if (!list.length) { fillLog(channelLog, [emptyState()]); return; }
    const nodes = [];
    let lastDay = null;
    list.forEach((message) => {
      const when = new Date(message.date);
      if (!Number.isNaN(when.getTime()) && startOfDay(when) !== lastDay) {
        lastDay = startOfDay(when);
        nodes.push(divider(dayLabel(when)));
      }
      nodes.push(renderRow(message, { inThread: false }));
    });
    fillLog(channelLog, nodes);
  }

  function renderThread() {
    const root = findMessage(messages, openThreadId);
    if (!root) { closeThread(); return; }
    const replies = threadReplies(messages, root.id);
    const count = replies.length ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'No replies yet';
    fillLog(threadLog, [
      renderRow(root, { inThread: true }),
      divider(count),
      ...replies.map((reply) => renderRow(reply, { inThread: true })),
    ]);
  }

  function render() {
    renderChannel();
    if (openThreadId) renderThread();
    renderBar(channel);
    renderBar(thread);
  }

  // Scrolls a row to the middle of its log (not the page) and highlights it.
  function flash(log, id) {
    const row = log.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!row) return false;
    const offset = row.getBoundingClientRect().top - log.getBoundingClientRect().top;
    log.scrollTop += offset - (log.clientHeight - row.offsetHeight) / 2;
    row.classList.remove('is-flash');
    void row.offsetWidth; // restart the highlight if it's already running
    row.classList.add('is-flash');
    window.setTimeout(() => row.classList.remove('is-flash'), FLASH_MS);
    return true;
  }

  function jumpTo(id, fromThread) {
    const target = findMessage(messages, id);
    if (!target) return;
    if (fromThread && flash(threadLog, id)) return;
    if (flash(channelLog, id)) return;
    if (target.threadId) openThread(target.threadId, { flashId: id });
  }

  /* ── Thread panel ───────────────────────────────────────────────── */

  function openThread(rootId, { flashId = null } = {}) {
    if (openThreadId !== rootId) cancelMode(thread);
    openThreadId = rootId;
    panel.hidden = false;
    layout.classList.add('is-thread-open');
    render();
    threadLog.scrollTop = threadLog.scrollHeight;
    if (flashId) flash(threadLog, flashId);
    thread.composer.focus();
  }

  function closeThread() {
    const wasOpen = openThreadId;
    openThreadId = null;
    panel.hidden = true;
    layout.classList.remove('is-thread-open');
    cancelMode(thread);
    render();
    // Put focus back on the thread's summary in the main chat, if it has one.
    const summary = wasOpen && channelLog.querySelector(`[data-message-id="${CSS.escape(wasOpen)}"] .ocs__thread-summary`);
    if (summary) summary.focus();
    else channel.composer.focus();
  }

  return {
    setMessages(list) {
      messages = list.slice();
      if (openThreadId && !findMessage(messages, openThreadId)) closeThread();
      else render();
    },
    add(message) { messages = applyAdd(messages, message); render(); },
    edit(id, html) { messages = applyEdit(messages, id, html); render(); },
    remove(id) { messages = applyDelete(messages, id); render(); },
    // Re-renders after me() changes (the demo's "Post as" switch).
    refresh() { render(); },
    setEnabled(on) {
      enabled = on;
      [channel, thread].forEach((area) => { area.composer.setEnabled(on); updateSendButton(area); });
    },
    showError(text) { showStatus(openThreadId ? thread : channel, text); },
    closeThread,
    get messages() { return messages; },
  };
}
