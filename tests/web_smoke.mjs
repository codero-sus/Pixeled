/**
 * Browser-edition smoke test, headless.
 *
 * The modules that touch the DOM or WebGL are exercised with small stubs, so the whole game
 * pipeline is checked without a browser: world generation, player physics, block breaking and
 * placing, the sprite sheet, the HUD and the save file.
 *
 *   node tests/web_smoke.mjs
 */

import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

// ------------------------------------------------------------------ stubs

class StubElement {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.placeholder = '';
    this.width = 44;
    this.height = 44;
    this.clientWidth = 960;
    this.clientHeight = 600;
    this.classList = {
      set: new Set(),
      add: name => this.classList.set.add(name),
      remove: name => this.classList.set.delete(name),
      toggle: (name, on) => (on ? this.classList.set.add(name) : this.classList.set.delete(name)),
      contains: name => this.classList.set.has(name),
    };
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ preventDefault() {}, stopPropagation() {}, clientX: 480, clientY: 300, button: 0, code: '', key: '', movementX: 0, movementY: 0, ...event });
    }
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector(selector) {
    const key = `${this.id}:${selector}`;
    if (!stubRegistry.has(key)) stubRegistry.set(key, new StubElement(key));
    return stubRegistry.get(key);
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; }
  getContext() { return stubContext(); }
  requestPointerLock() { return undefined; }
  focus() {}
}

const stubRegistry = new Map();

function stubContext() {
  const target = {
    canvas: { width: 256, height: 256 },
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    calls: 0,
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return (...args) => { object.calls++; void args; };
    },
    set(object, property, value) { object[property] = value; return true; },
  });
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new StubElement(id));
  return elements.get(id);
};

const documentListeners = new Map();
const windowListeners = new Map();

globalThis.document = {
  readyState: 'complete',
  hidden: false,
  pointerLockElement: null,
  getElementById: getElement,
  createElement: tag => new StubElement('', tag),
  querySelector: () => new StubElement('query'),
  querySelectorAll: () => [],
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  },
  exitPointerLock() {},
};

const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

globalThis.window = {
  innerWidth: 960,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
  AudioContext: class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createBuffer() { return { getChannelData: () => new Float32Array(64) }; }
    createBufferSource() { return { connect() {}, start() {}, buffer: null }; }
    createBiquadFilter() { return { connect() {}, type: '', frequency: { value: 0 } }; }
  },
};
if (!globalThis.navigator) globalThis.navigator = { clipboard: null };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
const emitWindow = (type, event = {}) => {
  for (const handler of windowListeners.get(type) ?? []) {
    handler({ preventDefault() {}, stopPropagation() {}, code: '', key: '', button: 0, movementX: 0, movementY: 0, deltaY: 0, ...event });
  }
};
globalThis.requestAnimationFrame = () => 0;

// ------------------------------------------------------------------ modules under test

const { paintAtlas, averageTileColor } = await import('../web/atlas.js');
const { paintCharacter, CHARACTER, frameUV, WALK_FRAMES } = await import('../web/sprites.js');
const { VoxelWorld } = await import('../web/world.js');
const { PlayerModel } = await import('../web/player.js');
const { GameStorage } = await import('../web/storage.js');
const { GameAudio } = await import('../web/audio.js');
const { Controls } = await import('../web/controls.js');
const { Hud, drawBlockIcon } = await import('../web/hud.js');
const { BLOCKS, HOTBAR_PAGES, DEFAULT_SETTINGS, TILES } = await import('../web/constants.js');
const { parseSeed, randomSeed } = await import('../web/noise.js');

// ------------------------------------------------------------------ the world

const world = new VoxelWorld(777001);
const spawn = world.findSpawn(0, 0);
assert.ok(Number.isFinite(spawn.x) && Number.isFinite(spawn.y), 'a spawn point is found above ground');
assert.ok(world.getBlock(Math.floor(spawn.x), Math.floor(spawn.y) - 1, Math.floor(spawn.z)) !== 0, 'spawn stands on solid ground');

// ------------------------------------------------------------------ player physics

