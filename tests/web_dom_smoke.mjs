/**
 * Boots the game against the real index.html markup.
 *
 * The main smoke test uses a stub DOM that invents an element for whatever id the game asks for, so
 * a typo like `menu-play-lable` would pass there. Here the id list is read out of index.html and
 * `getElementById` returns null for anything else, exactly like a browser. Any id the code expects
 * but the markup does not define shows up as a crash (or as a menu that will not open).
 *
 *   node tests/web_dom_smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual(duplicates, [], 'no duplicate ids in the markup');
assert.ok(ids.includes('menu') && ids.includes('menu-play'), 'the markup defines the start screen');

// ---------------------------------------------------------------- faithful DOM

class Element {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.clientWidth = 960;
    this.clientHeight = 600;
    this.attributeNames = new Set();
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const wanted = force === undefined ? !classes.has(name) : Boolean(force);
        if (wanted) classes.add(name); else classes.delete(name);
        return wanted;
      },
    };
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ preventDefault() {}, stopPropagation() {}, target: this, ...event });
    }
    return this;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributeNames.add(name); this[name] = value; }
  removeAttribute(name) { this.attributeNames.delete(name); }
  hasAttribute(name) { return this.attributeNames.has(name); }
  getAttribute(name) { return this.attributeNames.has(name) ? this[name] : null; }
  querySelector() { return null; }
  focus() {}
  requestPointerLock() {}                 // deliberately does not lock, as in an embedded frame
  requestFullscreen() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}

const byId = new Map(ids.map(id => [id, new Element(id)]));
byId.set('game', Object.assign(new Element('game'), { getContext: () => glStub }));
const canvas = byId.get('game');

const glStub = new Proxy({}, {
  get(object, property) {
    if (property === 'drawElements' || property === 'drawArrays') return () => { draws++; };
    if (property === 'getShaderParameter' || property === 'getProgramParameter') return () => true;
    if (['getShaderInfoLog', 'getProgramInfoLog'].includes(property)) return () => '';
    if (property === 'getAttribLocation') return () => 0;
    if (property === 'getUniformLocation') return () => ({});
    if (property === 'getExtension') return () => null;
    if (typeof property === 'string' && /^[A-Z][A-Z0-9_]*$/.test(property)) return 1;
    return () => ({});
  },
});
let draws = 0;

const documentListeners = new Map();
globalThis.document = {
  byId,
  getElementById: id => byId.get(id) ?? null,      // null for ids the markup does not define
  createElement: () => new Element(),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  },
  body: new Element('body'),
  fullscreenElement: null,
  pointerLockElement: null,
  exitPointerLock() {},
  exitFullscreen() {},
};

const storage = new Map();
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const windowListeners = new Map();
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
};
// A fixed ?seed= makes the world (and therefore this test) reproducible.
globalThis.location = { search: '?seed=2408', origin: 'http://localhost:8000', pathname: '/' };
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
  createOscillator() { return { connect: () => ({ connect: () => {} }), start() {}, stop() {}, frequency: {}, type: '' }; }
  createGain() { return { connect: () => {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} } }; }
  resume() {}
};

let frameQueue = [];
let clock = 0;
globalThis.requestAnimationFrame = callback => { frameQueue.push(callback); return frameQueue.length; };
globalThis.performance = globalThis.performance ?? { now: () => clock };
const step = (frames = 1) => {
  for (let i = 0; i < frames; i++) {
    clock += 16;
    const queue = frameQueue;
    frameQueue = [];
    for (const callback of queue) callback(clock);
  }
};

// ---------------------------------------------------------------- the real game

const { PixeledGame } = await import('../web/main.js');
const game = new PixeledGame(canvas);

assert.equal(game.paused, true, 'the game waits on the start screen');
assert.equal(game.menu.isOpen, true, 'the menu found its markup and opened');
assert.equal(byId.get('menu').classList.contains('hidden'), false, 'the start screen is on screen');
assert.ok(byId.get('menu-splash').textContent.length > 0, 'the splash text was written');
assert.ok(byId.get('menu-controls').textContent.includes('WASD'), 'the controls line was written');

step(30);
assert.ok(game.loaded, 'the world finishes meshing while the menu is up');
assert.ok(draws > 0, 'the panorama is rendering behind the menu');
assert.ok(game.panorama > 0, 'and the camera is turning');

// Play: the button in the markup must resume the game, and the HUD must come back.
byId.get('menu-play').dispatch('click');
assert.equal(game.paused, false, 'the Play button starts the game');
assert.equal(game.menu.isOpen, false, 'the menu closed');
assert.equal(game.input.enabled, true, 'input is live again');
assert.equal(byId.get('menu').classList.contains('hidden'), true, 'the start screen is hidden');
assert.equal(document.body.classList.contains('menu-open'), false, 'and the HUD is back');

// Without pointer capture the game must stay playable: dragging looks, clicking digs.
assert.equal(game.input.pointerLocked, false, 'the stub browser refuses to capture the pointer');
game.player.yaw = 0.5;
game.player.pitch = -1.2;
const target = game.target();
assert.ok(target, 'the player is aiming at terrain');
canvas.dispatch('mousedown', { button: 0, clientX: 40, clientY: 40 });
for (const handler of documentListeners.get('mousemove') ?? []) handler({ preventDefault() {}, movementX: 25, movementY: 0 });
step(1);
assert.ok(Math.abs(game.player.yaw - 0.5) > 0.01, 'dragging rotates the view without pointer capture');
for (const handler of documentListeners.get('mouseup') ?? []) handler({ preventDefault() {}, button: 0 });

const digTarget = game.target();
canvas.dispatch('mousedown', { button: 0, clientX: 40, clientY: 40 });
for (const handler of documentListeners.get('mouseup') ?? []) handler({ preventDefault() {}, button: 0 });
assert.equal(game.world.get(digTarget.x, digTarget.y, digTarget.z), 0, 'a click without a drag mines the block');

// Escape opens the pause screen, and Play takes you back.
for (const handler of windowListeners.get('keydown') ?? []) handler({ code: 'Escape', preventDefault() {} });
assert.equal(game.paused, true, 'Escape pauses the game');
assert.equal(byId.get('menu-play-label').textContent, 'Back to game', 'the menu offers to resume');
byId.get('menu-play').dispatch('click');
assert.equal(game.paused, false, 'and resuming works');

// The seed row replays a world on demand.
for (const handler of windowListeners.get('keydown') ?? []) handler({ code: 'Escape', preventDefault() {} });
byId.get('menu-seed-toggle').dispatch('click');
assert.equal(byId.get('menu-seed-row').hasAttribute('hidden'), false, 'the seed row opens');
byId.get('menu-seed-input').value = '2408';
byId.get('menu-seed-go').dispatch('click');
assert.equal(game.world.seed, 2408, 'a typed seed generates that world');
assert.equal(game.paused, false, 'and starts the game');

console.log('web DOM smoke test passed — %d ids from index.html, menu, pause, drag-look and seeds all wired'
  .replace('%d', ids.length));
