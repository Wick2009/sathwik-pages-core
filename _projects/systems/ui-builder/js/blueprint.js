// "What are you making?" (DESIGN: plans/2026-11-13-ui-builder-studio.md): a page kind (registry
// page_kinds: Capstone page, N@tM booth, CSP team project, Sprint review) plus the quick form's
// answers → a raw page document, every section a filled preset. Pure and DOM-free; the editor
// passes the result to page-model normalizePage, which checks it and gives every part an id.
import { PAGE_KIND, SCHEMA_VERSION } from './page-rules.js';
import { courseOptions, liveTypes } from './registry.js';
import { placeholderValues, presetReason, presetSection, sectionBlockTypes } from './section-presets.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);
const own = (value, key) => (isObject(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined);
const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

export function kindsOf(registry) {
  return listOf(registry.page_kinds).filter((kind) => isObject(kind) && typeof kind.key === 'string');
}

export function kindOf(registry, key) {
  return kindsOf(registry).find((kind) => kind.key === key) || null;
}

// The form's answers as plain trimmed text, people as {name, role, github} rows with a name or a
// username (at most the field's max_items), and a course the registry knows, or none.
export function cleanAnswers(registry, raw = {}) {
  const fields = listOf(isObject(registry.blueprint) ? registry.blueprint.fields : []);
  const out = {};
  for (const field of fields) {
    if (field.type === 'items') {
      const max = Number.isInteger(field.max_items) ? field.max_items : 8;
      out[field.id] = listOf(own(raw, field.id)).filter(isObject).map((row) => {
        const item = {};
        for (const sub of listOf(field.item_fields)) item[sub.id] = textOf(own(row, sub.id));
        return item;
      }).filter((item) => Object.values(item).some(Boolean)).slice(0, max);
    } else if (field.type === 'course') {
      const value = textOf(own(raw, field.id));
      out[field.id] = courseOptions(registry).some((course) => course.value === value) ? value : '';
    } else {
      out[field.id] = textOf(own(raw, field.id));
    }
  }
  return out;
}

// What a page needs before it's built: a project name. Returns the missing field ids.
export function missingAnswers(registry, answers) {
  return listOf(isObject(registry.blueprint) ? registry.blueprint.fields : [])
    .filter((field) => field.required && field.type !== 'items' && !textOf(own(answers, field.id)))
    .map((field) => field.id);
}

// The page: its settings from the answers, then the kind's sections in order. A section this site
// can't run (a block that needs Spring on a Flask-only site) is left out, as the library would
// show it disabled. capabilities: {spring, flask}.
export function blueprintPage(registry, kindKey, rawAnswers = {}, { capabilities = {} } = {}) {
  const kind = kindOf(registry, kindKey);
  if (!kind) throw new Error(`UI Builder blueprint: unknown page kind ${String(kindKey)}`);
  const answers = cleanAnswers(registry, rawAnswers);
  // The course's short name for badges ("CSP").
  const fill = { ...answers, course_label: (answers.course || '').toUpperCase(), kind_badge: textOf(kind.badge) };
  const values = placeholderValues(registry, fill);
  const sections = [];
  const live = liveTypes(registry);
  let liveCount = 0;
  for (const key of listOf(kind.sections)) {
    const section = presetSection(registry, key, fill);
    if (!section || presetReason(registry, section, { capabilities, liveCount }) !== null) continue;
    liveCount += sectionBlockTypes(section).filter((type) => live.has(type)).length;
    sections.push(section);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: PAGE_KIND,
    page: {
      title: values.project || '',
      description: answers.mission || '',
      byline: answers.team || '',
      course: answers.course || '',
      width: 'contained',
      image: '',
    },
    sections,
  };
}
