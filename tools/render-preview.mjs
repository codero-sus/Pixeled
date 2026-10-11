/**
 * Renders PNG previews of the 3D world (and the texture atlas) with the software renderer, so the
 * voxel geometry, UVs, ambient occlusion and fog can be inspected without a browser.
 *
 *   node tools/render-preview.mjs [outputDirectory]
 */

import fs from 'node:fs';
import path from 'node:path';

import { ATLAS_PIXELS, SEA_LEVEL } from '../web/constants.js';
import { paintAtlas } from '../web/atlas.js';
import { meshChunk } from '../web/mesher.js';
import { VoxelWorld } from '../web/world.js';
import { encodePng, makeCamera, renderMeshes } from './software-render.js';

const outputDirectory = process.argv[2] ?? path.join(import.meta.dirname, '..', 'artifacts');
fs.mkdirSync(outputDirectory, { recursive: true });

const SEED = 20261011;
const atlas = paintAtlas();
const world = new VoxelWorld(SEED);
const sun = { direction: [0.45, 0.78, 0.44] };
const sky = [148, 194, 222];

function meshesAround(cx, cz, radius) {
  const meshes = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) world.ensureChunk(x, z);
  }
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      const chunk = world.chunk(x, z);
      const mesh = meshChunk(world, chunk);
      for (const group of [mesh.opaque, mesh.water, mesh.plants]) {
        if (group.indices.length) meshes.push({ ...group, normals: group.normals });
      }
    }
  }
  return meshes;
}

function save(name, camera, meshes, extra = {}) {
  const rgb = renderMeshes({
    meshes, camera, atlas, atlasPixels: ATLAS_PIXELS, background: sky, fogColor: sky, sun, ...extra,
  });
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, encodePng(camera.width, camera.height, rgb));
  console.log('wrote', path.relative(process.cwd(), file));
}

/* ------------------------------------------------------------------ atlas sheet */

{
  const scale = 6;
  const size = ATLAS_PIXELS * scale;
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const texel = ((Math.floor(y / scale) * ATLAS_PIXELS) + Math.floor(x / scale)) * 4;
      const checker = (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 === 0 ? 26 : 38;
      const alpha = atlas[texel + 3] / 255;
      for (let c = 0; c < 3; c++) {
        rgb[(y * size + x) * 3 + c] = Math.round(atlas[texel + c] * alpha + checker * (1 - alpha));
      }
    }
  }
  fs.writeFileSync(path.join(outputDirectory, 'atlas.png'), encodePng(size, size, rgb));
  console.log('wrote', path.relative(process.cwd(), path.join(outputDirectory, 'atlas.png')));
}

/* ------------------------------------------------------------------ landscape shots */

// Find a photogenic spot: some water in view, some height variation.
let spot = { x: 0, z: 0 };
outer:
for (let radius = 8; radius <= 400; radius += 8) {
  for (let angle = 0; angle < 24; angle++) {
    const x = Math.round(Math.cos(angle / 24 * Math.PI * 2) * radius);
    const z = Math.round(Math.sin(angle / 24 * Math.PI * 2) * radius);
    const height = world.generator.heightAt(x, z);
    if (height > SEA_LEVEL - 2 && height < SEA_LEVEL + 3) { spot = { x, z }; break outer; }
  }
}
console.log('preview spot', spot, 'height', world.generator.heightAt(spot.x, spot.z), 'biome', world.generator.biomeAt(spot.x, spot.z));

const overview = {
  eye: [spot.x - 26, 62, spot.z - 26],
  target: [spot.x + 6, SEA_LEVEL + 2, spot.z + 6],
  width: 800,
  height: 450,
  fov: 68,
};
save('world-overview.png', makeCamera(overview), meshesAround(Math.floor(spot.x / 16), Math.floor(spot.z / 16), 3));

const ground = world.generator.heightAt(spot.x + 24, spot.z + 24);
const close = {
  eye: [spot.x + 24.5, ground + 3.2, spot.z + 24.5],
  target: [spot.x + 6, SEA_LEVEL + 1.5, spot.z + 6],
  width: 800,
  height: 450,
  fov: 75,
};
save('world-ground.png', makeCamera(close), meshesAround(Math.floor(spot.x / 16), Math.floor(spot.z / 16), 2), { fogNear: 40, fogFar: 150 });

// A high aerial view for the "is it really 3D?" test.
const aerial = {
  eye: [spot.x - 90, 120, spot.z - 90],
  target: [spot.x, SEA_LEVEL, spot.z],
  width: 900,
  height: 500,
  fov: 60,
};
save('world-aerial.png', makeCamera(aerial), meshesAround(Math.floor(spot.x / 16), Math.floor(spot.z / 16), 5), { fogNear: 120, fogFar: 320, sun });

console.log('done');
