/**
 * Particles: block break bursts, place puffs, water splashes, footstep dust and falling leaves.
 *
 * A fixed-size pool keeps this allocation-free, and every particle is a camera-facing quad by the
 * time it reaches the renderer. Nothing here touches WebGL, so it is easy to test.
 */

const GRAVITY = 18;

export class Particles {
  constructor(limit = 320) {
    this.limit = limit;
    this.items = new Array(limit);
    for (let i = 0; i < limit; i++) {
      this.items[i] = { life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.07, r: 0, g: 0, b: 0, a: 1, drag: 0.86, gravity: 1 };
    }
    this.next = 0;
    this.spawned = 0;
  }

  get active() {
    let count = 0;
    for (const item of this.items) if (item.life > 0) count++;
    return count;
  }

  /** Take a particle from the pool, recycling the oldest when the pool is full. */
  take() {
    for (let i = 0; i < this.limit; i++) {
      const index = (this.next + i) % this.limit;
      if (this.items[index].life <= 0) {
        this.next = (index + 1) % this.limit;
        this.spawned++;
        return this.items[index];
      }
    }
    const recycled = this.items[this.next];
    this.next = (this.next + 1) % this.limit;
    this.spawned++;
    return recycled;
  }

  /** A burst of coloured specks, used when a block is broken or placed. */
  burst(x, y, z, [r, g, b], count = 12, spread = 0.22, power = 3.4) {
    for (let i = 0; i < count; i++) {
      const particle = this.take();
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spread;
      particle.x = x + 0.5 + Math.cos(angle) * radius;
      particle.y = y + 0.2 + Math.random() * 0.6;
      particle.z = z + 0.5 + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle) * power * (0.4 + Math.random() * 0.7);
      particle.vy = 1.2 + Math.random() * power * 0.8;
      particle.vz = Math.sin(angle) * power * (0.4 + Math.random() * 0.7);
      particle.size = 0.045 + Math.random() * 0.05;
      particle.life = 0.5 + Math.random() * 0.6;
      particle.r = r; particle.g = g; particle.b = b; particle.a = 1;
      particle.gravity = 1;
      particle.drag = 0.9;
    }
  }

  /** Water: a ring of droplets that fall back down. */
  /**
   * A raindrop hitting the ground: a few droplets kicked up plus a flat ring, greedy on purpose so
   * heavy rain reads as rain and not as a haze.
   */
  rainSplash(x, y, z, wet = 1) {
    const drops = 2 + Math.round(3 * wet);
    for (let i = 0; i < drops; i++) {
      const angle = (i / drops) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 0.5 + Math.random() * 0.7 * wet;
      const particle = this.take();
      particle.x = x; particle.y = y + 0.06; particle.z = z;
      particle.vx = Math.cos(angle) * speed;
      particle.vz = Math.sin(angle) * speed;
      particle.vy = 1.1 + Math.random() * 0.8 * wet;
      particle.life = 0.28 + Math.random() * 0.18;
      particle.maxLife = particle.life;
      particle.size = 0.05 + Math.random() * 0.03;
      particle.r = 0.72; particle.g = 0.85; particle.b = 0.98; particle.a = 0.8;
      particle.drag = 0.82; particle.gravity = 3.4;
    }
    return drops;
  }

  splash(x, y, z, count = 16) {
    for (let i = 0; i < count; i++) {
      const particle = this.take();
      const angle = Math.random() * Math.PI * 2;
      particle.x = x + Math.cos(angle) * 0.3;
      particle.y = y + 0.1;
      particle.z = z + Math.sin(angle) * 0.3;
      particle.vx = Math.cos(angle) * 1.6;
      particle.vy = 2.6 + Math.random() * 2.4;
      particle.vz = Math.sin(angle) * 1.6;
      particle.size = 0.05 + Math.random() * 0.04;
      particle.life = 0.55 + Math.random() * 0.4;
      particle.r = 0.62; particle.g = 0.78; particle.b = 0.95; particle.a = 0.9;
      particle.gravity = 1;
      particle.drag = 0.94;
    }
  }

  /** A small scuff of dust under the feet. */
  dust(x, y, z, [r, g, b]) {
    for (let i = 0; i < 4; i++) {
      const particle = this.take();
      particle.x = x + (Math.random() - 0.5) * 0.4;
      particle.y = y + 0.05;
      particle.z = z + (Math.random() - 0.5) * 0.4;
      particle.vx = (Math.random() - 0.5) * 0.8;
      particle.vy = 0.4 + Math.random() * 0.5;
      particle.vz = (Math.random() - 0.5) * 0.8;
      particle.size = 0.03 + Math.random() * 0.03;
      particle.life = 0.35 + Math.random() * 0.25;
      particle.r = r * 0.9; particle.g = g * 0.9; particle.b = b * 0.9; particle.a = 0.8;
      particle.gravity = 0.5;
      particle.drag = 0.9;
    }
  }

  /** Petals drifting down when leaves or plants are destroyed. */
  leaves(x, y, z, [r, g, b], count = 6) {
    for (let i = 0; i < count; i++) {
      const particle = this.take();
      particle.x = x + 0.5 + (Math.random() - 0.5) * 0.7;
      particle.y = y + Math.random() * 0.9;
      particle.z = z + 0.5 + (Math.random() - 0.5) * 0.7;
      particle.vx = (Math.random() - 0.5) * 0.7;
      particle.vy = 0.2 + Math.random() * 0.3;
      particle.vz = (Math.random() - 0.5) * 0.7;
      particle.size = 0.05;
      particle.life = 1.1 + Math.random() * 0.8;
      particle.r = r; particle.g = g; particle.b = b; particle.a = 1;
      particle.gravity = 0.18;
      particle.drag = 0.92;
    }
  }

  /**
   * Advance every live particle and expire the old ones.
   *
   * One long frame is split into short sub-steps so a stalled tab cannot teleport particles through
   * the ground; the whole call is capped so a five-second freeze cannot spin the loop forever.
   */
  update(dt, world = null) {
    let remaining = Math.min(0.5, Math.max(0, dt));
    while (remaining > 0) {
      const step = Math.min(0.05, remaining);
      this.advance(step, world);
      remaining -= step;
    }
  }

  advance(step, world) {
    for (const particle of this.items) {
      if (particle.life <= 0) continue;
      particle.life -= step;
      if (particle.life <= 0) continue;
      particle.vy -= GRAVITY * particle.gravity * step;
      const drag = Math.pow(particle.drag, step * 60);
      particle.vx *= drag; particle.vz *= drag;
      const nx = particle.x + particle.vx * step;
      const ny = particle.y + particle.vy * step;
      const nz = particle.z + particle.vz * step;
      // Particles stop at solid ground instead of sinking through it.
      if (world && particle.gravity > 0.5 && world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        if (world.isSolid(Math.floor(nx), Math.floor(particle.y), Math.floor(nz))) {
          particle.vy = 0;
          particle.vx *= 0.4; particle.vz *= 0.4;
        } else {
          particle.y = ny;
          particle.vy = 0;
        }
      } else {
        particle.x = nx; particle.y = ny; particle.z = nz;
      }
    }
  }

  /** Compact list for the renderer, skipping anything dead. */
  visible() {
    const out = [];
    for (const particle of this.items) {
      if (particle.life <= 0) continue;
      out.push(particle);
    }
    return out;
  }

  clear() {
    for (const particle of this.items) particle.life = 0;
  }
}
