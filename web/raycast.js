/**
 * Voxel ray casting (Amanatides & Woo 3D DDA). Used for aiming, mining and placing, and ported
 * line-for-line into the Python, Java and Android editions for their software renderers.
 */

import { WORLD_X, WORLD_Y, WORLD_Z } from './constants.js';

/** @returns {{x:number,y:number,z:number,nx:number,ny:number,nz:number,distance:number}|null} */
export function raycast(world, origin, direction, maxDistance = 8, hitLiquid = false) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = direction.x > 0 ? 1 : -1;
  const stepY = direction.y > 0 ? 1 : -1;
  const stepZ = direction.z > 0 ? 1 : -1;
  const deltaX = Math.abs(1 / (direction.x || 1e-9));
  const deltaY = Math.abs(1 / (direction.y || 1e-9));
  const deltaZ = Math.abs(1 / (direction.z || 1e-9));

  let maxX = ((direction.x > 0 ? x + 1 - origin.x : origin.x - x) || 1e-9) * deltaX;
  let maxY = ((direction.y > 0 ? y + 1 - origin.y : origin.y - y) || 1e-9) * deltaY;
  let maxZ = ((direction.z > 0 ? z + 1 - origin.z : origin.z - z) || 1e-9) * deltaZ;

  let distance = 0, nx = 0, ny = 0, nz = 0;
  while (distance <= maxDistance) {
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) break;
    if (y >= 0 && y < WORLD_Y) {
      const id = world.get(x, y, z);
      const solid = id !== 0 && id !== 10;
      if (solid || (hitLiquid && id === 10)) {
        return { x, y, z, nx, ny, nz, distance, id };
      }
    } else if ((y < 0 && direction.y <= 0) || (y >= WORLD_Y && direction.y >= 0)) {
      break; // heading away from the world: above the sky or below the ground
    }
    if (maxX < maxY && maxX < maxZ) {
      x += stepX; distance = maxX; maxX += deltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (maxY < maxZ) {
      y += stepY; distance = maxY; maxY += deltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; distance = maxZ; maxZ += deltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

/** The empty cell facing the hit surface, where a new block would go. */
export function placementCell(hit) {
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}
