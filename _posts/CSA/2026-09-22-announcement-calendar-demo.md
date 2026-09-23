---
layout: post
title: Announcements + Calendar (demo)
description: >
  Two skeleton versions of putting calendar events straight into the class
  announcements, side by side, plus a week view that works with either, so we
  can pick one to build out.
permalink: /csa/announcement-calendar
course: csa
comments: false
---

## Why

With Slack, a post like `[Thu]: Live Reviews` in the class channel landed on the [class calendar]({{site.baseurl}}/student/calendar) by itself ([how that worked]({{site.baseurl}}/docs/calendar)). Announcements now live on the course site ([chat migration]({{site.baseurl}}/csa/chat-migration)), and that link didn't come with them. These demos bring it back. Each one reuses the calendar endpoints the backend already has, so none of them needs backend changes.

## The two versions

Switch between them with the tabs. Use **View as** to see the teacher view and the student view.

| | How the teacher adds an event | Best for |
|---|---|---|
| **V1: Add-to-calendar button** | Write the announcement, click **Add to calendar**, pick a date, type and priority, then Send | One-off events such as a quiz, a deadline or a guest speaker |
| **V2: Quick syntax** | Type `[Mon]: Title` lines, the same format as Slack. Asterisks set the priority (`*` = P1, `**` = P0). Detected events appear as chips you can switch off | Posting a whole week's plan at once |

In both versions, an announcement that carries an event shows a card with a **View on OCS calendar** button. Teachers also get **Remove from calendar**.

**Week view** is a toggle in the announcements header that works with either version. It pins this school week above the feed, including holidays from the school calendar. Click an event in it to jump to the announcement that created it.

**Preview** (the default) uses a sample week stored in your browser, so nothing reaches the class or the real calendar. **Reset** restores the sample. **Live** needs a sign-in. It posts to a separate `csa-announcements-demo` chat and adds real events to the CSA calendar.

{% include announcement_calendar_demo.html course="csa" %}

## Questions for feedback

- Which version fits how you plan the week? Would a mix of V1 and V2 work?
- Should Week view be on by default, or something students turn on?
- Should students be able to post in announcements, or should it be teacher-only, with questions going to week chat?
- Do events need a time of day? Right now they're all-day, because that's what the calendar backend stores.
- Should deleting an announcement also remove its event?

## Known limits of the skeleton

- Only the UI enforces teacher-only. The backend doesn't check roles on the calendar or chat endpoints yet.
- Events are all-day. Priority is stored as a `[P0]`–`[P3]` title prefix, which is how the calendar page reads it.
- The link between an announcement and its event is a hidden text marker inside the message. It works with today's chat backend without schema changes.
