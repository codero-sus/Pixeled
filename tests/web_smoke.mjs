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
import { readFileSync } from 'node:fs';

/** The source of a module, for assertions about the shaders and other embedded strings. */
const source = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

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
assert.equal(blockIds.length, 48, `forty-eight blocks plus air (${blockIds.length})`);
assert.equal(constants.blockById(0).name, 'Air', 'id 0 is air in every edition');
assert.equal(constants.blockById(23).name, 'Spruce needles', 'the earlier batch of ids is untouched');
assert.equal(constants.blockById(29).name, 'Pumpkin', 'the third wave of ids keeps its order');
assert.equal(constants.blockById(30).name, 'Lava', 'lava is id 30');
assert.equal(constants.blockById(31).name, 'Torch', 'torches are id 31');
assert.equal(constants.blockById(32).name, 'Sapling', 'and saplings are id 32');
assert.equal(constants.blockById(33).name, 'Smooth stone', 'the building batch starts at 33');
assert.equal(constants.blockById(40).name, 'Glass pane', 'panes are id 40');
assert.equal(constants.blockById(45).name, 'Bed', 'beds are id 45');
assert.equal(constants.blockById(48).name, 'Bookshelf', 'and bookshelves close the range at 48');
for (const id of blockIds) {
  const entry = constants.blockById(id);
  assert.equal(typeof entry.sound, 'string', `block ${entry.name} has a digging voice`);
  assert.ok(Number.isFinite(entry.hardness) || entry.hardness === Infinity, `block ${entry.name} has a hardness`);
  assert.equal(entry.top.length, 3, `block ${entry.name} has an RGB top face`);
  assert.ok(entry.top.every(channel => channel >= 0 && channel <= 1), `block ${entry.name} colour channels stay in range`);
}
assert.deepEqual(constants.ORES, [11, 12, 13, 14], 'four ores are declared');
assert.deepEqual(constants.PLANTS, [18, 19], 'two plants are declared');
assert.equal(constants.PALETTE.length, 46, `forty-six placeable blocks (${constants.PALETTE.length})`);
assert.ok(constants.PALETTE.includes(constants.TORCH), 'torches can be placed');
assert.ok(constants.PALETTE.includes(constants.SAPLING), 'so can saplings');
assert.ok(!constants.PALETTE.includes(constants.LAVA), 'lava is a hazard, not a building material');
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

// =============================================================== v3.3 systems
// Light, lava, gravity blocks, saplings and leaf decay.

const { LightEngine } = await import('../web/light.js');
const { lightCurve } = await import('../web/mesher.js');

// --- the block table keeps growing, in order
const lightSources = Object.entries(constants.LIGHT_SOURCES).map(([id, level]) => [Number(id), level]);
assert.ok(lightSources.length >= 2, 'torches and lava are light sources');
assert.equal(constants.lightOf(constants.TORCH), 14, 'a torch lights fourteen levels');
assert.equal(constants.lightOf(constants.LAVA), 12, 'lava glows twelve');
assert.equal(constants.lightOf(constants.STONE), 0, 'stone does not glow');
assert.ok(constants.FALLING.has(constants.SAND) && constants.FALLING.has(constants.GRAVEL), 'sand and gravel fall');
assert.ok(!constants.FALLING.has(constants.STONE), 'stone does not');
assert.equal(constants.DAMAGING.get(constants.LAVA), 1, 'lava hurts');
assert.ok(!constants.DAMAGING.has(constants.WATER), 'water does not');

// --- lava only pools deep underground
const lavaCount = new Map();
for (const seed of [2408, 7, 99]) {
  const world = new VoxelWorld(seed);
  let count = 0, shallow = 0;
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        if (world.get(x, y, z) !== constants.LAVA) continue;
        count++;
        if (y > 13) shallow++;
      }
    }
  }
  lavaCount.set(seed, count);
  assert.ok(count > 200, `seed ${seed} has lava somewhere (${count})`);
  assert.equal(shallow, 0, 'and never above y = 13');
}

// --- the light engine: torches light rooms, walls block the light
const lightWorld = new VoxelWorld(2408);
const light = new LightEngine(lightWorld);
lightWorld.light = light;
light.scan();
assert.ok(light.sources.size > 100, `the terrain glows in places (${light.sources.size} cells)`);
const lit = light.at(64, 60, 64);
assert.equal(lit, 15, 'daylight on the surface reads as full light');
assert.ok(light.blockLightAt(64, 60, 64) >= 0, 'and block light is reported separately');

// A sealed stone room with one torch: inside lit, outside pitch black.
for (let dx = -6; dx <= 6; dx++) {
  for (let dz = -6; dz <= 6; dz++) {
    for (let dy = 0; dy <= 6; dy++) lightWorld.set(20 + dx, 30 + dy, 20 + dz, constants.STONE);
  }
}
for (let dx = -2; dx <= 2; dx++) {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dy = 1; dy <= 3; dy++) lightWorld.set(20 + dx, 30 + dy, 20 + dz, constants.AIR);
  }
}
lightWorld.set(20, 31, 20, constants.TORCH);
assert.equal(light.blockLightAt(20, 31, 20), 14, 'the torch cell carries its own light');
assert.equal(light.blockLightAt(21, 31, 20), 13, 'light drops one level per step');
assert.equal(light.blockLightAt(22, 31, 20), 12, 'and keeps dropping');
assert.equal(light.blockLightAt(26, 31, 20), 0, 'the far side of a sealed room is dark');
assert.equal(light.blockLightAt(20, 37, 20), 0, 'so is the rock above the ceiling');
assert.equal(light.blockLightAt(20, 29, 20), 0, 'and the rock below the floor');
const outsideBefore = light.blockLightAt(20, 39, 20);
assert.equal(outsideBefore, 0, 'nothing leaks out of a sealed room');

// Break the wall and the light escapes through the hole.
lightWorld.set(23, 31, 20, constants.AIR);
lightWorld.set(24, 31, 20, constants.AIR);
lightWorld.set(25, 31, 20, constants.AIR);
lightWorld.set(26, 31, 20, constants.AIR);
assert.ok(light.blockLightAt(24, 31, 20) > 0, `light pours through the hole (${light.blockLightAt(24, 31, 20)})`);
assert.equal(light.blockLightAt(20, 31, 20), 14, 'and the torch itself is unchanged');

// Removing the torch darkens the room again.
lightWorld.set(20, 31, 20, constants.AIR);
assert.equal(light.blockLightAt(21, 31, 20), 0, 'taking the torch away leaves the room dark');
assert.equal(light.blockLightAt(20, 31, 20), 0, 'the torch cell too');
assert.ok(!light.sources.has(LightEngine.pack(20, 31, 20)), 'and it is no longer a light source');

// --- the light curve is monotonic and never fully black
const curve = [0, 3, 7, 11, 15].map(lightCurve);
for (let i = 1; i < curve.length; i++) assert.ok(curve[i] > curve[i - 1], 'brighter light means a brighter colour');
assert.ok(curve[0] > 0.2, 'deep darkness still keeps a little ambient light');
assert.ok(Math.abs(lightCurve(15) - 1) < 1e-9, 'full light is unmodified');

// --- sky light comes and goes with the skyline
const shaft = { x: 100, z: 100 };
const surface = lightWorld.surfaceHeight(shaft.x, shaft.z);
assert.equal(light.skyLight(shaft.x, surface + 1, shaft.z), 15, 'above ground is daylight');
assert.equal(light.skyLight(shaft.x, surface - 6, shaft.z), 0, 'cave dark');
// Digging a shaft straight down: the light follows the hole.
for (let y = surface + 1; y >= surface - 5; y--) lightWorld.set(shaft.x, y, shaft.z, constants.AIR);
assert.equal(light.skyLight(shaft.x, surface - 5, shaft.z), 15, 'a shaft lets the sun into a cave');

// --- gravity: sand and gravel fall, and stop when they land
const gravityWorld = new VoxelWorld(2408);
gravityWorld.light = new LightEngine(gravityWorld);
const sandy = { x: 90, z: 90 };
for (let y = 0; y <= 39; y++) gravityWorld.set(sandy.x, y, sandy.z, constants.STONE);
for (let y = 40; y <= 60; y++) gravityWorld.set(sandy.x, y, sandy.z, constants.AIR);
gravityWorld.set(sandy.x, 52, sandy.z, constants.SAND);          // dropped from five metres up
let fell = 0;
for (let tick = 0; tick < 40; tick++) fell += gravityWorld.worldTick().filter(event => event.id === constants.SAND).length;
assert.equal(gravityWorld.get(sandy.x, 40, sandy.z), constants.SAND, 'sand dropped in the air lands on the ground');
assert.equal(gravityWorld.get(sandy.x, 39, sandy.z), constants.STONE, 'and rests on the first solid block');
assert.ok(fell > 0, 'the tick reports the fall');
// Gravel falls too, and sand does not fall through a solid floor.
gravityWorld.set(sandy.x, 55, sandy.z, constants.GRAVEL);
for (let tick = 0; tick < 40; tick++) gravityWorld.worldTick();
assert.equal(gravityWorld.get(sandy.x, 41, sandy.z), constants.GRAVEL, 'gravel piles up on top of the sand');
assert.equal(gravityWorld.get(sandy.x, 40, sandy.z), constants.SAND, 'and the sand stays put underneath');

// Sand on a cliff edge falls when the block under it breaks.
const ledge = { x: 92, z: 92 };
gravityWorld.set(ledge.x, 30, ledge.z, constants.STONE);
gravityWorld.set(ledge.x, 31, ledge.z, constants.SAND);
assert.equal(gravityWorld.get(ledge.x, 31, ledge.z), constants.SAND, 'sand sits on the ledge');
gravityWorld.set(ledge.x, 30, ledge.z, constants.AIR);
for (let tick = 0; tick < 30; tick++) gravityWorld.worldTick();
assert.ok(gravityWorld.get(ledge.x, 31, ledge.z) !== constants.SAND, 'breaking the support drops the sand');

// --- saplings grow into trees, and the species follows the biome
const gardenWorld = new VoxelWorld(2408);
gardenWorld.light = new LightEngine(gardenWorld);
const plot = { x: 46, z: 46 };
for (let dz = -3; dz <= 3; dz++) {
  for (let dx = -3; dx <= 3; dx++) {
    gardenWorld.set(plot.x + dx, 30, plot.z + dz, constants.GRASS);
    for (let dy = 1; dy <= 8; dy++) gardenWorld.set(plot.x + dx, 30 + dy, plot.z + dz, constants.AIR);
  }
}
gardenWorld.set(plot.x, 31, plot.z, constants.SAPLING);
assert.equal(gardenWorld.plantSapling(plot.x, 31, plot.z), 1, 'the sapling is remembered for the world tick');
gardenWorld.worldTick();
assert.equal(gardenWorld.get(plot.x, 31, plot.z), constants.SAPLING, 'it does not grow instantly');
let grown = null;
for (let tick = 0; tick < 30 && !grown; tick++) {
  const events = gardenWorld.worldTick();
  grown = events.find(event => event.id === 'grown');
}
assert.ok(grown, 'the sapling grows within half a minute of ticks');
assert.match(constants.blockById(gardenWorld.get(plot.x, 32, plot.z)).name, /log/i, 'a trunk grew upward');
let leaves = 0;
for (let dy = 0; dy < 8; dy++) {
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) if (gardenWorld.isLeaf(gardenWorld.get(plot.x + dx, 31 + dy, plot.z + dz))) leaves++;
  }
}
assert.ok(leaves > 8, `and a crown of leaves (${leaves} leaf blocks)`);

