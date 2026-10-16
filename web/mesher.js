/**
 * Chunk mesher: turns voxels into triangle soup with baked ambient occlusion and face shading.
 *
 * Every visible face emits four vertices carrying position (chunk-local), normal, and a colour that
 * already includes the face shade, a per-block colour jitter and the ambient occlusion of that
 * corner. That keeps the shaders tiny and lets the GPU draw a whole chunk in one call.
 */

import { AIR, AO_LEVELS, CHUNK, CORNER_ORDER, FACES, GRASS, LEAVES, PLANTS, SPRUCE_LEAVES, TALL_GRASS, WATER, WORLD_Y, blockById, isTransparent } from './constants.js';
import { hashCoords } from './noise.js';

/** A block lets light through: air, water or glass. */
export function transparent(id) {
  return isTransparent(id);
}

export function buildChunkMesh(world, chunkX, chunkZ) {
  const opaque = emptyMesh();
  const water = emptyMesh();
  const plants = emptyMesh();
  const baseX = chunkX * CHUNK, baseZ = chunkZ * CHUNK;

  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = baseZ; z < baseZ + CHUNK; z++) {
      for (let x = baseX; x < baseX + CHUNK; x++) {
        const id = world.get(x, y, z);
        if (id === AIR) continue;
        const block = blockById(id);
        if (block.plant) {
          emitPlant(plants, world, block, x, y, z, baseX, baseZ);
          continue;                                  // plants never emit box faces
        }
        const target = block.liquid || block.transparent ? water : opaque;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const neighbour = world.get(x + face.normal[0], y + face.normal[1], z + face.normal[2]);
          if (!transparent(neighbour)) continue;   // hidden by a solid neighbour
          if (neighbour === id) continue;          // water beside water, glass beside glass
          emitFace(target, world, block, face, x, y, z, baseX, baseZ);
        }
      }
    }
  }
  return { opaque: finish(opaque), water: finish(water), plants: finish(plants) };
}

/**
 * A plant is two crossed, double-sided quads: the cheapest shape that still reads as a tuft or a
 * flower from every angle. Both windings are emitted so back-face culling can stay on.
 */
function emitPlant(mesh, world, block, x, y, z, baseX, baseZ) {
  const tint = biomeTint(world, x, z, block);
  const jitter = 0.92 + hashCoords(x, y, z, 23) * 0.16;
  const height = block.id === TALL_GRASS ? 0.95 : 0.75;
  const lift = hashCoords(x, y, z, 29) * 0.12;            // so a field of grass is not a grid
  const light = 0.94 * jitter * (block.light > 0 ? 1 : lightCurve(cellLight(world, x, y, z)));
  const planes = [
    [[0.06, 0.06], [0.94, 0.94]],
    [[0.94, 0.06], [0.06, 0.94]],
  ];
  for (const [a, b] of planes) {
    const start = mesh.positions.length / 3;
    const corners = [
      [a[0], lift, a[1]],
      [b[0], lift, b[1]],
      [b[0], lift + height, b[1]],
      [a[0], lift + height, a[1]],
    ];
    for (const [cx, cy, cz] of corners) {
      mesh.positions.push(x + cx - baseX, y + cy, z + cz - baseZ);
      mesh.normals.push(0, 1, 0);
      mesh.colors.push(tint[0] * light, tint[1] * light, tint[2] * light);
    }
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    mesh.indices.push(start + 2, start + 1, start, start + 3, start + 2, start);
  }
}

/** Biome colour for a tinted block, falling back to the plain palette colour. */
function biomeTint(world, x, z, block) {
  const base = block.top;
  if (!block.tint || typeof world.tintAt !== 'function') return base;
  const tint = world.tintAt(x, z);
  const plains = block.id === LEAVES || block.id === SPRUCE_LEAVES
    ? [0.33, 0.65, 0.28]
    : [0.47, 0.75, 0.35];
  return [
    Math.min(1.3, tint[0] / plains[0]) * base[0],
    Math.min(1.3, tint[1] / plains[1]) * base[1],
    Math.min(1.3, tint[2] / plains[2]) * base[2],
  ];
}

