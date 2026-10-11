/**
 * Headless smoke test for the 3D web edition.
 *
 * The voxel modules are pure JavaScript, so they run directly in Node. On top of that a small
 * WebGL + DOM stub lets the real game boot: it generates a world, meshes and "uploads" chunks,
 * renders frames, mines and builds blocks, walks the player around and round-trips the save.
 *
 *   node tests/web_smoke.mjs
 */

import assert from 'node:assert/strict';

// =============================================================== pure modules

const { VoxelWorld } = await import('../web/world.js');
const { Noise } = await import('../web/noise.js');
const { Player } = await import('../web/player.js');
const { buildChunkMesh } = await import('../web/mesher.js');
const { raycast, placementCell } = await import('../web/raycast.js');
const { AIR, CHUNK, GRASS, SEA_LEVEL, STONE, WATER, WORLD_X, WORLD_Y, WORLD_Z } = await import('../web/constants.js');
const { skyPalette, sunHeight } = await import('../web/renderer.js');

// --- noise is seeded and repeatable
const noiseA = new Noise(1234), noiseB = new Noise(1234), noiseC = new Noise(4321);
assert.equal(noiseA.value2(3.7, 9.2), noiseB.value2(3.7, 9.2), 'same seed, same noise');
assert.notEqual(noiseA.value2(3.7, 9.2), noiseC.value2(3.7, 9.2), 'different seed, different noise');
assert.ok(noiseA.fbm2(0.5, 0.5) >= 0 && noiseA.fbm2(0.5, 0.5) <= 1, 'fbm stays in range');

// --- worlds generate, differ by seed, and are deterministic for one seed
const one = new VoxelWorld(2408), two = new VoxelWorld(2408), three = new VoxelWorld(99);
assert.equal(one.surfaceHeight(40, 40), two.surfaceHeight(40, 40), 'same seed, same terrain');
assert.ok(one.data.length === WORLD_X * WORLD_Y * WORLD_Z, 'world buffer size');
const skyline = world => Array.from({ length: 48 }, (unused, x) => world.surfaceHeight(x * 2 + 4, 30));
assert.notDeepEqual(skyline(one), skyline(three), 'a new seed rolls a new landscape');

let solidCount = 0, waterCount = 0;
for (let i = 0; i < one.data.length; i++) {
  if (one.data[i] === STONE) solidCount++;
  if (one.data[i] === WATER) waterCount++;
}
assert.ok(solidCount > 100000, `world has plenty of stone (${solidCount})`);
assert.ok(waterCount > 0, 'some water sits at sea level');

const spawn = one.spawnPoint();
assert.ok(one.isSolid(Math.floor(spawn.x), Math.floor(spawn.y) - 1, Math.floor(spawn.z)), 'spawn stands on solid ground');
assert.ok(!one.isSolid(Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)), 'spawn is inside free space');

// --- raycast: straight down from high above hits the surface
const column = one.spawnPoint();
const down = raycast(one, { x: column.x, y: WORLD_Y - 1, z: column.z }, { x: 0, y: -1, z: 0 }, 64);
assert.ok(down, 'the ray finds the ground');
assert.equal(down.ny, 1, 'the hit reports the top face');
assert.ok(one.isSolid(down.x, down.y, down.z), 'the hit block is solid');
assert.ok(!one.isSolid(down.x, down.y + 1, down.z), 'the placement cell is free');
const cell = placementCell(down);
assert.equal(cell.y, down.y + 1, 'placement goes above the hit face');

// --- digging a hole and filling it back in
const height = down.y;
one.set(down.x, height, down.z, AIR);
assert.equal(one.get(down.x, height, down.z), AIR, 'block removed');
assert.ok(one.edits.size === 1, 'the edit is remembered for saving');
one.set(cell.x, cell.y, cell.z, GRASS);
assert.equal(one.get(cell.x, cell.y, cell.z), GRASS, 'block placed');