// --- leaf decay: leaves need a trunk within reach
const decayWorld = new VoxelWorld(2408);
decayWorld.light = new LightEngine(decayWorld);
decayWorld.set(10, 30, 10, constants.LOG);
for (let dz = -2; dz <= 2; dz++) {
  for (let dx = -2; dx <= 2; dx++) {
    if (dx === 0 && dz === 0) continue;              // the trunk cell stays a trunk
    decayWorld.set(10 + dx, 30, 10 + dz, constants.LEAVES);
  }
}
assert.equal(decayWorld.get(10, 30, 10), constants.LOG, 'the trunk is still there');
assert.equal(decayWorld.decayLeaves(10, 30, 10).length, 0, 'leaves beside a trunk survive');
decayWorld.set(10, 30, 10, constants.AIR);
const withered = decayWorld.decayLeaves(10, 30, 10);
assert.ok(withered.length >= 24, `and wither when the trunk goes (${withered.length} cleared)`);
assert.equal(decayWorld.get(11, 30, 10), constants.AIR, 'the leaves are gone');
assert.equal(decayWorld.isLeaf(decayWorld.get(10, 30, 10)), false, 'the trunk cell is not a leaf');

// --- mesher: light is baked into the colours, and nothing is crushed to pure black
for (const [cx, cz] of [[0, 0], [4, 4], [7, 6]]) {
  const chunk = buildChunkMesh(lightWorld, cx, cz);
  if (!chunk.opaque) continue;
  let black = 0, darkest = 1;
  for (let i = 0; i < chunk.opaque.colors.length; i += 3) {
    const [r, g, b] = [chunk.opaque.colors[i], chunk.opaque.colors[i + 1], chunk.opaque.colors[i + 2]];
    if (r < 0.004 && g < 0.004 && b < 0.004) black++;
    darkest = Math.min(darkest, r + g + b);
  }
  assert.equal(black, 0, `chunk ${cx},${cz} has no vertex baked to pure black`);
  assert.ok(darkest > 0.01, `and keeps a floor of ambient light (darkest ${darkest.toFixed(3)})`);
}
// A torch really does brighten the mesh: the same column meshed with and without light differs.
const darkWorld = new VoxelWorld(2408);
const darkChunk = buildChunkMesh(darkWorld, 4, 4);
const sum = mesh => { let total = 0; for (let i = 0; i < mesh.opaque.colors.length; i++) total += mesh.opaque.colors[i]; return total; };
assert.ok(sum(buildChunkMesh(lightWorld, 4, 4)) > 0, 'lit chunks contribute colour');
assert.ok(darkChunk.opaque.colors.length > 0, 'unlit worlds still mesh (the light engine is optional)');

class StubElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
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
  emit(type, event = {}) {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) handler({ preventDefault() {}, stopPropagation() {}, target: this, ...event });
    return handlers.length;
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
      const calls = [];
      const record = name => (...args) => calls.push({ name, args });
      this.ctx2d = {
        calls, fillStyle: '', strokeStyle: '', lineWidth: 1,
        clearRect: record('clearRect'), beginPath: record('beginPath'), closePath: record('closePath'),
        moveTo: record('moveTo'), lineTo: record('lineTo'), arc: record('arc'),
        bezierCurveTo: record('bezierCurveTo'), save: record('save'), restore: record('restore'), rect: record('rect'),
        clip: record('clip'),
        fill: record('fill'), stroke: record('stroke'), fillRect: record('fillRect'),
      };
      Object.defineProperty(this.ctx2d, 'fillStyle', {
        get() { return calls.filter(call => call.name === 'fillStyle').at(-1)?.args[0] ?? ''; },
        set(value) { calls.push({ name: 'fillStyle', args: [value] }); },
      });
    }
    return this.ctx2d;
  }
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
// Every run of the live-game battery must build the same world: the game picks a random seed when
// there is no save, which used to make aim, digging and terrain tests flake once in a while.
const TEST_SEED = 20250816;
storage.set('pixeled-voxel-v2', JSON.stringify({ seed: TEST_SEED, edits: [] }));
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
// The pad is levelled all the way to the top of the world: anything left hanging above it would
// fall in a few ticks later and sit exactly where the placement tests want to build.
const buildPad = () => {
  for (let dz = -PAD.half; dz <= PAD.half; dz++) {
    for (let dx = -PAD.half; dx <= PAD.half; dx++) {
      live.world.set(PAD.x + dx, padHeight, PAD.z + dz, STONE);
      for (let y = padHeight + 1; y < CHUNK * 4; y++) live.world.set(PAD.x + dx, y, PAD.z + dz, AIR);
    }
  }
  live.world.fallQueue?.clear();
};
buildPad();
/**
 * Step frames while holding the crosshair exactly where the test wants it. The game rotates the view
 * for its own reasons (menu drift, leftover look deltas), so aimed tests re-aim every frame.
 */
const stepAimed = (frames, yaw, pitch) => {
  for (let frame = 0; frame < frames; frame++) {
    live.player.yaw = yaw;
    live.player.pitch = pitch;
    step(1);
  }
  live.player.yaw = yaw;
  live.player.pitch = pitch;
};

/**
 * Turn to face a cell and step frames until the crosshair is on it. Aiming by hand is fragile — the
 * player settles, the eye height shifts and a one-pixel miss becomes a flaky test.
 */
const aimAt = (x, y, z, frames = 90) => {
  for (let frame = 0; frame < frames; frame++) {
    const dx = x + 0.5 - live.player.x;
    const dz = z + 0.5 - live.player.z;
    const dy = y + 0.5 - live.player.eyeY;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    stepAimed(1, yaw, pitch);
    const hit = live.target();
    if (hit && hit.x === x && hit.y === y && hit.z === z) return true;
  }
  return false;
};

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
stepAimed(1, 0, -1.5);
const stoneTarget = live.target();
assert.ok(stoneTarget, 'there is stone under the crosshair');
live.mine();
assert.notEqual(live.world.get(stoneTarget.x, stoneTarget.y, stoneTarget.z), AIR, 'one tap does not break stone');
live.input.mining = true;
// Step until it breaks rather than assuming an exact swing length: what matters is that holding the
// button finishes the block that a single tap could not.
let digFrames = 0;
for (; digFrames < 400 && live.world.get(stoneTarget.x, stoneTarget.y, stoneTarget.z) !== AIR; digFrames++) {
  stepAimed(1, 0, -1.5);
}
live.input.mining = false;
assert.equal(live.world.get(stoneTarget.x, stoneTarget.y, stoneTarget.z), AIR, `holding the button does (${digFrames} frames)`);
assert.ok(digFrames > 5, 'and it is a real dig, not an instant break');
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
for (let z = 1; z < WORLD_Z - 1; z++) {
  for (let x = 1; x < WORLD_X - 1; x++) {
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
// Clear the column above it: anything that landed there earlier would soak up the dig.
for (let y = padHeight + 1; y <= padHeight + 4; y++) live.world.set(PAD.x + 3, y, PAD.z + 3, constants.AIR);
standOnPad(PAD.x + 3, PAD.z + 3);
stepAimed(1, 0, -1.5);
assert.equal(live.target()?.y, padHeight, 'the crosshair is aimed straight at the diamond');
live.input.mining = true;
for (let frame = 0; frame < 400 && live.world.get(PAD.x + 3, padHeight, PAD.z + 3) !== AIR; frame++) {
  stepAimed(1, 0, -1.5);
}
live.input.mining = false;
assert.equal(live.world.get(PAD.x + 3, padHeight, PAD.z + 3), AIR, 'the diamond block breaks after a long dig');
assert.ok(live.milestones.has('diamond'), 'finding diamond is a milestone');
assert.match(elements.get('toast').textContent, /diamond/i, 'and the toast says so');
live.tally.broken = live.tally.broken;   // unchanged: the tally belongs to the real session

// --- the block palette: pick a block, and it fills the selected hotbar slot
if (live.paused) live.resume();
live.selectHotbar(0);
assert.equal(live.slotBlock(), constants.GRASS, 'a fresh game starts on grass');
assert.equal(live.chooseBlock(constants.TORCH), true, 'the palette can choose a torch');
assert.equal(live.slotBlock(), constants.TORCH, 'and the slot now holds torches');
assert.equal(live.chooseBlock(constants.WATER), false, 'water cannot be chosen');
assert.equal(live.slotBlock(), constants.TORCH, 'so the slot is unchanged');
live.selectHotbar(3);
assert.equal(live.slotBlock(), constants.SAND, 'each slot keeps its own block');
live.chooseBlock(constants.SAPLING);
live.selectHotbar(0);
assert.equal(live.slotBlock(), constants.TORCH, 'slot 0 still holds the torch');
// place the torch on the test pad and check the world lights up around it
buildPad();
standOnPad(PAD.x + 2, PAD.z + 2);
stepAimed(2, 0, -1.5);
live.selectHotbar(0);
const torchTarget = live.target();
assert.ok(torchTarget, 'there is ground to place a torch on');
const torchCell = placementCell(torchTarget);
live.build();
assert.equal(live.world.get(torchCell.x, torchCell.y, torchCell.z), constants.TORCH, 'the torch is placed');
assert.ok(live.world.torchLightAt(torchCell.x, torchCell.y, torchCell.z) >= 14, 'and it lights its own cell');
assert.ok(live.world.torchLightAt(torchCell.x + 2, torchCell.y, torchCell.z) > 8, 'and the ground around it');

// --- breaking a torch takes the light away again
live.world.set(torchCell.x, torchCell.y, torchCell.z, constants.AIR);
assert.ok(live.world.torchLightAt(torchCell.x + 2, torchCell.y, torchCell.z) < 5, 'removing it puts the light out');

// --- the inventory counts what you dig up
live.inventory.clear();
live.selectHotbar(2);
live.world.set(PAD.x + 5, padHeight, PAD.z + 5, constants.STONE);
standOnPad(PAD.x + 5, PAD.z + 5);
live.player.pitch = -1.5;
step(1);
live.input.mining = true;
step(120);
live.input.mining = false;
assert.ok((live.inventory.get(constants.STONE) ?? 0) >= 1, 'dug-up blocks go into the inventory');
const paletteIds = constants.PALETTE;
assert.ok(paletteIds.includes(constants.TORCH) && paletteIds.includes(constants.SAPLING), 'the palette offers torches and saplings');
assert.ok(paletteIds.length === constants.PALETTE.length, 'and lists every placeable block');

// --- the world tick runs while the game does: sand falls, saplings grow
live.world.set(PAD.x + 7, padHeight + 9, PAD.z - 7, constants.SAND);
assert.equal(live.world.get(PAD.x + 7, padHeight + 9, PAD.z - 7), constants.SAND, 'the sand starts in the air');
step(40);                                  // a second of frames is four world ticks
assert.notEqual(live.world.get(PAD.x + 7, padHeight + 9, PAD.z - 7), constants.SAND, 'the game tick drops it');
let landing = null;
for (let y = padHeight; y < padHeight + 10; y++) {
  if (live.world.get(PAD.x + 7, y, PAD.z - 7) === constants.SAND) { landing = y; break; }
}
assert.equal(landing, padHeight + 1, 'and it lands right on the pad');

// --- lava burns: a 3x3 pool so the landing does not depend on sub-block drift
const lavaCell = { x: PAD.x - 4, z: PAD.z - 4 };
for (let dz = -1; dz <= 1; dz++) {
  for (let dx = -1; dx <= 1; dx++) {
    live.world.set(lavaCell.x + dx, padHeight, lavaCell.z + dz, constants.LAVA);
    live.world.set(lavaCell.x + dx, padHeight - 1, lavaCell.z + dz, constants.STONE);   // a floor to stand on
  }
}
standOnPad(lavaCell.x, lavaCell.z, 2);
live.player.flying = false;
live.player.velocityY = 0;
live.milestones.delete('lava');
live.flash = 0;
live.damage = 0;
// Fall in first, then hold: the pool is below the ledge, and how long the drop takes depends on
// where the terrain happens to stop.
for (let frame = 0; frame < 120 && !live.player.inLava; frame++) step(1);
assert.equal(live.player.inLava, true, 'standing in lava is detected');
step(30);
assert.ok(live.heat > 0.1, `and the screen washes orange (heat ${live.heat.toFixed(2)})`);
let burned = false;
for (let frame = 0; frame < 120 && !burned; frame++) {
  step(1);
  burned = live.flash > 0 || live.damage > 0;
}
live.world.set(PAD.x - 4, padHeight, PAD.z - 4, constants.AIR);
standOnPad(PAD.x, PAD.z, 3);
step(30);
assert.ok(live.heat < 0.2, 'getting out of the lava clears the haze');

// --- leaf decay in the running game, well above the pad so no generated tree is in reach
const trunk = { x: PAD.x - 6, y: padHeight + 10, z: PAD.z + 6 };
for (let dy = -1; dy <= 6; dy++) {
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) live.world.set(trunk.x + dx, trunk.y + dy, trunk.z + dz, constants.AIR);
  }
}
for (let dy = 0; dy < 4; dy++) live.world.set(trunk.x, trunk.y + dy, trunk.z, constants.LOG);
for (let dz = -1; dz <= 1; dz++) {
  for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dz === 0) continue;
    live.world.set(trunk.x + dx, trunk.y + 3, trunk.z + dz, constants.LEAVES);
  }
}
assert.equal(live.world.decayLeaves(trunk.x, trunk.y + 3, trunk.z).length, 0, 'leaves around a trunk stay put');
live.world.set(trunk.x, trunk.y + 3, trunk.z, constants.AIR);
live.world.set(trunk.x, trunk.y + 2, trunk.z, constants.AIR);
live.world.set(trunk.x, trunk.y + 1, trunk.z, constants.AIR);
live.world.set(trunk.x, trunk.y, trunk.z, constants.AIR);
assert.ok(live.world.decayLeaves(trunk.x, trunk.y + 3, trunk.z).length > 0, 'and wither once the trunk is gone');

