// The canvas (DESIGN §7.4): runs inside the editor's same-origin iframe at /ui-builder/canvas/ and
// draws the page the editor sends it. It is four objects:
// - BuilderCanvas, the canvas itself: draws each page the editor sends, marks the selection and
//   the part under the pointer, and reports clicks, hovers and keys. Its frozen api is
//   window.OCSUiCanvas = {nonce, render, select, scrollTo, onSelect, onHover, onAddRequest,
//   onSectionAction, onAddSection, onKey}.
// - SectionChrome, the Studio's chrome on the drawn page: each section's toolbar (Edit, Move up,
//   Move down, Duplicate, Remove) and an Add section pill above it, with one more after the last
//   section, add buttons in empty cells and a label on hidden parts.
// - BlockCache: blocks whose JSON didn't change keep their DOM (no image flicker, scroll stays).
// - RealDataPreview: live blocks show design samples; only "Data from your API" reads anything,
//   and only with "Real data while editing" on.
// The canvas keeps no state the editor can't resend: every render gets the whole page as a JSON
// string, parsed here in this window's own realm. Links and buttons in the page never act: a
// click selects what was clicked.
import { readRegistry, textOf } from './registry.js';
import { renderPage } from './render.js';
import { contentRenderers } from './blocks-content.js';
import { renderApiItems } from './blocks-project.js';
import { toDOM } from './vnode.js';
import { createRichHooks } from './rich-content.js';
import { doctor, fetchJson, listIn, mapItems } from './api-data.js';
import { isMacPlatform, isTypingTarget, keyEventOf, shortcutOf } from './editor-shortcuts.js';
import { READY_EVENT } from './canvas-bridge.js';

const NONCE = /^[a-z0-9]{16,64}$/;
const FETCH_DELAY_MS = 1000;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => (isObject(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined);
const listOf = (value) => (Array.isArray(value) ? value : []);

function closestNode(target) {
  for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
    const id = node.getAttribute('data-ui-node');
    if (id) return node;
  }
  return null;
}

function notice(doc, root, text) {
  const box = doc.createElement('div');
  box.className = 'ocs__container ocs__stack';
  const callout = doc.createElement('div');
  callout.className = 'ocs__callout';
  callout.textContent = text;
  box.appendChild(callout);
  root.replaceChildren(box);
}

