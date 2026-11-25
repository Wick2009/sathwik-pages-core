// The editor's side of the canvas protocol (DESIGN §7.4). The canvas is a same-origin iframe of
// /ui-builder/canvas/?nonce=<n> that exposes window.OCSUiCanvas. The nonce makes the handshake
// race-free: the editor only talks to the canvas instance it loaded, never to a stale one or to
// another page the frame was navigated to. The canvas keeps no state, so every iframe load is
// handshaken again and gets its callbacks, the last render and the selection re-sent.
// A CanvasBridge is that connection, one per editor.

export const READY_EVENT = 'ocs:ui-canvas-ready';
// The section toolbar's actions the editor runs; anything else from the canvas is ignored.
export const SECTION_ACTIONS = Object.freeze(['edit', 'move_up', 'move_down', 'duplicate', 'remove']);
const NONCE = /^[a-z0-9]{16,64}$/;

// Values coming back from the canvas realm are read with typeof checks only.
const idOf = (value) => (typeof value === 'string' && value ? value : null);

// Reading another window's globals throws when it isn't same-origin (an error page, a link that
// escaped): that simply means "no canvas yet".
function canvasOf(iframe) {
  try {
    const win = iframe.contentWindow;
    const canvas = win && win.OCSUiCanvas;
    return canvas && typeof canvas === 'object' ? canvas : null;
  } catch (_) {
    return null;
  }
}

function matches(canvas, nonce) {
  return Boolean(canvas) && canvas.nonce === nonce && typeof canvas.render === 'function';
}

// Owns the iframe: loads it, handshakes on every load and re-sends the last render. Callbacks:
// onSelect(id|null), onHover(id|null), onAddRequest({sectionId, cellIndex}), onSectionAction(
// {sectionId, action}) from a section's toolbar, onAddSection({index}) from an Add section pill,
// onKey(keyEvent: the key fields plus nodeId, the part with focus), onStatus('loading'|'ready'|
// 'failed', error?).
export class CanvasBridge {
  static makeNonce(cryptoImpl = globalThis.crypto) {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  static canvasUrl(baseurl, nonce) {
    if (!NONCE.test(String(nonce))) throw new Error('UI Builder canvas: bad nonce');
    return `${String(baseurl || '').replace(/\/+$/, '')}/ui-builder/canvas/?nonce=${nonce}`;
  }

  // Resolves with the iframe's OCSUiCanvas once its nonce matches: at once if it is already there,
  // else when the canvas announces itself on the editor window. Rejects after timeoutMs.
  static waitForCanvas(iframe, { nonce, timeoutMs = 10000, win = globalThis.window, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const existing = canvasOf(iframe);
    if (matches(existing, nonce)) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = () => {
        clearTimer(timer);
        win.removeEventListener(READY_EVENT, onReady);
      };
      function onReady(event) {
        const detail = event && event.detail;
        if (!detail || detail.nonce !== nonce) return;
        const canvas = canvasOf(iframe);
        if (!canvas || detail.canvas !== canvas || !matches(canvas, nonce)) return;
        done();
        resolve(canvas);
      }
      win.addEventListener(READY_EVENT, onReady);
      timer = setTimer(() => {
        done();
        reject(Object.assign(new Error('UI Builder canvas: the canvas did not load'), { name: 'CanvasTimeout' }));
      }, timeoutMs);
    });
  }

