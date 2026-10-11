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
        player: save.player ?? null,
        selected: save.selected ?? 0,
        clock: typeof save.clock === 'number' ? save.clock : 0.42,
      };
    } catch (_) {
      return null;
    }
  }

  write({ seed, edits, player, selected, clock }) {
    try {
      const payload = {
        seed,
        edits: Object.fromEntries(edits),
        player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
        selected,
        clock,
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
