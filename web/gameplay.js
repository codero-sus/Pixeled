/**
 * Gameplay rules that are worth testing on their own: how long a block takes to break, how the
 * clock moves through a day, and when a footstep lands.
 *
 * Keeping these out of the frame loop means the numbers can be checked without a browser.
 */

import { AIR, WATER, blockById, hardnessOf } from './constants.js';

/** Seconds to break a block by hand, from its hardness. Plants pop instantly. */
export function breakSeconds(blockId) {
  if (blockId === AIR || blockId === WATER) return Infinity;
  const hardness = hardnessOf(blockId);
  if (hardness <= 0) return 0;
  if (!Number.isFinite(hardness)) return Infinity;
  return 0.28 + Math.sqrt(hardness) * 0.5;
}

export class Mining {
  constructor() {
    this.key = null;
    this.progress = 0;
    this.blockId = AIR;
    this.swings = 0;
    this.total = 0;
  }

  /** Forget the current block — used when the crosshair moves somewhere else. */
  reset() {
    this.key = null;
    this.progress = 0;
    this.blockId = AIR;
    this.total = 0;
  }

  /**
   * Hold mining on a target for one frame.
   * @returns {{progress:number, digging:boolean, broken:boolean, tick:boolean, blockId:number}}
   */
  hold(dt, hit, world) {
    if (!hit) {
      this.reset();
      return { progress: 0, digging: false, broken: false, tick: false, blockId: AIR };
    }
    const key = `${hit.x},${hit.y},${hit.z}`;
    const blockId = world.get(hit.x, hit.y, hit.z);
    if (blockId === AIR || blockId === WATER) {
      this.reset();
      return { progress: 0, digging: false, broken: false, tick: false, blockId };
    }
    // Re-target when the cell changes *or* when the block inside it does: a cell that used to hold
    // grass must not keep grass's break time once stone is placed there.
    if (key !== this.key || blockId !== this.blockId) {
      this.key = key;
      this.progress = 0;
      this.swings = 0;
      this.blockId = blockId;
      this.total = breakSeconds(blockId);
    }
    if (this.total <= 0) {                     // grass, flowers: one tap and it is gone
      return { progress: 1, digging: true, broken: true, tick: false, blockId };
    }
    if (!Number.isFinite(this.total)) {
      return { progress: 0, digging: false, broken: false, tick: false, blockId };
    }

    const before = this.progress;
    this.progress += dt / this.total;
    // A tick noise every quarter of the way through, like Minecraft's dig rhythm.
    const tick = Math.floor(before * 4) !== Math.floor(Math.min(1, this.progress) * 4);
    if (this.progress >= 1) {
      this.reset();
      this.swings++;
      return { progress: 1, digging: true, broken: true, tick: false, blockId };
    }
    return { progress: this.progress, digging: true, broken: false, tick, blockId };
  }

  /** The swing speed for the held block, in radians per second. */
  get swingRate() {
    return this.total > 0 && Number.isFinite(this.total) ? 3.2 + 4 / Math.max(0.2, this.total) : 0;
  }
}

/** Sunrise, noon, sunset, midnight. */
export function dayPhase(clock) {
  const c = ((clock % 1) + 1) % 1;
  if (c < 0.22) return 'night';
  if (c < 0.3) return 'dawn';
  if (c < 0.7) return 'day';
  if (c < 0.8) return 'dusk';
  return 'night';
}

export function isNight(clock) { return dayPhase(clock) === 'night'; }

/** A rolling day/night clock, so the day length can be changed while playing. */
export class DayCycle {
  constructor(seconds = 600, clock = 0.36) {
    this.seconds = seconds;
    this.clock = clock;
    this.elapsed = 0;
    this.days = 0;
  }

  update(dt) {
    this.elapsed += dt;
    const previous = this.clock;
    this.clock = (this.clock + dt / Math.max(1, this.seconds)) % 1;
    if (this.clock < previous) this.days++;
    this.phase = dayPhase(this.clock);
    return this.clock;
  }

  /** A readable clock: 12:00 at midday, 00:00 at midnight. */
  get timeLabel() {
    const totalMinutes = Math.floor(this.clock * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  get night() { return isNight(this.clock); }
}

/** Emits a footstep sound every so many blocks, faster when sprinting. */
export class Footsteps {
  constructor(stride = 1.9) {
    this.stride = stride;
    this.distance = 0;
    this.steps = 0;
  }

  /** @returns {boolean} true when a step should play this frame */
  update(moved, { sprinting = false, crouching = false, inWater = false, onGround = true } = {}) {
    if (!onGround || moved <= 0) return false;
    const stride = this.stride * (sprinting ? 0.78 : crouching ? 1.6 : 1);
    if (inWater) return false;                     // swimming makes no footstep
    this.distance += moved;
    if (this.distance < stride) return false;
    this.distance = 0;
    this.steps++;
    return true;
  }

  reset() { this.distance = 0; }
}

/** Small helper for HUD text: the block under the crosshair. */
export function describeTarget(world, hit) {
  if (!hit) return '';
  const block = blockById(world.get(hit.x, hit.y, hit.z));
  if (!block || block.id === AIR) return '';
  return block.name;
}