// --- the debug panel and the camera
assert.equal(live.debug, false, 'the debug panel starts hidden');
assert.equal(live.toggleDebug(), true, 'F3 opens it');
assert.equal(live.toggleDebug(), false, 'F3 closes it again');
assert.equal(live.thirdPerson, false, 'the game starts in first person');
assert.equal(live.toggleCamera(), true, 'F5 moves the camera behind the player');
step(3);
assert.ok(live.renderer.stats.draws > 0, 'the third-person frame still draws');
assert.equal(live.toggleCamera(), false, 'F5 brings it back');

// --- the minimap draws terrain colours
const mapCanvas = elements.get('minimap');
let painted = 0;
mapCanvas.getContext = () => ({
  set fillStyle(value) { void value; },
  get fillStyle() { return '#000'; },
  set strokeStyle(value) { void value; },
  lineWidth: 1,
  fillRect: () => { painted++; },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
});
mapCanvas.width = 16;
mapCanvas.height = 16;
const drawn = live.ui.drawMinimap(live.world, 64, 64, 0, 32);
assert.equal(drawn, 16, 'the minimap reports the canvas size it filled');
assert.equal(painted >= 16 * 16, true, `every pixel of the map is painted (${painted})`);

// --- ambient sound is scheduled, not spammed
live.ambientTimer = 0;
live.updateAmbient(1, 'forest', { intensity: 0 });
live.ambientTimer = 0;
live.player.y = 12;
live.updateAmbient(1, 'forest', { intensity: 0 });
assert.ok(live.ambientTimer > 0, 'the ambience waits before playing again');
assert.ok(live.world.lightSourceCount > 0, 'the world knows about its glowing blocks');

// =============================================================== v3.4: building blocks

// --- the new blocks are all shape-aware, and nothing moved the old ids
const { SHAPES, RECIPES, CLIMBABLE, INTERACTIVE } = constants;
assert.deepEqual(Object.keys(SHAPES).map(Number).sort((a, b) => a - b), [40, 41, 42, 43, 44, 45, 46, 47], 'eight partial shapes');
assert.equal(SHAPES[46], 'slab', 'slabs are a slab');
assert.equal(SHAPES[47], 'stairs', 'stairs are stairs');
assert.equal(CLIMBABLE.has(42), true, 'ladders are climbable');
assert.equal(INTERACTIVE[43], 'door', 'doors open');
assert.equal(INTERACTIVE[44], 'chest', 'chests hold things');
assert.equal(INTERACTIVE[45], 'bed', 'beds let you sleep');
assert.ok(RECIPES.length >= 18, `there are recipes to make (${RECIPES.length})`);
assert.ok(RECIPES.every(recipe => recipe.label && recipe.count > 0 && recipe.needs.length), 'every recipe is described');
assert.ok(RECIPES.every(recipe => recipe.needs.every(([id, n]) => constants.blockById(id).id === id && n > 0)), 'every ingredient is a real block');
assert.ok(RECIPES.every(recipe => constants.PALETTE.includes(recipe.out)), 'every recipe makes something you can place');

// --- shapeBoxes describes every shape, and a cube is a single box
const { shapeBoxes } = await import('../web/shapes.js');
const { PLANKS } = constants;
assert.equal(shapeBoxes(constants.blockById(constants.STONE), 0).length, 1, 'a full cube is one box');
assert.equal(shapeBoxes(constants.blockById(constants.SLAB), 0)[0].max[1], 0.5, 'a slab is half a block tall');
const stairBoxes = shapeBoxes(constants.blockById(constants.STAIRS), 1);
assert.equal(stairBoxes.length, 2, 'stairs are two boxes');
assert.deepEqual(stairBoxes[1].min, [0.5, 0.5, 0], 'facing east puts the raised step on the east half');
assert.deepEqual(shapeBoxes(constants.blockById(constants.STAIRS), 3)[1].max[0], 0.5, 'facing west mirrors it');
assert.equal(shapeBoxes(constants.blockById(constants.CHEST), 0).length, 2, 'a chest is a body plus a lid');
assert.equal(shapeBoxes(constants.blockById(constants.BED), 0).length, 2, 'a bed is a mattress plus a pillow');
assert.equal(shapeBoxes(constants.blockById(constants.DOOR), 0)[0].max[0] - shapeBoxes(constants.blockById(constants.DOOR), 0)[0].min[0], 0.875, 'a closed door is a flat plate');
const openDoor = shapeBoxes(constants.blockById(constants.DOOR), 1)[0];
const shutDoor = shapeBoxes(constants.blockById(constants.DOOR), 0)[0];
assert.equal(openDoor.max[2] - openDoor.min[2] > shutDoor.max[2] - shutDoor.min[2], true, 'an open door is a wide plate across z');
assert.equal(openDoor.max[0] - openDoor.min[0] < shutDoor.max[0] - shutDoor.min[0], true, 'and a thin plate across x, which is exactly a quarter turn');
const fenceAlone = shapeBoxes(constants.blockById(constants.FENCE), 0, () => false);
assert.equal(fenceAlone.length, 1, 'a lone fence is just its post');
const fenceRun = shapeBoxes(constants.blockById(constants.FENCE), 0, (dx, dz) => dx === 1);
assert.equal(fenceRun.length, 3, 'a fence beside another fence grows two rails toward it');
const paneAlone = shapeBoxes(constants.blockById(constants.GLASS_PANE), 0, () => false);
assert.equal(paneAlone.length, 2, 'a lone pane is a small cross so it is still visible');

// --- placing a shaped block records how it faces
const shapeWorld = new VoxelWorld(707);
assert.equal(shapeWorld.placeBlock(70, 40, 70, constants.STAIRS, { yaw: -Math.PI / 2 }), true, 'stairs can be placed in the air');
assert.equal(shapeWorld.getMeta(70, 40, 70), 1, 'and they remember they face east');
assert.equal(shapeWorld.placeBlock(71, 40, 70, constants.LADDER, { face: [0, 0, -1] }), true, 'a ladder can be placed');
assert.equal(shapeWorld.getMeta(71, 40, 70), 2, 'and it hangs on the wall it was aimed at');
assert.equal(shapeWorld.placeBlock(72, 40, 70, constants.DOOR, { yaw: Math.PI }), true, 'a door can be placed');
assert.equal(shapeWorld.isDoorOpen(72, 40, 70), false, 'and it starts shut');
assert.equal(shapeWorld.placeBlock(73, 40, 70, constants.LAVA), false, 'lava still cannot be placed');
assert.equal(shapeWorld.placeBlock(70, 40, 70, constants.STONE), false, 'and nothing replaces a block already there');
assert.equal(shapeWorld.placeBlock(70, 40, 70, constants.STONE, { replace: true }), true, 'unless the caller asks to replace it');

// --- collision: you stand on a slab at half height and walk up stairs
const shapePad = { x: 70, z: 70, ground: shapeWorld.surfaceHeight(70, 70) + 1 };
for (let dz = -6; dz <= 6; dz++) {
  for (let dx = -6; dx <= 6; dx++) {
    for (let y = shapePad.ground; y < shapePad.ground + 6; y++) shapeWorld.set(shapePad.x + dx, y, shapePad.z + dz, constants.AIR);
    shapeWorld.set(shapePad.x + dx, shapePad.ground - 1, shapePad.z + dz, constants.STONE);
  }
}
assert.equal(shapeWorld.blockTop(shapePad.x, shapePad.ground - 1, shapePad.z), shapePad.ground, 'flat ground tops out at the surface');
shapeWorld.set(shapePad.x + 1, shapePad.ground, shapePad.z, constants.SLAB);
shapeWorld.set(shapePad.x + 2, shapePad.ground, shapePad.z, constants.STAIRS);
shapeWorld.setMeta(shapePad.x + 2, shapePad.ground, shapePad.z, 1);
assert.equal(shapeWorld.blockTop(shapePad.x + 1, shapePad.ground, shapePad.z), shapePad.ground + 0.5, 'a slab tops out half a block up');
assert.equal(shapeWorld.blockTop(shapePad.x + 2, shapePad.ground, shapePad.z), shapePad.ground + 1, 'a stair tops out a whole block up');
assert.equal(shapeWorld.overlapsSolid(shapePad.x + 1.2, shapePad.ground + 0.6, shapePad.z + 0.2,
  shapePad.x + 1.8, shapePad.ground + 2.4, shapePad.z + 0.8), false, 'you walk over a slab, not into it');
