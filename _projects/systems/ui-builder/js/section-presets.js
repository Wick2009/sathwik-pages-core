// The section library (Add section) and the fill that "What are you making?" shares with it.
// Pure and DOM-free. A preset (registry section_presets) is one ordinary section of existing
// blocks, written in the registry with {placeholders}. presetSection() fills them from the quick
// form's answers, the way each field's type needs (rich text escaped, table cells kept to one
// cell), and returns a raw section for page-model insertSections() to check and give ids.
import { defOf, liveTypes } from './registry.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);
const own = (value, key) => (isObject(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined);
const textOrEmpty = (value) => (typeof value === 'string' ? value.trim() : '');

const PLACEHOLDER = /\{(\w+)\}/g;
const PEOPLE = '{people}';
// Answers that are links: no fallback words, an empty one leaves its button out.
const LINK_VARS = new Set(['repo', 'board', 'site']);
// GitHub's username rule: letters, digits and single hyphens, not at either end, at most 39.
const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

const escapeHTML = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A table cell is split on | and a row ends at a line break, so an answer stays one cell.
const tableCell = (text) => text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/');

export function presetOf(registry, key) {
  return listOf(registry.section_presets).find((preset) => isObject(preset) && preset.key === key) || null;
}

// Every block type a section holds, in order, repeats kept (they count toward the live limit).
export function sectionBlockTypes(section) {
  return listOf(own(section, 'cells')).flatMap((cell) => listOf(own(cell, 'blocks')).map((block) => own(block, 'type')))
    .filter((type) => typeof type === 'string');
}

// Why this site or page can't take a section: a block that needs Spring or Flask the site lacks,
// or more live blocks than the page has room for. null when it can.
export function presetReason(registry, section, { capabilities = {}, liveCount = 0 } = {}) {
  const live = liveTypes(registry);
  const types = sectionBlockTypes(section);
  for (const type of types) {
    const def = defOf(registry, 'block', type);
    if (def && def.needs === 'spring' && !capabilities.spring) return 'blocks.live_needs_spring';
    if (def && def.needs === 'flask' && !capabilities.flask) return 'blocks.live_needs_flask';
  }
  const adds = types.filter((type) => live.has(type)).length;
  if (adds && liveCount + adds > ((registry.limits || {}).live_blocks || 0)) return 'errors.too_many_live';
  return null;
}

// The library: a Blank group (one column, and columns per layout, from blankChoices) first, then
// each category in registry order with its presets. Items that can't go on this page stay listed,
// disabled, with the reason's text key.
export function libraryOf(registry, { capabilities = {}, liveCount = 0, blankChoices = [], blankLabel = '' } = {}) {
  const groups = [];
  if (blankChoices.length) {
    groups.push({ category: 'blank', label: blankLabel, items: blankChoices.map((choice) => ({ ...choice, kind: 'frame', key: `blank:${choice.type}:${choice.layout || ''}`, disabled: false, reasonKey: null })) });
  }
  for (const category of listOf(registry.section_categories)) {
    const items = listOf(registry.section_presets).filter((preset) => preset.category === category.key).map((preset) => {
      const reasonKey = presetReason(registry, preset.section, { capabilities, liveCount });
      return { kind: 'preset', key: preset.key, label: preset.label, help: preset.help || '', icon: preset.icon || 'fa-square', disabled: reasonKey !== null, reasonKey };
    });
    if (items.length) groups.push({ category: category.key, label: category.label, items });
  }
  return groups;
}

// The words each placeholder becomes: the answer, else the registry's fallback (links have none).
export function placeholderValues(registry, answers = {}) {
  const fallbacks = isObject(registry.blueprint) && isObject(registry.blueprint.fallbacks) ? registry.blueprint.fallbacks : {};
  const values = {};
  const keys = new Set([...Object.keys(fallbacks), ...Object.keys(isObject(answers) ? answers : {})]);
  for (const key of keys) {
    if (key === 'people') continue;
    const answer = textOrEmpty(own(answers, key));
    const fallback = LINK_VARS.has(key) ? '' : textOrEmpty(own(fallbacks, key));
    values[key] = answer || fallback;
  }
  return values;
}

function fillText(template, values, format) {
  if (typeof template !== 'string') return template;
  return template.replace(PLACEHOLDER, (match, name) => (Object.prototype.hasOwnProperty.call(values, name) ? format(values[name]) : match));
}

const hasPlaceholder = (text) => typeof text === 'string' && /\{\w+\}/.test(text);

// The quick form's people as the Team block's items: name (or the username), role, and the
// GitHub profile as the link when the username is a real one.
export function peopleItems(field, people) {
  const ids = new Set(listOf(field && field.item_fields).map((sub) => sub.id));
  const max = Number.isInteger(field && field.max_items) ? field.max_items : 8;
  return listOf(people).map((person) => {
    const name = textOrEmpty(own(person, 'name'));
    const github = textOrEmpty(own(person, 'github')).replace(/^@/, '');
    const item = {};
    if (ids.has('name')) item.name = name || github;
    if (ids.has('role')) item.role = textOrEmpty(own(person, 'role'));
    if (ids.has('url')) item.url = GITHUB_USER.test(github) ? `https://github.com/${github}` : '';
    return item;
  }).filter((item) => item.name).slice(0, max);
}

function fillValue(field, value, values, answers) {
  if (!field) return value;
  switch (field.type) {
    case 'richtext': return fillText(value, values, escapeHTML);
    case 'table': return fillText(value, values, tableCell);
    case 'url':
    case 'image': return typeof value === 'string' ? fillText(value, values, (v) => v).trim() : value;
    case 'links':
      // A button whose link was an answer left empty is dropped, not drawn with no address.
      return listOf(value).filter(isObject).map((link) => ({
        label: fillText(own(link, 'label'), values, (v) => v),
        url: typeof own(link, 'url') === 'string' ? fillText(link.url, values, (v) => v).trim() : '',
        template: own(link, 'url'),
      })).filter((link) => !(hasPlaceholder(link.template) && !link.url)).map(({ label, url }) => ({ label, url }));
    case 'items':
      if (value === PEOPLE) return peopleItems(field, own(answers, 'people'));
      return listOf(value).filter(isObject).map((item) => fillFields(field.item_fields, item, values, answers));
    case 'choice':
    case 'course':
    case 'text':
    case 'textarea':
      return fillText(value, values, (v) => v);
    default:
      return value;
  }
}

function fillFields(fields, settings, values, answers) {
  if (!isObject(settings)) return {};
  const out = {};
  const defs = new Map(listOf(fields).map((field) => [field.id, field]));
  for (const [key, value] of Object.entries(settings)) {
    if (key === '__proto__') continue;
    out[key] = fillValue(defs.get(key), value, values, answers);
  }
  return out;
}

// People who were actually listed (a name or a GitHub username), else the registry's sample
// rows, so a Team section never arrives empty.
function peopleOrSamples(registry, people) {
  const listed = listOf(people).filter((person) => textOrEmpty(own(person, 'name')) || textOrEmpty(own(person, 'github')));
  if (listed.length) return listed;
  const fallbacks = isObject(registry.blueprint) && isObject(registry.blueprint.fallbacks) ? registry.blueprint.fallbacks : {};
  return listOf(fallbacks.people).filter(isObject);
}

// A raw section with every placeholder filled: frame settings, then each block's settings by
// its fields. Unknown frames and blocks pass through for normalizePage to drop.
export function fillSection(registry, section, rawAnswers = {}) {
  if (!isObject(section)) return null;
  const answers = { ...(isObject(rawAnswers) ? rawAnswers : {}), people: peopleOrSamples(registry, own(rawAnswers, 'people')) };
  const values = placeholderValues(registry, answers);
  const frame = defOf(registry, 'frame', section.type);
  return {
    type: section.type,
    settings: fillFields(frame ? frame.fields : [], own(section, 'settings'), values, answers),
    cells: listOf(own(section, 'cells')).map((cell) => ({
      blocks: listOf(own(cell, 'blocks')).filter(isObject).map((block) => {
        const def = defOf(registry, 'block', block.type);
        return { type: block.type, settings: fillFields(def ? def.fields : [], own(block, 'settings'), values, answers) };
      }),
    })),
  };
}

// One preset as a filled raw section, or null for an unknown key.
export function presetSection(registry, key, answers = {}) {
  const preset = presetOf(registry, key);
  return preset ? fillSection(registry, preset.section, answers) : null;
}

// What the page already says, as quick-form answers, so a section added later is filled with the
// team's facts: title, byline, description and course from the page settings; the board from a
// Kanban block; the repository and site from links; people from a Team block.
const REPO_LINK = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/;
const PROFILE_LINK = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/?$/;
export function answersFromPage(page) {
  const settings = isObject(own(page, 'page')) ? page.page : {};
  const answers = {
    project: textOrEmpty(own(settings, 'title')),
    team: textOrEmpty(own(settings, 'byline')),
    mission: textOrEmpty(own(settings, 'description')),
    course: textOrEmpty(own(settings, 'course')),
    repo: '', board: '', site: '', people: [],
  };
  answers.course_label = answers.course ? answers.course.toUpperCase() : '';
  const blocks = listOf(own(page, 'sections')).flatMap((section) => listOf(own(section, 'cells')).flatMap((cell) => listOf(own(cell, 'blocks'))));
  for (const block of blocks) {
    const s = isObject(own(block, 'settings')) ? block.settings : {};
    if (block.type === 'kanban' && !answers.board) answers.board = textOrEmpty(own(s, 'url'));
    if (block.type === 'team' && !answers.people.length) {
      answers.people = listOf(own(s, 'items')).filter(isObject).map((item) => {
        const profile = PROFILE_LINK.exec(textOrEmpty(item.url));
        return { name: textOrEmpty(item.name), role: textOrEmpty(item.role), github: profile ? profile[1] : '' };
      });
    }
    for (const link of [...listOf(own(s, 'links')), ...listOf(own(s, 'items'))]) {
      const url = textOrEmpty(own(link, 'url'));
      if (!url) continue;
      if (REPO_LINK.test(url) && !answers.repo) answers.repo = url;
      else if (block.type === 'hero' && /^https:\/\//.test(url) && !url.startsWith('https://github.com/') && !answers.site) answers.site = url;
    }
  }
  return answers;
}
