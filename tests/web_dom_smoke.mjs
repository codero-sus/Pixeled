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
const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual(duplicates, [], 'no duplicate ids in the markup');
assert.ok(ids.includes('menu') && ids.includes('menu-play'), 'the markup defines the start screen');

// A class rule like `.overlay { display: grid }` beats the browser's own `[hidden]` rule, which
// once left the help sheet stuck over everything: `element.hidden = true` did nothing. The
// stylesheet must make the attribute authoritative, and the overlays must stack in a known order.
assert.match(stylesheet, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, 'the hidden attribute wins over display rules');
assert.match(stylesheet, /\.overlay\.loading\s*\{[^}]*z-index:\s*10/, 'loading sits under the menu');
assert.match(stylesheet, /\.overlay\.menu\s*\{[^}]*z-index:\s*20/, 'the menu sits under the help sheet');
assert.match(stylesheet, /\.overlay\.modal\s*\{[^}]*z-index:\s*30/, 'the help sheet is on top');

// ---------------------------------------------------------------- faithful DOM

class Element {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
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
    // className and classList are two views of one set, exactly like the real DOM.
    Object.defineProperty(this, 'className', {
      get() { return [...classes].join(' '); },
      set(value) {
        classes.clear();
        for (const name of String(value).split(/\s+/)) if (name) classes.add(name);
      },
    });
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
  prepend(...nodes) { this.children.unshift(...nodes); }
  querySelectorAll(selector) {
    // Enough of a selector engine for the two cases the UI uses: a class, or a tag plus a class.
    const [tag, klass] = selector.includes('.') ? selector.split('.') : [selector, null];
    return this.children.flatMap(child => {
      const matches = (!tag || child.tagName?.toLowerCase() === tag.toLowerCase())
        && (!klass || child.classList?.contains(klass));
      if (matches) return [child];
      return child.querySelectorAll ? child.querySelectorAll(selector) : [];
    });
  }
  getContext(type) {
    if (type !== '2d') return null;
    if (!this.ctx2d) {
      this.ctx2d = {
        fillCalls: 0, fillStyle: '', strokeStyle: '', lineWidth: 1,
        clearRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
        bezierCurveTo() {}, save() {}, restore() {}, clip() {}, rect() {},
        fill() { this.fillCalls++; }, stroke() {}, fillRect() {},
      };
    }
    return this.ctx2d;
  }
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

// Reflect the markup's own attributes, so a `hidden` overlay starts hidden here too.
const byId = new Map();
for (const tag of markup.match(/<[a-z][^>]*>/gi) ?? []) {
  const id = /\bid="([^"]+)"/.exec(tag)?.[1];
  if (!id) continue;
  const element = new Element(id);
  if (/\shidden(\s|>|=)/.test(tag)) element.setAttribute('hidden', '');
  const classes = /\bclass="([^"]*)"/.exec(tag)?.[1] ?? '';
  for (const name of classes.split(/\s+/).filter(Boolean)) element.classList.add(name);
  byId.set(id, element);
}
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

// The help sheet starts hidden — the bug that made the game unplayable was that it did not.
assert.equal(byId.get('help-modal').hasAttribute('hidden'), true, 'the help sheet starts hidden');
assert.equal(byId.get('help-modal').classList.contains('hidden'), true, 'and hidden by class too');

// Opening it from the menu, then closing it with the Let us build button, must land back on the menu.
byId.get('menu-help').dispatch('click');
assert.equal(byId.get('help-modal').hidden, false, 'How to play opens the sheet');
assert.equal(game.paused, true, 'the game is still on the start screen behind the sheet');
byId.get('got-it').dispatch('click');
assert.equal(byId.get('help-modal').hidden, true, 'the Let us build button closes the sheet');
assert.equal(byId.get('help-modal').classList.contains('hidden'), true, 'by class as well as by attribute');
assert.equal(game.paused, true, 'and drops back to the start screen');
assert.equal(byId.get('menu').classList.contains('hidden'), false, 'the menu is visible again');

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

// While playing, the help sheet must park the controls (the pointer is captured, so its buttons
// would otherwise be unclickable) and hand them back when it closes.
byId.get('open-help').dispatch('click');
assert.equal(byId.get('help-modal').hidden, false, 'the HUD button opens the sheet');
assert.equal(game.input.enabled, false, 'controls are parked while the sheet is up');
byId.get('got-it').dispatch('click');
assert.equal(byId.get('help-modal').hidden, true, 'the Let us build button closes it during play');
assert.equal(game.input.enabled, true, 'and the controls come back');

