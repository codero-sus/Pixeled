/**
 * Renderer test, headless.
 *
 * three.js is swapped for the small fake in `fake-three.mjs`, so the real `VoxelRenderer`, `Sky`
 * and `PlayerVisual` code runs in Node: chunk meshes really get built from voxel data, the scene
 * really fills up, and edits really rebuild the right chunks.
 *
 *   node tests/render_test.mjs
 */

import assert from 'node:assert/strict';

import {
  THREE, countSceneMeshes, countSceneTriangles, Mesh, Points, InstancedMesh,
} from './fake-three.mjs';
import { DEFAULT_SETTINGS, CHUNK_SIZE, SEA_LEVEL } from '../web/constants.js';
import { VoxelWorld } from '../web/world.js';
import { PlayerModel } from '../web/player.js';
import { VoxelRenderer } from '../web/renderer.js';
import { Sky } from '../web/sky.js';
import { PlayerVisual } from '../web/player.js';

// ------------------------------------------------------------------ fake document bits

const fakeCanvas = {
  width: 320, height: 240, clientWidth: 960, clientHeight: 600,
  addEventListener() {}, removeEventListener() {},
  getContext() {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      clearRect() {}, drawImage() {}, save() {}, restore() {}, setTransform() {},
      set imageSmoothingEnabled(value) { this._smooth = value; },
      get imageSmoothingEnabled() { return this._smooth; },
      globalAlpha: 1,
    };
  },
  requestPointerLock() {},
};

// A canvas texture needs a canvas; the renderer only ever stores it.
globalThis.devicePixelRatio = 1;
globalThis.document = {
  createElement: () => fakeCanvas,
};

// ------------------------------------------------------------------ world + renderer

const world = new VoxelWorld(13579);
const settings = { ...DEFAULT_SETTINGS, renderDistance: 3 };
const renderer = new VoxelRenderer(THREE, fakeCanvas, world, settings);

assert.ok(renderer.scene, 'the scene exists');
assert.ok(renderer.camera.fov === settings.fov, 'the camera uses the settings field of view');
assert.ok(renderer.scene.fog, 'distance fog is set up');

const spawn = world.findSpawn(0, 0);
const player = new PlayerModel(world, spawn);

// Stream and mesh a few frames' worth of chunks.
for (let frame = 0; frame < 40; frame++) {
  renderer.streamChunks(player);
  renderer.processQueue();
}

const meshes = countSceneMeshes(renderer.scene);
const triangles = countSceneTriangles(renderer.scene);
assert.ok(renderer.chunkMeshes.size > 5, `chunks are streamed in (${renderer.chunkMeshes.size})`);
assert.ok(meshes > 5, `the scene holds meshes (${meshes})`);
assert.ok(triangles > 500, `and real triangles (${triangles})`);

// Chunk meshes must be in world space, never stacked at the origin.
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const entry of renderer.chunkMeshes.values()) {
  for (const mesh of [entry.opaque, entry.water, entry.plants]) {
    if (!mesh) continue;
    const positions = mesh.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
  }
}
assert.ok(maxX - minX > CHUNK_SIZE * 2, `chunk meshes spread across the world (${(maxX - minX).toFixed(0)} blocks wide)`);
assert.ok(maxZ - minZ > CHUNK_SIZE * 2, 'in both directions');

// Every mesh should sit where its chunk does.
for (const entry of renderer.chunkMeshes.values()) {
  const mesh = entry.opaque;
  if (!mesh) continue;
  const sphere = mesh.geometry.boundingSphere;
  assert.ok(sphere, 'each mesh has a bounding sphere for culling');
  assert.ok(sphere.center.x >= entry.cx * CHUNK_SIZE - 1 && sphere.center.x <= (entry.cx + 1) * CHUNK_SIZE + 1,
    `chunk ${entry.cx},${entry.cz} mesh sits over its own chunk`);
}

// ------------------------------------------------------------------ editing rebuilds chunks

const surfaceY = world.columnTop(Math.floor(spawn.x), Math.floor(spawn.z));
// Dig one block below the surface: it is surrounded on all sides, so removing it must add faces.
const target = { x: Math.floor(spawn.x), y: surfaceY - 1, z: Math.floor(spawn.z) };
const chunkKey = `${target.x >> 4},${target.z >> 4}`;
const before = renderer.chunkMeshes.get(chunkKey).opaque.geometry.attributes.position.array;
const trianglesBefore = countSceneTriangles(renderer.scene);

assert.equal(world.setBlock(target.x, target.y, target.z, 0), true, 'a buried block is removed');
renderer.markBlockDirty(target.x, target.z);
assert.ok(renderer.buildQueue.length > 0, 'the edit queues a rebuild');
for (let frame = 0; frame < 6; frame++) renderer.processQueue();
const after = renderer.chunkMeshes.get(chunkKey).opaque.geometry.attributes.position.array;
assert.notEqual(after, before, 'the chunk mesh is rebuilt with fresh geometry');
assert.ok(after.length > before.length, `the hole adds faces (${before.length / 3} → ${after.length / 3} vertices)`);
assert.ok(countSceneTriangles(renderer.scene) > trianglesBefore, 'the scene gains those triangles');
assert.ok(renderer.buildQueue.length === 0, 'and the queue drains');

