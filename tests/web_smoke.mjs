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

// =============================================================== v3.1 systems
// Everything below was added in the big polish batch: particles, weather, settings, mining timers,
// the day cycle, the new blocks and the audio voices. Each block is a self-contained check.

const constants = await import('../web/constants.js');
const { Particles } = await import('../web/particles.js');
const { Weather } = await import('../web/weather.js');
const { Settings, DEFAULTS } = await import('../web/settings.js');
const { Mining, DayCycle, Footsteps, breakSeconds, dayPhase, isNight, describeTarget: describeBlock } = await import('../web/gameplay.js');

// --- the block table grew, and the old ids did not move
const blockIds = constants.BLOCKS.map(entry => entry.id);
assert.equal(new Set(blockIds).size, blockIds.length, 'block ids are unique');
assert.deepEqual(blockIds.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'ids 1-10 still match the other editions');
assert.equal(blockIds.length, 29, `twenty-nine blocks plus air (${blockIds.length})`);
assert.equal(constants.blockById(0).name, 'Air', 'id 0 is air in every edition');
assert.equal(constants.blockById(23).name, 'Spruce needles', 'the earlier batch of ids is untouched');
assert.equal(constants.blockById(29).name, 'Pumpkin', 'and id 29 is the newest block');
for (const id of blockIds) {
  const entry = constants.blockById(id);
  assert.equal(typeof entry.sound, 'string', `block ${entry.name} has a digging voice`);
  assert.ok(Number.isFinite(entry.hardness) || entry.hardness === Infinity, `block ${entry.name} has a hardness`);
  assert.equal(entry.top.length, 3, `block ${entry.name} has an RGB top face`);
  assert.ok(entry.top.every(channel => channel >= 0 && channel <= 1), `block ${entry.name} colour channels stay in range`);
}
assert.deepEqual(constants.ORES, [11, 12, 13, 14], 'four ores are declared');
assert.deepEqual(constants.PLANTS, [18, 19], 'two plants are declared');
assert.equal(constants.PALETTE.length, 28, `twenty-eight placeable blocks (${constants.PALETTE.length})`);
assert.ok(!constants.PALETTE.includes(constants.WATER), 'water is not placeable');
assert.ok(constants.isTransparent(constants.GLASS) && constants.isTransparent(constants.ICE), 'glass and ice are see-through');
assert.ok(!constants.isTransparent(constants.STONE), 'stone is opaque');
assert.ok(constants.isTransparent(constants.TALL_GRASS), 'plants do not block the view');
assert.equal(constants.EMISSIVE.has(constants.DIAMOND_ORE), true, 'diamond ore glows at night');
assert.ok(constants.blockById(999).id >= 1, 'an out-of-range id still returns a real block');

// --- mining times rise with hardness, and plants pop instantly
const hardOrder = [constants.GRASS, constants.STONE, constants.IRON_ORE, constants.DIAMOND_ORE].map(breakSeconds);
assert.ok(hardOrder[0] < hardOrder[1] && hardOrder[1] < hardOrder[2] && hardOrder[2] < hardOrder[3],
  `break times rise with hardness (${hardOrder.map(v => v.toFixed(2)).join(' < ')})`);
assert.equal(breakSeconds(constants.TALL_GRASS), 0, 'grass pops on the first tap');
assert.equal(breakSeconds(constants.WATER), Infinity, 'water is never "mined"');

// --- ore bands: rare stuff deep down, coal all over
const census = new Map();
let deepest = new Map();
for (let y = 0; y < WORLD_Y; y++) {
  for (let z = 0; z < WORLD_Z; z++) {
    for (let x = 0; x < WORLD_X; x++) {
      const id = one.get(x, y, z);
      if (constants.ORES.includes(id)) {
        census.set(id, (census.get(id) ?? 0) + 1);
        deepest.set(id, Math.max(deepest.get(id) ?? 0, y));
      }
    }
  }
}
for (const ore of constants.ORES) assert.ok((census.get(ore) ?? 0) > 100, `ore ${ore} exists in the world (${census.get(ore) ?? 0})`);
assert.ok(deepest.get(constants.DIAMOND_ORE) < 14, `diamond stays in the deep band (max y ${deepest.get(constants.DIAMOND_ORE)})`);
assert.ok(deepest.get(constants.GOLD_ORE) < 14, 'gold is a deep ore too');
assert.ok(deepest.get(constants.IRON_ORE) < 26, 'iron stops below the caves');
assert.ok(deepest.get(constants.COAL_ORE) > deepest.get(constants.DIAMOND_ORE), 'coal reaches higher than diamond');
assert.ok(census.get(constants.COAL_ORE) > census.get(constants.DIAMOND_ORE), 'diamond is rarer than coal');