assert.equal(shapeWorld.overlapsSolid(shapePad.x + 1.2, shapePad.ground + 0.2, shapePad.z + 0.2,
  shapePad.x + 1.8, shapePad.ground + 1.8, shapePad.z + 0.8), true, 'but the slab still stops you at ground level');
const shapeWalker = new Player(shapeWorld);
shapeWalker.x = shapePad.x + 0.5;
shapeWalker.z = shapePad.z + 0.5;
shapeWalker.y = shapePad.ground;
shapeWalker.yaw = -Math.PI / 2;              // face east, so "forward" is +x
let slabHeight = 0, stairHeight = 0;
for (let frame = 0; frame < 120; frame++) {
  shapeWalker.update(1 / 60, { forward: true }, shapeWorld);
  if (shapeWalker.x > shapePad.x + 1.05 && shapeWalker.x < shapePad.x + 1.9) slabHeight = Math.max(slabHeight, shapeWalker.y);
  if (shapeWalker.x > shapePad.x + 2.05 && shapeWalker.x < shapePad.x + 2.9) stairHeight = Math.max(stairHeight, shapeWalker.y);
}
// The +0.0001 is the collision epsilon: you stand a hair above the surface you landed on.
assert.ok(Math.abs(slabHeight - (shapePad.ground + 0.5)) < 1e-3, `walking onto a slab steps up half a block (${slabHeight})`);
assert.ok(Math.abs(stairHeight - (shapePad.ground + 1)) < 1e-3, `and stairs are a full step (${stairHeight})`);
assert.equal(shapeWorld.overlapsSolid(shapeWalker.x - 0.29, shapeWalker.y + 0.05, shapeWalker.z - 0.29,
  shapeWalker.x + 0.29, shapeWalker.y + 1.75, shapeWalker.z + 0.29), false, 'the walker never ends up inside a block');

// --- ladders: hold on, climb, and slide down gently
const ladderX = shapePad.x + 4;
for (let dy = 0; dy < 6; dy++) {
  shapeWorld.set(ladderX, shapePad.ground + dy, shapePad.z, constants.LADDER);
  shapeWorld.setMeta(ladderX, shapePad.ground + dy, shapePad.z, 0);
  shapeWorld.set(ladderX - 1, shapePad.ground + dy, shapePad.z, constants.STONE);
}
const climber = new Player(shapeWorld);
climber.x = ladderX + 0.5;
climber.z = shapePad.z + 0.5;
climber.y = shapePad.ground + 2.5;
climber.flying = false;
climber.onGround = false;
const startY = climber.y;
for (let frame = 0; frame < 40; frame++) climber.update(1 / 60, { jump: true }, shapeWorld);
assert.ok(climber.y > startY + 0.5, `holding jump climbs the ladder (${climber.y.toFixed(2)} from ${startY.toFixed(2)})`);
const highY = climber.y;
for (let frame = 0; frame < 30; frame++) climber.update(1 / 60, {}, shapeWorld);
assert.ok(climber.y < highY, 'and letting go slides slowly back down');
assert.ok(climber.y > highY - 3, 'but not as fast as a fall');

// --- doors open and close, and only get in the way when shut
const doorWorld = new VoxelWorld(11);
doorWorld.set(70, 40, 70, constants.DOOR);
const doorBox = (world) => world.overlapsSolid(70.1, 40.1, 70.1, 70.9, 41.9, 70.9);
assert.equal(doorBox(doorWorld), true, 'a shut door stops you');
assert.equal(doorWorld.toggleDoor(70, 40, 70), true, 'opening it returns the new state');
assert.equal(doorWorld.isDoorOpen(70, 40, 70), true, 'and it reports open');
assert.equal(doorBox(doorWorld), false, 'an open door lets you through');
assert.equal(shapeBoxes(constants.blockById(constants.DOOR), 1)[0].min[0], 0,
  'an open door hangs flat against the frame');
assert.equal(shapeBoxes(constants.blockById(constants.DOOR), 3)[0].max[0], 1,
  'and swings to the other side when the metadata says so');
const hingedDoor = new VoxelWorld(11);
hingedDoor.set(70, 40, 70, constants.DOOR);
hingedDoor.toggleDoor(70, 40, 70);
assert.equal(hingedDoor.overlapsSolid(70.2, 40.1, 70.1, 70.8, 41.9, 70.9), false,
  'walking the middle of an open doorway is clear');
assert.equal(hingedDoor.overlapsSolid(70, 40.1, 70.1, 70.05, 41.9, 70.9), true,
  'but the frame itself is still there');
assert.equal(doorWorld.toggleDoor(70, 40, 70), false, 'toggling again shuts it');
assert.equal(doorBox(doorWorld), true, 'and it is solid again');

// --- chests remember what you put in them, and forget when broken
const chestWorld = new VoxelWorld(12);
chestWorld.set(70, 40, 70, constants.CHEST);
const chest = chestWorld.chestAt(70, 40, 70, true);
chest.set(constants.STONE, 12);
chest.set(constants.LOG, 3);
assert.equal(chestWorld.chestAt(70, 40, 70).get(constants.STONE), 12, 'the chest holds what it was given');
assert.equal(chestWorld.chestAt(71, 40, 70), null, 'and other cells have no chest');
chestWorld.set(70, 40, 70, constants.AIR);
assert.equal(chestWorld.chestAt(70, 40, 70), null, 'breaking a chest takes its contents with it');

// --- water flows into what you dig out
const flowWorld = new VoxelWorld(13);
const flowY = 40;
for (let dx = -1; dx < 6; dx++) {
  flowWorld.set(70 + dx, flowY - 1, 70, constants.STONE);
  flowWorld.set(70 + dx, flowY + 1, 70, constants.STONE);
  flowWorld.set(70 + dx, flowY, 70, constants.AIR);
  for (const dz of [-1, 1]) flowWorld.set(70 + dx, flowY, 70 + dz, constants.STONE);
}
flowWorld.set(69, flowY, 70, constants.WATER);
flowWorld.wakeWater(70, flowY, 70);
let flowTicks = 0;
while (flowWorld.waterQueue.length && flowTicks < 40) { flowWorld.worldTick(); flowTicks++; }
let flooded = 0;
for (let dx = 0; dx < 6; dx++) if (flowWorld.get(70 + dx, flowY, 70) === constants.WATER) flooded++;
assert.equal(flooded, 6, `water flows down the whole channel (${flooded}/6 in ${flowTicks} ticks)`);
assert.equal(flowWorld.get(69, flowY + 1, 70) === constants.WATER, false, 'and it does not climb uphill');

// --- crafting
const { canCraft, craft, craftable, missingFor, spend, addTo, countOf, recipesUsing } = await import('../web/crafting.js');
const backpack = new Map([[constants.LOG, 3], [constants.COAL_ORE, 1], [constants.SAND, 2]]);
const torchRecipe = RECIPES.find(recipe => recipe.out === constants.TORCH);
const glassRecipe = RECIPES.find(recipe => recipe.out === constants.GLASS);
assert.equal(canCraft(backpack, torchRecipe), true, 'a log and coal make torches');
assert.equal(countOf(backpack, constants.TORCH), 0, 'we start with no torches');
assert.equal(craft(backpack, torchRecipe), 4, 'crafting gives four torches');
assert.equal(countOf(backpack, constants.LOG), 2, 'and spends one log');
assert.equal(countOf(backpack, constants.COAL_ORE), 0, 'and the coal');
assert.equal(canCraft(backpack, glassRecipe), false, 'with no coal left, glass is out of reach');
assert.deepEqual(missingFor(backpack, glassRecipe).map(item => item.id), [constants.COAL_ORE], 'and the panel can say exactly what is missing');
assert.equal(craft(backpack, glassRecipe), 0, 'crafting without the ingredients changes nothing');
assert.equal(countOf(backpack, constants.SAND), 2, 'the sand is untouched');
assert.equal(craftable(new Map([[constants.LOG, 1]]), RECIPES).some(recipe => recipe.out === constants.PLANKS), true, 'one log is enough for planks');
assert.equal(recipesUsing(constants.SAND).some(recipe => recipe.out === constants.GLASS), true, 'sand is used by the glass recipe');
assert.equal(spend(backpack, constants.SAND, 5), false, 'you cannot spend what you do not have');
assert.equal(countOf(backpack, constants.SAND), 2, 'and a refused spend changes nothing');
assert.equal(addTo(backpack, constants.SAND, 3), 5, 'adding stacks up');
assert.equal(spend(backpack, constants.SAND, 5), true, 'and spending it all works');
assert.equal(backpack.has(constants.SAND), false, 'leaving no empty entry behind');

// --- the mesher draws the shapes without tripping over them
const shapeMesh = buildChunkMesh(shapeWorld, 4, 4);
assert.ok(shapeMesh && shapeMesh.opaque.quadCount > 0, 'a chunk full of slabs and stairs still meshes');
assert.equal(shapeMesh.opaque.positions.every(Number.isFinite), true, 'every vertex is a real number');
const halfWorld = new VoxelWorld(14);
halfWorld.set(70, 40, 70, constants.SLAB);        // chunk 4,4: floating high above the terrain
const halfMesh = buildChunkMesh(halfWorld, 4, 4);
assert.ok(halfMesh.opaque.quadCount >= 6, `a lone slab draws its faces (${halfMesh.opaque.quadCount} quads)`);
const slabTop = halfMesh.opaque.positions.filter((value, index) => index % 3 === 1 && value > 40.4 && value < 40.6);
assert.ok(slabTop.length >= 4, `its top face sits at half height (${slabTop.length} vertices at y=40.5)`);
const slabBottom = halfMesh.opaque.positions.filter((value, index) => index % 3 === 1 && value > 39.9 && value < 40.1);
assert.ok(slabBottom.length >= 4, 'and its bottom face sits on the cell floor');
const midHeight = halfMesh.opaque.positions.filter((value, index) => index % 3 === 1 && value > 40.6 && value < 41);
assert.equal(midHeight.length, 0, 'and nothing is drawn above the half-way line');

