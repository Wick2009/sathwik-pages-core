// Replies and threads for class chat: the rules, with no DOM.
//
// A message is { id, name, message, date, edited, deleted, replyToId, threadId,
// alsoInChannel }, the same fields the Spring group chat stores
// (GroupChatMessage). replyToId quotes another message in the main chat
// (Discord-style reply). threadId puts the message in the thread under a
// top-level message (Slack-style). alsoInChannel shows a thread reply in the
// main chat too. Thread summaries are worked out from the loaded history, so
// the backend needs no extra endpoints.

export function normalizeMessage(raw) {
  const threadId = raw.threadId || null;
  return {
    id: String(raw.id ?? raw.messageId ?? ''),
    name: raw.name ?? raw.sender ?? 'Unknown',
    message: raw.message ?? '',
    date: raw.date ?? null,
    edited: Boolean(raw.edited),
    deleted: Boolean(raw.deleted),
    replyToId: raw.replyToId || null,
    threadId,
    alsoInChannel: Boolean(threadId && raw.alsoInChannel),
  };
}

export function findMessage(messages, id) {
  return id ? messages.find((m) => m.id === id) || null : null;
}

// The main chat: top-level messages, plus thread replies also sent to it.
export function channelMessages(messages) {
  return messages.filter((m) => !m.threadId || m.alsoInChannel);
}

export function threadReplies(messages, rootId) {
  return messages.filter((m) => m.threadId === rootId);
}

// What the main chat shows under a message that has a thread, or null.
// Participants are the most recent repliers first, at most three.
export function threadSummary(messages, rootId) {
  const replies = threadReplies(messages, rootId);
  if (!replies.length) return null;
  const participants = [];
  for (let i = replies.length - 1; i >= 0 && participants.length < 3; i -= 1) {
    if (!participants.includes(replies[i].name)) participants.push(replies[i].name);
  }
  return { count: replies.length, lastDate: replies[replies.length - 1].date, participants };
}

// Same rules as the backend (GroupChatService.checkLinks): a reply quotes a
// message that exists, and a thread hangs off a top-level message.
export function linkProblem(messages, { replyToId, threadId }) {
  if (replyToId && !findMessage(messages, replyToId)) return 'The message you replied to no longer exists.';
  if (!threadId) return null;
  const root = findMessage(messages, threadId);
  if (!root) return 'That thread no longer exists.';
  if (root.threadId) return 'Threads can’t be nested.';
  return null;
}

export function applyAdd(messages, message) {
  return messages.some((m) => m.id === message.id)
    ? messages.map((m) => (m.id === message.id ? message : m))
    : [...messages, message];
}

export function applyEdit(messages, id, html) {
  return messages.map((m) => (m.id === id && !m.deleted ? { ...m, message: html, edited: true } : m));
}

// Same rule as the backend: a message with thread replies stays as "deleted"
// so its thread survives; anything else is removed.
export function applyDelete(messages, id) {
  if (messages.some((m) => m.threadId === id)) {
    return messages.map((m) => (m.id === id ? { ...m, deleted: true, message: '' } : m));
  }
  return messages.filter((m) => m.id !== id);
}

// The message ↑ edits: your latest one in this chat or thread.
export function lastOwnMessage(messages, name, threadId = null) {
  const inPlace = threadId ? threadReplies(messages, threadId) : channelMessages(messages);
  for (let i = inPlace.length - 1; i >= 0; i -= 1) {
    if (inPlace[i].name === name && !inPlace[i].deleted) return inPlace[i];
  }
  return null;
}

const ENTITIES = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

// One line of plain text from a message's HTML, for quotes and the replying bar.
export function snippet(html, max = 90) {
  const text = String(html || '')
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// "just now", "5 min ago", "3 hr ago", "yesterday", or a date.
export function relativeTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((now - date) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60 && date.getDate() === now.getDate()) return `${Math.round(minutes / 60)} hr ago`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date >= yesterday) return 'yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
