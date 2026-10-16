/**
 * Crafting: recipes, what you can afford, and spending the ingredients.
 *
 * Kept as pure functions over an inventory map (block id -> count) so the panel, the tests and any
 * other edition can all use the same rules without duplicating them.
 */

import { RECIPES } from './constants.js';

/** How many of a block the inventory holds. */
export function countOf(inventory, id) {
  return inventory instanceof Map ? (inventory.get(id) ?? 0) : 0;
}

export function addTo(inventory, id, count = 1) {
  if (!(inventory instanceof Map) || count <= 0) return 0;
  inventory.set(id, countOf(inventory, id) + count);
  return countOf(inventory, id);
}

/** Take blocks out of the inventory. Returns false and changes nothing if there are not enough. */
export function spend(inventory, id, count = 1) {
  if (countOf(inventory, id) < count) return false;
  const left = countOf(inventory, id) - count;
  if (left > 0) inventory.set(id, left);
  else inventory.delete(id);
  return true;
}

/** Can this recipe be made from what is in the inventory? */
export function canCraft(inventory, recipe, times = 1) {
  return recipe.needs.every(([id, need]) => countOf(inventory, id) >= need * times);
}

/** Everything the inventory has a recipe for right now. */
export function craftable(inventory, recipes = RECIPES) {
  return recipes.filter(recipe => canCraft(inventory, recipe));
}

/** What a recipe is still missing, as a list of {id, need, have}. */
export function missingFor(inventory, recipe) {
  return recipe.needs
    .map(([id, need]) => ({ id, need, have: countOf(inventory, id) }))
    .filter(entry => entry.have < entry.need);
}

/**
 * Craft one of a recipe: spend the ingredients, add the output. Returns the new count of the
 * output, or 0 when the ingredients were not all there.
 */
export function craft(inventory, recipe, times = 1) {
  if (!canCraft(inventory, recipe, times)) return 0;
  for (const [id, need] of recipe.needs) spend(inventory, id, need * times);
  addTo(inventory, recipe.out, recipe.count * times);
  return countOf(inventory, recipe.out);
}

/** Recipes that use this block as an ingredient, for a "what can I make with this" hint. */
export function recipesUsing(id, recipes = RECIPES) {
  return recipes.filter(recipe => recipe.needs.some(([need]) => need === id));
}