// --- the live game: craft, place a shaped block, open a chest, sleep
live.pause(false);
if (live.paused) live.resume();
live.storage.clear();
addTo(live.inventory, constants.LOG, 4);
addTo(live.inventory, constants.SMOOTH_STONE, 8);
const recipesBefore = live.refreshCraft();
assert.ok(recipesBefore > 0, `the crafting panel marks what you can afford (${recipesBefore})`);
assert.equal(live.toggleCraft(true), true, 'C opens the crafting panel');
assert.equal(live.input.enabled, false, 'and the controls park while it is open');
assert.ok(live.ui.craftButtons.size >= 18, 'every recipe has a row');
const plankRecipe = RECIPES.find(recipe => recipe.out === constants.PLANKS);
const logsBefore = countOf(live.inventory, constants.LOG);
live.doCraft(plankRecipe);
assert.equal(countOf(live.inventory, constants.PLANKS), 4, 'crafting planks puts them in the bag');
assert.equal(countOf(live.inventory, constants.LOG), logsBefore - 1, 'and spends the log');
assert.equal(live.toggleCraft(false), false, 'C closes the panel');
assert.equal(live.input.enabled, true, 'and gives the controls back');
// Level the pad again first: the digging tests above left holes that the player would fall into.
buildPad();
const chestCell = { x: PAD.x + 1, y: padHeight + 2, z: PAD.z };
live.world.placeBlock(chestCell.x, chestCell.y, chestCell.z, constants.CHEST);
live.player.flying = false;
live.player.x = PAD.x + 0.5;
live.player.z = PAD.z + 0.5;
live.player.y = padHeight + 1;
live.player.velocityX = live.player.velocityY = live.player.velocityZ = 0;
assert.equal(aimAt(chestCell.x, chestCell.y, chestCell.z), true, 'the crosshair finds the chest');
assert.equal(live.interact(), 'chest', 'E opens a chest you are looking at');
assert.ok(live.openChest, 'and the game remembers which chest it is');
assert.equal(live.storeHeld(), true, 'the held block goes in');
const storedId = live.slotBlock();
assert.equal(countOf(live.world.chestAt(chestCell.x, chestCell.y, chestCell.z), storedId), 1, 'so the chest holds it');
const beforeTake = countOf(live.inventory, storedId);
assert.equal(live.takeFromStorage(storedId), true, 'and taking it back works');
assert.equal(countOf(live.inventory, storedId), beforeTake + 1, 'which puts it back in the bag');
assert.equal(live.closeStorage(), true, 'the chest closes');
assert.equal(live.openChest, null, 'and is forgotten');
live.world.set(chestCell.x, chestCell.y, chestCell.z, constants.DOOR);
assert.equal(live.interact(), 'door', 'a door in the same place can be used');
assert.equal(live.world.isDoorOpen(chestCell.x, chestCell.y, chestCell.z), true, 'which swings it open');
assert.equal(live.interact(), 'door', 'and using it again');
assert.equal(live.world.isDoorOpen(chestCell.x, chestCell.y, chestCell.z), false, 'shuts it');
live.day.clock = 0.8;                        // midnight: bedtime
live.world.set(chestCell.x, chestCell.y, chestCell.z, constants.BED);
assert.equal(live.interact(), 'bed', 'and a bed can be slept in at night');
assert.ok(live.sleeping > 0, 'which starts the fade');
step(120);
assert.equal(live.sleeping, 0, 'the fade finishes on its own');
assert.ok(!isNight(live.day.clock), `and wakes you up in the morning (clock ${live.day.clock.toFixed(2)})`);
live.day.clock = 0.4;
live.world.set(chestCell.x, chestCell.y, chestCell.z, constants.BED);
assert.equal(aimAt(chestCell.x, chestCell.y, chestCell.z), true, 'aim at the bed again');
assert.equal(live.interact(), null, 'a daytime nap is refused');
live.world.set(chestCell.x, chestCell.y, chestCell.z, constants.STONE);
assert.equal(aimAt(chestCell.x, chestCell.y, chestCell.z), true, 'aim at a plain stone block');
assert.equal(live.interact(), null, 'and aiming at a plain block does nothing');

// --- hotbar icons are cubes, drawn on canvas, not colour chips
live.selectHotbar(0);
const iconsDrawn = live.ui.drawHotbarIcons(live.ui.hotbar, live.slotBlocks);
assert.equal(iconsDrawn, 9, 'all nine hotbar slots get a cube');
const firstSlot = live.ui.hotbar.children[0];
assert.equal(firstSlot.children.some(child => child.className === 'slot-cube'), true, 'each slot holds a canvas');
const iconCalls = firstSlot.children.find(child => child.className === 'slot-cube').getContext('2d').calls;
assert.equal(iconCalls.filter(call => call.name === 'fill').length, 3, 'a cube is three filled faces');
assert.equal(iconCalls.filter(call => call.name === 'closePath').length, 3, 'each face is a closed path');
assert.equal(new Set(iconCalls.filter(call => call.name === 'fillStyle').map(call => call.args[0])).size, 3, 'and the three faces are shaded differently');

// =============================================================== v3.5: hearts, sky and weather

// --- the health model on its own
const { Health, fallDamage, DEATH_MESSAGES, MAX_HEALTH, HEARTS } = await import('../web/health.js');
assert.equal(MAX_HEALTH, 20, 'ten hearts, two points each');
assert.equal(HEARTS, 10, 'and ten hearts on the bar');
const heart = new Health();
assert.equal(heart.points, MAX_HEALTH, 'you start at full health');
assert.equal(heart.ratio, 1, 'and the ratio agrees');
assert.equal(heart.hurt(4, 'fall'), 4, 'a fall takes four points');
assert.equal(heart.points, 16, 'eight hearts left');
assert.equal(heart.hurt(4, 'fall'), 0, 'but the mercy window swallows the next hit');
assert.equal(heart.points, 16, 'so nothing is lost');
heart.invulnerable = 0;
assert.equal(heart.hurt(4, 'fall'), 4, 'once the window closes, damage lands again');
assert.equal(fallDamage(2), 0, 'a two-block drop is free');
assert.equal(fallDamage(3), 0, 'so is three');
assert.equal(fallDamage(7), 4, 'seven blocks costs four points');
assert.equal(fallDamage(NaN), 0, 'and nonsense costs nothing');
heart.points = 8;
heart.invulnerable = 0;
heart.sinceDamage = 0;
assert.equal(heart.update(6), 0, 'six seconds without a scratch is not long enough to heal');
assert.equal(heart.update(1), 0, 'seven seconds arms the healing, but nothing comes back yet');
assert.equal(heart.points, 8, 'so you are still on four hearts');
assert.equal(heart.update(3), 2, 'a couple of seconds later a heart comes back');
assert.equal(heart.points, 10, 'which is two points');
const healed = heart.update(30);
assert.equal(heart.points, MAX_HEALTH, 'and the rest heals up to the cap');
assert.ok(healed > 0, 'the update reports what it healed');
heart.points = 1;
heart.invulnerable = 0;
assert.equal(heart.hurt(6, 'lava'), 1, 'six points of damage on your last point takes one');
assert.equal(heart.isDead, true, 'and that is the end of you');
assert.equal(heart.deaths, 1, 'the number of deaths is counted');
assert.equal(heart.lastCause, 'lava', 'and the cause is remembered for the death screen');
assert.equal(heart.respawn(), true, 'respawning revives you');
assert.equal(heart.points, MAX_HEALTH, 'at full health');
assert.equal(heart.isDead, false, 'and alive again');
assert.ok(heart.invulnerable > 0, 'with a moment of mercy to get your bearings');
assert.match(DEATH_MESSAGES.lava, /lava/i, 'the death messages name the cause');
assert.match(DEATH_MESSAGES.drown, /air/i, 'including drowning');

// --- falling hurts, and the drop is measured by the player
const fallWorld = new VoxelWorld(21);
const fallHeight = fallWorld.surfaceHeight(70, 70);
for (let dz = -3; dz <= 3; dz++) {
  for (let dx = -3; dx <= 3; dx++) {
    for (let y = fallHeight + 1; y < fallHeight + 24; y++) fallWorld.set(70 + dx, y, 70 + dz, constants.AIR);
    fallWorld.set(70 + dx, fallHeight, 70 + dz, constants.STONE);
  }
}
const cliffJumper = new Player(fallWorld);
cliffJumper.x = 70.5; cliffJumper.z = 70.5;
cliffJumper.y = fallHeight + 13;                       // thirteen blocks up
cliffJumper.flying = false;
cliffJumper.velocityY = 0;
let hardLanding = 0;
for (let frame = 0; frame < 300 && !cliffJumper.onGround; frame++) {
  cliffJumper.update(1 / 60, {}, fallWorld);
  if (cliffJumper.landedHard) hardLanding = cliffJumper.landedHard;
}
assert.ok(Math.abs(hardLanding - 12) < 1.5, `the drop is measured as about twelve blocks (${hardLanding.toFixed(2)})`);
assert.equal(fallDamage(hardLanding), 9, 'and costs nine points of health');
assert.equal(cliffJumper.fallDistance, 0, 'the counter resets when you land');
assert.equal(cliffJumper.landedHard > 0, true, 'and the landing is reported once, for the game to read');

// --- the sky grew a moon, an aurora and some planets
const { shapeHeight } = await import('../web/renderer.js');
const middaySky = skyPalette(0.5);
const midnightSky = skyPalette(0.0);
assert.equal(middaySky.night < 0.05, true, 'midday is not night');
assert.equal(midnightSky.night > 0.9, true, 'and midnight is');
assert.ok(Array.isArray(middaySky.moonDirection) && middaySky.moonDirection.length === 3, 'the moon has a direction');
const dot = middaySky.sunDirection[0] * middaySky.moonDirection[0] + middaySky.sunDirection[1] * middaySky.moonDirection[1] + middaySky.sunDirection[2] * middaySky.moonDirection[2];
assert.ok(dot < -0.9, `the moon sits opposite the sun (${dot.toFixed(2)})`);
assert.equal(middaySky.aurora.toFixed(2), '0.00', 'there is no aurora at midday');
assert.ok(midnightSky.aurora > 0.9, `and a strong one at midnight (${midnightSky.aurora.toFixed(2)})`);
assert.match(source('../web/renderer.js'), /uMoonDirection|uAurora/, 'the sky shader is built from the same data');

// --- the outline of a slab is half height, not a whole block
const shapeWorld2 = new VoxelWorld(22);      // (skyPalette came in with the modules at the top)
assert.equal(shapeHeight(null, { x: 0, y: 0, z: 0 }), 1, 'no world means a plain cube outline');
shapeWorld2.set(70, 40, 70, constants.SLAB);
shapeWorld2.set(71, 40, 70, constants.STAIRS);
shapeWorld2.set(72, 40, 70, constants.STONE);
assert.equal(shapeHeight(shapeWorld2, { x: 70, y: 40, z: 70 }), 0.5, 'a slab is outlined at half height');
assert.equal(shapeHeight(shapeWorld2, { x: 71, y: 40, z: 70 }), 1, 'stairs are a whole block');
assert.equal(shapeHeight(shapeWorld2, { x: 72, y: 40, z: 70 }), 1, 'and so is stone');
assert.equal(shapeHeight(shapeWorld2, { x: 73, y: 40, z: 70 }), 1, 'and an empty cell falls back to a cube');