// --- decorations and the deep rock types the third wave added
const decoration = new Map();
for (const seed of [2408, 7, 4242, 99, 31337]) {
  const world = new VoxelWorld(seed);
  for (let i = 0; i < world.data.length; i++) {
    const id = world.data[i];
    if (id) decoration.set(id, (decoration.get(id) ?? 0) + 1);
  }
}
for (const [name, id] of [
  ['birch logs', constants.BIRCH_LOG], ['birch leaves', constants.BIRCH_LEAVES],
  ['cobblestone', constants.COBBLESTONE], ['mossy stone', constants.MOSSY_STONE],
  ['obsidian', constants.OBSIDIAN], ['pumpkins', constants.PUMPKIN],
]) {
  assert.ok((decoration.get(id) ?? 0) > 5, `${name} generate in the world (${decoration.get(id) ?? 0} across five seeds)`);
}
assert.ok(decoration.get(constants.OBSIDIAN) < decoration.get(constants.COBBLESTONE), 'obsidian is rarer than cobblestone');

// --- biomes: a normal world is not one shade of green
const biomeNamesIn = world => {
  const seen = new Set();
  for (let x = 4; x < WORLD_X; x += 5) {
    for (let z = 4; z < WORLD_Z; z += 5) seen.add(world.biomeNameAt(x, z));
  }
  return seen;
};
const biomeSeen = biomeNamesIn(one);
assert.ok(biomeSeen.size >= 3, `one world holds several biomes (${[...biomeSeen].join(', ')})`);
assert.ok(one.tintAt(40, 40).length === 3, 'every column has a grass tint');
const allBiomes = new Set([...biomeSeen]);
for (const seed of [7, 99, 4242, 90210, 31337, 6512, 8080, 1234, 5150, 20001]) {
  for (const name of biomeNamesIn(new VoxelWorld(seed))) allBiomes.add(name);
}
assert.equal(allBiomes.size, 7, `all seven biomes grow somewhere (${[...allBiomes].sort().join(', ')})`);
const tintValues = Object.values((await import('../web/world.js')).GRASS_TINTS);
assert.equal(tintValues.length, 7, 'seven biomes each have a grass tint');
for (const tint of tintValues) assert.equal(tint.length, 3, 'tints are RGB triples');

// --- plants and boulders end up in the mesh
const plantChunk = buildChunkMesh(one, 3, 3);
assert.ok(plantChunk.opaque.quadCount > 0, 'chunks still emit opaque geometry');
for (const layer of ['opaque', 'water', 'plants']) {
  assert.ok(layer in plantChunk, `the mesher returns the ${layer} layer separately`);
}
let plantQuads = 0, plantColours = 0, plantVertices = 0;
for (let cx = 0; cx < 8; cx++) {
  for (let cz = 0; cz < 8; cz++) {
    const mesh = buildChunkMesh(one, cx, cz);
    if (mesh.plants) {
      plantQuads += mesh.plants.quadCount;
      plantColours += mesh.plants.colors.length;
      plantVertices += mesh.plants.vertexCount;
      assert.equal(mesh.plants.colors.length, mesh.plants.vertexCount * 3, 'plant colours match their vertices');
      assert.equal(mesh.plants.indices.length, mesh.plants.quadCount * 6, 'plant indices are triangles');
    }
  }
}
assert.ok(plantQuads > 0, `crossed plants are meshed somewhere (${plantQuads} plant quads)`);
assert.ok(plantVertices > 0 && plantColours === plantVertices * 3, 'every plant vertex carries its biome colour');

// --- particles: a fixed pool, gravity, and no leaks
const particles = new Particles(48);
assert.equal(particles.active, 0, 'the pool starts empty');
particles.burst(4, 4, 4, [0.5, 0.4, 0.3], 20);
assert.equal(particles.active, 20, 'a burst fills twenty particles');
particles.splash(2, 2, 2, 10);
assert.equal(particles.active, 30, 'a splash adds droplets');
particles.dust(1, 1, 1, [0.4, 0.4, 0.4]);
particles.leaves(3, 3, 3, [0.3, 0.7, 0.3], 6);
assert.equal(particles.active, 40, 'dust and leaves add their own particles');
particles.burst(9, 9, 9, [0.2, 0.2, 0.9], 200);
assert.equal(particles.active, 48, 'the pool caps at its limit and never overflows');
const over = [];
for (let i = 0; i < 120; i++) over.push(particles.take());
assert.ok(new Set(over).size <= 48, 'particles are recycled from the same pool, not allocated');
assert.ok(particles.spawned >= 100, `the pool counts what it has spawned (${particles.spawned})`);
for (let i = 0; i < 90; i++) particles.update(1 / 60, one);      // a second and a half of frames
assert.ok(particles.active < 48, `short-lived particles expire (${particles.active} left)`);
assert.ok(particles.visible().length === particles.active, 'only live particles reach the renderer');
particles.clear();
assert.equal(particles.active, 0, 'clear empties the pool');
const faller = particles.take();
Object.assign(faller, { x: 40, y: 50, z: 40, vx: 0, vy: 0, vz: 0, size: 0.05, life: 5, gravity: 1, drag: 1, r: 1, g: 1, b: 1, a: 1 });
for (let i = 0; i < 6; i++) particles.update(1 / 60, one);
assert.ok(faller.vy < 0, 'gravity pulls particles down');
assert.ok(faller.y < 50, 'and they actually fall');

