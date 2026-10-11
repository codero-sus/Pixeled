/**
 * First-person player: a swept AABB against the voxel grid, plus looking direction.
 * Physics values are in blocks and seconds (1 block = 1 unit), matching Minecraft's feel.
 */

import { EYE_HEIGHT, FLY_SPEED, GRAVITY, JUMP_SPEED, PLAYER_HEIGHT, PLAYER_WIDTH, SPRINT_SPEED, WALK_SPEED } from './constants.js';

export class Player {
  constructor(world) {
    const spawn = world.spawnPoint();
    this.x = spawn.x; this.y = spawn.y; this.z = spawn.z;
    this.velocityX = 0; this.velocityY = 0; this.velocityZ = 0;
    this.yaw = Math.PI * 0.25; this.pitch = -0.15;
    this.onGround = false;
    this.flying = false;
    this.walking = 0;
    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
  }

  get eyeY() { return this.y + EYE_HEIGHT; }

  direction() {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  look(deltaYaw, deltaPitch) {
    this.yaw -= deltaYaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this.pitch - deltaPitch));
  }

  spawnAt(world) {
    const spawn = world.spawnPoint();
    this.x = spawn.x; this.y = spawn.y; this.z = spawn.z;
    this.velocityX = this.velocityY = this.velocityZ = 0;
    this.onGround = false;
  }

  update(dt, input, world) {
    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const speed = this.flying ? FLY_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
    const sinYaw = Math.sin(this.yaw), cosYaw = Math.cos(this.yaw);

    // Movement in the horizontal plane, relative to where the player is looking.
    let wishX = 0, wishZ = 0;
    if (forward || strafe) {
      wishX = -sinYaw * forward + cosYaw * strafe;
      wishZ = -cosYaw * forward - sinYaw * strafe;
      const length = Math.hypot(wishX, wishZ) || 1;
      wishX /= length; wishZ /= length;
    }

    if (this.flying) {
      this.velocityX = wishX * speed;
      this.velocityZ = wishZ * speed;
      const vertical = (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
      this.velocityY = vertical * speed;
      if (input.sprint && vertical === 0) { this.velocityX *= 1.6; this.velocityZ *= 1.6; }
    } else {
      // Snappy ground control, softer air control (Minecraft-like).
      const accel = this.onGround ? 42 : 12;
      this.velocityX += (wishX * speed - this.velocityX) * Math.min(1, accel * dt);
      this.velocityZ += (wishZ * speed - this.velocityZ) * Math.min(1, accel * dt);
      if (this.onGround && input.jump) { this.velocityY = JUMP_SPEED; this.onGround = false; }
      this.velocityY = Math.max(-60, this.velocityY - GRAVITY * dt);
    }

    this.move(world, this.velocityX * dt, this.velocityY * dt, this.velocityZ * dt);
    if (!this.flying && this.y < -8) this.spawnAt(world);
    this.walking += Math.hypot(this.velocityX, this.velocityZ) * dt * 0.7;
  }

  /**
   * Axis-separated sweep: move on one axis, and if the box ends up inside a block, snap it back
   * onto that face. Because the frame time is clamped the box never penetrates by more than a
   * block, so the face we hit is simply the one the feet or the head are inside.
   */
  move(world, dx, dy, dz) {
    const epsilon = 1e-4;

    this.x += dx;
    if (this.collides(world)) {
      this.x -= dx;
      this.velocityX = 0;
      this.attemptStep(world, dx, 0);
    }

    this.z += dz;
    if (this.collides(world)) {
      this.z -= dz;
      this.velocityZ = 0;
      this.attemptStep(world, 0, dz);
    }

    this.y += dy;
    this.onGround = false;
    if (!this.collides(world)) return;
    if (dy > 0) {
      const ceiling = Math.floor(this.y + this.height - 1e-3);
      this.y = ceiling - this.height - epsilon;
      this.velocityY = 0;
    } else {
      const ground = Math.floor(this.y + 1e-3);
      this.y = ground + 1 + epsilon;
      this.velocityY = 0;
      this.onGround = true;
    }
  }

  /** Walk up a single block: probe first, then commit only if the box really ends up free. */
  attemptStep(world, dx, dz) {
    if (!this.onGround) return false;
    const probeX = this.x + Math.sign(dx) * 0.09 + dx;
    const probeZ = this.z + Math.sign(dz) * 0.09 + dz;
    if (this.collidesAt(world, probeX, this.y + 1.02, probeZ)) return false;
    const previousY = this.y;
    this.y += 1.02;
    this.x += dx;
    this.z += dz;
    if (this.collides(world)) {
      this.y = previousY;
      this.x -= dx;
      this.z -= dz;
      return false;
    }
    return true;
  }

  collides(world) { return this.collidesAt(world, this.x, this.y, this.z); }

  /** True when the player box overlaps any solid voxel. */
  collidesAt(world, x, y, z) {
    const half = this.width / 2 - 1e-3;
    const minX = Math.floor(x - half), maxX = Math.floor(x + half);
    const minY = Math.floor(y + 1e-3), maxY = Math.floor(y + this.height - 1e-3);
    const minZ = Math.floor(z - half), maxZ = Math.floor(z + half);
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (world.isSolid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  /** Solid ground is not "inside" the player, but the ground they stand on is fine. */
  overlappingBlock() {
    const half = this.width / 2;
    return { min: { x: this.x - half, y: this.y, z: this.z - half }, max: { x: this.x + half, y: this.y + this.height, z: this.z + half } };
  }
}