// Class names are read and written as text, so the same code works on every element.
function setClass(element, name, on) {
  const names = String(element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const has = names.includes(name);
  if (on && !has) element.setAttribute('class', [...names, name].join(' '));
  if (!on && has) element.setAttribute('class', names.filter((other) => other !== name).join(' '));
}

// The Studio's chrome on the drawn page, in grammar classes (elements/toolbars): each section is
// an ocs__float-host with an ocs__toolbar and an Add section pill floating on its top edge. Its
// buttons only report what they are for (data-ui-* attributes); the editor runs the action.
export class SectionChrome {
  constructor({ doc, say }) {
    this.doc = doc;
    this.say = say;
  }

  // An ocs__btn with an icon, then its words, or (icon only) its name as aria-label and title.
  button({ iconName, label, attrs, words = false, accent = false }) {
    const button = this.doc.createElement('button');
    button.type = 'button';
    // ocs__btn--icon spaces the icon from the words (a flex button drops a leading space).
    button.className = accent ? 'ocs__btn ocs__btn--icon small accent fill' : 'ocs__btn ocs__btn--icon small';
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    const glyph = this.doc.createElement('i');
    glyph.className = `fa-solid ${iconName}`;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    if (words) button.append(this.doc.createTextNode(label));
    else {
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    return button;
  }

  // The add button in an empty cell (or in a section without cells).
  addButton(sectionId, cellIndex) {
    return this.button({
      iconName: 'fa-plus', label: this.say('canvas_add'), words: true,
      attrs: { 'data-ui-add': '', 'data-ui-add-section': sectionId, 'data-ui-add-cell': String(cellIndex) },
    });
  }

  // An Add section pill: floating on the top edge of the section at index, or, at the end, in a
  // row of its own after the last section.
  addSectionPill(index, { end = false } = {}) {
    const holder = this.doc.createElement('div');
    holder.className = end ? 'ocs__links' : 'ocs__float ocs__float--center';
    if (end) holder.setAttribute('data-ui-add-end', '');
    holder.setAttribute('data-ui-chrome', '');
    holder.append(this.button({ iconName: 'fa-plus', label: this.say('canvas_add_section'), words: true, accent: true, attrs: { 'data-ui-add-section-at': String(index) } }));
    return holder;
  }

  // A section's toolbar, on its top right corner.
  toolbar(sectionId, index, count) {
    const bar = this.doc.createElement('div');
    bar.className = 'ocs__toolbar ocs__float ocs__float--end';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', this.say('canvas_section_tools', { n: index + 1 }));
    bar.setAttribute('data-ui-chrome', '');
    const tool = (action, iconName, label, options = {}) => this.button({ iconName, label, ...options, attrs: { 'data-ui-section-act': action, 'data-ui-section': sectionId } });
    const up = tool('move_up', 'fa-arrow-up', this.say('move_up'));
    const down = tool('move_down', 'fa-arrow-down', this.say('move_down'));
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    bar.append(tool('edit', 'fa-pen', this.say('canvas_edit_section'), { words: true, accent: true }), up, down,
      tool('duplicate', 'fa-clone', this.say('duplicate')), tool('remove', 'fa-trash-can', this.say('remove')));
    return bar;
  }

  // Puts the chrome on the page drawn in root. Toolbars, pills and add buttons only while the
  // page can be edited (read only, someone else holds it, they would do nothing); the label on
  // hidden parts always.
  decorate(root, { editable = true } = {}) {
    const sections = editable ? [...root.querySelectorAll('[data-ui-kind="section"]')] : [];
    sections.forEach((section, index) => {
      const sectionId = section.getAttribute('data-ui-node');
      if (!sectionId) return;
      setClass(section, 'ocs__float-host', true);
      const first = section.firstChild;
      section.insertBefore(this.addSectionPill(index), first);
      section.insertBefore(this.toolbar(sectionId, index, sections.length), first);
    });
    const article = root.querySelector('[data-ui-page]');
    if (article && editable) article.append(this.addSectionPill(sections.length, { end: true }));
    for (const section of sections) {
      const sectionId = section.getAttribute('data-ui-node');
      if (!sectionId || section.hasAttribute('data-ui-error')) continue;
      const cells = [...section.children].filter((child) => child.hasAttribute('data-ui-cell'));
      const holders = cells.length ? cells : [section];
      holders.forEach((holder, index) => {
        if (!holder.querySelector('[data-ui-kind="block"]')) holder.appendChild(this.addButton(sectionId, index));
      });
    }
    for (const hidden of root.querySelectorAll('[data-ui-hidden]')) hidden.setAttribute('data-ui-hidden-label', this.say('canvas_hidden'));
  }
}

// Keeps the DOM of blocks whose JSON didn't change since the last render, as long as nothing
// every block depends on changed either.
export class BlockCache {
  // What each node's DOM depends on. A section's own settings and the order of its blocks (not
  // their content, so editing a block never rebuilds its neighbours); a block's whole JSON.
  static nodeHashes(page) {
    const out = new Map();
    for (const section of listOf(own(page, 'sections'))) {
      const id = own(section, 'id');
      if (typeof id !== 'string' || out.has(id)) continue;
      const cells = listOf(own(section, 'cells')).map((cell) => listOf(own(cell, 'blocks')).map((block) => own(block, 'id')));
      out.set(id, JSON.stringify([own(section, 'type'), own(section, 'settings'), own(section, 'hidden') === true, cells]));
      for (const cell of listOf(own(section, 'cells'))) {
        for (const block of listOf(own(cell, 'blocks'))) {
          const blockId = own(block, 'id');
          if (typeof blockId === 'string' && !out.has(blockId)) out.set(blockId, JSON.stringify(block));
        }
      }
    }
    return out;
  }

  // Everything every block depends on: the page's own settings (a calendar uses its course, the
  // width sets the container) and the real-data switch. A change here redraws every block.
  static contextKey(page, realData) {
    return JSON.stringify([own(page, 'page'), realData === true]);
  }

  constructor() {
    this.clear();
  }

  clear() {
    this.key = null;
    this.hashes = new Map();
    this.blocks = new Map();
  }

  // Puts the old DOM back in place of each freshly drawn block that didn't change.
  reuse(fresh, key, hashes) {
    if (key !== this.key || !fresh.querySelectorAll) return;
    const used = new Set();
    for (const element of fresh.querySelectorAll('[data-ui-kind="block"][data-ui-node]')) {
      const id = element.getAttribute('data-ui-node');
      const old = this.blocks.get(id);
      if (old && !used.has(old) && this.hashes.get(id) === hashes.get(id)) {
        element.replaceWith(old);
        used.add(old);
      }
    }
  }

  // Remembers the blocks now drawn in root, for the next render.
  remember(root, key, hashes) {
    const blocks = new Map();
    for (const element of root.querySelectorAll('[data-ui-kind="block"][data-ui-node]')) {
      const id = element.getAttribute('data-ui-node');
      if (id && !blocks.has(id)) blocks.set(id, element);
    }
    this.key = key;
    this.hashes = hashes;
    this.blocks = blocks;
  }

  block(id) {
    return this.blocks.get(id);
  }
}

// "Real data while editing": each Data from your API block shows what the published page would,
// read a second after its address last changed. Answers are kept by address until the switch is
// turned on again. view() says what the canvas shows now: {page, cache (its BlockCache), on}.
export class RealDataPreview {
  static apiBlocksOf(page) {
    const out = [];
    for (const section of listOf(own(page, 'sections'))) {
      for (const cell of listOf(own(section, 'cells'))) {
        for (const block of listOf(own(cell, 'blocks'))) {
          if (own(block, 'type') === 'api_data' && typeof own(block, 'id') === 'string') out.push(block);
        }
      }
    }
    return out;
  }

  // What the preview shows for one Data from your API block, from its fetchJson result: the
  // published page's own list rule (api-data.js listIn) and markup (blocks-project.js
  // renderApiItems), so the preview is what visitors will see. A failed read shows the saved
  // copy, if there is one, and the doctor's advice. ctx is the canvas render context.
  // → {view: vnode or null, status: text}
  static realDataView(result, block, ctx) {
    const { registry } = ctx;
    const settings = isObject(own(block, 'settings')) ? block.settings : {};
    const source = isObject(own(settings, 'source')) ? settings.source : {};
    const limit = Number.isInteger(settings.limit) ? Math.min(Math.max(settings.limit, 1), 50) : 12;
    if (result.ok) {
      const cookieDomain = own(registry.security, 'cookie_domain');
      const items = mapItems(listIn(result.json, source.list_path), source, {
        limit, itemChars: (registry.limits || {}).api_item_chars || 500, baseurl: ctx.baseurl, pageOrigin: ctx.pageOrigin,
        cookieDomain: typeof cookieDomain === 'string' ? cookieDomain : '', sourceUrl: result.url,
      });
      const view = renderApiItems(items, settings, ctx);
      return { view, status: view ? '' : textOf(registry, 'blocks.api_empty') };
    }
    const problem = doctor(result, { url: source.url, pageOrigin: ctx.pageOrigin }).find((line) => line.level === 'error');
    return {
      view: renderApiItems(listOf(own(source.snapshot, 'items')).slice(0, limit), settings, ctx),
      status: problem ? textOf(registry, `doctor.${problem.key}`, problem.vars) : '',
    };
  }

  constructor({ ctx, doc, win, say, limits = {}, view }) {
    this.ctx = ctx;
    this.doc = doc;
    this.win = win;
    this.say = say;
    this.limits = limits;
    this.view = view;
    this.results = new Map();
    this.timers = new Map();
    this.wanted = new Map();
  }

  // Switching on reads the APIs again.
  restart() {
    this.results.clear();
  }

  paintBlock(element, block) {
    const settings = isObject(block.settings) ? block.settings : {};
    const source = isObject(settings.source) ? settings.source : {};
    const mount = element.querySelector('[data-ui-live-mount]');
    const status = element.querySelector('[data-ui-live-status]');
    const entry = this.results.get(String(source.url || '').trim());
    if (!mount || !status || !entry) return;
    if (entry.loading) {
      status.textContent = this.say('canvas_real_loading');
      return;
    }
    // Once the API has answered, the sample gives way to what visitors would see, even nothing.
    const { view, status: line } = RealDataPreview.realDataView(entry.result, block, this.ctx);
    mount.replaceChildren(...(view ? [toDOM(view, { doc: this.doc })] : []));
    status.textContent = line;
  }

  fetchSource(url) {
    if (this.results.has(url)) return;
    this.results.set(url, { loading: true });
    const { win, limits } = this;
    fetchJson(url, {
      mode: 'canvas', pageHost: win.location.hostname, pageProtocol: win.location.protocol,
      timeoutMs: limits.api_timeout_ms || 8000, maxChars: limits.api_max_chars || 512000,
    }).then((result) => {
      this.results.set(url, { result });
      if (this.view().on) this.paint();
    });
  }

  // One fetch per change of a block's source, a second after the last change to it.
  paint() {
    const { page, cache } = this.view();
    for (const block of RealDataPreview.apiBlocksOf(page)) {
      const element = cache.block(block.id);
      const url = String(own(own(own(block, 'settings'), 'source'), 'url') || '').trim();
      if (!element || !url) continue;
      if (this.results.has(url)) {
        this.paintBlock(element, block);
        continue;
      }
      if (this.wanted.get(block.id) === url && this.timers.has(block.id)) continue;
      clearTimeout(this.timers.get(block.id));
      this.wanted.set(block.id, url);
      this.timers.set(block.id, setTimeout(() => {
        this.timers.delete(block.id);
        this.fetchSource(url);
        if (this.view().on) this.paint();
      }, FETCH_DELAY_MS));
    }
  }
}

export class BuilderCanvas {
  static readNonce(search) {
    const nonce = new URLSearchParams(String(search || '')).get('nonce');
    return nonce && NONCE.test(nonce) ? nonce : null;
  }

  // Only under a parent window of this same origin: anywhere else the canvas would hand its API
  // to a page it doesn't know. Reading a cross-origin parent's location throws.
  static canvasAllowed(win) {
    try {
      return Boolean(win) && win.parent !== win && win.parent.location.origin === win.location.origin;
    } catch (_) {
      return false;
    }
  }

  // The part of the page a key was pressed in, sent with the key so Delete or a move acts on what
  // has focus: the id of the block or section around the focused element, '' on an add button or
  // an Add section pill (no part to act on) and null when nothing in the page has focus (the
  // editor's selection then).
  static keyPartOf(target) {
    if (!target || target.nodeType !== 1) return null;
    if (target.closest('[data-ui-add], [data-ui-add-section-at]')) return '';
    const node = target.closest('[data-ui-node]');
    return node ? node.getAttribute('data-ui-node') : null;
  }

  // The canvas page's start (pages/canvas.md): under the editor's frame, a canvas that listens
  // and has told the editor it is there; anywhere else only a note, and null.
  static start({ root, richText, baseurl = '', win = globalThis.window, doc = globalThis.document } = {}) {
    if (!root) throw new Error('UI Builder canvas: root is required');
    const registry = readRegistry(doc);
    const nonce = BuilderCanvas.readNonce(win.location.search);
    if (!nonce || !BuilderCanvas.canvasAllowed(win)) {
      notice(doc, root, textOf(registry, 'editor.canvas_only'));
      return null;
    }
    const canvas = new BuilderCanvas({ root, registry, nonce, richText, baseurl, win, doc });
    canvas.listen();
    canvas.announce();
    return canvas;
  }

  constructor({ root, registry, nonce, richText, baseurl = '', win = globalThis.window, doc = globalThis.document }) {
    this.root = root;
    this.registry = registry;
    this.nonce = nonce;
    this.win = win;
    this.doc = doc;
    this.say = (key, vars) => textOf(registry, `editor.${key}`, vars);
    this.limits = registry.limits || {};
    const pageOrigin = win.location.origin;
    this.hooks = createRichHooks({ richText, baseurl, pageOrigin, doc });
    this.ctx = { registry, mode: 'canvas', baseurl, pageOrigin, renderers: contentRenderers };
    this.handlers = { select: null, hover: null, add: null, key: null, sectionAction: null, addSection: null };
    this.chrome = new SectionChrome({ doc, say: this.say });
    this.cache = new BlockCache();
    this.real = new RealDataPreview({
      ctx: this.ctx, doc, win, say: this.say, limits: this.limits,
      view: () => ({ page: this.page, cache: this.cache, on: this.realData }),
    });
    this.page = null;
    this.realData = false;
    this.selectedId = null;
    this.hoverId = null;
    this.mac = isMacPlatform(win.navigator);
    // All the editor gets: these, bound to this canvas, frozen so neither side can swap one.
    this.api = Object.freeze({
      nonce,
      render: (specJson, options) => this.render(specJson, options),
      select: (id) => this.select(id),
      scrollTo: (id) => this.scrollTo(id),
      onSelect: (fn) => this.on('select', fn),
      onHover: (fn) => this.on('hover', fn),
      onAddRequest: (fn) => this.on('add', fn),
      onSectionAction: (fn) => this.on('sectionAction', fn),
      onAddSection: (fn) => this.on('addSection', fn),
      onKey: (fn) => this.on('key', fn),
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, value) {
    const fn = this.handlers[name];
    if (typeof fn !== 'function') return;
    try {
      fn(value);
    } catch (error) {
      console.error('UI Builder canvas: the editor callback failed', error);
    }
  }

  find(id) {
    if (typeof id !== 'string' || !id) return null;
    return [...this.root.querySelectorAll('[data-ui-node]')].find((node) => node.getAttribute('data-ui-node') === id) || null;
  }

  // Moves an attribute (data-ui-selected, data-ui-hover) to the part with this id, if any.
  mark(attribute, id) {
    for (const element of this.root.querySelectorAll(`[${attribute}]`)) element.removeAttribute(attribute);
    const element = this.find(id);
    if (element) element.setAttribute(attribute, '');
    return element;
  }

  // The chosen part is outlined; a chosen section also shows its toolbar and pill (is-active on
  // its ocs__float-host).
  showSelection() {
    const element = this.mark('data-ui-selected', this.selectedId);
    for (const section of this.root.querySelectorAll('[data-ui-kind="section"]')) setClass(section, 'is-active', section === element);
  }

  render(specJson, options = {}) {
    let page;
    try {
      page = typeof specJson === 'string' ? JSON.parse(specJson) : null;
    } catch (error) {
      page = null;
    }
    if (!isObject(page)) return this.fail(this.say('canvas_bad_page', { message: 'JSON' }));
    const realData = own(options, 'realData') === true;
    if (realData && !this.realData) this.real.restart();
    this.selectedId = typeof own(options, 'selectedId') === 'string' ? options.selectedId : null;
    const key = BlockCache.contextKey(page, realData);
    const hashes = BlockCache.nodeHashes(page);
    let fresh;
    try {
      fresh = toDOM(renderPage(page, this.ctx), { doc: this.doc, renderRich: this.hooks.renderRich });
    } catch (error) {
      console.error('UI Builder canvas: the page could not be drawn', error);
      return this.fail(this.say('canvas_bad_page', { message: error && error.message ? error.message : '' }));
    }
    this.cache.reuse(fresh, key, hashes);
    const scroller = this.doc.scrollingElement || this.doc.documentElement;
    const top = scroller.scrollTop;
    this.root.replaceChildren(fresh);
    scroller.scrollTop = top;
    this.cache.remember(this.root, key, hashes);
    this.page = page;
    this.realData = realData;
    this.chrome.decorate(this.root, { editable: own(options, 'editable') !== false });
    this.showSelection();
    this.mark('data-ui-hover', this.hoverId);
    if (realData) this.real.paint();
    return Promise.resolve();
  }

  // A page the renderer can't read at all (blocks have their own error boundaries): a note
  // instead, and nothing kept for the next render.
  fail(text) {
    notice(this.doc, this.root, text);
    this.cache.clear();
    this.page = null;
    return Promise.resolve();
  }

  select(id) {
    this.selectedId = typeof id === 'string' && id ? id : null;
    this.showSelection();
  }

  scrollTo(id) {
    const element = this.find(id);
    const reduceMotion = Boolean(this.win.matchMedia && this.win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (element) element.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    const sectionAct = target && target.closest('[data-ui-section-act]');
    if (sectionAct) {
      if (!sectionAct.disabled) this.emit('sectionAction', { sectionId: sectionAct.getAttribute('data-ui-section'), action: sectionAct.getAttribute('data-ui-section-act') });
      return;
    }
    const addAt = target && target.closest('[data-ui-add-section-at]');
    if (addAt) {
      this.emit('addSection', { index: Number(addAt.getAttribute('data-ui-add-section-at')) });
      return;
    }
    const add = target && target.closest('[data-ui-add]');
    if (add) {
      this.emit('add', { sectionId: add.getAttribute('data-ui-add-section'), cellIndex: Number(add.getAttribute('data-ui-add-cell')) || 0 });
      return;
    }
    const node = closestNode(target);
    this.emit('select', node ? node.getAttribute('data-ui-node') : null);
  }

  handleOver(event) {
    const node = closestNode(event.target);
    const id = node ? node.getAttribute('data-ui-node') : null;
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.mark('data-ui-hover', id);
    this.emit('hover', id);
  }

  handleKey(event) {
    if (isTypingTarget(event.target)) return;
    if (!shortcutOf(event, { mac: this.mac })) return;
    // The editor runs the shortcut; nothing in the canvas (or a site script) may act on it too.
    event.preventDefault();
    event.stopPropagation();
    this.emit('key', { ...keyEventOf(event), nodeId: BuilderCanvas.keyPartOf(event.target) });
  }

  // Listens on the whole document in the capture phase, so nothing in the page (or a site
  // script) acts on a click, a drag, a submit or a shortcut first.
  listen() {
    const { doc, win } = this;
    const stop = (event) => event.preventDefault();
    doc.addEventListener('click', (event) => this.handleClick(event), true);
    doc.addEventListener('auxclick', stop, true);
    doc.addEventListener('dragstart', stop, true);
    doc.addEventListener('submit', stop, true);
    doc.addEventListener('mouseover', (event) => this.handleOver(event), true);
    doc.documentElement.addEventListener('mouseleave', () => this.handleOver({ target: null }));
    win.addEventListener('keydown', (event) => this.handleKey(event), true);
  }

  // Hands the api to the editor: on this window, and in a ready event on the editor's window.
  announce() {
    this.win.OCSUiCanvas = this.api;
    const parent = this.win.parent;
    parent.dispatchEvent(new parent.CustomEvent(READY_EVENT, { detail: { nonce: this.nonce, canvas: this.api } }));
  }
}