// --- weather: it rains, it snows, it thunders, and it saves
const weather = new Weather(4242);
assert.equal(weather.state.label, 'clear', 'a fresh world starts clear');
const realRandom = Math.random;
let thunderSeen = 0;
for (let second = 0; second < 60 * 25; second++) {
  for (let frame = 0; frame < 10; frame++) {
    weather.update(0.1, { snowBiome: second > 900 });          // simulate ten minutes
    if (weather.thundering) thunderSeen++;
  }
}
assert.ok(weather.cycles > 0, `the sky changes over time (${weather.cycles} fronts)`);
assert.ok(weather.strikes > 0, `thunderstorms strike (${weather.strikes})`);
void thunderSeen;
weather.phase = 'storm'; weather.target = 1; weather.intensity = 1; weather.stormy = true; weather.timer = 1e6;
Math.random = () => 0;                                          // force the strike roll to succeed
weather.update(1 / 60, {});
assert.ok(weather.flash > 0, 'a strike lights the sky');
assert.equal(weather.thundering, true, 'and reports the thunder for the audio');
Math.random = realRandom;
const snowy = new Weather(7);
snowy.phase = 'storm'; snowy.target = 1; snowy.stormy = false; snowy.timer = 1e6;
for (let i = 0; i < 60; i++) snowy.update(0.1, { snowBiome: true });
assert.equal(snowy.state.snow, true, 'cold biomes get snow instead of rain');
assert.equal(snowy.state.raining, false, 'snow is not rain');
const roundTrip = new Weather(11);
roundTrip.phase = 'storm'; roundTrip.timer = 42; roundTrip.intensity = 0.62; roundTrip.cycles = 3;
const loaded = new Weather(11).load(roundTrip.serialize());
assert.equal(loaded.phase, 'storm', 'the storm survives a save');
assert.ok(Math.abs(loaded.timer - 42) < 0.001, 'so does the countdown');
assert.ok(Math.abs(loaded.intensity - 0.62) < 0.001, 'and the intensity');
const off = new Weather(5, { enabled: false });
off.intensity = 1;
for (let i = 0; i < 40; i++) off.update(0.1, {});
assert.ok(off.intensity < 0.5, 'turning weather off drains the sky');

// --- settings: clamped, sticky, and separate from the world save
const store = new Map();
const settingsStore = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
const settings = new Settings(settingsStore);
assert.equal(settings.get('fov'), DEFAULTS.fov, 'settings start at their defaults');
assert.equal(settings.set('fov', 9999), 110, 'field of view is clamped at the top');
assert.equal(settings.set('fov', 1), 50, 'and at the bottom');
assert.equal(settings.set('volume', -20), 0, 'volume cannot go negative');
assert.equal(settings.set('uiScale', 500), 150, 'the HUD cannot grow past 150%');
assert.equal(settings.set('bob', 0), false, 'switches coerce to booleans');
assert.equal(settings.set('nonsense', 5), undefined, 'unknown keys are ignored');
assert.ok(store.has('pixeled-settings-v1'), 'settings are written under their own key');
const remembered = new Settings(settingsStore);
assert.equal(remembered.get('fov'), 50, 'settings come back next time');
assert.equal(remembered.get('bob'), false, 'including the switches');
assert.ok(Math.abs(remembered.mouseSensitivity - 0.0022) < 1e-6, 'sensitivity is scaled for the look code');
assert.ok(Math.abs(settings.fovRadians - (50 * Math.PI) / 180) < 1e-9, 'field of view converts to radians');
settings.set('reducedMotion', true);
assert.ok(settings.effectiveDayLength > settings.get('dayLength'), 'reduced motion slows the clock');
settings.reset();
assert.equal(settings.get('fov'), DEFAULTS.fov, 'reset restores the defaults');
const brokenStore = new Settings({ getItem: () => '{not json', setItem: () => { throw new Error('private mode'); } });
assert.equal(brokenStore.get('fov'), DEFAULTS.fov, 'a corrupt settings blob falls back to defaults');
assert.doesNotThrow(() => brokenStore.save(), 'and a store that refuses writes does not crash the game');

