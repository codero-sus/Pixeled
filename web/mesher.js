/**
 * Chunk meshing: turns voxels into triangles.
 *
 * Three groups come out of every chunk:
 *   opaque – solid block faces with baked ambient occlusion and skylight
 *   water  – the liquid surface, drawn transparent and slightly sunken
 *   plants – crossed quads for grass and flowers, alpha-tested
 *
 * The mesher only writes into plain arrays, so it runs (and is tested) in Node with no renderer,
 * no canvas and no three.js.
 */

import { BLOCKS, CHUNK_SIZE, FACE_SHADE, IS_LIQUID, IS_OPAQUE, IS_PLANT, WORLD_HEIGHT } from './constants.js';
import { hashFloat } from './noise.js';
import { tileUV } from './atlas.js';

const AO_LEVELS = [0.45, 0.62, 0.8, 1.0];
const SKY_SEARCH = 12;

/**
 * The six cube faces. `base` is one corner of the quad, `u` and `v` are the edge vectors that also
 * define the texture axes, and `normal` points out of the block. Winding is corrected below so
 * front faces always end up counter-clockwise with upright textures.
 */
const RAW_FACES = [
  { name: 'px', normal: [1, 0, 0], base: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], tile: 'side', shade: FACE_SHADE.side },
  { name: 'nx', normal: [-1, 0, 0], base: [0, 0, 1], u: [0, 0, -1], v: [0, 1, 0], tile: 'side', shade: FACE_SHADE.side },
  { name: 'py', normal: [0, 1, 0], base: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], tile: 'top', shade: FACE_SHADE.top },
  { name: 'ny', normal: [0, -1, 0], base: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], tile: 'bottom', shade: FACE_SHADE.bottom },
  { name: 'pz', normal: [0, 0, 1], base: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], tile: 'side', shade: FACE_SHADE.side },
  { name: 'nz', normal: [0, 0, -1], base: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], tile: 'side', shade: FACE_SHADE.side },
];

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Face table with guaranteed outward, counter-clockwise winding and matching UVs. */
export const FACE_TABLE = RAW_FACES.map(face => {
  const corners = [
    face.base,
    [face.base[0] + face.u[0], face.base[1] + face.u[1], face.base[2] + face.u[2]],
    [face.base[0] + face.u[0] + face.v[0], face.base[1] + face.u[1] + face.v[1], face.base[2] + face.u[2] + face.v[2]],
    [face.base[0] + face.v[0], face.base[1] + face.v[1], face.base[2] + face.v[2]],
  ];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (dot(cross(face.u, face.v), face.normal) < 0) {
    corners.reverse();
    uv.reverse();
  }
  return { ...face, corners, uvs: uv };
});

function emptyGroup() {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [], vertices: 0, quads: 0 };
}

function finalize(group) {
  return {
    positions: new Float32Array(group.positions),
    normals: new Float32Array(group.normals),
    uvs: new Float32Array(group.uvs),
    colors: new Float32Array(group.colors),
    indices: new Uint32Array(group.indices),
    vertices: group.vertices,
    quads: group.quads,
  };
}

/**
 * How much sky reaches a point. Fully covered cells fade towards 0.3, which is what makes caves
 * and overhangs read as dark without needing a light engine.
 */
function skyLight(world, x, y, z, columnTop) {
  if (y >= columnTop) return 1;
  let open = 0;
  for (let scan = y + 1; scan <= WORLD_HEIGHT; scan++) {
    if (IS_OPAQUE[world.getBlock(x, scan, z)]) break;
    if (++open >= SKY_SEARCH) return 1;
  }
  return 0.3 + 0.7 * (open / SKY_SEARCH);
}

/** Mesh one chunk into `{ opaque, water, plants }`, each with typed arrays for a BufferGeometry. */
export function meshChunk(world, chunk) {
  const groups = { opaque: emptyGroup(), water: emptyGroup(), plants: emptyGroup() };
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let y = 0; y <= chunk.highest; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.get(x, y, z);
        if (id === 0) continue;
        const worldX = baseX + x, worldZ = baseZ + z;
        if (IS_PLANT[id]) {
          emitPlant(groups.plants, world, x, y, z, worldX, worldZ, id);
          continue;
        }
        const liquid = IS_LIQUID[id];
        const group = liquid ? groups.water : groups.opaque;
        const definition = BLOCKS[id];
        const jitter = 0.95 + hashFloat(worldX, y, worldZ, 7717) * 0.1;
        // The top layer of a liquid sits a little below the block so the surface reads as water.
        const drop = liquid && world.getBlock(worldX, y + 1, worldZ) === 0 ? 0.12 : 0;
        for (const face of FACE_TABLE) {
          const neighbourX = worldX + face.normal[0];
          const neighbourY = y + face.normal[1];
          const neighbourZ = worldZ + face.normal[2];
          const neighbour = world.getBlock(neighbourX, neighbourY, neighbourZ);
          if (IS_OPAQUE[neighbour]) continue;
          if (liquid && IS_LIQUID[neighbour]) continue;
          if (definition.cutout && neighbour === id) continue;
          emitFace(group, {
            world, face, id,
            x, y, z, worldX, worldZ,
            neighbourX, neighbourY, neighbourZ,
            uv: tileUV(definition.tiles[face.tile]),
            jitter,
            liquid,
            drop,
          });
        }
      }
    }
  }

  return { opaque: finalize(groups.opaque), water: finalize(groups.water), plants: finalize(groups.plants) };
}

