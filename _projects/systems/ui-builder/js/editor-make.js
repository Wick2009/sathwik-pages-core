// "What are you making?" (Studio, plans/2026-11-13-ui-builder-studio.md): the start screen's
// first step for a new page. The student picks the page their class needs (registry page_kinds:
// Capstone page, N@tM booth, CSP team project, Sprint review), fills a short form (registry
// blueprint.fields, drawn with the inspector's own field widgets), and Build my page hands the
// kind and answers to actions.build, which lays the page out from the kind's section presets.
import { kindsOf, missingAnswers } from './blueprint.js';
import { createFieldWidget, el, icon } from './editor-fields.js';

const listOf = (value) => (Array.isArray(value) ? value : []);
const KIND_CLASS = 'ocs__hub-card ocs__stack ui-builder-kind';

// actions: build(kindKey, answers), blank(), message(text, {error}).
export function createMakePanel({ doc = globalThis.document, registry, say, text, actions }) {
  const kinds = kindsOf(registry);
  const fields = listOf(registry.blueprint && registry.blueprint.fields);
  let chosen = kinds[0] ? kinds[0].key : null;
  const answers = {};
  let counter = 0;

  const kindCards = new Map();
  const formTitle = el(doc, 'h2', { class: 'ocs__section-title', id: 'ui-make-form-title' }, '');
  const kindGroup = el(doc, 'div', { class: 'ocs__hub-grid ui-builder-kinds', role: 'radiogroup', 'aria-label': say('make_kinds') });

  function pick(key, { focus = false } = {}) {
    chosen = key;
    for (const [name, card] of kindCards) {
      const on = name === key;
      card.className = `${KIND_CLASS}${on ? ' ocs__hub-card--selected' : ''}`;
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
      if (on && focus) card.focus();
    }
    const kind = kinds.find((item) => item.key === key);
    formTitle.textContent = say('make_form_title', { kind: kind ? kind.label : '' });
  }

  kinds.forEach((kind, index) => {
    // A radio drawn as a card (a div, not a button: it holds a title and two paragraphs). The
    // whole card is the control; arrow keys move between them, Space or Enter picks.
    const card = el(doc, 'div', { role: 'radio', tabindex: '-1', class: KIND_CLASS, 'data-kind': kind.key, onclick: () => pick(kind.key) },
      el(doc, 'span', { class: 'ui-builder-kind-icon', 'aria-hidden': 'true' }, icon(doc, kind.icon || 'fa-file')),
      el(doc, 'strong', { class: 'ocs__hub-card-title' }, kind.label),
      el(doc, 'p', { class: 'ocs__text' }, kind.help || ''),
      el(doc, 'p', { class: 'ui-builder-note' }, say('make_sections', { count: listOf(kind.sections).length })));
    card.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        pick(kind.key);
        return;
      }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      pick(kinds[(index + step + kinds.length) % kinds.length].key, { focus: true });
    });
    kindCards.set(kind.key, card);
    kindGroup.appendChild(card);
  });

  // The form: one inspector widget per field. Every change only updates answers.
  const widgets = new Map();
  // The course list's empty choice: "Pick a course" here ("The page's course" means a block's).
  const formSay = (key, vars) => say(key === 'course_page' ? 'course_none' : key, vars);
  const ctx = {
    doc, say: formSay, text, registry, readOnly: false, nextId: () => `ui-make-${(counter += 1)}`,
    courses: registry.courses || [], listMax: (registry.limits || {}).list_max || 20, services: {},
  };
  const grid = el(doc, 'div', { class: 'ui-builder-make-fields' });
  for (const field of fields) {
    answers[field.id] = field.type === 'items' ? [] : '';
    const widget = createFieldWidget(field, { ...ctx, value: answers[field.id], settings: answers, onChange: (value) => { answers[field.id] = value; widget.setIssues([]); } });
    widgets.set(field.id, widget);
    grid.appendChild(el(doc, 'div', { class: field.type === 'items' || field.type === 'textarea' ? 'ui-builder-make-wide' : null }, widget.element));
  }

  const build = el(doc, 'button', { type: 'button', class: 'ocs__btn ocs__btn--icon accent fill', onclick: () => {
    const missing = missingAnswers(registry, answers);
    if (missing.length) {
      for (const id of missing) widgets.get(id).setIssues([{ path: '', message: say('make_required') }]);
      widgets.get(missing[0]).focus();
      actions.message(say('make_missing'), { error: true });
      return;
    }
    if (chosen) actions.build(chosen, { ...answers });
  } }, icon(doc, 'fa-wand-magic-sparkles'), say('make_build'));
  const blank = el(doc, 'button', { type: 'button', class: 'ocs__btn', onclick: () => actions.blank() }, say('make_blank'));

  const form = el(doc, 'section', { class: 'ocs__card ocs__stack', 'aria-labelledby': 'ui-make-form-title' },
    formTitle, el(doc, 'p', { class: 'ocs__text' }, say('make_form_lead')), grid,
    el(doc, 'div', { class: 'ocs__links' }, build, blank));

  const element = el(doc, 'div', { class: 'ocs__stack' },
    el(doc, 'p', { class: 'ocs__text' }, say('make_lead')), kindGroup, form);
  if (chosen) pick(chosen);
  return {
    element,
    pick,
    // Tests and the app read what would be built.
    get kind() { return chosen; },
    get answers() { return { ...answers }; },
  };
}