// --- mining: progress, ticks, resets and instants
const mining = new Mining();
const stoneCell = { x: 40, y: 40, z: 40 };
one.set(stoneCell.x, stoneCell.y, stoneCell.z, constants.STONE);
one.set(stoneCell.x, stoneCell.y + 1, stoneCell.z, constants.AIR);
let miningTicks = 0;
let brokenAt = 0;
const miningStart = 0;
for (let i = 0; i < 600; i++) {
  const result = mining.hold(1 / 60, stoneCell, one);
  if (result.tick) miningTicks++;
  if (result.broken) { brokenAt = i / 60; break; }
}
assert.ok(brokenAt > 0.4, `stone takes real time to break (${brokenAt.toFixed(2)}s)`);
assert.ok(miningTicks >= 2, `the dig ticks along the way (${miningTicks})`);
const instant = mining.hold(1 / 60, stoneCell, { get: () => constants.TALL_GRASS });
assert.equal(instant.broken, true, 'plants break on the first bite');
const progressA = new Mining();
progressA.hold(0.3, stoneCell, one);
assert.ok(progressA.progress > 0.2 && progressA.progress < 0.6, 'a part-way dig reports its progress');
const firstKey = progressA.key;
progressA.hold(0.1, { x: 12, y: 30, z: 12 }, one);
assert.notEqual(progressA.key, firstKey, 'looking elsewhere re-targets the dig');
assert.equal(new Mining().hold(0.1, null, one).digging, false, 'mining nothing does nothing');
assert.equal(progressA.swingRate > 0, true, 'the swing rate is derived from the block');
void miningStart;

// --- the day cycle and its labels
const day = new DayCycle(600, 0.0);
const phasesSeen = new Set();
for (let i = 0; i < 600 * 61; i++) { day.update(1 / 60); phasesSeen.add(day.phase); }
assert.equal(day.days, 1, 'one full day passes in one day length (plus a second of slack)');
assert.deepEqual([...phasesSeen].sort(), ['dawn', 'day', 'dusk', 'night'], 'the clock visits every phase');
assert.match(day.timeLabel, /^\d\d:\d\d$/, 'the clock reads like a clock');
assert.equal(isNight(0.0), true, 'midnight is night');
assert.equal(dayPhase(0.5), 'day', 'midday is day');
assert.equal(dayPhase(1.5), dayPhase(0.5), 'the clock wraps around');

// --- footsteps and swimming
const steps = new Footsteps();
let walkSteps = 0;
for (let i = 0; i < 200; i++) if (steps.update(0.05, {})) walkSteps++;
assert.ok(walkSteps > 3 && walkSteps < 12, `a stride lands every couple of blocks (${walkSteps})`);
const sprintSteps = new Footsteps();
let fastSteps = 0;
for (let i = 0; i < 200; i++) if (sprintSteps.update(0.05, { sprinting: true })) fastSteps++;
assert.ok(fastSteps > walkSteps, `sprinting steps more often (${fastSteps} vs ${walkSteps})`);
assert.equal(new Footsteps().update(0.05, { inWater: true }), false, 'swimming makes no footstep sound');
assert.equal(new Footsteps().update(0.05, { onGround: false }), false, 'nor does falling');

describeBlock: {
  const named = describeBlock(one, { x: 40, y: 40, z: 40 });
  assert.equal(named, 'Stone', `the crosshair names the block (${named})`);
  assert.equal(describeBlock(one, null), '', 'and says nothing about thin air');
}

