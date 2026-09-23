// The event fields a teacher can set, shared by both composer versions so the
// V1 form and the V2 quick syntax stay equivalent: same types, same priorities.
// `tags` are the #words quick syntax accepts for each type (first one is shown in help).

export const EVENT_TYPES = [
  { value: 'event', label: 'Event', tags: ['event'] },
  { value: 'daily plan', label: 'Daily plan', tags: ['plan', 'daily-plan'] },
  { value: 'assignment', label: 'Due', tags: ['due', 'assignment'] },
  { value: 'check-in', label: 'Check-in', tags: ['check-in', 'checkin'] },
  { value: 'grade', label: 'Graded', tags: ['graded', 'grade'] },
];

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const DEFAULT_PRIORITY = 'P2';

export const TYPE_LABELS = Object.fromEntries(EVENT_TYPES.map((type) => [type.value, type.label]));