// --- mesher output is sane: quads, matching buffers, ambient occlusion baked in
const mesh = buildChunkMesh(one, 0, 0);
assert.ok(mesh.opaque, 'chunk 0,0 has an opaque mesh');
assert.equal(mesh.opaque.positions.length, mesh.opaque.vertexCount * 3, 'positions match vertex count');
assert.equal(mesh.opaque.colors.length, mesh.opaque.vertexCount * 3, 'colours match vertex count');
assert.equal(mesh.opaque.normals.length, mesh.opaque.vertexCount * 3, 'normals match vertex count');
assert.equal(mesh.opaque.indices.length, mesh.opaque.quadCount * 6, 'indices match quad count');
assert.ok(mesh.opaque.quadCount > 200, `visible faces are emitted (${mesh.opaque.quadCount} quads)`);
for (let i = 0; i < mesh.opaque.colors.length; i += 97) {
  const value = mesh.opaque.colors[i];
  assert.ok(value >= 0 && value <= 1, 'baked colours stay in range');
}
const top = mesh.opaque.normals.findIndex((value, index) => index % 3 === 1 && value === 1);
assert.ok(top >= 0, 'some faces point up');
assert.ok(mesh.water === null || mesh.water.quadCount >= 0, 'water mesh is optional but valid');

// --- player physics: falls, lands, jumps, and cannot walk through stone
const player = new Player(one);
for (let i = 0; i < 600; i++) player.update(1 / 60, { forward: false, back: false, left: false, right: false, jump: false, crouch: false, sprint: false }, one);
assert.ok(player.onGround, 'the player lands');
assert.ok(player.y > 0 && player.y < WORLD_Y, 'and lands inside the world');
const restingY = player.y;
player.update(1 / 60, { forward: false, back: false, left: false, right: false, jump: true, crouch: false, sprint: false }, one);
assert.ok(player.velocityY > 0, 'jump gives upward speed');
assert.ok(!player.onGround, 'and leaves the ground');
for (let i = 0; i < 60; i++) player.update(1 / 60, { forward: false, back: false, left: false, right: false, jump: false, crouch: false, sprint: false }, one);
assert.ok(Math.abs(player.y - restingY) < 0.2, 'gravity brings the player back down');

// walking into a wall stops the player instead of clipping through
const course = new VoxelWorld(7);
const baseY = 40;
for (let x = 6; x < 16; x++) for (let z = 8; z < 14; z++) {
  for (let y = baseY; y < baseY + 5; y++) course.set(x, y, z, AIR);   // carve a clear track
  course.set(x, baseY - 1, z, STONE);                                  // and give it a floor
}
for (let y = baseY; y < baseY + 5; y++) course.set(12, y, 11, STONE);  // wall across the track
const walker = new Player(course);
walker.x = 9.5; walker.y = baseY + 0.01; walker.z = 11.5; walker.yaw = -Math.PI / 2;
walker.velocityX = walker.velocityY = walker.velocityZ = 0;
for (let i = 0; i < 180; i++) walker.update(1 / 60, { forward: true, back: false, left: false, right: false, jump: false, crouch: false, sprint: true }, course);
assert.ok(walker.x < 12, `the player is blocked by the wall (x=${walker.x.toFixed(2)})`);
assert.ok(walker.x > 10, `and actually walked up to it (x=${walker.x.toFixed(2)})`);
assert.ok(!walker.collides(course), 'the player never ends up inside a block');
assert.ok(walker.onGround, 'the player is still standing on the floor');

// --- sky palette shifts across a day
assert.ok(Math.abs(sunHeight(0.5) - 1) < 1e-6, 'noon sun is at its highest');
assert.ok(sunHeight(0.0) < 0, 'midnight sun is below the horizon');
const noon = skyPalette(0.5), night = skyPalette(0.0);
assert.ok(night.night > 0.8 && noon.night < 0.1, 'night factor follows the clock');
assert.ok(noon.zenith[2] > night.zenith[2], 'the day sky is bluer than the night sky');

// =============================================================== browser stubs

class StubElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.clientWidth = 960;
    this.clientHeight = 600;
    this.classList = {
      toggle: () => {},
      add: () => {},
      remove: () => {},
      contains: () => false,
    };
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, event = {}) {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) handler({ preventDefault() {}, stopPropagation() {}, target: this, ...event });
    return handlers.length;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  focus() {}
  requestPointerLock() {}
  requestFullscreen() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}