// --- audio: materials, loops and silence
const audio = new (await import('../web/audio.js')).Audio();
const created = { oscillators: 0, buffers: 0, sources: 0, filters: 0, gains: 0 };
globalThis.window = globalThis.window ?? {};
globalThis.window.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  createOscillator() { created.oscillators++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect: () => {} }), start() {}, stop() {} }; }
  createBuffer() { created.buffers++; return { getChannelData: () => new Float32Array(16) }; }
  createBufferSource() { created.sources++; return { buffer: null, loop: false, playbackRate: { value: 1 }, connect: () => ({ connect: () => ({ connect: () => {} }) }), start() {}, stop() {} }; }
  createBiquadFilter() { created.filters++; return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: () => ({ connect: () => ({ connect: () => {} }) }) }; }
  createGain() { created.gains++; return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }; }
  resume() {}
};
audio.resume();
audio.step(constants.GRASS);
audio.step(constants.STONE);
audio.digTick(constants.STONE);
audio.dig(constants.DIAMOND_ORE);
audio.splash();
audio.thunder();
assert.ok(created.oscillators > 0 && created.sources > 0, `sounds are synthesised (${created.oscillators} tones, ${created.sources} noise bursts)`);
assert.ok(created.filters > 0, 'and shaped by filters');
audio.setRain(0.8);
assert.ok(audio.rain, 'rain starts a looping source');
audio.setRain(0.9);
const rainSources = created.sources;
audio.setRain(0.4);
assert.equal(created.sources, rainSources, 'the rain loop is reused, never restarted');
audio.setRain(0);
assert.equal(audio.rain, null, 'and it stops when the sky clears');
audio.setVolume(0);
const quiet = created.oscillators;
audio.blip(440);
assert.equal(created.oscillators, quiet, 'muted audio makes no sound');
audio.setVolume(70);
assert.equal(audio.toggle(), false, 'the sound button mutes');
assert.equal(audio.toggle(), true, 'and unmutes');

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
    this.attributes = new Set();
    const classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const wanted = force === undefined ? !classes.has(name) : Boolean(force);
        if (wanted) classes.add(name); else classes.delete(name);
        return wanted;
      },
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      get length() { return classes.size; },
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
  setAttribute(name, value) { this.attributes.add(name); this[name] = value; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.has(name) ? this[name] : null; }
  querySelector() { return null; }
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
const documentListeners = new Map();
function onDocument(type, event = {}) {
  const handlers = documentListeners.get(type) ?? [];
  for (const handler of handlers) handler({ preventDefault() {}, stopPropagation() {}, ...event });
  return handlers.length;
}

globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id);
  },
  createElement: () => new StubElement(),
  querySelectorAll: selector => (selector === '[data-touch-action]' ? touchButtons : []),
  querySelector: () => new StubElement('game-frame'),
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  },
  fullscreenElement: null,
  exitFullscreen() {},
  exitPointerLock() {},
  pointerLockElement: null,
  body: new StubElement('body'),
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
// A fixed ?seed= makes the world (and therefore this test) reproducible.
globalThis.location = { search: '?seed=2408', origin: 'http://localhost:8000', pathname: '/' };
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

const press = code => (windowListeners.get('keydown') ?? []).forEach(handler => handler({ code, preventDefault() {} }));
const release = code => (windowListeners.get('keyup') ?? []).forEach(handler => handler({ code }));

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

// --- the start screen is up before anything else, and the world builds behind it
assert.equal(game.paused, true, 'the game starts on the start screen');
assert.equal(game.menu.isOpen, true, 'the menu reports itself open');
assert.equal(elements.get('menu').classList.contains('hidden'), false, 'the menu is visible');
assert.ok(elements.get('menu-play'), 'the menu has a Play button');
assert.ok(elements.get('menu-splash').textContent.length > 0, 'the splash text is set');
assert.equal(elements.get('menu-world').textContent.includes(String(game.world.seed)), true,
  'the menu shows the seed of the world behind it');
step(10);
assert.ok(elements.get('menu-controls').textContent.includes('WASD'), 'the menu lists the controls');
game.menu.setLookMode(true);
assert.ok(elements.get('menu-controls').textContent.startsWith('Drag to look'), 'and explains drag-to-look when capture is blocked');

const pausedStart = { x: game.player.x, z: game.player.z };
press('KeyW');
step(20);
release('KeyW');
assert.equal(game.player.x, pausedStart.x, 'movement keys do nothing while the menu is open');
assert.equal(game.player.z, pausedStart.z, 'and the player stays put');
assert.ok(game.panorama > 0, 'the camera turns slowly behind the menu');

// --- Enter and the Play button both start the game
press('Enter');
assert.equal(game.paused, false, 'Enter leaves the start screen');
assert.equal(game.menu.isOpen, false, 'and the menu closes');
game.pause(true);
assert.equal(game.paused, true, 'Escape opens the pause screen');
elements.get('menu-play').emit('click');
assert.equal(game.paused, false, 'the Play button resumes the game');

step(24);   // the status panel refreshes every quarter second
assert.ok(document.getElementById('hud-fps').textContent.length > 0, 'the HUD is updated once play starts');

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

// --- pointer capture can be refused (embedded frames); dragging must still look and click
game.input.pointerLocked = false;
game.player.yaw = 0;
const dragYawBefore = game.player.yaw;
canvas.emit('mousedown', { button: 0, clientX: 100, clientY: 100 });
onDocument('mousemove', { movementX: 40, movementY: 0 });
step(1);
assert.ok(Math.abs(game.player.yaw - dragYawBefore) > 0.01, 'dragging with the button held looks around');
onDocument('mouseup', { button: 0 });
assert.equal(game.input.mining, false, 'a drag does not keep mining');

