/**
 * Items: the handful of things in Pixeled that are carried but never placed.
 *
 * Blocks live in `constants.js` and are keyed by number, because a block id is also what the world
 * grid stores. Items are keyed by name instead and keep their own little bag, so an apple can never
 * be confused with block 12. The rules are pure functions over a Map, like `crafting.js`, which is
 * what makes them cheap to test and easy to save.
 */

export const ITEMS = [
  {
    id: 'apple', name: 'Apple', hex: '#c8402f', icon: '🍎',
    heal: 4,                     // two hearts
    source: 'Leaves drop one now and then.',
  },
  {
    id: 'berry', name: 'Berry', hex: '#8e3fb0', icon: '🫐',
    heal: 2,                     // one heart
    source: 'Tall grass hides them.',
  },
];

const BY_ID = new Map(ITEMS.map(item => [item.id, item]));

export function itemById(id) {
  return BY_ID.get(id) ?? null;
}

/** How many of an item a bag holds. */
export function itemCount(bag, id) {
  return Math.max(0, Math.floor(Number(bag?.get?.(id)) || 0));
}

export function addItem(bag, id, count = 1) {
  if (!BY_ID.has(id) || !(count > 0)) return 0;
  const next = itemCount(bag, id) + Math.floor(count);
  bag.set(id, next);
  return next;
}

/** Take up to `count` of an item out of the bag; answer with how many actually left it. */
export function takeItem(bag, id, count = 1) {
  const have = itemCount(bag, id);
  const taken = Math.min(have, Math.max(0, Math.floor(count)));
  if (taken <= 0) return 0;
  if (have - taken > 0) bag.set(id, have - taken);
  else bag.delete(id);
  return taken;
}

/**
 * Eat one of `id`: takes the bite out of the bag and answers with how much health it is worth.
 * Refuses when the bag is empty, so the caller can say which item it is missing.
 */
export function eat(bag, id) {
  const item = itemById(id);
  if (!item) return { ok: false, reason: 'unknown', heal: 0 };
  if (itemCount(bag, id) <= 0) return { ok: false, reason: 'none', heal: 0, name: item.name };
  takeItem(bag, id, 1);
  return { ok: true, heal: item.heal ?? 0, name: item.name, item };
}

/** The bag as a tidy list for the HUD and the palette header, biggest stacks first. */
export function itemList(bag, limit = 6) {
  return [...(bag ?? new Map())]
    .map(([id, count]) => ({ id, count, item: itemById(id) }))
    .filter(entry => entry.item && entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** The first thing in the bag worth eating, or null — what `Q` reaches for. */
export function firstFood(bag) {
  const order = itemList(bag);
  return order.length ? order[0].id : null;
}
