/**
 * The daily challenge: one date-seeded world and three goals, the same for everyone playing today.
 *
 * Goals are pure data plus a progress function over the game's own tally, so the panel can draw a
 * progress bar, the game can fire a toast the moment one completes, and the tests can check the
 * arithmetic without a world.
 */

/** YYYY-MM-DD in local time — the key a day's challenge is filed under. */
export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A stable 32-bit hash of a string, so the same day always gives the same seed. */
export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The seed of the day: a real world seed, shared by everyone playing on that date. */
export function dailySeed(key = todayKey()) {
  return (hashString(`pixeled:${key}`) % 900000) + 1000;
}

/** Every goal the generator can hand out. */
export const GOALS = [
  { id: 'mine-30', label: 'Mine 30 blocks', value: 30, of: stats => stats.broken, icon: '⛏' },
  { id: 'place-20', label: 'Place 20 blocks', value: 20, of: stats => stats.placed, icon: '▣' },
  { id: 'walk-150', label: 'Walk 150 blocks', value: 150, of: stats => Math.round(stats.distance), icon: '➤' },
  { id: 'torch-2', label: 'Light the dark: place 2 torches', value: 2, of: stats => stats.torches, icon: '☀' },
  { id: 'tree-1', label: 'Chop down a tree', value: 1, of: stats => stats.logs, icon: '🌳' },
  { id: 'craft-2', label: 'Craft anything twice', value: 2, of: stats => stats.crafted, icon: '⚒' },
  { id: 'diamond-1', label: 'Find a diamond', value: 1, of: stats => stats.diamonds, icon: '◆' },
  { id: 'depth-14', label: 'Dig down to y=14', value: 1, of: stats => (stats.lowestY !== null && stats.lowestY <= 14 ? 1 : 0), icon: '↓' },
  { id: 'night-1', label: 'Survive until morning', value: 1, of: stats => stats.dawns, icon: '☾' },
  { id: 'fish-or-swim', label: 'Swim 40 blocks underwater', value: 40, of: stats => Math.round(stats.swum), icon: '≈' },
];

export const GOALS_PER_DAY = 3;

/** Today's three goals: chosen by the date, so everyone gets the same set. */
export function dailyGoals(key = todayKey()) {
  const seed = hashString(`goals:${key}`);
  const picked = [];
  for (let offset = 0; picked.length < GOALS_PER_DAY && offset < GOALS.length * 3; offset++) {
    const goal = GOALS[(seed + offset * 7) % GOALS.length];
    if (!picked.some(entry => entry.id === goal.id)) picked.push(goal);
  }
  return picked;
}

/** How far along a goal is, 0..1. */
export function goalProgress(goal, stats) {
  const done = goal.of(stats) ?? 0;
  return Math.max(0, Math.min(1, done / goal.value));
}

export function goalComplete(goal, stats) {
  return goal.of(stats) >= goal.value;
}

/** The state of a day's challenge: which goals are ticked, and the best streak so far. */
export function loadDaily(storage, key = todayKey()) {
  const raw = storage?.get?.('pixeled-daily-v1');
  let state = { day: key, done: [], streak: 0, best: 0, lastDay: null, total: 0 };
  try {
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch (_) { /* a corrupt entry just resets the day */ }
  if (state.day !== key) {
    // A new day: keep the streak counter, start the goals fresh.
    const yesterday = previousKey(key);
    state = {
      ...state,
      day: key,
      done: [],
      streak: state.lastDay === yesterday && state.done?.length >= GOALS_PER_DAY ? state.streak : state.streak,
      lastDay: state.lastDay,
    };
  }
  return state;
}

export function saveDaily(storage, state) {
  try { storage?.set?.('pixeled-daily-v1', JSON.stringify(state)); } catch (_) { /* private mode */ }
  return state;
}

/** The day before a YYYY-MM-DD key. */
export function previousKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

/**
 * Tick a goal off for the day. Returns `{ state, justFinished, streak }` so the caller can celebrate.
 */
export function completeGoal(storage, goalId, key = todayKey()) {
  const state = loadDaily(storage, key);
  if (state.done.includes(goalId)) return { state, justFinished: false, streak: state.streak };
  state.done = [...state.done, goalId];
  state.total = (state.total ?? 0) + 1;
  const finishedToday = state.done.length >= GOALS_PER_DAY;
  let streak = state.streak;
  if (finishedToday && state.lastDay !== key) {
    streak = state.lastDay === previousKey(key) ? state.streak + 1 : 1;
    state.streak = streak;
    state.lastDay = key;
  }
  state.best = Math.max(state.best ?? 0, streak);
  saveDaily(storage, state);
  return { state, justFinished: true, streak };
}

/** Everything the panel needs: each goal with its progress and whether it is ticked. */
export function challengeSummary(goals, stats, state) {
  return goals.map(goal => ({
    ...goal,
    progress: goalProgress(goal, stats),
    complete: state.done.includes(goal.id) || goalComplete(goal, stats),
    done: state.done.includes(goal.id),
    have: goal.of(stats) ?? 0,
  }));
}