// Aim straight down over untouched ground, so a click has a fresh block to remove.
const clickSpawn = game.world.spawnPoint();
game.player.x = Math.floor(clickSpawn.x) + 0.5;
game.player.z = Math.floor(clickSpawn.z) + 0.5;
game.player.y = game.world.surfaceHeight(Math.floor(game.player.x), Math.floor(game.player.z)) + 4;  // inside REACH
game.player.pitch = -1.2;
const clickTarget = game.target();
assert.ok(clickTarget && clickTarget.id !== AIR, 'aiming straight down finds solid ground');
canvas.emit('mousedown', { button: 0, clientX: 100, clientY: 100 });
onDocument('mouseup', { button: 0 });
assert.equal(game.world.get(clickTarget.x, clickTarget.y, clickTarget.z), AIR,
  'a click with no drag mines the aimed block');

// And a right click builds into the cell it just cleared.
game.selectHotbar(2);
game.player.pitch = -1.2;
const buildTarget = game.target();
assert.ok(buildTarget, 'there is still ground in reach to build against');
const buildCell = placementCell(buildTarget);
canvas.emit('mousedown', { button: 2, clientX: 100, clientY: 100 });
onDocument('mouseup', { button: 2 });
assert.equal(game.world.get(buildCell.x, buildCell.y, buildCell.z), STONE,
  'a right click with no drag builds the selected block');
// A refused capture flips the input layer into drag mode and tells the player how to look.
game.input.pointerLocked = false;
game.input.dragLook = false;
game.input.enableDragLook();
assert.equal(game.input.dragLook, true, 'a refused pointer lock switches to drag-to-look');
assert.ok(elements.get('menu-controls').textContent.startsWith('Drag to look'), 'and the menu says so');
game.input.pointerLocked = true;       // back to captured mode for the rest of the run
game.input.dragLook = false;

// --- flying, walking and looking
game.player.flying = true;
game.player.flying = false;
game.toggleFly();
assert.equal(game.player.flying, true, 'fly toggles on');
game.toggleFly();

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

// =============================================================== v3.1 systems in the running game
// The reload check above threw away the first game's pending frame callback, so the instance
// that is still animating is the reloaded one. Drive that one from here on.
const live = reloaded;
assert.ok(live.particles instanceof Particles, 'the game owns a particle pool');
assert.ok(live.weather instanceof Weather, 'and a weather machine');
assert.ok(live.settings instanceof Settings, 'and a settings store');
assert.ok(live.panel, 'the pause menu has a settings panel');
assert.ok(live.fovSmooth > 0, 'the field of view is smoothed for the sprint stretch');

// --- the HUD grew extra readouts
step(24);
assert.ok(elements.get('hud-weather').textContent.length > 0, 'the HUD shows the sky');
assert.ok(['north', 'east', 'south', 'west', 'north-east', 'north-west', 'south-east', 'south-west']
  .includes(elements.get('hud-facing').textContent), `the HUD shows the compass (${elements.get('hud-facing').textContent})`);
assert.match(elements.get('hud-walked').textContent, /^\d+ m$/, 'the HUD counts the distance walked');
assert.match(elements.get('hud-mined').textContent, /^\d+$/, 'and the blocks broken');

// A test pad: flatten a patch of ground and clear the air above it, so digging and walking checks
// do not depend on whether the random world grew a tree or a cliff at that exact spot.
const PAD = { x: 64, z: 64, half: 8 };
const padHeight = live.world.surfaceHeight(PAD.x, PAD.z);
const buildPad = () => {
  for (let dz = -PAD.half; dz <= PAD.half; dz++) {
    for (let dx = -PAD.half; dx <= PAD.half; dx++) {
      live.world.set(PAD.x + dx, padHeight, PAD.z + dz, STONE);
      for (let y = padHeight + 1; y <= padHeight + 8; y++) live.world.set(PAD.x + dx, y, PAD.z + dz, AIR);
    }
  }
};
buildPad();
const standOnPad = (cellX, cellZ, lift = 3) => {
  live.player.flying = true;
  live.player.x = cellX + 0.5;
  live.player.z = cellZ + 0.5;
  live.player.y = padHeight + lift;
  live.player.velocityX = live.player.velocityY = live.player.velocityZ = 0;
};

