/**
 * Saves are tiny: a seed plus the blocks the player changed. Everything else is regenerated from
 * the seed, so a world with a thousand edits still fits comfortably in local storage.
 */

const KEY = 'pixeled-voxel-v2';

export class BrowserSave {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const save = JSON.parse(raw);
      if (typeof save?.seed !== 'number') return null;
      return {
        seed: save.seed,
        edits: new Map(Object.entries(save.edits ?? {})),
        // Doors, stair facings, ladder sides and the contents of every chest you filled.
        metaEdits: new Map(Object.entries(save.metaEdits ?? {})),
        chests: save.chests ?? {},
        inventory: save.inventory ?? null,
        player: save.player ?? null,
        selected: save.selected ?? 0,
        clock: typeof save.clock === 'number' ? save.clock : 0.42,
        // Added later, and optional: an old save simply has no weather or tally in it.
        weather: save.weather ?? null,
        distance: Number.isFinite(save.distance) ? save.distance : null,
        broken: Number.isFinite(save.broken) ? save.broken : 0,
        placed: Number.isFinite(save.placed) ? save.placed : 0,
        steps: Number.isFinite(save.steps) ? save.steps : 0,
        mode: typeof save.mode === 'string' ? save.mode : null,
        daily: save.daily ?? null,
      };
    } catch (_) {
      return null;
    }
  }

  write({ seed, edits, player, selected, clock, weather = null, distance = null, broken = 0, placed = 0, steps = 0, mode = null, daily = null, metaEdits = null, chests = null, inventory = null }) {
    try {
      const payload = {
        seed,
        edits: Object.fromEntries(edits),
        metaEdits: metaEdits ? Object.fromEntries(metaEdits) : {},
        chests: chests ?? {},
        inventory: inventory ? Object.fromEntries([...inventory].map(([id, count]) => [id, count])) : null,
        player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
        selected,
        clock,
        weather,
        distance,
        broken,
        placed,
        steps,
        mode,
        daily,
        savedAt: Date.now(),
      };
      localStorage.setItem(KEY, JSON.stringify(payload));
      return true;
    } catch (_) {
      return false;
    }
  }

  clear() {
    try { localStorage.removeItem(KEY); } catch (_) { /* storage can be disabled */ }
  }

  /**
   * Small side-keys stored beside the save: the daily challenge's progress and the recent-worlds
   * shelf. Strings in, strings out, so the callers own their own shape.
   */
  get(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (_) {
      return false;      // private mode, or the quota is full
    }
  }

  remove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* storage can be disabled */ }
  }
}

/** A fresh random seed every time a world is created — that is the point of the button. */
export function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff) || 1;
}

/** Optional ?seed=1234 in the URL, so a world can be shared as a link. */
export function seedFromLocation() {
  const value = new URLSearchParams(location.search).get('seed');
  const seed = Number(value);
  return Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : null;
}