function emptyMesh() { return { positions: [], normals: [], colors: [], indices: [] }; }

function finish(mesh) {
  if (mesh.indices.length === 0) return null;
  return {
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    colors: new Float32Array(mesh.colors),
    indices: mesh.indices,
    vertexCount: mesh.positions.length / 3,
    quadCount: mesh.indices.length / 6,
  };
}

function emitFace(mesh, world, block, face, x, y, z, baseX, baseZ) {
  const tint = 0.9 + hashCoords(x, y, z, 17) * 0.1;
  let base = face.normal[1] > 0 ? block.top : face.normal[1] < 0 ? block.bottom : block.side;
  if (block.tint && block.id !== TALL_GRASS) base = biomeTint(world, x, z, block);
  const start = mesh.positions.length / 3;
  const lights = [];
  // Torches and lava light the cell a face looks into; a glowing block lights itself fully.
  const here = cellLight(world, x, y, z);
  const there = cellLight(world, x + face.normal[0], y + face.normal[1], z + face.normal[2]);
  const glow = block.light > 0 ? 1 : lightCurve(Math.max(here, there));

  for (let corner = 0; corner < 4; corner++) {
    const [i, j] = CORNER_ORDER[corner];
    const offsetU = i ? 1 : -1, offsetV = j ? 1 : -1;
    const cx = x + face.origin[0] + i * face.u[0] + j * face.v[0];
    const cy = y + face.origin[1] + i * face.u[1] + j * face.v[1];
    const cz = z + face.origin[2] + i * face.u[2] + j * face.v[2];
    const ox = x + face.normal[0], oy = y + face.normal[1], oz = z + face.normal[2];

    const sideA = solidAt(world, cx + ox + face.u[0] * offsetU, cy + oy + face.u[1] * offsetU, cz + oz + face.u[2] * offsetU);
    const sideB = solidAt(world, cx + ox + face.v[0] * offsetV, cy + oy + face.v[1] * offsetV, cz + oz + face.v[2] * offsetV);
    const diagonal = solidAt(world,
      cx + ox + face.u[0] * offsetU + face.v[0] * offsetV,
      cy + oy + face.u[1] * offsetU + face.v[1] * offsetV,
      cz + oz + face.u[2] * offsetU + face.v[2] * offsetV);
    const occlusion = sideA && sideB ? 3 : (sideA ? 1 : 0) + (sideB ? 1 : 0) + (diagonal ? 1 : 0);
    // Ambient occlusion, face shading and the light level all multiply into the vertex colour.
    const light = AO_LEVELS[occlusion] * face.shade * tint * glow;

    mesh.positions.push(cx - baseX, cy, cz - baseZ);
    mesh.normals.push(face.normal[0], face.normal[1], face.normal[2]);
    mesh.colors.push(base[0] * light, base[1] * light, base[2] * light);
    lights.push(light);
  }

  // Split the quad along whichever diagonal keeps the ambient-occlusion gradient smooth.
  if (lights[0] + lights[2] <= lights[1] + lights[3]) {
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else {
    mesh.indices.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
  }
}

/**
 * Light level at a cell, if the world has a light engine. Anything without one (unit tests, other
 * editions) reads as full daylight, which keeps the mesher usable on its own.
 */
function cellLight(world, x, y, z) {
  if (typeof world.lightAt !== 'function') return 15;
  return world.lightAt(Math.floor(x), Math.floor(y), Math.floor(z));
}

/**
 * 0-15 light to a brightness multiplier. Deep darkness still keeps a little ambient light so caves
 * read as dim rather than as a void, and the curve is soft so torchlight falls off naturally.
 */
export function lightCurve(level) {
  const t = Math.max(0, Math.min(1, level / 15));
  return 0.28 + 0.72 * Math.pow(t, 0.72);
}

function solidAt(world, x, y, z) {
  const id = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return id !== AIR && !blockById(id).transparent;
}

export { WATER };