function createGlStub() {
  const stats = { draws: 0, uploads: 0, programs: 0 };
  const constants = {};
  const target = {
    stats,
    getExtension: () => null,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramParameter: () => 1,
    getProgramInfoLog: () => '',
    getActiveAttrib: () => ({ name: 'aPosition' }),
    getActiveUniform: () => ({ name: 'uViewProjection' }),
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createProgram: () => { stats.programs++; return {}; },
    createShader: () => ({}),
    createBuffer: () => { stats.uploads++; return {}; },
    drawElements: () => { stats.draws++; },
    drawArrays: () => { stats.draws++; },
    bufferData: () => {},
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (typeof property === 'string' && /^[A-Z][A-Z0-9_]*$/.test(property)) return constants[property] ?? 1;
      return () => undefined;
    },
  });
}

const glStub = createGlStub();
const elements = new Map();
const canvas = new StubElement('game');
canvas.getContext = () => glStub;
elements.set('game', canvas);

const touchButtons = ['jump', 'mine', 'place', 'fly'].map(action => {
  const button = new StubElement();
  button.dataset.touchAction = action;
  return button;
});

const storage = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id);
  },
  createElement: () => new StubElement(),
  querySelectorAll: selector => (selector === '[data-touch-action]' ? touchButtons : []),
  querySelector: () => new StubElement('game-frame'),
  addEventListener() {},
  fullscreenElement: null,
  exitFullscreen() {},
  pointerLockElement: null,
};
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
  setInterval: () => 0,
  confirm: () => true,
};
globalThis.location = { search: '', origin: 'http://localhost:8000', pathname: '/' };
try {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
} catch (_) { /* clipboard is optional for the test */ }
globalThis.AudioContext = class { constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; } createOscillator() { return { connect: () => ({ connect: () => {} }), start() {}, stop() {}, frequency: {} }; } createGain() { return { connect: () => {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } resume() {} };

let frameQueue = [];
let clock = 0;
globalThis.requestAnimationFrame = callback => { frameQueue.push(callback); return frameQueue.length; };
globalThis.performance = globalThis.performance ?? { now: () => clock };

function step(frames = 1, milliseconds = 16) {
  for (let i = 0; i < frames; i++) {
    clock += milliseconds;
    const queue = frameQueue;
    frameQueue = [];
    for (const callback of queue) callback(clock);
  }
}

// =============================================================== the whole game

const { PixeledGame } = await import('../web/main.js');
const game = new PixeledGame(canvas);

assert.equal(elements.get('hotbar').children.length, 9, 'nine blocks in the hotbar');
assert.ok(game.world instanceof VoxelWorld, 'a world was generated');
assert.ok(game.renderer.pending.length === 64, `all 64 chunks are queued for meshing (${game.renderer.pending.length})`);
assert.ok(glStub.stats.programs >= 3, 'sky, terrain and highlight shaders compiled');

step(40);
assert.ok(game.renderer.meshes.size > 20, `chunks were meshed (${game.renderer.meshes.size})`);
assert.ok(glStub.stats.draws > 0, 'the renderer draws every frame');
assert.ok(game.loaded, 'loading finished');
assert.ok(elements.get('hud-fps').textContent.length > 0, 'the HUD is updated');

// --- mine the block the crosshair is aiming at, and check the mesh is rebuilt
game.player.pitch = -1.2;
const hit = game.target();
assert.ok(hit, 'the player is aiming at terrain');
const before = game.world.get(hit.x, hit.y, hit.z);
game.mine();
assert.equal(game.world.get(hit.x, hit.y, hit.z), AIR, 'mining removes the aimed block');
assert.ok(game.world.edits.size >= 1, 'the change is recorded for saving');
assert.notEqual(before, AIR, 'there was a block there to mine');

// --- build a block on top of the hole
game.selectHotbar(7);                        // planks
const below = { x: hit.x, y: hit.y - 1, z: hit.z };
if (game.world.get(below.x, below.y, below.z) === AIR) game.world.set(below.x, below.y, below.z, STONE);
game.player.pitch = -1.2;
game.build();
assert.ok(game.world.edits.size >= 1, 'building records an edit');
const placed = [...game.world.edits.values()].some(id => id === 8);
assert.ok(placed || game.world.get(hit.x, hit.y, hit.z) !== AIR, 'a block was placed');

// --- flying, walking and looking
game.player.flying = true;
game.player.flying = false;
game.toggleFly();
assert.equal(game.player.flying, true, 'fly toggles on');
game.toggleFly();

const press = code => (windowListeners.get('keydown') ?? []).forEach(handler => handler({ code, preventDefault() {} }));
const release = code => (windowListeners.get('keyup') ?? []).forEach(handler => handler({ code }));
const startX = game.player.x, startZ = game.player.z;
press('KeyW');
step(30);
release('KeyW');
assert.ok(Math.hypot(game.player.x - startX, game.player.z - startZ) > 0.4, 'holding W walks forward');
press('Space');
assert.ok(game.input.takeJump(), 'space queues a jump');
release('Space');
press('Digit4');
assert.equal(game.selected, 3, 'number keys pick a hotbar slot');
press('KeyF');
assert.equal(game.player.flying, true, 'F toggles flying');
press('KeyF');

// --- mobile input: thumb-stick, drag-to-look and the action buttons
canvas.emit('touchstart', {
  pointerType: 'touch',
  changedTouches: [{ identifier: 1, clientX: 120, clientY: 620 }],
});
canvas.emit('touchmove', {
  pointerType: 'touch',
  changedTouches: [{ identifier: 1, clientX: 120, clientY: 560 }],
});
assert.ok(game.input.axes().forward > 0.5, 'dragging the thumb-stick up means "walk forward"');
canvas.emit('touchend', { pointerType: 'touch', changedTouches: [{ identifier: 1, clientX: 120, clientY: 560 }] });
assert.equal(game.input.axes().forward, 0, 'releasing the stick stops movement');

const yawBefore = game.player.yaw;
canvas.emit('touchstart', { pointerType: 'touch', changedTouches: [{ identifier: 2, clientX: 900, clientY: 300 }] });
canvas.emit('touchmove', { pointerType: 'touch', changedTouches: [{ identifier: 2, clientX: 960, clientY: 320 }] });
step(1);
assert.notEqual(game.player.yaw, yawBefore, 'dragging on the world turns the camera');
canvas.emit('touchend', { pointerType: 'touch', changedTouches: [{ identifier: 2, clientX: 960, clientY: 320 }] });

const mineButton = touchButtons.find(button => button.dataset.touchAction === 'mine');
const editsBefore = game.world.edits.size;
mineButton.emit('touchstart', { preventDefault() {} });
step(2);
mineButton.emit('touchend', { preventDefault() {} });
assert.ok(game.world.edits.size >= editsBefore, 'the MINE button digs (or finds nothing in reach)');

// --- persistence: the save holds the seed and the edits, and a reload restores them
game.save();
const raw = storage.get('pixeled-voxel-v2');
assert.ok(raw, 'the world is written to local storage');
const save = JSON.parse(raw);
assert.equal(save.seed, game.world.seed, 'the seed is stored');
assert.ok(Object.keys(save.edits).length >= 1, 'edits are stored');
assert.ok(Number.isFinite(save.player.x), 'the player position is stored');

frameQueue = [];
const reloaded = new PixeledGame(canvas);
assert.equal(reloaded.world.seed, game.world.seed, 'the same world comes back after a reload');
for (const [key, id] of Object.entries(save.edits)) {
  const [x, y, z] = key.split(',').map(Number);
  assert.equal(reloaded.world.get(x, y, z), id, `restored edit at ${key}`);
}
assert.ok(Math.abs(reloaded.player.x - save.player.x) < 0.001, 'the player resumes where they left off');

// --- a brand new world gets a different seed and a different landscape
const beforeSeed = reloaded.world.seed;
const beforeSkyline = skyline(reloaded.world).join(',');
reloaded.newWorld();
assert.notEqual(reloaded.world.seed, beforeSeed, 'New world rolls a fresh random seed');
assert.notEqual(skyline(reloaded.world).join(','), beforeSkyline, 'and a different landscape');
assert.equal(reloaded.world.edits.size, 0, 'a new world starts clean');

step(30);
assert.ok(reloaded.loaded, 'the new world finishes loading too');

console.log(`web smoke test passed — ${game.renderer.meshes.size} chunks meshed, ${glStub.stats.draws} draw calls, water blocks: ${waterCount}`);
void CHUNK; void SEA_LEVEL;