// Physics gets a deliberately flat, empty world so the numbers are the numbers.
const flatWorld = {
  getBlock: (x, y, z) => (y < 40 ? 3 : 0),
  findSpawn: () => ({ x: 0.5, y: 41, z: 0.5 }),
};
const player = new PlayerModel(flatWorld, { x: 0.5, y: 50, z: 0.5 });
for (let i = 0; i < 180; i++) player.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(player.onGround, 'the player falls and lands');
const standingY = player.position.y;

const start = { ...player.position };
for (let i = 0; i < 60; i++) player.update(1 / 60, { forward: 1, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
const travelled = Math.hypot(player.position.x - start.x, player.position.z - start.z);
assert.ok(travelled > 1, `walking moves the player (${travelled.toFixed(2)} blocks)`);
assert.ok(Math.abs(player.position.y - standingY) < 0.05, 'and stays on the flat ground');
assert.ok(Math.abs(travelled - 4.6) < 1.4, 'at roughly walking speed');

assert.equal(player.jump(), true, 'you can jump from the ground');
assert.equal(player.onGround, false);
let peak = player.position.y;
for (let i = 0; i < 20; i++) { player.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false }); peak = Math.max(peak, player.position.y); }
assert.ok(peak > standingY + 0.5, 'the jump actually gains height');
for (let i = 0; i < 200; i++) player.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(player.onGround, 'and lands again');

// Looking around: yaw turns the walking direction.
player.yaw = 0;
const forwardDirection = player.wishDirection({ forward: 1, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(forwardDirection.z < -0.9, 'with yaw 0 the player walks towards -z');
player.yaw = Math.PI / 2;
const turned = player.wishDirection({ forward: 1, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(turned.x < -0.9, 'turning 90° walks towards -x');
player.yaw = 0;

// Flying ignores gravity.
player.toggleFly(true);
const beforeFly = player.position.y;
for (let i = 0; i < 30; i++) player.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: true, sneak: false, sprint: false });
assert.ok(player.position.y > beforeFly, 'flying rises with space');
player.toggleFly(true);
assert.equal(player.flying, false, 'and can be switched off again');

// Walking into a wall stops the player instead of letting them clip through it.
const wallWorld = {
  getBlock: (x, y, z) => (y < 40 || (x >= 3 && y < 43) ? 3 : 0),
  findSpawn: () => ({ x: 0.5, y: 41, z: 0.5 }),
};
const walker = new PlayerModel(wallWorld, { x: 0.5, y: 41.5, z: 0.5 });
for (let i = 0; i < 240; i++) walker.update(1 / 60, { forward: 1, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(walker.position.x < 3, `the wall stops the player (x=${walker.position.x.toFixed(2)})`);
assert.ok(!walker.overlapsBlock(3, 41, 0), 'and they never end up inside it');

// Falling from a great height still lands on the ground rather than through it.
const faller = new PlayerModel(flatWorld, { x: 0.5, y: 90, z: 0.5 });
for (let i = 0; i < 600; i++) faller.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: false, sneak: false, sprint: false });
assert.ok(faller.position.y > 39.99 && faller.position.y < 40.02, `a long fall lands on the floor (y=${faller.position.y.toFixed(2)})`);

// Swimming: water slows the fall and a jump stroke pushes upwards.
const waterWorld = {
  getBlock: (x, y, z) => (y < 30 ? 3 : y <= 40 ? 10 : 0),
  findSpawn: () => ({ x: 0.5, y: 41, z: 0.5 }),
};
const swimmer = new PlayerModel(waterWorld, { x: 0.5, y: 39, z: 0.5 });
for (let i = 0; i < 30; i++) swimmer.update(1 / 60, { forward: 0, back: 0, left: 0, right: 0, jump: true, sneak: false, sprint: false });
assert.equal(swimmer.inWater, true, 'standing in water is detected');
assert.ok(swimmer.velocity.y > 0, 'and pressing space swims upwards');

// ------------------------------------------------------------------ block editing

const edit = { x: Math.floor(spawn.x) + 2, y: Math.floor(spawn.y) + 3, z: Math.floor(spawn.z) };
assert.equal(world.setBlock(edit.x, edit.y, edit.z, 13), true, 'a block can be placed');
assert.equal(world.getBlock(edit.x, edit.y, edit.z), 13, 'and read back');
assert.equal(world.edits.size >= 1, true, 'the edit is recorded for saving');
const hit = world.raycast({ x: edit.x + 0.5, y: edit.y + 2, z: edit.z + 0.5 }, { x: 0, y: -1, z: 0 }, 6);
assert.ok(hit && hit.x === edit.x && hit.y === edit.y, 'raycasting finds the block under the crosshair');
assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, 1, 0], 'with the correct face normal');
assert.equal(world.setBlock(edit.x, edit.y, edit.z, 0), true, 'and blocks can be removed');

