/**
 * Health: hearts, damage, regeneration and death.
 *
 * Pure logic so the HUD, the tests and any other edition share exactly the same rules. Ten hearts,
 * each one two points; a hit grants a moment of invulnerability so a single fall cannot kill you
 * twice, and breathing again after a beating slowly heals you.
 */

export const MAX_HEALTH = 20;            // ten hearts, two points each
export const HEARTS = MAX_HEALTH / 2;
export const INVULNERABLE = 0.6;         // seconds of mercy after a hit
export const REGEN_DELAY = 7;            // seconds without damage before healing starts
export const REGEN_INTERVAL = 2.4;       // seconds per heart once healing has started

export class Health {
  constructor(max = MAX_HEALTH) {
    this.max = max;
    this.points = max;
    this.invulnerable = 0;
    this.sinceDamage = 0;
    this.regenTimer = 0;
    this.deaths = 0;
    this.lastCause = '';
    this.healed = 0;
    this.taken = 0;
  }

  get hearts() { return this.points / 2; }
  get isDead() { return this.points <= 0; }
  get ratio() { return Math.max(0, Math.min(1, this.points / this.max)); }
  get shielded() { return this.invulnerable > 0; }

  /**
   * Take damage from something. Returns the points actually lost, which is 0 while the mercy timer
   * is still running or when there is nothing left to lose.
   */
  hurt(amount, cause = 'hurt', { ignoreInvulnerable = false } = {}) {
    if (amount <= 0 || this.isDead) return 0;
    if (this.invulnerable > 0 && !ignoreInvulnerable) return 0;
    const before = this.points;
    this.points = Math.max(0, this.points - amount);
    const lost = before - this.points;
    this.invulnerable = INVULNERABLE;
    this.sinceDamage = 0;
    this.regenTimer = 0;
    this.taken += lost;
    this.lastCause = cause;
    if (this.isDead) this.deaths++;
    return lost;
  }

  heal(amount = 1) {
    if (this.isDead || amount <= 0) return 0;
    const before = this.points;
    this.points = Math.min(this.max, this.points + amount);
    this.healed += this.points - before;
    return this.points - before;
  }

  /**
   * Tick the timers: the mercy window runs down, and after REGEN_DELAY seconds without a scratch the
   * player heals a heart every REGEN_INTERVAL. Returns how much was healed this frame.
   */
  update(dt) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.isDead) return 0;
    this.sinceDamage += dt;
    if (this.sinceDamage < REGEN_DELAY) return 0;
    this.regenTimer += dt;
    let healed = 0;
    while (this.regenTimer >= REGEN_INTERVAL) {
      this.regenTimer -= REGEN_INTERVAL;
      if (this.points >= this.max) break;
      healed += this.heal(2);
    }
    return healed;
  }

  /** Back on your feet at full health, keeping the world and everything you were carrying. */
  respawn() {
    const wasDead = this.isDead;
    this.points = this.max;
    this.invulnerable = INVULNERABLE * 2;
    this.sinceDamage = 0;
    this.regenTimer = 0;
    this.lastCause = '';
    return wasDead;
  }
}

/** Points of fall damage for a drop of this many blocks, with the first three blocks forgiven. */
export function fallDamage(blocks, safe = 3) {
  if (!Number.isFinite(blocks) || blocks <= safe) return 0;
  return Math.round((blocks - safe) * 1);
}

/** A readable name for whatever just hit you, for the death screen. */
export const DEATH_MESSAGES = {
  fall: 'You fell from a great height',
  lava: 'You swam in lava',
  drown: 'You ran out of air',
  void: 'You fell out of the world',
  hurt: 'You took a beating',
};
