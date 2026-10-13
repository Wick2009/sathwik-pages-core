---
layout: post
title: Replies and threads (demo)
description: >
  Discord-style replies and Slack-style threads for the class chats, as one
  working demo, so we can settle how they should work before they go into
  the real announcements.
permalink: /csa/chat-threads
course: csa
comments: false
lesson_group: "cs112"
articulation: {"institution":"MiraCosta College","course":"CS112"}
categories: []
---

## Why

A question about one announcement gets its answer at the bottom of the chat, far from the message it's about. After a few of those, nobody can tell which answer goes with which question. Students already know two fixes from apps they use every day.

## How it works

| | From | What it does | Use it for |
|---|---|---|---|
| **Reply** | Discord | Posts in the main chat with a quote line above it. Click the quote to jump to the original. | A short answer everyone should see |
| **Thread** | Slack | Opens a side panel on that one message. The main chat only shows "3 replies · Last reply 5 min ago" under it. | Questions about one announcement |

Hover a message (or tab to it) to see its actions: **Reply**, **Reply in thread**, and on your own messages **Edit** and **Delete**.

- In a thread, **Also send to CSA Announcements** posts the reply in the main chat too, marked "replied to a thread".
- **Esc** cancels a reply or an edit, or closes the thread. **↑** in an empty message box edits your last message.
- A deleted message that has a thread stays as "This message was deleted." so its thread survives.

## Try it

**Preview** (the default) is a sample conversation stored in your browser. **Post as** switches between the teacher and a student, so one person can play both sides. **Reset** restores the sample.

**Live** needs a sign-in. It posts to a separate demo chat, `csa-threads-demo`, not the real announcements. Open the page in a second browser with another account to see replies and threads arrive in real time.

{% include chat_threads_demo.html course="csa" %}

## Questions for feedback

- Do we want both, or only threads? Replies are quicker; threads keep the chat tidier.
- On announcements, should students start threads, or only answer in threads the teacher starts?
- Should a thread reply notify the person who posted the message?
- Which chats get it first: announcements, week chats, lesson chats or DMs?

## What changes behind it

Each message can carry three optional fields: `replyToId` (the message it quotes), `threadId` (the message whose thread it's in) and `alsoInChannel`. The Spring backend stores them and rejects links to messages that aren't in the chat, or a thread inside a thread. There are no new endpoints: the page works out thread summaries from the chat history it already loads. Old messages have none of the fields, so they still show as plain messages.