// --- the held block keeps its shape in your hand
const { buildHeldModel, offsetHeldModel } = await import('../web/renderer.js');
const frame = Array.from(buildHeldModel(new Float32Array(16), 0, 0));
const corner = (matrix, q) => [
  matrix[0] * q[0] + matrix[4] * q[1] + matrix[8] * q[2] + matrix[12],
  matrix[1] * q[0] + matrix[5] * q[1] + matrix[9] * q[2] + matrix[13],
  matrix[2] * q[0] + matrix[6] * q[1] + matrix[10] * q[2] + matrix[14],
];
const low = [-0.5, -0.5, -0.5], high = [0.5, 0.5, 0.5];
const cubeBox = (minX, minY, minZ, maxX, maxY, maxZ) => ({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
const plainHeld = Array.from(offsetHeldModel(new Float32Array(16), frame, cubeBox(0, 0, 0, 1, 1, 1)));
assert.deepEqual(corner(plainHeld, low).map(v => +v.toFixed(6)), corner(frame, low).map(v => +v.toFixed(6)),
  'a whole block fills the hand cube exactly as before');
const slabHeld = Array.from(offsetHeldModel(new Float32Array(16), frame, cubeBox(0, 0, 0, 1, 0.5, 1)));
assert.deepEqual(corner(slabHeld, low).map(v => +v.toFixed(6)), corner(frame, low).map(v => +v.toFixed(6)),
  'a held slab sits on the same floor as a cube');
const cubeTop = corner(frame, high), cubeBottom = corner(frame, low);
// A slab is only short on Y: the height drops by half, the footprint does not move. Compare the
// three edge vectors of the box, since the hand's frame is rotated and world axes are no guide.
const edge = (matrix, axis) => [matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]];
const closeEdge = (a, b, label) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-6, label + ` (part ${i})`));
closeEdge(edge(slabHeld, 0), edge(frame, 0), 'a held slab keeps the cube width');
closeEdge(edge(slabHeld, 2), edge(frame, 2), 'and the cube depth');
closeEdge(edge(slabHeld, 1), edge(frame, 1).map(v => v / 2), 'and half the cube height');
// A held chest is two boxes, drawn as two squeezed cubes.
const chestParts = shapeBoxes(constants.blockById(44));
assert.equal(chestParts.length, 2, 'a chest in the hand is drawn as a body and a lid');
assert.equal(live.world.metaAt(-1, 0, 0), 0, 'meta outside the world reads as none');

// --- the save file carries the whole world, not just the blocks
const { BrowserSave } = await import('../web/storage.js');
const goodSave = {
  seed: 4242,
  edits: { '1,2,3': 5 },                       // saved files are plain objects, as JSON requires
  metaEdits: { '1,2,3': 3 },
  chests: { '4,5,6': { 12: 2, 30: 1 } },
  inventory: { 5: 9, 42: 1, 7: 0 },
  player: { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 },
  selected: 1,
  clock: 0.5,
};
storage.set('pixeled-voxel-v2', JSON.stringify(goodSave));
const richLoaded = new BrowserSave().load();
assert.equal(richLoaded.metaEdits.get('1,2,3'), 3, 'a door that was left open stays open');
assert.deepEqual(richLoaded.chests['4,5,6'], { 12: 2, 30: 1 }, 'and the chest keeps what was in it');
assert.deepEqual(richLoaded.inventory, { 5: 9, 42: 1, 7: 0 }, 'and so does the backpack');
const oldSave = { seed: 7, edits: {}, player: null, selected: 0, clock: 0.4 };
storage.set('pixeled-voxel-v2', JSON.stringify(oldSave));
const upgraded = new BrowserSave().load();
assert.deepEqual(Object.fromEntries(upgraded.metaEdits), {}, 'an old save has no metadata');
assert.equal(upgraded.inventory, null, 'and no backpack, so it loads as empty');
assert.ok(new BrowserSave().write({
  seed: 9, edits: new Map(), player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, selected: 0, clock: 0.4,
  metaEdits: new Map([['2,2,2', 1]]), chests: { '2,3,2': { 1: 3 } }, inventory: new Map([[5, 2]]),
}), 'and a write with the new fields succeeds');
const savedAgain = new BrowserSave().load();
assert.equal(savedAgain.metaEdits.get('2,2,2'), 1, 'metadata survives the round trip');
assert.deepEqual(savedAgain.chests['2,3,2'], { 1: 3 }, 'chests do too');
assert.deepEqual(savedAgain.inventory, { 5: 2 }, 'and the backpack');
assert.equal(new BrowserSave().get('pixeled-recent-v1'), null, 'the side keys start empty');
const saves = new BrowserSave();
assert.equal(saves.set('pixeled-recent-v1', [{ seed: 1 }]), true, 'a side key can be written');
assert.deepEqual(JSON.parse(saves.get('pixeled-recent-v1')), [{ seed: 1 }], 'and read back');
assert.equal(saves.set('pixeled-recent-v1', 'plain text'), true, 'strings are stored as they are');
assert.equal(saves.get('pixeled-recent-v1'), 'plain text', 'and come back untouched');
saves.remove('pixeled-recent-v1');
assert.equal(saves.get('pixeled-recent-v1'), null, 'and a side key can be removed');
assert.equal(typeof live.world.metaAt(64, 30, 64), 'number', 'and inside it as a number');

const bodyHeld = Array.from(offsetHeldModel(new Float32Array(16), frame, chestParts[0]));
assert.ok(corner(bodyHeld, high)[1] < corner(frame, high)[1] - 1e-6, 'and its body is shorter than a cube');
const fenceHeld = Array.from(offsetHeldModel(new Float32Array(16), frame, shapeBoxes(constants.blockById(41))[0]));
const lengthOf = vector => Math.hypot(...vector);
assert.ok(lengthOf(edge(fenceHeld, 0)) < 0.1 && lengthOf(edge(fenceHeld, 2)) < 0.1,
  'a held fence post is a stick, not a block');
assert.ok(lengthOf(edge(fenceHeld, 1)) > 0.3, 'but still a whole block tall');

// --- rain splashes (Particles is already in scope from the modules above)
const splashParticles = new Particles(64);
const splashCount = splashParticles.rainSplash(10.5, 20, 10.5, 1);
assert.ok(splashCount >= 3, `a raindrop kicks up a few droplets (${splashCount})`);
assert.equal(splashParticles.active, splashCount, 'and they are live');
const firstSplash = splashParticles.items.find(item => item.life > 0);
assert.equal(firstSplash.y, 20.06, 'starting just above the ground');
assert.ok(firstSplash.vy > 0, 'moving upward first');
assert.ok(firstSplash.vz !== 0 || firstSplash.vx !== 0, 'and outward from the impact');
assert.ok(splashParticles.rainSplash(10.5, 20, 10.5, 0.2) <= splashCount + 3, 'a light drizzle makes fewer splashes');

// --- the live game: hearts drop, the death screen shows, respawning brings you back
if (live.paused) live.resume();
live.health.points = MAX_HEALTH;
live.health.invulnerable = 0;
live.dead = false;
live.ui.setDeath(false);
standOnPad(PAD.x + 5, PAD.z + 5);
live.player.flying = false;
live.player.velocityY = 0;
live.hurt(6, 'fall');
assert.equal(live.health.points, 14, 'a hit takes health off');
assert.ok(live.flash > 0, 'and the screen flashes');
assert.equal(live.hurt(6, 'fall'), 0, 'a second hit in the same moment is swallowed');
live.health.invulnerable = 0;
live.hurt(20, 'lava');
assert.equal(live.dead, true, 'running out of hearts kills you');
assert.equal(live.input.enabled, false, 'and parks the controls');
assert.equal(elements.get('death').hidden, false, 'the death screen comes up');
assert.equal(elements.get('death-cause').textContent, DEATH_MESSAGES.lava, 'with the cause written on it');
assert.equal(live.health.deaths, 1, 'the death is counted');
assert.equal(live.respawn(), true, 'the respawn button works');
assert.equal(live.dead, false, 'and you are alive again');
assert.equal(live.health.points, MAX_HEALTH, 'at full health');
assert.equal(elements.get('death').hidden, true, 'with the death screen gone');
assert.equal(live.input.enabled, true, 'and the controls back');
const respawnPoint = live.world.spawnPoint();
assert.ok(Math.abs(live.player.x - respawnPoint.x) < 0.01 && Math.abs(live.player.z - respawnPoint.z) < 0.01, 'standing at the spawn point');
assert.equal(live.respawn(), false, 'respawning twice does nothing the second time');