  constructor({
    iframe, baseurl = '', win = globalThis.window, timeoutMs = 10000, nonceOf = () => CanvasBridge.makeNonce(),
    onSelect = () => {}, onHover = () => {}, onAddRequest = () => {}, onSectionAction = () => {}, onAddSection = () => {},
    onKey = () => {}, onStatus = () => {},
  } = {}) {
    this.iframe = iframe;
    this.baseurl = baseurl;
    this.win = win;
    this.timeoutMs = timeoutMs;
    this.nonceOf = nonceOf;
    this.onStatus = onStatus;
    this.nonce = null;
    this.canvas = null;
    this.attempt = 0;
    this.destroyed = false;
    this.last = null; // {specJson, options} of the newest render
    this.selectedId = null;
    // What the canvas may call. Nothing reaches the editor after destroy().
    this.callbacks = {
      select: (id) => { if (!this.destroyed) onSelect(idOf(id)); },
      hover: (id) => { if (!this.destroyed) onHover(idOf(id)); },
      add: (request) => {
        if (this.destroyed || !request || typeof request !== 'object') return;
        const sectionId = idOf(request.sectionId);
        const cellIndex = Number.isInteger(request.cellIndex) ? request.cellIndex : 0;
        if (sectionId) onAddRequest({ sectionId, cellIndex });
      },
      key: (event) => { if (!this.destroyed && event && typeof event === 'object') onKey(event); },
      sectionAction: (request) => {
        if (this.destroyed || !request || typeof request !== 'object') return;
        const sectionId = idOf(request.sectionId);
        const action = typeof request.action === 'string' && SECTION_ACTIONS.includes(request.action) ? request.action : null;
        if (sectionId && action) onSectionAction({ sectionId, action });
      },
      addSection: (request) => {
        if (this.destroyed || !request || typeof request !== 'object') return;
        if (Number.isInteger(request.index) && request.index >= 0) onAddSection({ index: request.index });
      },
    };
    this.onLoad = () => this.handshake();
    iframe.addEventListener('load', this.onLoad);
    this.load();
  }

  get ready() {
    return Boolean(this.canvas);
  }

  render(page, { realData = false, editable = true } = {}) {
    this.last = { specJson: JSON.stringify(page), options: { realData: realData === true, editable: editable !== false } };
    return this.canvas ? this.send(this.canvas) : Promise.resolve();
  }

  select(id) {
    this.selectedId = idOf(id);
    if (this.canvas) this.canvas.select(this.selectedId);
  }

  scrollTo(id) {
    if (this.canvas && idOf(id)) this.canvas.scrollTo(id);
  }

  focus() {
    try {
      this.iframe.focus();
      if (this.iframe.contentWindow) this.iframe.contentWindow.focus();
    } catch (_) {
      // the frame is mid-load or not ours; focusing the element is enough
    }
  }

  // A fresh nonce and a fresh load: the old canvas, if it answers at all, is no longer ours.
  reload() {
    this.load();
  }

  destroy() {
    this.destroyed = true;
    this.attempt += 1;
    this.iframe.removeEventListener('load', this.onLoad);
  }

  load() {
    this.nonce = this.nonceOf();
    this.canvas = null;
    this.iframe.src = CanvasBridge.canvasUrl(this.baseurl, this.nonce);
  }

  send(target) {
    if (!this.last) return Promise.resolve();
    return Promise.resolve(target.render(this.last.specJson, { ...this.last.options, selectedId: this.selectedId }))
      .catch((error) => this.onStatus('failed', error));
  }

  async handshake() {
    const mine = ++this.attempt;
    this.canvas = null;
    this.onStatus('loading');
    try {
      const found = await CanvasBridge.waitForCanvas(this.iframe, { nonce: this.nonce, timeoutMs: this.timeoutMs, win: this.win });
      if (mine !== this.attempt || this.destroyed) return;
      const { callbacks } = this;
      found.onSelect(callbacks.select);
      found.onHover(callbacks.hover);
      found.onAddRequest(callbacks.add);
      found.onKey(callbacks.key);
      // A canvas from before the Studio has no section toolbar to listen to.
      if (typeof found.onSectionAction === 'function') found.onSectionAction(callbacks.sectionAction);
      if (typeof found.onAddSection === 'function') found.onAddSection(callbacks.addSection);
      this.canvas = found;
      await this.send(found);
      if (mine === this.attempt && !this.destroyed) this.onStatus('ready');
    } catch (error) {
      if (mine === this.attempt && !this.destroyed) this.onStatus('failed', error);
    }
  }
}