// H toggles the same sheet.
for (const handler of windowListeners.get('keydown') ?? []) handler({ code: 'KeyH', preventDefault() {} });
assert.equal(byId.get('help-modal').hidden, false, 'H opens the sheet');
for (const handler of windowListeners.get('keydown') ?? []) handler({ code: 'KeyH', preventDefault() {} });
assert.equal(byId.get('help-modal').hidden, true, 'H closes it again');

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

// =============================================================== v3.1 markup and panels

// The extra HUD readouts exist in the real markup, not just in the game code.
for (const id of ['hud-weather', 'hud-facing', 'hud-mined', 'hud-walked', 'target-label', 'breath', 'breath-fill',
                  'settings-panel', 'menu-settings']) {
  assert.ok(byId.has(id), `index.html defines #${id}`);
}
assert.match(markup, /<div class="breath" id="breath" hidden>/, 'the breath bar starts hidden');
assert.match(markup, /class="settings-panel hidden" id="settings-panel" hidden/, 'the settings panel starts hidden');
assert.match(markup, /class="credits"/, 'the help sheet credits the build');

// The stylesheet keeps the new pieces working: the hidden attribute must still win, the panels must
// stack, and the settings rows must be laid out.
assert.match(stylesheet, /\.target-label\s*\{[^}]*position:\s*absolute/, 'the target label floats over the crosshair');
assert.match(stylesheet, /\.target-label:empty\s*\{[^}]*opacity:\s*0/, 'and fades out when nothing is aimed at');
assert.match(stylesheet, /\.breath i\.low\s*\{/, 'the breath bar turns a warning colour');
assert.match(stylesheet, /\.settings-panel\s*\{[^}]*max-height/, 'the settings panel scrolls instead of overflowing');
assert.match(stylesheet, /\.settings-row\s*\{[^}]*grid-template-columns/, 'settings rows use a grid');
assert.match(stylesheet, /\.hud\s*\{[^}]*zoom:\s*var\(--ui-scale\)/, 'the HUD scale is a CSS variable');

// --- the options panel builds real controls from the settings object
const { Settings, DEFAULTS } = await import('../web/settings.js');
const { OptionsPanel } = await import('../web/options.js');
const panelSettings = new Settings({ getItem: () => null, setItem: () => {} });
const changes = [];
const panel = new OptionsPanel(panelSettings, { onChange: (key, value) => changes.push([key, value]) });
panel.build();
const panelRoot = panel.root;
assert.ok(panelRoot, 'the panel found its markup');
const rows = panelRoot.children.flatMap(child => child.children ?? []);
assert.ok(rows.length >= 13, `the panel has a row per setting (${rows.length})`);
assert.equal(panel.controls.size, 13, 'six sliders and seven switches are wired');
const slider = panel.controls.get('fov');
assert.equal(slider.type, 'range', 'the field of view is a slider');
assert.equal(panel.controls.get('volume').type, 'range', 'volume is a slider');
assert.equal(panel.controls.get('particles').type, 'checkbox', 'particles are a switch');
slider.value = '95';
slider.dispatch('input');
assert.equal(panelSettings.get('fov'), 95, 'dragging a slider stores the value');
assert.deepEqual(changes.at(-1), ['fov', 95], 'and tells the game about it');
const switchInput = panel.controls.get('weather');
switchInput.checked = false;
switchInput.dispatch('change');
assert.equal(panelSettings.get('weather'), false, 'a switch stores its state');
assert.deepEqual(changes.at(-1), ['weather', false], 'and notifies');
panel.toggle(true);
assert.equal(panelRoot.hidden, false, 'the panel can be opened');
assert.equal(panelRoot.classList.contains('hidden'), false, 'and drops its hidden class');
panel.toggle(false);
assert.equal(panelRoot.hidden, true, 'and closes again');
panelSettings.set('fov', 60);
panel.sync();
assert.equal(panel.controls.get('fov').value, '60', 'sync pulls the controls back in line');
const resetButton = panelRoot.children.flatMap(child => child.children ?? []).find(child => child.id === 'settings-reset');
assert.ok(resetButton, 'the panel offers a reset');
resetButton.dispatch('click');
assert.equal(panelSettings.get('fov'), DEFAULTS.fov, 'reset restores the defaults');

// --- the menu chip opens the panel in the running game
const menuChip = byId.get('menu-settings');
assert.ok(menuChip, 'the pause menu has a settings chip');
menuChip.dispatch('click');
assert.equal(byId.get('settings-panel').hidden, false, 'clicking the chip opens the panel');
assert.equal(menuChip.classList.contains('active'), true, 'and marks the chip active');
menuChip.dispatch('click');
assert.equal(byId.get('settings-panel').hidden, true, 'clicking again closes it');
assert.equal(menuChip.classList.contains('active'), false, 'and clears the active mark');

// --- HUD readouts are written through the real ids
const game2 = game;                        // the instance this suite has been driving
game2.ui.setStatus({
  fps: 61, position: { x: 1, y: 2, z: 3 }, biome: 'swamp', seed: 2408, clock: 0.5,
  flying: false, blocksPlaced: 4, broken: 9, walked: 21.4, weather: 'rain',
  facing: 'west', underfoot: 'Diamond ore', breath: 0.42, underwater: true,
});
assert.equal(byId.get('hud-weather').textContent, 'rain', 'the sky readout updates');
assert.equal(byId.get('hud-facing').textContent, 'west', 'so does the compass');
assert.equal(byId.get('hud-mined').textContent, '9', 'and the mined counter');
assert.equal(byId.get('hud-walked').textContent, '21 m', 'the walk counter is rounded for the HUD');
assert.equal(byId.get('target-label').textContent, 'Diamond ore', 'the crosshair names the block');
assert.equal(byId.get('breath').hidden, false, 'the breath bar shows while submerged');
assert.equal(byId.get('breath-fill').style.width, '42%', 'and fills to the remaining air');
assert.equal(byId.get('breath-fill').classList.contains('low'), false, 'half a lung is not a warning');
game2.ui.setStatus({
  fps: 61, position: { x: 1, y: 2, z: 3 }, biome: 'swamp', seed: 2408, clock: 0.5,
  flying: false, blocksPlaced: 4, broken: 9, walked: 21.4, weather: 'rain',
  facing: 'west', underfoot: 'Diamond ore', breath: 0.12, underwater: true,
});
assert.equal(byId.get('breath-fill').style.width, '12%', 'the bar keeps up with the drain');
assert.ok(byId.get('breath-fill').classList.contains('low'), 'and warns when it runs low');
game2.ui.setStatus({
  fps: 61, position: { x: 1, y: 2, z: 3 }, biome: 'swamp', seed: 2408, clock: 0.5,
  flying: false, blocksPlaced: 4, broken: 9, walked: 21.4, weather: 'clear',
  facing: 'west', underfoot: '', breath: 1, underwater: false,
});
assert.equal(byId.get('breath').hidden, true, 'and hides again at the surface');
assert.equal(byId.get('target-label').textContent, '', 'the block name clears when nothing is aimed at');
game2.ui.setBiomeReadout(false);
game2.ui.setScale(130);
assert.equal(game2.ui.scale, 130, 'the HUD scale can be set');
game2.ui.setBiomeReadout(true);

// =============================================================== v3.3 markup and panels

for (const id of ['open-palette', 'palette', 'palette-grid', 'close-palette', 'minimap', 'debug', 'hud-light']) {
  assert.ok(byId.has(id), `index.html defines #${id}`);
}
assert.match(markup, /<div class="overlay modal palette hidden" id="palette" hidden>/, 'the palette starts hidden');
assert.match(markup, /<canvas class="minimap" id="minimap"/, 'the minimap is a canvas');
assert.match(markup, /<pre class="debug hidden" id="debug" hidden/, 'the debug panel starts hidden and empty');
assert.match(stylesheet, /\.palette-grid\s*\{[^}]*grid-template-columns/, 'the palette lays out as a grid');
assert.match(stylesheet, /\.minimap\s*\{[^}]*image-rendering:\s*pixelated/, 'the minimap stays crisp when scaled');
assert.match(stylesheet, /\.debug\s*\{[^}]*font:\s*11px/, 'the debug panel uses a monospace font');

// --- the palette builds one button per placeable block, with counts
const { PALETTE, TORCH, SAPLING, STONE } = await import('../web/constants.js');
const game3 = game;
game3.ui.buildPalette(PALETTE, { counts: new Map([[STONE, 7]]), onPick: () => { picked++; } });
let picked = 0;
const grid = byId.get('palette-grid');
assert.equal(grid.children.length, PALETTE.length, `the palette shows every placeable block (${grid.children.length})`);
assert.equal(game3.ui.paletteButtons.size, PALETTE.length, 'and indexes them by id');
assert.ok(grid.children.every(button => button.dataset.block), 'each button carries its block id');
assert.equal(game3.ui.highlightPalette(TORCH), true, 'a block can be highlighted');
assert.equal(game3.ui.paletteButtons.get(TORCH).classList.contains('active'), true, 'the torch button is marked');
assert.equal(game3.ui.highlightPalette(SAPLING), true, 'and the highlight moves');
assert.equal(game3.ui.paletteButtons.get(TORCH).classList.contains('active'), false, 'off the old one');
grid.children[0].dispatch('click');
assert.equal(picked, 1, 'clicking a block picks it');

// --- opening and closing the palette through the HUD button and the game
assert.equal(byId.get('palette').hasAttribute('hidden'), true, 'the palette starts closed');
byId.get('open-palette').dispatch('click');
assert.equal(byId.get('palette').hidden, false, 'the HUD button opens it');
assert.equal(game3.input.enabled, false, 'and the controls park while it is open');
byId.get('close-palette').dispatch('click');
assert.equal(byId.get('palette').hidden, true, 'the Done button closes it');
assert.equal(game3.input.enabled, true, 'and the controls come back');

// --- choosing a block from the palette fills the selected slot
game3.selectHotbar(5);
game3.togglePalette(true);
const torchButton = game3.ui.paletteButtons.get(TORCH);
torchButton.dispatch('click');
assert.equal(game3.slotBlock(), TORCH, 'the chosen block lands in the selected slot');
assert.equal(byId.get('palette').hidden, true, 'and the palette closes behind it');
assert.equal(byId.get('selected-block').textContent, 'Torch', 'the HUD names the block in hand');

// --- the debug panel
assert.equal(byId.get('debug').hasAttribute('hidden'), true, 'the debug panel starts hidden');
game3.toggleDebug(true);
assert.equal(byId.get('debug').hidden, false, 'F3 shows it');
game3.ui.setStatus({
  fps: 60, position: { x: 12, y: 34, z: 56 }, biome: 'plains', seed: 2408, clock: 0.4,
  flying: false, blocksPlaced: 3, broken: 12, walked: 88.2, weather: 'clear', facing: 'east',
  underfoot: 'Stone · light 4', breath: 1, underwater: false, chunks: 40, draws: 120,
  light: 9, torchLight: 3, chunk: '0,3', sources: 500, tally: { broken: 12, placed: 3, distance: 88.2 }, inventory: new Map([[STONE, 4]]),
});
const debugText = byId.get('debug').textContent;
assert.ok(debugText.includes('12 34 56'), `the debug panel shows the coordinates (${debugText.split('\n')[1]})`);
assert.ok(debugText.includes('light'), 'and the light level');
assert.ok(debugText.includes('0,3'), 'and the chunk');
assert.equal(byId.get('hud-light').textContent, '9', 'the HUD light readout updates too');
game3.toggleDebug(false);
assert.equal(byId.get('debug').hidden, true, 'and it closes again');

// --- the minimap
const mapElement = byId.get('minimap');
let painted = 0;
mapElement.getContext = () => ({
  fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  fillRect: () => { painted++; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
});
const size = new Element('minimap');
size.width = 24; size.height = 24;
byId.set('minimap-size', size);
mapElement.width = 24;
const filled = game3.ui.drawMinimap(game3.world, 40, 40, 0, 32);
assert.equal(filled, 24, 'the minimap reports the canvas size');
assert.ok(painted > 0, 'and paints terrain pixels');
game3.ui.setMinimapVisible(false);
assert.equal(mapElement.hidden, true, 'the map can be hidden with the biome readout');
game3.ui.setMinimapVisible(true);
assert.equal(mapElement.hidden, false, 'and shown again');

// =============================================================== v3.4 panels

for (const id of ['craft', 'craft-list', 'craft-inventory', 'close-craft', 'storage', 'storage-grid',
  'storage-empty', 'storage-held', 'store-held', 'close-storage', 'sleep', 'palette-craft']) {
  assert.ok(byId.has(id), `index.html defines #${id}`);
}
assert.match(markup, /<div class="overlay modal hidden" id="craft" hidden>/, 'the crafting panel starts hidden');
assert.match(markup, /<div class="sleep" id="sleep" hidden><\/div>/, 'the sleep fade starts hidden');
assert.match(stylesheet, /\.craft-row\s*\{[^}]*grid-template-columns/, 'recipe rows lay out as a grid');
assert.match(stylesheet, /\.craft-row\.affordable\s*\{[^}]*border-color/, 'affordable recipes stand out');
assert.match(stylesheet, /\.sleep\s*\{[^}]*inset:\s*0/, 'the sleep fade covers the screen');
assert.match(stylesheet, /\.craft-need\.short\s*\{[^}]*color/, 'missing ingredients are called out');

// --- the recipe book
const craftUi = game.ui;
const { RECIPES, PLANKS, LOG, TORCH: TORCH2, STONE: STONE2 } = await import('../web/constants.js');
let crafted = [];
craftUi.buildCraft(RECIPES, {
  canCraft: recipe => recipe.out === PLANKS,
  missing: recipe => recipe.needs.map(([id, need]) => ({ id, need, have: id === LOG ? 2 : 0 })),
  onCraft: recipe => crafted.push(recipe.out),
});
const craftList = byId.get('craft-list');
assert.equal(craftList.children.length, RECIPES.length, `one row per recipe (${craftList.children.length})`);
assert.equal(craftUi.lastCraftable, 1, 'exactly one recipe is affordable in this story');
const plankRow = craftUi.craftButtons.get(PLANKS);
assert.equal(plankRow.classList.contains('affordable'), true, 'the plank row is highlighted');
assert.equal(craftUi.craftButtons.get(TORCH2).classList.contains('affordable'), false, 'the torch row is not');
assert.match(plankRow.innerHTML, /Oak planks/, 'the row names what it makes');
assert.equal(craftList.children.filter(row => row.innerHTML.includes('short')).length, RECIPES.length - 1, 'every unaffordable recipe shows a short ingredient');
plankRow.dispatch('click');
assert.deepEqual(crafted, [PLANKS], 'clicking a recipe crafts it');

// --- the backpack summary
const inv = new Map([[STONE2, 12], [LOG, 3], [PLANKS, 1]]);
assert.equal(craftUi.setCraftInventory(inv), 3, 'three stacks are listed');
assert.equal(byId.get('craft-inventory').children.length, 3, 'as three chips');
assert.match(byId.get('craft-inventory').children[0].innerHTML, /Stone <b>12<\/b>/, 'sorted by how many you have');
assert.equal(craftUi.setCraftInventory(new Map()), 0, 'an empty bag says so');
assert.match(byId.get('craft-inventory').textContent, /empty/, 'with a nudge to go digging');

// --- opening and closing through the game
assert.equal(byId.get('craft').hasAttribute('hidden'), true, 'the crafting panel starts closed');
game.toggleCraft(true);
assert.equal(byId.get('craft').hidden, false, 'C opens it');
assert.equal(game.input.enabled, false, 'the controls park');
game.toggleCraft(false);
assert.equal(byId.get('craft').hidden, true, 'and closing gives them back');
assert.equal(game.input.enabled, true, 'so the player can move again');
byId.get('close-craft').dispatch('click');
assert.equal(game.craftOpen, false, 'the Done button closes it too');

// --- chest storage
let taken = [];
game.ui.callbacks.takeFromStorage = id => taken.push(id);
const contents = new Map([[STONE2, 4], [LOG, 1]]);
assert.equal(game.ui.buildStorage(contents, 3), 2, 'two stacks are shown');
assert.equal(byId.get('storage-grid').children.length, 2, 'as two buttons');
assert.equal(byId.get('storage-empty').hidden, true, 'and the empty note hides');
assert.match(byId.get('storage-held').textContent, /3 in the stack/, 'the panel says what is in hand');
game.ui.storageButtons.get(LOG).dispatch('click');
assert.deepEqual(taken, [LOG], 'clicking a stack takes from the chest');
assert.equal(game.ui.buildStorage(new Map(), 0), 0, 'an empty chest shows nothing');
assert.equal(byId.get('storage-empty').hidden, false, 'and says it is empty');
assert.match(byId.get('storage-held').textContent, /nothing/, 'with nothing in hand');
assert.equal(game.ui.setStorage(true), true, 'the chest overlay opens');
assert.equal(byId.get('storage').hidden, false, 'and is on screen');
assert.equal(game.ui.setStorage(false), false, 'and closes');

// --- the sleep fade
assert.equal(game.ui.setSleep(true), true, 'the fade can be turned on');
assert.equal(byId.get('sleep').hidden, false, 'and covers the screen');
assert.equal(game.ui.setSleepProgress(1), 0, 'a full second left is still black');
assert.equal(Math.round(game.ui.setSleepProgress(0.4) * 100), 60, 'and it brightens as the night runs out');
assert.equal(game.ui.setSleep(false), false, 'then it is switched off again');
assert.equal(byId.get('sleep').hidden, true, 'and hidden');

// --- hotbar cubes
const cubeSlot = game.ui.hotbar.children[0];
assert.equal(game.ui.drawHotbarIcons(game.ui.hotbar, [STONE2, LOG, PLANKS]), 3, 'cubes are drawn for the chosen blocks');
const cubeCanvas = cubeSlot.children.find(child => child.className === 'slot-cube');
assert.ok(cubeCanvas, 'the slot holds a canvas');
assert.equal(cubeCanvas.width, 34, 'drawn at 34 pixels');
assert.equal(cubeCanvas.getContext('2d').fillCalls, 3, 'three faces painted');
assert.equal(game.ui.drawHotbarIcons(game.ui.hotbar, [null, null, null]), 3, 'every slot still gets a canvas, empty or not');

// =============================================================== v3.5 shelves and panels

for (const id of ['menu-surprise', 'mode-row', 'daily-card', 'daily-goals', 'menu-daily',
  'challenge-list', 'challenges', 'close-challenges', 'challenge-share', 'challenge-day',
  'challenge-seed', 'challenge-streak', 'challenge-streak-panel', 'hud-mode-chip', 'run-timer',
  'recent-row', 'recent-title']) {
  assert.ok(byId.has(id), `index.html defines #${id}`);
}
assert.match(markup, /<div class="mode-row" id="mode-row" role="radiogroup"/, 'the mode shelf is a radio group');
assert.match(markup, /<div class="daily-card" id="daily-card">/, 'the daily challenge has a card');
assert.match(markup, /<div class="daily-goals" id="daily-goals"><\/div>/, 'with a row for its goals');
assert.match(markup, /<div class="recent-row" id="recent-row"><\/div>/, 'and a shelf for recent worlds');
for (const rule of ['.mode-card', '.mode-card.active', '.daily-badge', '.recent-chip', '.mode-chip',
  '.run-timer', '.challenge-row', '.challenge-bar']) {
  assert.ok(stylesheet.includes(rule), `styles.css styles ${rule}`);
}
assert.match(stylesheet, /\.run-timer\.finished/, 'and marks a finished run');

// --- the mode cards
const { MODES } = await import('../web/modes.js');
const { buildModeRow, buildDailyTeaser, buildRecentRow } = await import('../web/menu.js');
const modeRow = byId.get('mode-row');
assert.equal(buildModeRow(modeRow, MODES, { active: 'speedrun' }), MODES.length, 'a card per mode');
assert.equal(modeRow.children.length, MODES.length, 'all on the shelf');
const speedCard = modeRow.children.find(card => card.dataset.mode === 'speedrun');
assert.ok(speedCard, 'the speedrun card exists');
assert.equal(speedCard.classList.contains('active'), true, 'and is marked active');
assert.equal(speedCard.getAttribute('aria-checked'), 'true', 'and announced as checked');
assert.match(speedCard.innerHTML, /Speedrun/, 'the card names the mode');
assert.match(speedCard.innerHTML, /TIMED · GOAL/, 'and carries its badge');
assert.equal(speedCard.style['--mode-colour'], '#d0684f', 'and its colour');
let modePicked = null;
buildModeRow(modeRow, MODES, { active: 'survival', onPick: id => { modePicked = id; } });
modeRow.children.find(card => card.dataset.mode === 'creative').dispatch('click');
assert.equal(modePicked, 'creative', 'clicking a card picks that mode');

// --- the daily card on the start screen
const teaser = byId.get('daily-goals');
const summary = [
  { id: 'mine-30', label: 'Mine 30 blocks', icon: '⛏', complete: false },
  { id: 'diamond-1', label: 'Find a diamond', icon: '◆', complete: true },
];
assert.equal(buildDailyTeaser(teaser, summary), 2, 'the teaser lists today goals');
assert.equal(teaser.children.length, 2, 'as two chips');
assert.equal(teaser.children[1].classList.contains('done'), true, 'the finished one is ticked');

// --- recent worlds
const recent = byId.get('recent-row');
const recentTitle = byId.get('recent-title');
let reopened = null;
assert.equal(buildRecentRow(recent, recentTitle, [], () => {}), 0, 'no worlds, no shelf');
assert.equal(recentTitle.hidden, true, 'and the heading hides with it');
assert.equal(buildRecentRow(recent, recentTitle, [{ seed: 777, mode: 'creative' }, { seed: 2408, mode: 'survival' }],
  entry => { reopened = entry; }), 2, 'two recent worlds');
assert.equal(recentTitle.hidden, false, 'so the heading comes back');
recent.children[0].dispatch('click');
assert.deepEqual(reopened, { seed: 777, mode: 'creative' }, 'clicking a chip reopens that world');

// --- the in-game chips
const { formatTime } = await import('../web/modes.js');
const modeChip = byId.get('hud-mode-chip');
assert.equal(game.ui.setMode({ name: 'Speedrun', badge: 'TIMED · GOAL', colour: '#d0684f', icon: '⏱' }), true, 'the mode chip can be filled');
assert.match(modeChip.textContent, /Speedrun/, 'with the mode name');
assert.equal(modeChip.title, 'TIMED · GOAL', 'and the badge as its tooltip');
assert.equal(modeChip.hidden, false, 'and it is visible');
assert.equal(modeChip.style['--mode-colour'], '#d0684f', 'painted in the mode colour');
const runTimer = byId.get('run-timer');
assert.equal(game.ui.setRunTimer(true), true, 'the run clock can be shown');
assert.equal(runTimer.hidden, false, 'and is visible');
assert.equal(game.ui.setRunTime(0), 0, 'the clock starts at zero');
assert.equal(runTimer.textContent, formatTime(0), 'formatted like a stopwatch');
game.ui.setRunTime(12.34);
assert.equal(runTimer.textContent, '0:12.3', 'and counts in tenths');
game.ui.setRunTime(12.34, 12.34);
assert.equal(runTimer.textContent, '★ 0:12.3', 'a finished run gets a star');
assert.equal(runTimer.classList.contains('finished'), true, 'and a green border');
assert.equal(game.ui.setRunTimer(false), false, 'and the clock hides outside a speedrun');

// --- the daily panel in-game
const challengeRows = byId.get('challenge-list');
const built = game.ui.buildChallenges([
  { id: 'mine-30', label: 'Mine 30 blocks', icon: '⛏', progress: 0.5, have: 15, value: 30, complete: false },
  { id: 'diamond-1', label: 'Find a diamond', icon: '◆', progress: 1, have: 1, value: 1, complete: true },
], { day: '2026-10-16', streak: 3, best: 5, seed: 424242 });
assert.equal(built, 2, 'the panel lists the goals');
assert.equal(challengeRows.children.length, 2, 'one row each');
assert.match(challengeRows.children[0].innerHTML, /15\/30/, 'half-done work shows its count');
assert.match(challengeRows.children[0].innerHTML, /width:50%/, 'and its progress bar');
assert.equal(challengeRows.children[1].classList.contains('complete'), true, 'a finished goal is marked complete');
assert.match(challengeRows.children[1].innerHTML, /✓/, 'with a tick');
assert.equal(byId.get('challenge-day').textContent, 'DAILY · 2026-10-16', 'the panel shows the day');
assert.equal(byId.get('challenge-seed').textContent, '424242', 'and the seed');
assert.match(byId.get('challenge-streak').textContent, /3 day streak · best 5/, 'and the streak');
assert.deepEqual(game.ui.challengeProgress(), { done: 1, total: 2 }, 'the chip counts how many are done');
assert.equal(game.ui.setChallenges(true), true, 'the panel opens');
assert.equal(byId.get('challenges').hidden, false, 'and is on screen');
assert.equal(game.ui.setChallenges(false), false, 'and closes again');
assert.equal(byId.get('challenges').hidden, true, 'back off screen');

console.log('web DOM smoke test passed — %d ids from index.html, menu, pause, drag-look and seeds all wired'
  .replace('%d', ids.length));