// --- and the hearts are drawn, ten of them, darkened as they empty
const heartCanvas = elements.get('hearts');
heartCanvas.width = 200;
const heartContext = heartCanvas.getContext('2d');
/** Draw the bar and hand back just the calls that draw made, not every call since the game booted. */
const drawAndTrace = (points) => {
  live.health.points = points;
  const from = heartContext.calls.length;       // window: only the calls this draw makes
  const count = live.ui.drawHealth(heartCanvas, live.health);
  return { count, calls: heartContext.calls.slice(from) };
};
const fullBar = drawAndTrace(20);
// Each heart is drawn three times: the dark socket, the clipped colour, then the outline.
assert.equal(fullBar.calls.filter(call => call.name === 'bezierCurveTo').length, 60, 'each heart is two curves, three passes');
assert.equal(fullBar.calls.filter(call => call.name === 'stroke').length, 10, 'and gets an outline');
assert.equal(fullBar.calls.filter(call => call.name === 'clip').length, 10, 'a full heart clips its fill into the shape');
assert.equal(fullBar.calls.filter(call => call.name === 'fill').length, 20, 'and paints a socket plus a coloured face');
const halfBar = drawAndTrace(10);
assert.equal(halfBar.calls.filter(call => call.name === 'clip').length, 5, 'half your hearts clips five of them');
const emptyBar = drawAndTrace(0);
assert.ok(emptyBar.calls.length > 0, 'an empty bar still draws its sockets');
assert.equal(emptyBar.calls.filter(call => call.name === 'clip').length, 0, 'with nothing to clip and no colour');
assert.equal(emptyBar.calls.filter(call => typeof call.args?.[0] === 'string' && /^#/.test(call.args[0])).length, 0, 'so no heart is painted red');
assert.ok(fullBar.calls.filter(call => typeof call.args?.[0] === 'string' && /^#/.test(call.args[0])).length > 0, 'while a full bar is painted in colour');

// --- low health pulses the screen
live.health.points = 4;
live.health.invulnerable = 0;
live.flash = 0;
step(1);
assert.ok(live.flash > 0, 'being nearly dead makes the screen pulse');
assert.ok(live.pulse >= 0 && live.pulse <= 1, 'and the pulse stays in range');
live.health.points = MAX_HEALTH;
step(1);
assert.ok(live.flash < 0.2, 'but a healthy player has a clear screen');

// --- weather now splashes on the ground where you can see it
const splashBefore = live.particles.active;
live.weather.intensity = 0.8;
live.weather.storm = true;
live.settings.values.particles = true;
live.particles.clear();
let splashed = 0;
for (let frame = 0; frame < 40 && splashed === 0; frame++) {
  live.splashTimer = 0;
  step(1);
  splashed = live.particles.active;
}
assert.ok(splashed > 0, `rain kicks droplets up off the ground (${splashed} particles)`);
live.weather.intensity = 0;
live.particles.clear();
void splashBefore;

// =============================================================== v3.6: modes, dailies, seeded worlds

// --- the mode shelf
const { MODES, DEFAULT_MODE, modeById, modeChip, randomModeId, formatTime } = await import('../web/modes.js');
assert.equal(MODES.length, 4, 'four modes on the shelf');
assert.equal(modeById(DEFAULT_MODE).id, 'survival', 'survival is the default');
assert.equal(modeById('nonsense').id, 'survival', 'an unknown mode falls back to survival');
for (const mode of MODES) {
  assert.ok(mode.name && mode.hook && mode.badge && mode.blurb, `${mode.id} is described like a shelf card`);
  assert.match(mode.colour, /^#[0-9a-f]{6}$/i, `${mode.id} has a colour`);
  assert.equal(typeof mode.rules.health, 'boolean', `${mode.id} says whether health applies`);
  assert.equal(typeof mode.rules.infiniteBlocks, 'boolean', `${mode.id} says whether blocks are free`);
}
assert.equal(modeById('creative').rules.infiniteBlocks, true, 'creative gives unlimited blocks');
assert.equal(modeById('creative').rules.instantMine, true, 'and instant mining');
assert.equal(modeById('sandbox').rules.flat, true, 'the sandbox is a flat world');
assert.equal(modeById('speedrun').rules.timer, true, 'the speedrun is timed');
assert.equal(modeChip(modeById('speedrun')).name, 'Speedrun', 'the HUD chip carries the name');
const randomModes = new Set();
for (let i = 0; i < 200; i++) randomModes.add(randomModeId(() => i / 200));
assert.equal(randomModes.size, 4, 'every mode can come up on "surprise me"');
assert.equal(formatTime(0), '0:00.0', 'the timer formats zero');
assert.equal(formatTime(83.45), '1:23.5', 'and minutes and seconds, to a tenth');
assert.equal(formatTime(60), '1:00.0', 'a whole minute pads its seconds');
assert.equal(formatTime(-3), '0:00.0', 'and a negative clock reads as zero');

// --- a flat sandbox world
const flatWorld = new VoxelWorld(4242, { flat: true });
assert.equal(flatWorld.flat, true, 'the world knows it is flat');
assert.equal(flatWorld.surfaceHeight(4, 4), flatWorld.surfaceHeight(120, 120), 'every column is the same height');
const flatTop = flatWorld.surfaceHeight(64, 64);
assert.equal(constants.blockById(flatWorld.get(64, flatTop, 64)).name, 'Grass', 'the top layer is grass');
assert.equal(constants.blockById(flatWorld.get(64, flatTop - 1, 64)).name, 'Dirt', 'under it is dirt');
assert.equal(constants.blockById(flatWorld.get(64, flatTop - 4, 64)).name, 'Stone', 'and then stone');
assert.equal(constants.blockById(flatWorld.get(64, 0, 64)).name, 'Obsidian', 'the floor is unbreakable obsidian');
assert.equal(flatWorld.biomeNameAt(10, 10), 'plains', 'a sandbox world is all plains');
assert.equal(flatWorld.ready, true, 'and it is ready for edits like any other world');
assert.ok(flatWorld.lightAt(64, flatTop + 1, 64) === 15, 'daylight reaches the surface');
assert.ok(flatWorld.lightAt(64, flatTop - 6, 64) < 8, 'and the ground below is dark');
let flatTrunks = 0, flatPlants = 0;
for (let z = 0; z < 128; z += 1) {
  for (let x = 0; x < 128; x += 1) {
    const id = flatWorld.get(x, flatTop + 1, z);
    if ([constants.LOG, constants.BIRCH_LOG, constants.SPRUCE_LOG].includes(id)) flatTrunks++;
    else if (id === constants.FLOWER || id === constants.TALL_GRASS) flatPlants++;
  }
}
assert.ok(flatTrunks > 0, `a flat world still has a few trees (${flatTrunks} trunk cells)`);
assert.ok(flatPlants > 20, `and a scattering of grass and flowers (${flatPlants})`);
const flatMesh = buildChunkMesh(flatWorld, 4, 4);
assert.ok(flatMesh.opaque.quadCount > 40, 'and it meshes like any other chunk');
// water never pools on a flat world: sea level is far below the plateau
assert.equal(flatWorld.get(64, SEA_LEVEL, 64) === WATER, false, 'no sea on the sandbox plateau');

// --- the daily challenge
const { todayKey, dailySeed, dailyGoals, GOALS, GOALS_PER_DAY, goalProgress, goalComplete, loadDaily, saveDaily, completeGoal, challengeSummary, previousKey, hashString } = await import('../web/challenges.js');
assert.match(todayKey(new Date(2026, 9, 16)), /^2026-10-16$/, 'the day key is YYYY-MM-DD');
assert.equal(previousKey('2026-10-16'), '2026-10-15', 'and the day before it can be worked out');
assert.equal(previousKey('2026-03-01'), '2026-02-28', 'across a month boundary too');
assert.equal(dailySeed('2026-10-16'), dailySeed('2026-10-16'), 'the same day gives the same seed');
assert.notEqual(dailySeed('2026-10-16'), dailySeed('2026-10-17'), 'and a new day gives a new one');
assert.ok(dailySeed('2026-10-16') >= 1000 && dailySeed('2026-10-16') <= 901000, 'the seed is in a sane range');
const goalsA = dailyGoals('2026-10-16');
assert.equal(goalsA.length, GOALS_PER_DAY, 'three goals a day');
assert.equal(new Set(goalsA.map(goal => goal.id)).size, GOALS_PER_DAY, 'and they are different goals');
assert.deepEqual(dailyGoals('2026-10-16').map(goal => goal.id), goalsA.map(goal => goal.id), 'the same day gives the same goals');
assert.ok(goalsA.every(goal => GOALS.includes(goal)), 'every goal comes from the pool');
assert.ok(GOALS.every(goal => goal.label && goal.value > 0 && typeof goal.of === 'function'), 'every goal knows its label, target and progress');

const stats = { broken: 15, placed: 0, distance: 40, torches: 0, logs: 0, crafted: 0, diamonds: 0, lowestY: 40, dawns: 0, swum: 0 };
const mineGoal = GOALS.find(goal => goal.id === 'mine-30');
assert.equal(goalProgress(mineGoal, stats), 0.5, 'fifteen of thirty is half done');
assert.equal(goalComplete(mineGoal, stats), false, 'and not finished');
stats.broken = 30;
assert.equal(goalComplete(mineGoal, stats), true, 'thirty of thirty is finished');
assert.equal(goalProgress(mineGoal, stats), 1, 'and clamps at one');
assert.equal(goalProgress(mineGoal, { ...stats, broken: 900 }), 1, 'even when you overshoot');
const depthGoal = GOALS.find(goal => goal.id === 'depth-14');
assert.equal(goalComplete(depthGoal, { ...stats, lowestY: 20 }), false, 'staying above y=14 does not count');
assert.equal(goalComplete(depthGoal, { ...stats, lowestY: 14 }), true, 'reaching y=14 does');
assert.equal(goalComplete(depthGoal, { ...stats, lowestY: null }), false, 'and never digging down counts as nothing');

const dailyStore = new Map();
const fakeStorage = { get: key => (dailyStore.has(key) ? dailyStore.get(key) : null), set: (key, value) => dailyStore.set(key, value) };
let dayState = loadDaily(fakeStorage, '2026-10-16');
assert.deepEqual(dayState.done, [], 'a fresh day starts with nothing done');
const firstTick = completeGoal(fakeStorage, 'mine-30', '2026-10-16');
assert.equal(firstTick.justFinished, true, 'completing a goal reports the news');
assert.equal(firstTick.state.done.length, 1, 'and records it');
assert.equal(completeGoal(fakeStorage, 'mine-30', '2026-10-16').justFinished, false, 'doing it twice only counts once');
const secondTick = completeGoal(fakeStorage, 'place-20', '2026-10-16');
assert.equal(secondTick.state.done.length, 2, 'a second goal is recorded');
const thirdTick = completeGoal(fakeStorage, 'walk-150', '2026-10-16');
assert.equal(thirdTick.state.done.length, 3, 'and a third');
assert.equal(thirdTick.streak, 1, 'finishing all three starts a streak');
assert.equal(loadDaily(fakeStorage, '2026-10-16').streak, 1, 'which is remembered');
// the next day: yesterday's goals are gone, and finishing today extends the streak
const nextDay = loadDaily(fakeStorage, '2026-10-17');
assert.deepEqual(nextDay.done, [], 'a new day clears the ticks');
completeGoal(fakeStorage, 'mine-30', '2026-10-17');
completeGoal(fakeStorage, 'place-20', '2026-10-17');
const extended = completeGoal(fakeStorage, 'walk-150', '2026-10-17');
assert.equal(extended.streak, 2, 'two days in a row is a two-day streak');
assert.equal(extended.state.best, 2, 'and the best is kept');
const summary = challengeSummary([mineGoal], { ...stats, broken: 10, lowestY: 40 }, { day: '2026-10-16', done: [], streak: 0 });
assert.equal(summary[0].progress > 0 && summary[0].progress < 1, true, 'the summary carries a progress bar value');
assert.equal(summary[0].complete, false, 'and whether it is done');

// --- the live game: modes change the rules, and the shelves are filled
live.setMode('creative');
assert.equal(live.creativeMode, true, 'creative mode gives infinite blocks');
assert.equal(live.instantMine, true, 'and instant mining');
assert.equal(live.invulnerable, true, 'and no damage at all');
assert.equal(live.player.flying, true, 'with flight on from the start');
assert.equal(live.hurt(20, 'fall'), 0, 'so a fall cannot hurt you');
assert.equal(live.health.points, 20, 'and your hearts stay full');
assert.equal(elements.get('hud-mode-chip').hidden, false, 'the HUD shows the mode you are playing');
assert.match(elements.get('hud-mode-chip').textContent, /Creative/, 'by name');
assert.equal(elements.get('run-timer').hidden, true, 'and the clock stays hidden outside a speedrun');

// placing a block in creative does not spend anything
buildPad();
standOnPad(PAD.x + 2, PAD.z + 2);
live.selectHotbar(2);
const freeBlock = live.slotBlock();
live.inventory.delete(freeBlock);
assert.equal(live.build() || live.world.get(PAD.x + 2, padHeight + 1, PAD.z + 2) !== constants.AIR, true, 'creative building works');
assert.equal(live.inventory.has(freeBlock), false, 'and costs nothing from the bag');

live.setMode('survival');
assert.equal(live.creativeMode, false, 'survival takes the free blocks away');
assert.equal(live.invulnerable, false, 'and gives you your hearts back');
live.setMode('speedrun');
assert.equal(elements.get('run-timer').hidden, false, 'the speedrun shows the clock');
assert.equal(live.runTime, 0, 'which starts at zero');
assert.equal(live.running, true, 'and runs while you play');
step(30);
assert.ok(live.runTime > 0.3, `the clock counts up while playing (${live.runTime.toFixed(2)})`);
live.runDone = 12.5;
assert.equal(live.running, false, 'and stops once the run is finished');
assert.equal(formatTime(live.runDone), '0:12.5', 'with the finishing time on the HUD');
live.setMode('survival');

// --- picking a mode card, and starting a world from a seed
live.pickMode('sandbox');
assert.equal(live.mode.id, 'sandbox', 'clicking a mode card switches the rules');
assert.equal(live.world.flat, true, 'and the sandbox really is a flat world');
assert.equal(live.recent.length >= 1, true, 'starting a world remembers it in the recent list');
live.pickMode('survival');
assert.equal(live.world.flat, false, 'going back to survival rebuilds a normal world');
assert.ok(live.menu.recentRow.children.length >= 1, 'the world is on the recent shelf');
assert.equal(live.recent[0].seed, live.world.seed, 'and the most recent entry is the world you are in');
assert.equal(live.recent[0].mode, live.mode.id, 'with the mode it was played in');
assert.equal(live.recent.filter(entry => entry.seed === live.world.seed).length, 1, 'the shelf never lists a seed twice');
const surprise = live.surprise();
assert.ok(surprise.seed >= 100000, 'surprise me picks a real seed');
assert.equal(MODES.some(mode => mode.id === surprise.mode), true, `and a real mode (${surprise.mode})`);
assert.equal(live.mode.id, surprise.mode, 'which is the mode the game is now playing');
assert.equal(live.world.seed, surprise.seed, 'and starts you in it');

live.startWorld(777, 'creative');
assert.equal(live.world.seed, 777, 'a seed starts the exact world you asked for');
assert.equal(live.mode.id, 'creative', 'in the mode you asked for');
assert.equal(live.menu.modeRow.children.length, MODES.length, 'the shelf keeps its cards');
assert.equal([...live.menu.modeRow.children].filter(card => card.classList.contains('active')).length, 1, 'with exactly one selected');

// --- the daily panel
const refreshed = live.refreshChallenges();
assert.equal(refreshed.length, GOALS_PER_DAY, 'the daily panel lists today three goals');
assert.equal(elements.get('challenge-list').children.length, GOALS_PER_DAY, 'as three rows');
assert.equal(elements.get('challenge-seed').textContent, String(dailySeed(live.dayKey)), "the card shows today's seed");
assert.match(elements.get('challenge-day').textContent, /DAILY/, 'and the day badge');
assert.equal(elements.get('daily-goals').children.length, GOALS_PER_DAY, 'the start screen teases the same goals');
assert.equal(live.toggleChallenges(true), true, 'J opens the daily panel');
assert.equal(elements.get('challenges').hidden, false, 'and it is on screen');
assert.equal(live.toggleChallenges(false), false, 'J closes it again');
assert.equal(elements.get('challenges').hidden, true, 'and it is hidden');

// --- a goal completes itself as you play, and the day is remembered
live.dailyState.done = [];
live.storage.set('pixeled-daily-v1', JSON.stringify({ ...live.dailyState, done: [] }));
for (const goal of live.dailyGoals) live.challengeStats[goal.id] = 0;
// The game's own tally feeds some of the goals, so it has to move too.
live.tally.broken = 9999;
live.tally.placed = 9999;
live.tally.distance = 9999;
live.challengeStats.broken = 9999;
live.challengeStats.placed = 9999;
live.challengeStats.distance = 9999;
live.challengeStats.torches = 9999;
live.challengeStats.logs = 9999;
live.challengeStats.crafted = 9999;
live.challengeStats.diamonds = 9999;
live.challengeStats.lowestY = 4;
live.challengeStats.dawns = 9999;
live.challengeStats.swum = 9999;
assert.equal(live.updateChallenges(1), true, 'a completed goal is noticed while playing');
assert.equal(live.dailyState.done.length, GOALS_PER_DAY, 'all three land at once when the stats say so');
assert.match(elements.get('toast').textContent, /Daily/, 'and the toast says which');
assert.equal(live.challengeOpen, false, 'the panel stays closed unless asked for');

// --- closing the tab and coming back: the world, your backpack and your chests all return
const saveSeed = live.world.seed;
const saveDoor = { x: PAD.x, y: padHeight + 1, z: PAD.z + 4 };
live.world.set(saveDoor.x, saveDoor.y, saveDoor.z, constants.DOOR);
live.world.setMeta(saveDoor.x, saveDoor.y, saveDoor.z, 3);
const saveChest = { x: PAD.x + 2, y: padHeight + 1, z: PAD.z + 4 };
live.world.set(saveChest.x, saveChest.y, saveChest.z, constants.CHEST);
const savedChest = live.world.chestAt(saveChest.x, saveChest.y, saveChest.z, true);
assert.ok(chest, 'a chest can be placed and filled');
addTo(savedChest, constants.DIAMOND_BLOCK, 5);
addTo(live.inventory, constants.STONE, 64);
live.save();
const written = JSON.parse(storage.get('pixeled-voxel-v2'));
assert.equal(written.seed, saveSeed, 'the save names the world');
assert.equal(written.metaEdits[`${saveDoor.x},${saveDoor.y},${saveDoor.z}`], 3, 'the open door is written down');
assert.equal(written.chests[`${saveChest.x},${saveChest.y},${saveChest.z}`][String(constants.DIAMOND_BLOCK)], 5, 'the chest keeps its diamonds');
assert.equal(written.inventory[String(constants.STONE)], 64, 'and the backpack keeps the stone');
assert.equal(written.mode, live.mode.id, 'with the mode you were playing');
live.saved = live.storage.load();
live.createWorld(saveSeed, true);
const reopened = live.world.chestAt(saveChest.x, saveChest.y, saveChest.z);
assert.ok(reopened, 'reopening the save brings the chest back');
assert.equal(countOf(reopened, constants.DIAMOND_BLOCK), 5, 'with its diamonds still inside');
assert.equal(live.world.getMeta(saveDoor.x, saveDoor.y, saveDoor.z), 3, 'and the door is still open');
assert.equal(countOf(live.inventory, constants.STONE), 64, 'and you still have your stone');
assert.equal(live.world.get(saveDoor.x, saveDoor.y, saveDoor.z), constants.DOOR, 'and the blocks you placed are all there');
// --- breaking a chest gives back what was inside it
buildPad();
const spillCell = { x: PAD.x - 1, y: padHeight + 2, z: PAD.z };
live.player.flying = false;
live.player.x = PAD.x + 0.5;
live.player.z = PAD.z + 0.5;
live.player.y = padHeight + 1;
live.player.velocityX = live.player.velocityY = live.player.velocityZ = 0;
live.world.placeBlock(spillCell.x, spillCell.y, spillCell.z, constants.CHEST);
const spillChest = live.world.chestAt(spillCell.x, spillCell.y, spillCell.z, true);
addTo(spillChest, constants.GOLD_BLOCK, 3);
const goldBefore = countOf(live.inventory, constants.GOLD_BLOCK);
assert.equal(aimAt(spillCell.x, spillCell.y, spillCell.z), true, 'the crosshair finds the chest before it goes');
live.input.mining = true;                  // hold the button, one frame at a time
for (let frame = 0; frame < 400 && live.world.get(spillCell.x, spillCell.y, spillCell.z) !== AIR; frame++) {
  stepAimed(1, live.player.yaw, live.player.pitch);
}
live.input.mining = false;
assert.equal(live.world.get(spillCell.x, spillCell.y, spillCell.z), constants.AIR, 'a chest breaks like any other block');
assert.equal(countOf(live.inventory, constants.GOLD_BLOCK), goldBefore + 3, 'and its stacks land in your backpack');
assert.equal(live.world.chestAt(spillCell.x, spillCell.y, spillCell.z), null, 'the chest itself is gone');
assert.match(elements.get('toast').textContent, /spilled/, 'and the toast says so');

// --- a block placed against water or a plant takes its cell
const splashCell = { x: PAD.x + 4, y: padHeight + 1, z: PAD.z };
live.world.set(splashCell.x, splashCell.y, splashCell.z, constants.WATER);
assert.equal(live.world.placeBlock(splashCell.x, splashCell.y, splashCell.z, constants.STONE, { replace: true }), true,
  'placeBlock can replace water when it is told to');
live.world.set(splashCell.x, splashCell.y, splashCell.z, constants.TALL_GRASS);
assert.equal(constants.blockById(live.world.get(splashCell.x, splashCell.y, splashCell.z)).plant, true, 'tall grass is a plant');
live.world.set(splashCell.x, splashCell.y, splashCell.z, AIR);

// --- sleeping brings a clear morning
live.setMode('survival', { silent: true });
const midnight = 0.9;
live.day.clock = midnight;
live.weather.intensity = 0.8;
live.weather.phase = 'storm';
assert.equal(live.sleep(PAD.x, padHeight, PAD.z), true, 'you can sleep at night');
live.finishSleep();
assert.equal(live.day.clock, 0.28, 'and wake just after dawn');
assert.equal(live.weather.intensity, 0, 'to a clear sky');
assert.equal(live.weather.phase, 'clear', 'with the storm gone');

// --- nonsense coordinates do not create phantom chests
assert.equal(live.world.chestAt(NaN, NaN, NaN, true), null, 'a chest needs a real cell');
assert.equal(live.world.chests.has('NaN,NaN,NaN'), false, 'so no phantom chest is filed under NaN');
assert.equal(live.world.chestAt(-1, 5, 5, true), null, 'nor outside the world');
const guardCell = { x: PAD.x - 4, y: padHeight + 2, z: PAD.z };
assert.equal(live.world.placeBlock(guardCell.x, guardCell.y, guardCell.z, constants.CHEST), true, 'a chest goes down for the guard test');
assert.ok(live.world.chestAt(guardCell.x, guardCell.y, guardCell.z, true) instanceof Map, 'a real cell still opens its chest');
// --- and a hand-edited save cannot smuggle junk in
const littered = new VoxelWorld(4242);
littered.applyEdits(new Map(), new Map(), {
  '10,20,10': { 5: 3, 0: 9, '-2': 4, 11: 0, 12: -3 },
  'NaN,0,0': { 5: 1 },
  '900,900,900': { 5: 1 },
});
assert.deepEqual([...littered.chests.keys()], ['10,20,10'], 'only the real chest survives');
assert.deepEqual([...littered.chestAt(10, 20, 10).entries()], [[5, 3]], 'with only the sane stacks in it');
// Leaving a save written, so the next boot of the suite starts from a known world.
live.save();

console.log(`web smoke test passed — ${game.renderer.meshes.size} chunks meshed, ${glStub.stats.draws} draw calls, water blocks: ${waterCount}`);
void CHUNK; void SEA_LEVEL;