// ------------------------------------------------------------------ sprites and atlas

const character = paintCharacter();
const painted = Array.from(character).filter((value, index) => index % 4 === 3 && value > 0).length;
assert.ok(painted > 800, `the character sheet has painted pixels (${painted})`);
const uv = frameUV('walk1');
assert.ok(uv.u0 > 0 && uv.u1 <= 1 && uv.v0 >= 0 && uv.v1 <= 1, 'frame UVs stay inside the sheet');
assert.equal(WALK_FRAMES.length, 4, 'four walk frames');
assert.equal(CHARACTER.frames.mine.column, 3, 'the mining pose is where the code expects it');

const atlas = paintAtlas();
const greenish = (red, green, blue) => green > red && green > blue;
const [topRed, topGreen, topBlue] = averageTileColor(atlas, TILES.grass_top);
assert.ok(greenish(topRed, topGreen, topBlue), 'grass tops are green');
const [waterRed, waterGreen, waterBlue] = averageTileColor(atlas, TILES.water);
assert.ok(waterBlue > waterGreen && waterBlue > waterRed, 'water is blue');
const [snowRed, snowGreen, snowBlue] = averageTileColor(atlas, TILES.snow_top);
assert.ok(Math.min(snowRed, snowGreen, snowBlue) > 0.85, 'snow is nearly white');
const [, sandGreen, sandBlue] = averageTileColor(atlas, TILES.sand);
assert.ok(averageTileColor(atlas, TILES.sand)[0] > sandGreen && sandGreen > sandBlue, 'sand is sandy');
const { TILES: tiles } = await import('../web/constants.js');
assert.equal(typeof tiles.grass_top, 'number');
void tiles;

// ------------------------------------------------------------------ HUD

const hud = new Hud(getElement('atlas-canvas'), { ...DEFAULT_SETTINGS }, {
  onSelectSlot: slot => hud.setSelected(slot),
});
hud.setSeedText(4242);
hud.setSelected(3);
assert.equal(hud.selectedBlockId(), HOTBAR_PAGES[0][3], 'the selected slot maps to a block');
hud.update({
  fps: 60, biome: 'forest', position: { x: 1, y: 2, z: 3 }, clock: '07:00', phase: 'Daytime',
  target: 'Grass', blocksPlaced: 4, chunks: 25, breakProgress: 0.5, seed: 4242,
  flying: false, onGround: true, inWater: false,
});
assert.equal(getElement('stat-biome').textContent, 'forest', 'the HUD shows the biome');
assert.equal(getElement('stat-coords').textContent, '1.0 2.0 3.0', 'and the player position');
hud.toast('hello');
assert.equal(getElement('toast').textContent, 'hello');
hud.setPage(1);
assert.equal(hud.selectedBlockId(), HOTBAR_PAGES[1][3], 'paging changes the block set');

const iconContext = stubContext();
drawBlockIcon(iconContext, getElement('atlas-canvas'), BLOCKS[1], 44);
assert.ok(iconContext.calls > 0, 'block icons draw something');
drawBlockIcon(iconContext, getElement('atlas-canvas'), BLOCKS[16], 44);
assert.ok(iconContext.calls > 0, 'plants draw as a flat tile');

// ------------------------------------------------------------------ input

