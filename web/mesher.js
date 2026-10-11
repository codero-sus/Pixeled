/**
 * Chunk mesher: turns voxels into triangle soup with baked ambient occlusion and face shading.
 *
 * Every visible face emits four vertices carrying position (chunk-local), normal, and a colour that
 * already includes the face shade, a per-block colour jitter and the ambient occlusion of that
 * corner. That keeps the shaders tiny and lets the GPU draw a whole chunk in one call.
 */

import { AIR, AO_LEVELS, CHUNK, CORNER_ORDER, FACES, WATER, WORLD_Y, blockById } from './constants.js';
import { hashCoords } from './noise.js';

/** A block lets light through: air, water or glass. */
export function transparent(id) {
  return id === AIR || blockById(id).transparent;
}

export function buildChunkMesh(world, chunkX, chunkZ) {
  const opaque = emptyMesh();
  const water = emptyMesh();
  const baseX = chunkX * CHUNK, baseZ = chunkZ * CHUNK;

  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = baseZ; z < baseZ + CHUNK; z++) {
      for (let x = baseX; x < baseX + CHUNK; x++) {
        const id = world.get(x, y, z);
        if (id === AIR) continue;
        const block = blockById(id);
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
  return { opaque: finish(opaque), water: finish(water) };
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
  const base = face.normal[1] > 0 ? block.top : face.normal[1] < 0 ? block.bottom : block.side;
  const start = mesh.positions.length / 3;
  const lights = [];

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
    const light = AO_LEVELS[occlusion] * face.shade * tint;

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

function solidAt(world, x, y, z) {
  const id = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return id !== AIR && !blockById(id).transparent;
}

export { WATER };