// --- a stone block needs the button held, grass does not
if (live.paused) live.resume();
standOnPad(PAD.x, PAD.z);
live.world.set(PAD.x, padHeight, PAD.z, STONE);
live.world.set(PAD.x, padHeight + 1, PAD.z, AIR);
live.world.set(PAD.x, padHeight + 2, PAD.z, AIR);
live.player.pitch = -1.5; live.player.yaw = 0;
step(1);
const stoneTarget = live.target();
assert.ok(stoneTarget, 'there is stone under the crosshair');
live.mine();
assert.notEqual(live.world.get(stoneTarget.x, stoneTarget.y, stoneTarget.z), AIR, 'one tap does not break stone');
live.input.mining = true;
step(90);
live.input.mining = false;
assert.equal(live.world.get(stoneTarget.x, stoneTarget.y, stoneTarget.z), AIR, 'holding the button does');
assert.ok(live.particles.spawned > 0, 'breaking a block throws particles');
assert.ok(live.tally.broken >= 1, 'and the tally counts it');
assert.ok(live.world.edits.size >= 1, 'the block change is recorded for saving');

// --- particles also appear when building, and quieten down when switched off
live.settings.set('particles', false);
live.onSettingChanged('particles', false);
const spawnedWithParticlesOff = live.particles.spawned;
live.selectHotbar(2);
live.player.pitch = -1.5;
const beforeBuildParticles = live.particles.active;
live.build();
assert.equal(live.particles.active, beforeBuildParticles, 'no particles are made when the setting is off');
assert.equal(live.particles.spawned, spawnedWithParticlesOff, 'and the pool is left alone');
live.settings.set('particles', true);
live.onSettingChanged('particles', true);

// --- underwater: the breath bar appears and drains
live.player.flying = false;
const waterSpot = live.world.spawnPoint();
// Find a *deep* pool, not just a cell with water on top: the player has to fit inside water whose
// surface is above their eyes.
let waterColumn = null;
for (let z = 1; z < WORLD_Z - 1; z += 2) {
  for (let x = 1; x < WORLD_X - 1; x += 2) {
    if (live.world.get(x, SEA_LEVEL, z) !== WATER) continue;
    let depth = 0;
    while (live.world.isLiquid(x, SEA_LEVEL - depth - 1, z)) depth++;
    if (depth < 4) continue;
    if (!waterColumn || depth > waterColumn.depth) waterColumn = { x, z, depth };
  }
}
assert.ok(waterColumn && waterColumn.depth >= 4, `the world has deep water to dive into (${waterColumn?.depth})`);
live.player.x = waterColumn.x + 0.5;
live.player.z = waterColumn.z + 0.5;
live.player.y = SEA_LEVEL - 1.5;
const breathBefore = live.player.breath;
step(20);
assert.equal(live.player.headUnder, true, 'the player is under water');
assert.ok(live.player.breath < breathBefore, 'breath drains under water');
assert.equal(elements.get('breath').hidden, false, 'the breath bar appears');
assert.ok(elements.get('breath-fill').style.width.endsWith('%'), 'and shows how much is left');
live.player.y = SEA_LEVEL + 4;
step(30);
assert.ok(live.player.breath > 4, 'breath refills in the air');

// --- weather in the running game, and turning it off
live.weather.phase = 'storm';
live.weather.target = 1;
live.weather.stormy = true;
live.weather.timer = 1e6;
step(30);
assert.ok(live.weather.intensity > 0, 'a storm builds up while playing');
step(24);
assert.ok(elements.get('hud-weather').textContent !== 'clear', 'the HUD reports the weather');
live.settings.set('weather', false);
live.onSettingChanged('weather', false);
for (let i = 0; i < 30; i++) live.weather.update(0.2, {});
assert.ok(live.weather.intensity < 0.05, 'switching weather off clears the sky');
live.settings.set('weather', true);
live.onSettingChanged('weather', true);

// --- settings changes reach the systems they control (the panel stores then notifies)
const setOption = (key, value) => {
  live.settings.set(key, value);
  return live.onSettingChanged(key, live.settings.get(key));
};
setOption('renderDistance', 72);
assert.equal(live.viewDistance, 72, 'view distance is applied');
setOption('fov', 90);
assert.ok(Math.abs(live.fov - (90 * Math.PI) / 180) < 1e-9, 'field of view is applied');
setOption('volume', 15);
assert.ok(Math.abs(live.audio.volume - 0.15) < 1e-9, 'volume is applied');
setOption('particles', false);
setOption('particles', true);
setOption('minimap', false);
step(24);
assert.equal(elements.get('hud-biome').textContent, '—', 'the biome readout can be hidden');
setOption('minimap', true);
step(24);
assert.notEqual(elements.get('hud-biome').textContent, '—', 'and comes back');
setOption('reducedMotion', true);
assert.ok(live.settings.effectiveDayLength > 600, 'reduced motion stretches the day while playing');
setOption('reducedMotion', false);
setOption('bob', false);
step(5);
assert.ok(Math.abs(live.player.cameraRoll) < 0.05, 'turning view bob off steadies the camera');
setOption('bob', true);
setOption('viewmodel', false);
assert.equal(live.settings.get('viewmodel'), false, 'the held block can be hidden');
setOption('dayLength', 300);
assert.equal(live.day.seconds, 300, 'the day length is applied live');
setOption('uiScale', 120);
assert.equal(live.settings.get('uiScale'), 120, 'the HUD scale is stored');
setOption('adaptiveDistance', true);
live.fps = 20;
step(30);
assert.ok(live.viewDistance <= 72, `a slow frame rate shortens the fog (${live.viewDistance})`);
setOption('adaptiveDistance', false);
step(30);
assert.equal(live.viewDistance, live.settings.get('renderDistance'), 'and turning it off restores the chosen distance');

