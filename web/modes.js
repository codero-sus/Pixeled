/**
 * Game modes: the rules a world is played under.
 *
 * The start screen offers one card per mode, the way a games shelf does, and every rule lives here
 * as data so the game code only has to ask "am I creative?" rather than re-implementing variants.
 */

export const MODES = [
  {
    id: 'survival',
    name: 'Survival',
    badge: 'FIRST-PERSON · SURVIVAL',
    hook: 'Gather. Build. Keep your hearts.',
    blurb: 'The full game: health, hunger for progress, night, lava and everything out to get you.',
    colour: '#4f9d5b',
    icon: '⛏',
    rules: { health: true, infiniteBlocks: false, fly: false, instantMine: false, flat: false, timer: false },
  },
  {
    id: 'creative',
    name: 'Creative',
    badge: 'ZERO LIMITS · SANDBOX',
    hook: 'Every block. Fly anywhere.',
    blurb: 'All 46 placeable blocks unlocked, nothing costs anything, mining is instant and you cannot be hurt.',
    colour: '#4f7fd0',
    icon: '✦',
    rules: { health: false, infiniteBlocks: true, fly: true, instantMine: true, flat: false, timer: false },
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    badge: 'FLAT WORLD · BUILD',
    hook: 'A flat green world, all yours.',
    blurb: 'A quiet plateau with clear air, infinite blocks and no damage. Start building straight away.',
    colour: '#c9a54f',
    icon: '▤',
    rules: { health: false, infiniteBlocks: true, fly: true, instantMine: false, flat: true, timer: false },
  },
  {
    id: 'speedrun',
    name: 'Speedrun',
    badge: 'TIMED · GOAL',
    hook: 'Diamond, as fast as you can.',
    blurb: 'The clock runs from the first step. Dig to y=14, find a diamond and the run is over.',
    colour: '#d0684f',
    icon: '⏱',
    rules: { health: true, infiniteBlocks: false, fly: false, instantMine: false, flat: false, timer: true },
  },
];

export const DEFAULT_MODE = 'survival';

export function modeById(id) {
  return MODES.find(entry => entry.id === id) ?? MODES[0];
}

/** A random mode, for the "surprise me" button. Survival is weighted heavily so it stays playable. */
export function randomModeId(random = Math.random) {
  const roll = random();
  if (roll < 0.5) return 'survival';
  if (roll < 0.72) return 'creative';
  if (roll < 0.88) return 'sandbox';
  return 'speedrun';
}

/** A readable line for the HUD chip. */
export function modeChip(mode) {
  return { name: mode.name, badge: mode.badge, colour: mode.colour, icon: mode.icon };
}

/** Format a run timer as m:ss.t, for the speedrun HUD. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