function emitFace(group, options) {
  const { world, face, id, y, worldX, worldZ, neighbourX, neighbourY, neighbourZ, uv, jitter, liquid, drop } = options;
  const [nx, ny, nz] = face.normal;
  const [ux, uy, uz] = face.u;
  const [vx, vy, vz] = face.v;
  const opaque = id => IS_OPAQUE[id];
  const columnTop = world.columnTop(worldX, worldZ);
  const light = (face.shade * jitter * skyLight(world, neighbourX, neighbourY, neighbourZ, columnTop)) || 1;
  const start = group.vertices;

  for (let corner = 0; corner < 4; corner++) {
    const point = face.corners[corner];
    const py = y + point[1] - (point[1] === 1 ? drop : 0);
    let shade = light;
    if (!liquid) {
      // Ambient occlusion from the three neighbours that can shadow this vertex.
      const su = face.uvs[corner][0] === 0 ? -1 : 1;
      const sv = face.uvs[corner][1] === 0 ? -1 : 1;
      const blocked = (dx, dy, dz) => (opaque(world.getBlock(worldX + dx, y + dy, worldZ + dz)) ? 1 : 0);
      const sideA = blocked(nx + ux * su, ny + uy * su, nz + uz * su);
      const sideB = blocked(nx + vx * sv, ny + vy * sv, nz + vz * sv);
      const diagonal = blocked(nx + ux * su + vx * sv, ny + uy * su + vy * sv, nz + uz * su + vz * sv);
      const ao = sideA && sideB ? 0 : 3 - (sideA + sideB + diagonal);
      shade *= AO_LEVELS[ao];
    }
    group.positions.push(worldX + point[0], py, worldZ + point[2]);
    group.normals.push(nx, ny, nz);
    group.uvs.push(
      uv.u0 + face.uvs[corner][0] * (uv.u1 - uv.u0),
      uv.v0 + (1 - face.uvs[corner][1]) * (uv.v1 - uv.v0),
    );
    group.colors.push(shade, shade, shade);
  }

  group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  group.vertices += 4;
  group.quads += 1;
}

/** Crossed quads for grass and flowers, jittered so a field never looks like a grid. */
function emitPlant(group, world, x, y, z, worldX, worldZ, id) {
  const uv = tileUV(BLOCKS[id].tiles.side);
  const columnTop = world.columnTop(worldX, worldZ);
  const light = skyLight(world, worldX, y, worldZ, columnTop) * (0.9 + hashFloat(worldX, y, worldZ, 991) * 0.16);
  const offsetX = (hashFloat(worldX, 1, worldZ, 131) - 0.5) * 0.3;
  const offsetZ = (hashFloat(worldX, 2, worldZ, 131) - 0.5) * 0.3;
  const height = 0.86 + hashFloat(worldX, 3, worldZ, 131) * 0.18;

  const quads = [
    { normal: [0, 0, 1], corners: [[0, 0, 0.5], [1, 0, 0.5], [1, height, 0.5], [0, height, 0.5]] },
    { normal: [1, 0, 0], corners: [[0.5, 0, 1], [0.5, 0, 0], [0.5, height, 0], [0.5, height, 1]] },
  ];

  for (const quad of quads) {
    const start = group.vertices;
    for (let corner = 0; corner < 4; corner++) {
      const [qx, qy, qz] = quad.corners[corner];
      group.positions.push(worldX + qx + offsetX, y + qy, worldZ + qz + offsetZ);
      group.normals.push(quad.normal[0], quad.normal[1], quad.normal[2]);
      const u = corner === 1 || corner === 2 ? 1 : 0;
      const v = corner >= 2 ? 0 : 1;
      group.uvs.push(uv.u0 + u * (uv.u1 - uv.u0), uv.v0 + v * (uv.v1 - uv.v0));
      group.colors.push(light, light, light);
    }
    group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    group.vertices += 4;
    group.quads += 1;
  }
}

/** Face counts per group, handy for the HUD and for tests. */
export function countFaces(mesh) {
  return { opaque: mesh.opaque.quads, water: mesh.water.quads, plants: mesh.plants.quads };
}
