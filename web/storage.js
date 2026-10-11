/**
 * Browser storage: the settings the player chooses and the world they built.
 *
 * Saves stay small by storing only the seed, the player's position and the blocks they changed —
 * the rest of the world is regenerated from the seed on load, exactly as it was.
 */

import { SAVE_KEY, SETTINGS_KEY, DEFAULT_SETTINGS } from './constants.js';

export class GameStorage {
  constructor(store = globalThis.localStorage) {
    this.store = store;
    this.available = true;
    try {
      const probe = '__pixeled_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
    } catch (_) {
      this.available = false;
    }
  }

  // ------------------------------------------------------------------ settings

  loadSettings() {
    if (!this.available) return { ...DEFAULT_SETTINGS };
    try {
      const raw = this.store.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings) {
    if (!this.available) return false;
    try {
      this.store.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------ world

  /**
   * Save the world.
   * `edits` is a Map of `"x,y,z"` to block id; only non-air differences are kept by the world.
   */
  saveWorld({ seed, time, player, edits, blocksPlaced, minutesPlayed }) {
    if (!this.available) return false;
    try {
      const packed = [];
      let count = 0;
      for (const [key, id] of edits) {
        const comma = key.indexOf(',');
        const second = key.indexOf(',', comma + 1);
        packed.push([
          Number(key.slice(0, comma)),
          Number(key.slice(comma + 1, second)),
          Number(key.slice(second + 1)),
          id,
        ]);
        if (++count >= 60000) break;
      }
      this.store.setItem(SAVE_KEY, JSON.stringify({
        version: 3,
        seed,
        time: Math.round(time * 10000) / 10000,
        player,
        placed: blocksPlaced,
        minutes: Math.round(minutesPlayed),
        edits: packed,
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  loadWorld() {
    if (!this.available) return null;
    try {
      const raw = this.store.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Number.isFinite(data.seed)) return null;
      const edits = new Map();
      for (const entry of data.edits ?? []) {
        if (!Array.isArray(entry) || entry.length !== 4) continue;
        edits.set(`${entry[0]},${entry[1]},${entry[2]}`, entry[3]);
      }
      return {
        seed: data.seed >>> 0,
        time: Number.isFinite(data.time) ? data.time : 0.3,
        player: data.player ?? null,
        blocksPlaced: data.placed ?? 0,
        minutesPlayed: data.minutes ?? 0,
        edits,
        version: data.version ?? 1,
      };
    } catch (_) {
      return null;
    }
  }

  clearWorld() {
    if (!this.available) return;
    try { this.store.removeItem(SAVE_KEY); } catch (_) { /* nothing to do */ }
  }

  hasWorld() {
    if (!this.available) return false;
    try { return this.store.getItem(SAVE_KEY) !== null; } catch (_) { return false; }
  }
}
