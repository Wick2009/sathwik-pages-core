// The section library (Studio, plans/2026-11-13-ui-builder-studio.md): what Add section opens,
// like a site builder's section picker. Categories down the left (Blank first, then the school
// pack's: Intro, Our client, Board and plan …), and each category's sections drawn small on the
// right with the real renderer, already filled with the page's own facts. A section this site or
// page can't take stays listed, its Add button disabled, with the reason. Picking one resolves
// with {kind: 'frame', type, layout} or {kind: 'preset', key}.
import { normalizePage } from './page-model.js';
import { renderPage } from './render.js';
import { contentRenderers } from './blocks-content.js';
import { toDOM } from './vnode.js';
import { textOf } from './registry.js';
import { libraryOf, presetSection } from './section-presets.js';
import { sectionChoices } from './editor-palette.js';
import { el, icon } from './editor-fields.js';

const THUMB_WIDTH = 960;

// Ids for sections that are only drawn, never saved.
function drawIds() {
  let n = 0;
  return (kind) => `${kind}-l${String((n += 1)).padStart(5, '0')}`;
}

export function createSectionLibrary({ doc = globalThis.document, registry, say, dialogs, baseurl = '', pageOrigin = '', renderRich }) {
  const view = doc.defaultView;
  const fit = (frame) => frame.style.setProperty('--ui-thumb-scale', String(Math.max(0.05, frame.clientWidth / THUMB_WIDTH)));

  // One section drawn at 960px inside a window scaled to the card (the start screen's thumbnail).
  function thumbnail(raw, observer) {
    const frame = el(doc, 'div', { class: 'ui-builder-thumb ui-builder-thumb--section', 'aria-hidden': 'true' });
    frame.inert = true;
    try {
      const page = normalizePage({ page: { title: '' }, sections: [raw] }, registry, { ids: drawIds() });
      const tree = renderPage(page, { registry, mode: 'canvas', baseurl, pageOrigin, renderers: contentRenderers });
      frame.appendChild(el(doc, 'div', { class: 'ui-builder-thumb-page' }, toDOM(tree, { doc, renderRich })));
    } catch (error) {
      console.error('UI Builder: a section could not be drawn', error);
    }
    if (observer) observer.observe(frame);
    else view.requestAnimationFrame(() => fit(frame));
    return frame;
  }

  function blankRaw(item) {
    return { type: item.type, settings: item.layout ? { layout: item.layout } : {}, cells: [] };
  }

  // capabilities: {spring, flask}; liveCount: live blocks already on the page; answers: the page's
  // own facts (section-presets.js answersFromPage) to fill the drawn sections with.
  function open({ capabilities = {}, liveCount = 0, answers = {} } = {}) {
    const groups = libraryOf(registry, {
      capabilities, liveCount,
      blankChoices: sectionChoices(registry, say), blankLabel: say('library_blank'),
    });
    // The first category that has a section the page can take opens first: Intro on a new page.
    let current = (groups.find((group) => group.category !== 'blank' && group.items.some((item) => !item.disabled)) || groups[0] || {}).category;
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target))) : null;
    const nav = el(doc, 'div', { class: 'ui-builder-library-nav', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': say('library_categories') });
    const grid = el(doc, 'div', { class: 'ocs__hub-grid ui-builder-library-grid', role: 'tabpanel', tabindex: '-1' });
    const tabs = new Map();
    const cards = new Map(); // item key → its card, drawn once per open
    let dialog = null;

    function card(item) {
      const raw = item.kind === 'frame' ? blankRaw(item) : presetSection(registry, item.key, answers);
      const reason = item.disabled ? textOf(registry, item.reasonKey, { max: (registry.limits || {}).live_blocks }) : '';
      const add = el(doc, 'button', {
        type: 'button', class: 'ocs__btn small accent fill', disabled: item.disabled,
        'aria-label': say('library_add', { label: item.label }),
        onclick: () => dialog.finish(item.kind === 'frame' ? { kind: 'frame', type: item.type, layout: item.layout } : { kind: 'preset', key: item.key }),
      }, say('library_add_short'));
      const node = el(doc, 'div', { class: 'ocs__hub-card ocs__stack', 'data-library-item': item.key, 'aria-disabled': item.disabled ? 'true' : null },
        raw && item.kind === 'preset' ? thumbnail(raw, observer) : el(doc, 'div', { class: 'ui-builder-library-blank', 'aria-hidden': 'true' }, icon(doc, item.icon || 'fa-square')),
        el(doc, 'strong', { class: 'ocs__hub-card-title' }, item.label),
        el(doc, 'p', null, item.disabled ? say('palette_reason', { reason }) : (item.help || '')),
        el(doc, 'div', { class: 'ocs__links' }, add));
      // The whole card is a pointer target; the button is the keyboard and screen reader one.
      if (!item.disabled) node.addEventListener('click', (event) => { if (event.target !== add) add.click(); });
      return node;
    }

    function show(category, { focus = false } = {}) {
      current = category;
      for (const [key, tab] of tabs) {
        const on = key === category;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        tab.className = on ? 'ocs__btn small accent fill' : 'ocs__btn small';
        if (on && focus) tab.focus();
      }
      const group = groups.find((item) => item.category === category);
      grid.setAttribute('aria-label', group ? group.label : '');
      if (observer) observer.disconnect();
      const shown = (group ? group.items : []).map((item) => {
        if (!cards.has(item.key)) cards.set(item.key, card(item));
        return cards.get(item.key);
      });
      grid.replaceChildren(...shown);
      if (observer) for (const frame of grid.querySelectorAll('.ui-builder-thumb')) observer.observe(frame);
      grid.scrollTop = 0;
    }

    groups.forEach((group, index) => {
      const tab = el(doc, 'button', { type: 'button', role: 'tab', 'data-category': group.category, onclick: () => show(group.category) }, group.label);
      tab.addEventListener('keydown', (event) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (step) {
          event.preventDefault();
          show(groups[(index + step + groups.length) % groups.length].category, { focus: true });
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          show(groups[event.key === 'Home' ? 0 : groups.length - 1].category, { focus: true });
        }
      });
      tabs.set(group.category, tab);
      nav.appendChild(tab);
    });
    show(current);

    const lead = el(doc, 'p', { class: 'ocs__text', id: `ui-library-lead-${Date.now().toString(36)}` }, say('library_lead'));
    dialog = dialogs.open({
      title: say('library_title'), body: [lead, el(doc, 'div', { class: 'ui-builder-library' }, nav, grid)],
      describedBy: lead.id, focus: () => tabs.get(current),
    });
    dialog.card.classList.add('ui-builder-library-card');
    return dialog.result.finally(() => { if (observer) observer.disconnect(); });
  }

  return { open };
}