const canvas = getElement('game');
const controls = new Controls(canvas, { ...DEFAULT_SETTINGS }, {});
controls.keys.add('keyw');
assert.equal(controls.moveInput().forward, 1, 'W walks forward');
controls.keys.add('controlleft');
assert.equal(controls.moveInput().sprint, true, 'ctrl sprints');
controls.keys.clear();
controls.mouse.dx = 5;
assert.deepEqual(controls.takeLook(), { dx: 5, dy: 0 }, 'mouse movement is consumed once');
assert.deepEqual(controls.takeLook(), { dx: 0, dy: 0 }, 'and then cleared');
controls.locked = true; // the game only reads clicks while the pointer is locked
canvas.emit('mousedown', { button: 0 });
assert.equal(controls.isBreaking(), true, 'holding the left button digs');
assert.equal(controls.drainActions().some(action => action.type === 'break'), true, 'and queues a break action');
emitWindow('wheel', { deltaY: 120 });
assert.equal(controls.takeWheel(), 1, 'the wheel steps through the hotbar');
canvas.emit('mousedown', { button: 2 });
assert.equal(controls.isPlacing(), true, 'the right button places blocks');
const hotbarCalls = [];
const spyControls = new Controls(canvas, { ...DEFAULT_SETTINGS }, { onHotbarSlot: slot => hotbarCalls.push(slot) });
emitWindow('keydown', { code: 'Digit5' });
assert.deepEqual(hotbarCalls, [4], 'number keys pick a hotbar slot');
emitWindow('keydown', { code: 'Space' });
assert.equal(spyControls.drainActions().some(action => action.type === 'jump'), true, 'space queues a jump');

// ------------------------------------------------------------------ audio (stubbed WebAudio)

const audio = new GameAudio({ sound: true });
audio.unlock();
audio.dig('stone');
audio.place('wood');
audio.step();
audio.jump();
audio.setEnabled(false);
assert.equal(audio.enabled, false, 'sound can be switched off');

// ------------------------------------------------------------------ storage

const storage = new GameStorage(globalThis.localStorage);
assert.equal(storage.available, true, 'storage is available in the stub');
storage.saveSettings({ ...DEFAULT_SETTINGS, renderDistance: 9 });
const settings = storage.loadSettings();
assert.equal(settings.renderDistance, 9, 'settings round-trip');
assert.equal(settings.fov, DEFAULT_SETTINGS.fov, 'and keep their defaults');

storage.saveWorld({
  seed: 4242,
  time: 0.75,
  player: { x: 1.5, y: 40, z: -3.25, yaw: 1.2, pitch: 0.1 },
  edits: new Map([['1,40,2', 13], ['-5,41,0', 0]]),
  blocksPlaced: 7,
  minutesPlayed: 3,
});
const loaded = storage.loadWorld();
assert.equal(loaded.seed, 4242, 'the world save keeps its seed');
assert.equal(loaded.edits.get('1,40,2'), 13, 'and its edits');
assert.equal(loaded.edits.get('-5,41,0'), 0, 'including removed blocks');
assert.equal(loaded.player.z, -3.25, 'and the player position');
assert.equal(loaded.blocksPlaced, 7, 'and the block counter');
storage.clearWorld();
assert.equal(storage.loadWorld(), null, 'clearing the save works');
assert.equal(storage.hasWorld(), false);

// ------------------------------------------------------------------ seeds

// A blank seed means "surprise me": the game rolls a fresh random one for every new world.
assert.ok(parseSeed('') === null || parseSeed('') === undefined, 'a blank seed asks for a random world');
assert.notEqual(randomSeed(), randomSeed(), 'random seeds differ');
assert.equal(parseSeed('12345'), 12345, 'number-like seeds are used as they are');
assert.equal(typeof parseSeed('a lovely meadow'), 'number', 'text seeds are hashed');
assert.equal(parseSeed('a lovely meadow'), parseSeed('a lovely meadow'), 'the same text always gives the same world');
assert.notEqual(parseSeed('a lovely meadow'), parseSeed('a gloomy cave'), 'different text gives a different world');

// Two worlds with different seeds must not look the same.
const otherWorld = new VoxelWorld(4242);
assert.notEqual(otherWorld.generator.heightAt(12, 34), world.generator.heightAt(12, 34), 'different seeds make different terrain');

console.log('web smoke test passed — world, player, HUD, input and storage all behave');