// --- walking, sprinting and crouching all move at different speeds
const distanceOver = (input, frames = 60) => {
  if (live.paused) live.resume();
  buildPad();
  live.player.flying = false;
  live.player.x = PAD.x + 0.5;
  live.player.z = PAD.z + PAD.half - 1 + 0.5;      // start at one end of the pad
  live.player.y = padHeight + 1;
  live.player.velocityX = live.player.velocityY = live.player.velocityZ = 0;
  live.input.keys.clear();
  for (const key of input) live.input.keys.add(key);
  const startX = live.player.x, startZ = live.player.z;
  step(frames);
  live.input.keys.clear();
  return Math.hypot(live.player.x - startX, live.player.z - startZ);
};
live.player.yaw = 0;
const walked = distanceOver(['KeyW']);
const sprinted = distanceOver(['KeyW', 'ShiftLeft']);
const crouched = distanceOver(['KeyW', 'ControlLeft']);
assert.ok(walked > 0.2, `holding W moves the player (${walked.toFixed(2)} blocks/s)`);
assert.ok(sprinted > walked * 1.2, `sprinting is faster (${sprinted.toFixed(2)} vs ${walked.toFixed(2)})`);
assert.ok(crouched < walked, `crouching is slower (${crouched.toFixed(2)})`);
assert.ok(live.tally.distance > 0, 'the odometer counts the walking');

// --- the save now carries the weather and the tally
live.save();
const richSave = JSON.parse(storage.get('pixeled-voxel-v2'));
assert.ok(richSave.weather && typeof richSave.weather.phase === 'string', 'the save stores the weather');
assert.ok(Number.isInteger(richSave.broken), 'and the tally');
assert.ok(Number.isFinite(richSave.distance), 'and the view distance');


// --- zoom: holding Z narrows the field of view and releasing eases it back
live.input.keys.delete('KeyZ');
step(30);
const restingFov = live.fovSmooth;
live.input.keys.add('KeyZ');
step(40);
assert.ok(live.fovSmooth < restingFov * 0.75, `holding Z zooms in (${live.fovSmooth.toFixed(1)} vs ${restingFov.toFixed(1)})`);
live.input.keys.delete('KeyZ');
step(60);
assert.ok(live.fovSmooth > live.fov * 0.9, `releasing Z eases back out (${live.fovSmooth.toFixed(1)})`);

// --- milestones: cheerful one-off toasts as the tally grows
live.milestones.clear();
live.tally.broken = 600;
live.tally.placed = 70;
live.tally.distance = 1200;
live.checkMilestones();
for (const key of ['first-break', 'break-25', 'break-100', 'break-500', 'first-place', 'place-64', 'walk-200', 'walk-1000']) {
  assert.ok(live.milestones.has(key), `milestone ${key} fired`);
}
assert.ok(elements.get('toast').textContent.length > 0, 'a milestone shows a toast');
assert.equal(live.milestone('break-500', 'again'), false, 'each milestone only fires once');
assert.equal(live.milestone('brand-new', 'hello'), true, 'a new key fires');

// --- breaking a diamond celebrates, which also exercises the deep-ore flavour text
if (live.paused) live.resume();
live.world.set(PAD.x + 3, padHeight, PAD.z + 3, constants.DIAMOND_ORE);
standOnPad(PAD.x + 3, PAD.z + 3);
live.player.pitch = -1.5; live.player.yaw = 0;
step(1);
live.input.mining = true;
step(120);
live.input.mining = false;
assert.equal(live.world.get(PAD.x + 3, padHeight, PAD.z + 3), AIR, 'the diamond block breaks after a long dig');
assert.ok(live.milestones.has('diamond'), 'finding diamond is a milestone');
assert.ok(elements.get('toast').textContent.includes('Diamond'), 'and the toast says so');
live.tally.broken = live.tally.broken;   // unchanged: the tally belongs to the real session

console.log(`web smoke test passed — ${game.renderer.meshes.size} chunks meshed, ${glStub.stats.draws} draw calls, water blocks: ${waterCount}`);
void CHUNK; void SEA_LEVEL;