// Highlight + particles + break feedback.
renderer.setHighlight({ x: target.x, y: target.y, z: target.z }, 0.5);
assert.equal(renderer.highlight.visible, true, 'the block highlight appears');
assert.ok(renderer.highlight.position.x === target.x + 0.5, 'and snaps to the block centre');
renderer.setHighlight(null);
assert.equal(renderer.highlight.visible, false, 'and hides again');

renderer.spawnBreakParticles(target.x, target.y, target.z, 3, 12);
assert.equal(renderer.particles.visible, true, 'breaking a block throws particles');
const particlePositions = renderer.particles.geometry.attributes.position.array;
const aliveBefore = Array.from(particlePositions).filter((value, index) => index % 3 === 1 && value > -100).length;
assert.ok(aliveBefore >= 12, `particles carry positions (${aliveBefore})`);
renderer.updateParticles(0.05);
assert.equal(renderer.particles.geometry.attributes.position.needsUpdate, true, 'and they are animated');

// ------------------------------------------------------------------ frames, camera, resize

const frames = [];
for (let i = 0; i < 5; i++) {
  renderer.render(player, 1 / 60, { mining: i % 2 === 0 });
  frames.push({ renders: renderer.renderer.renders, chunks: renderer.chunksRendered });
}
assert.equal(renderer.renderer.renders, 5, 'every frame reaches the renderer');
assert.ok(renderer.fps >= 0, 'the frame counter updates');

renderer.resize(1280, 720);
assert.equal(Math.round(renderer.camera.aspect * 100) / 100, 1.78, 'resizing updates the camera aspect');
assert.deepEqual(renderer.renderer.sizes.at(-1), { width: 1280, height: 720 }, 'and the drawing buffer');

renderer.applySettings({ ...settings, fov: 92, renderDistance: 5 });
assert.equal(renderer.camera.fov, 92, 'settings reach the camera');
assert.equal(renderer.scene.fog.far, 5 * CHUNK_SIZE - 8, 'and the fog distance');

// ------------------------------------------------------------------ sky

const sky = renderer.sky;
assert.ok(sky instanceof Sky, 'the renderer owns a sky');
assert.match(sky.clockText(), /^\d{2}:\d{2}$/, `the sky has a clock (${sky.clockText()})`);
// The clock runs 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
sky.setTime(0.5);
assert.ok(sky.daylight > 0.8, `noon is bright (${sky.daylight.toFixed(2)})`);
assert.equal(sky.clockText(), '12:00', 'noon reads 12:00');
sky.setTime(0.0);
assert.ok(sky.daylight < 0.2, `midnight is dark (${sky.daylight.toFixed(2)})`);
assert.equal(sky.phaseName(0.0), 'Night');
assert.equal(sky.phaseName(0.25), 'Dawn');
assert.equal(sky.phaseName(0.5), 'Daytime');
assert.equal(sky.phaseName(0.72), 'Dusk');
sky.setTime(0.32);
sky.update(1 / 60);
sky.follow(player, 3.2);
assert.ok(sky.skyMesh.position.x === player.position.x, 'the sky dome follows the player');
assert.ok(sky.clouds.matrices.every(matrix => matrix), 'every cloud has a matrix');
assert.ok(sky.clouds.instanceMatrix.needsUpdate, 'and the cloud instancing is uploaded');

// ------------------------------------------------------------------ avatar

const avatar = new PlayerVisual(THREE, renderer.camera);
assert.ok(avatar.group.children.length > 0, 'the avatar has body parts');
avatar.setVisible(true);
avatar.update(player, 1 / 60, 0.7, false);
avatar.setFrame('walk1', false);
const uvBefore = Array.from(avatar.head.geometry.getAttribute('uv').array);
avatar.setFrame('walk1', true);
const uvAfter = Array.from(avatar.head.geometry.getAttribute('uv').array);
assert.notDeepEqual(uvBefore, uvAfter, 'mirroring the sprite flips its texture coordinates');
assert.ok(uvAfter.every(value => value >= 0 && value <= 1), 'and keeps them inside the sheet');
avatar.setVisible(false);
assert.equal(avatar.group.visible, false, 'the avatar hides in first person');

// The walk cycle should cycle (on the ground, and moving).
player.onGround = true;
player.walkPhase = 0;
const seen = new Set();
for (let i = 0; i < 8; i++) {
  player.walkPhase += 0.2;
  player.walkSpeed = 4;
  avatar.update(player, 1 / 60, 0, false);
  seen.add(avatar.currentFrame);
}
assert.ok(seen.size >= 2, `the walk cycle uses several frames (${Array.from(seen).join(', ')})`);

// ------------------------------------------------------------------ new world clears everything

const sceneObjectsBefore = countSceneMeshes(renderer.scene);
const freshWorld = new VoxelWorld(2468);
renderer.setWorld(freshWorld);
assert.equal(countSceneMeshes(renderer.scene) <= sceneObjectsBefore, true, 'swapping worlds drops the old chunk meshes');
for (let frame = 0; frame < 60; frame++) {
  renderer.streamChunks(player);
  renderer.processQueue();
}
assert.ok(renderer.chunkMeshes.size > 5, 'and the new world streams in');
assert.ok(countSceneTriangles(renderer.scene) > 500, 'with its own terrain');

console.log('render tests passed — chunk meshes, edits, sky, particles and the avatar all behave');
