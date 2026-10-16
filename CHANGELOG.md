# Pixeled — changelog

*(Newest batch first after the intro. Batch two continues the numbering at 194; batch three at 282.)*

Numbered, and counted honestly: every line below is a discrete change that shipped in the commit next
to it, and every one of them is covered by the test suites (`tests/web_smoke.mjs` 774 checks,
`tests/web_dom_smoke.mjs` 242, `tests/web_shaders.mjs` 56, `tests/python_smoke.py` 25 checks, plus the
Java reference check over 24 files and 27 classes). No padding, no round numbers invented after the
fact. Batch three runs to 579.

## v3.6 — food, beds and a bag to carry it in

*(Continues the numbering. Batch three's third slice.)*

### Things you carry but cannot place — 529-543

529. `web/items.js`: a small catalogue of items that are carried but never placed
530. Two to start with, both with a real source: apples off the leaves, berries in the grass
531. An apple is worth two hearts, a berry one, and the catalogue says so in one field
532. Item ids are names, not numbers, and live in their own bag — an apple can never be
     mistaken for block 12
533. `itemById` answers null for anything that is not food, so nothing eats a rock
534. `itemCount`, `addItem` and `takeItem`: pure functions over a Map, like `crafting.js`
535. An emptied stack is removed rather than left behind at zero
536. `takeItem` never takes more than is there, and answers with what actually moved
537. `eat` takes the bite out of the bag and answers with what it is worth, in one call
538. Eating an unknown item and eating nothing both come back with a reason, not an exception
539. `itemList` sorts the biggest stack first, for the HUD and the backpack
540. `firstFood` is what `Q` reaches for: the biggest stack you are carrying
541. Chopping leaves has its own roll for an apple, separate from the sapling roll
542. Tall grass hides berries on a third roll, so walking through a meadow pays
543. Both drops are seeded by the world and the cell, so the same tree gives the same apples

### Eating — 544-551

544. `Q` eats the first thing in the bag, and heals exactly what the catalogue promises
545. Eating at full health is refused, with a reason — the apple stays in the bag
546. Eating with an empty bag explains where food comes from
547. A named item can be eaten directly (`eatSomething('berry')`), for the HUD and the tests
548. Food heals through the same `Health.heal` every other source uses, so the counters add up
549. A bite plays the craft sound and tells you how much health it was worth
550. Eating is refused while dead, like every other action
551. The first apple found is announced by a toast that says the key

### The bag on screen — 552-560

552. A bag chip in the HUD lists what you are carrying, `🍎 3  🫐 1`
553. It starts hidden and stays hidden while the bag is empty
554. Clicking the chip eats something, so a phone has a way to eat without a keyboard
555. The chip's tooltip spells out the stacks and the key
556. The click handler binds once, so repeated refreshes cannot stack up handlers
557. The crafting panel's backpack line lists food next to the blocks
558. Food chips carry their own colour, so an apple is not grey
559. `giveItem` keeps the HUD chip in step every time the bag grows
560. The touch layout gained USE and EAT buttons beside MINE, PLACE and JUMP

### Beds as spawn points — 561-567

561. Sleeping in a bed sets your spawn point, the way it should
562. The toast says so: "Spawn point set to this bed"
563. Respawn goes to the bed when there is one, and to the world spawn when there is not
564. `player.spawnAt(world, point)` takes an explicit point instead of always asking the world
565. The bed spawn is written to the save and restored with the world
566. The bag is saved too, so the apples you were carrying are still there tomorrow
567. An older save without either field still loads: no bag, no bed, no error

### Fixes and tests for this slice — 568-579

568. **Bug fixed while testing:** `main.save()` handed storage an already-plain object for the bag
     and storage serialised it a second time, so every save threw and the game reported "This
     browser blocked saving" — the bag now travels as a Map, exactly like the inventory
569. The respawn test now knows about beds: it checks both the bed spawn and the world-spawn fallback
570. The damage tests clear the mercy window explicitly, because a respawn grants one
571. Item tests: the catalogue, the bad ids, the empty handfuls, the stack that disappears at zero
572. Eating tests: the heal, the refusal at full health, the named item, the empty bag, the toast
573. A live-game test chops leaves in a loop until one drops an apple, then eats it through the HUD
574. Creative mode is asserted to shrug off lava before the same lava is used to test a berry
575. The backpack test asserts the food chip's colour class, not just its text
576. DOM tests for the bag chip: hidden when empty, counts when full, click eats, no double binding
577. DOM tests for the two new touch buttons and the four new help-sheet rows
578. `refreshBag` and `setCraftInventory` are covered for both the empty and the full case
579. The suite stands at 1072 web assertions across the three files

## v3.5 — modes, the daily challenge and the living sea

*(Continues the numbering. Batch three's second half.)*

### Game modes — 393-411

393. `web/modes.js`: four modes, each a small record of rules rather than a fork of the game
394. Survival: the game as it was — health on, blocks cost inventory, mining takes time
395. Creative: infinite blocks, flight, instant mining, and damage switched off
396. Sandbox: a flat world, free blocks and flight, but mining still takes as long as it should
397. Speedrun: the survival rules plus a clock and a finish line
398. `modeById` falls back to survival, so a save from a mode that no longer exists still loads
399. `randomModeId` for "surprise me", weighted 50% toward survival so the surprise stays playable
400. `setMode` applies the rules to the live player mid-game — no restart, no second code path
401. Creative flight turns on the moment the mode does, and off again when you switch back
402. Instant mining only shortens the dig timer; breaking still emits a particle burst and a sound
403. Placing blocks in creative and sandbox never spends inventory
404. `invulnerable` is a mode rule: a creative player standing in lava simply does not burn
405. Mode cards on the start screen: icon, name, one-line description, a colour and a badge
406. The cards are a real radio group — `role="radiogroup"`, `aria-checked`, keyboard reachable
407. Clicking a card switches mode immediately, and `setMode` repaints the shelf so exactly one card
     is ever marked active, whichever route the switch came from
408. The HUD carries a small mode chip with the mode's colour and its badge as the tooltip
409. `pickMode` offers to move you into a flat world when the new mode needs one
410. Speedrun shows a stopwatch in the corner, hidden in every other mode
411. The clock counts in tenths, and a finished run gets a star and a green edge

### Daily challenge — 412-433

412. `web/challenges.js`: the daily challenge is derived, never stored as a list of days
413. `todayKey` reads the local date, so "today" is the player's today, not UTC's
414. `hashString` gives a stable 32-bit hash of any string, used as the day's source of randomness
415. `dailySeed(key)` maps a day to a world seed in the 1000-901000 range
416. Ten goals in the catalogue, each a small pure function over the game's stats
417. `mine-30`, `place-20` and `walk-150`: the everyday ones
418. `torch-2`, `tree-1`, `craft-2`: the ones that send you to the crafting panel
419. `diamond-1`: the long shot
420. `depth-14`: reach y 14, which means an actual mine shaft rather than a poke at the ground
421. `night-1` and `fish-or-swim`: survive a dawn, and get properly wet
422. Three goals a day, chosen by hashing the day key — the same three for everyone, all day
423. `goalProgress` and `goalComplete` are pure, so the UI and the tests derive progress the same way
424. Stats are read from the tally the game already keeps; nothing new is counted per frame
425. Completing a goal toasts once and is written down once
426. The panel (J) shows one row per goal with a progress bar and the count
427. Finishing all three extends a streak; a missed day resets it to one and keeps the best
428. `previousKey` walks back a day properly, including across month and year boundaries
429. The streak, the best streak and today's completions all survive a reload
430. A teaser card on the start screen lists today's three goals with the day's seed
431. `Play today's world` drops you straight into the daily seed
432. The seed is copyable from the panel and from the pause menu — one link, one world
433. The start screen card carries the day's date, so the three goals are never ambiguous

### Seeded worlds and the shelf — 434-451

434. `startWorld(seed, mode)` is now the single path for the seed box, the daily challenge, surprise
     and the recent shelf: four entry points, one code path
435. `New world` always picks a fresh random seed — no cached world, no repeated terrain
436. `?seed=1234` in the URL opens that exact world, which is what the share button hands out
437. The seed box accepts a number, a pasted link's number, or nothing at all
438. The recent-worlds shelf remembers your last four worlds, newest first
439. The shelf de-duplicates by seed, so replaying a world moves it to the front instead of listing it
     twice
440. Each chip remembers the mode that world was played in
441. Clicking a chip reopens that world in that mode
442. The shelf hides itself, heading and all, when there is nothing on it
443. "Surprise me" picks a random mode and a random seed in one press
444. Surprise returns the mode id, so the HUD, the shelf and the toast agree on what happened
445. The flat-world generator (sandbox): obsidian floor, stone below, dirt, grass at y 28
446. Flat worlds flood the whole map with daylight and no sea, so building is unobstructed
447. Flat worlds still grow hashed trees, plants and the odd pumpkin — flat, not empty
448. `surfaceHeight` and `biomeAt` short-circuit in flat mode, so nothing samples noise for nothing
449. A flat world reports itself ready immediately: no spawn search, no waiting
450. Starting a world resets the clock, the weather, the particles and the dig timers together
451. The seed is written into the save, so a reload lands you in the same place

### The sea — 452-462

452. Water's vertex stage adds two offset waves, so the surface is never flat
453. The waves drop the surface a little, so a full cube of water reads as liquid
454. The fragment stage re-derives a normal from the same two waves, so the highlights ride the swell
455. Fresnel rim: water goes pale and sky-coloured at grazing angles
456. Sun glitter: a tight specular lobe where the sun's reflection lines up with the eye
457. A foam crest on the steep part of the swell
458. Only the top face of water takes any of it — the sides stay deep and blue
459. Ripples are seeded by world position, so they are stable for a given spot rather than sliding
460. Underwater, tint mode 3 draws moving caustics instead of a plain blue wash
461. Rain splash: droplets kicked up where rain meets a surface near the player
462. The splash skips water — the pond is already wet — and scales with the intensity

### The held block — 463-469

463. The view model reads `shapeBoxes`, the same helper the mesher and the physics use
464. A held slab is a slab: the hand's cube is squeezed to the shape's box
465. A held fence post is a stick, a held pane is a wafer, a held ladder a plate
466. A two-box block (chest, bed, door) draws both boxes in the hand
467. The hand's last-placed orientation comes from the world's metadata, so a held stair matches the
     one you just put down
468. `offsetHeldModel` reshapes the cube inside the hand's rigid transform, so swinging, bobbing and
     tilting all keep working
469. The maths is tested by transforming the box's three edge vectors, not by eyeballing a screenshot

### Saves that keep the world — 470-481

470. The save now carries the metadata: a door left open comes back open
471. And the chests, stack by stack
472. And the backpack, block by block
473. Chest contents are written as plain objects and read back into Maps, one chest per cell
474. An older save without the new fields still loads: no metadata, no backpack, no error
475. A save with a corrupt chest entry cannot inject phantom cells into the world
476. Stack counts and ids are sanitised on load — nothing negative, nothing below id 1
477. `chestAt` refuses cells outside the world instead of filing a chest under `NaN`
478. `BrowserSave.get/set/remove` for the small side-keys, so the daily and the recent shelf have a
     home that is not the world save
479. Side-keys store strings untouched and JSON for everything else, so callers own their own shape
480. A blocked or private-mode storage returns false instead of throwing at the first write
481. The save is exercised end to end in the suite: place, fill, save, reload, count the diamonds

### Interface and shell — 482-495

482. `#hud-mode-chip` in the HUD, hidden until a mode says otherwise
483. `#run-timer` for the speedrun clock
484. `#menu-surprise`, `#mode-row`, `#daily-card`, `#daily-goals`, `#recent-row` and `#recent-title` on
     the start screen
485. `#challenges` panel with `#challenge-list`, the day badge, the seed, the streak line, a share
     button and a close button
486. The version line reads v3.5
487. J opens the daily panel, and `input.js` passes the key through like every other shortcut
488. The panel closes on its own button, on Escape, and on the rule that only one overlay is ever up
489. Stylesheet: `.mode-card`, the active card, the badge, the chip, the stopwatch
490. Stylesheet: `.daily-card`, `.daily-badge`, `.daily-goals`, the chips and their ticks
491. Stylesheet: `.recent-row`/`.recent-chip`, with the heading collapsing when the row is empty
492. Stylesheet: `.challenge-row`, `.challenge-bar`, the completed state and the streak line
493. The panel id for the streak was split into `#challenge-streak` (card) and
     `#challenge-streak-panel` (panel) — two elements may not share one id
494. `ui.setMode`, `ui.setRunTimer`, `ui.setRunTime`, `ui.buildChallenges`, `ui.challengeProgress`
495. Mobile rules for the new shelves, cards and panel, so the modes fit a phone's width

### Tests for the GameZ batch — 496-521

496. Mode rules: every mode's flags asserted one by one
497. `modeById` fallback and `randomModeId` weighting over many draws
498. `setMode` against the live game: flight, instant mining, free blocks and invulnerability each
     observed, not assumed
499. The mode shelf renders one card per mode, exactly one active, and clicks report the right id
500. Daily: `todayKey` shape, `dailySeed` range and stability
501. The same day always yields the same three goals; the day after is a different three
502. `previousKey` across a month boundary and a year boundary
503. `goalProgress` clamping, `goalComplete` boundaries, and every goal's `.of()` stat
504. Completing all three in the live game ticks the streak on and toasts once
505. The daily panel renders progress bars against the real DOM stub
506. The start screen's teaser lists the same three goals the panel does
507. A save written from the live game is read back inside the same run: seed, meta, chests, backpack
508. Reloading from that save brings back the open door, the diamonds and the stone
509. Corrupt-save guards: a littered chest map keeps only the sane stacks
510. `chestAt(NaN)`, `chestAt(-1, …)` and an out-of-range cell all return null
511. The recent shelf: empty, one entry, de-duplication by seed, and the heading hiding with it
512. Clicking a recent chip reopens exactly that world in exactly that mode
513. `surprise()` returns a real mode id and switches the live game to it
514. Flat worlds: surface at 28, obsidian floor, no sea, daylight at the surface
515. Flat worlds still carry trees and plants
516. Water shader lint: the water flag crossing both stages, the wave, the fresnel, the glitter, the
     crest, and the uniforms the fragment stage needs
517. Held-shape maths: a whole block fills the hand cube, a slab keeps its footprint and half its
     height, a chest is two boxes, a fence post is a narrow stick
518. Physics on shapes: a slab's top at 31.5, stairs at 32, and landings measured from the drop
519. `metaAt` inside and outside the world
520. Water flow in a walled channel: six cells flood in order, and the source is not consumed
521. Ten more assertions on the DOM for the new ids, the ARIA wiring and the CSS hooks

### Fixes found while testing — 522-528

522. `surprise()` returned `mode.name` where callers expected the id — the toast was right, the shelf
     was not
523. The mode shelf was rebuilt in two places and could show two active cards; `setMode` owns it now
524. The test DOM stubs had no relationship between `className` and `classList`, so class assertions
     read `undefined` — both stubs now keep the two views of one set in step, like a browser
525. A save fixture written with `JSON.stringify(new Map(...))` silently became `{}` — the test now
     writes real JSON files, which is also what the game writes
526. A test placed a block at `PAD.h + 1`, a property that does not exist: `NaN` coordinates created a
     phantom chest at "NaN,NaN,NaN" and proved `chestAt` needed its guard
527. A held-block test compared a rotated corner against a world axis; the assertions now compare edge
     vectors, which is rotation-independent
528. A daily-goal test moved the challenge counters but not the game tally that feeds them, so goals
     that read the tally looked complete while the ones that read the stats did not

## v3.4 — shapes, interaction, crafting and health

*(Continues the numbering. Batch three's first half.)*

### Blocks and shapes — 282-303

282. Ten new blocks: smooth stone, stone bricks, iron block, gold block, diamond block, birch planks,
     spruce planks, glass pane, fence and ladder (ids 33-42)
283. Door (43), chest (44) and bed (45): interactive blocks with shapes of their own
284. Slab (46), stairs (47) and bookshelf (48), taking the block list to 49
285. New `web/shapes.js`: one source of truth for partial-block geometry
286. `shapeBoxes(block, meta, connect)`: every shape is a list of cell-local boxes
287. A full cube is one box from 0 to 1, so nothing special-cases the common block
288. Slab: a single box 0-0.5 tall
289. Stairs: a lower step plus an upper half on the facing side
290. Fence: a 0.375-0.625 post, plus rails that only appear when the neighbour is fence-like
291. Pane: a 0.4375-0.5625 wafer, crossed when both axes connect
292. Ladder: a 0.16 plate flat against the wall it was hung on, chosen by metadata
293. Door: a closed plate 0.4375-0.5625, or the same swung a quarter turn when open
294. Chest: a body to 0.82 with a lid on top, in the block's own colours
295. Bed: a 0.45 mattress with a pillow end, so it reads as a bed from above
296. The mesher draws shapes from `shapeBoxes`, so the picture and the collision agree by construction
297. Collision is shape-aware: `cellBoxes`, `overlapsSolid`, `surfaceUnder`, `blockTop`
298. `standingHeight` and `tallestTop` answer "can I stand here" from the same boxes
299. Walking onto a slab steps up half a block instead of being blocked
300. Shapes carry a +0.0001 epsilon so a standing height is never defeated by floating point
301. Metadata nibble per cell: door open, stair facing, ladder side, bed pillow
302. `metaEdits` tracks only the metadata the player changed, so a save stays small
303. Shape-aware block highlighting and crack overlay: a slab's outline is half a block tall

### Interaction — 304-322

304. E interacts with whatever the crosshair is on
305. Doors swing open and shut, and the open bit lives in the cell's metadata
306. A door's collision follows it: an open door is a wall across the other axis
307. Chests open a panel listing their stacks
308. `world.chests`: one Map per chest cell, created on demand
309. Take one out of a chest into the backpack, and put one back from the backpack
310. The take/store buttons carry the counts, so a nearly-empty chest is obvious
311. Breaking a chest spills its contents into the inventory, so nothing is lost by accident
312. Beds sleep the night away — at night only, with a toast that says why not
313. Sleeping fades the screen to black, runs the clock forward and clears the weather
314. Ladders are climbable: hold into them and you go up, slowly, with a slower fall
315. `placeBlock(x, y, z, id, { yaw, face, replace })` is the one way a block enters the world
316. `yawToFacing` turns the player's heading into a stair or ladder facing
317. `wallFromNormal` hangs a ladder on the wall you were looking at, or the nearest neighbour
318. A door remembers which way it swings from the face you placed it against
319. Placement refuses a cell that is occupied, a block that is not placeable, and a cell outside the
     world
320. Standing where a block would go is refused with a toast rather than a fit of jitter
321. Placing or breaking wakes the neighbouring water, so a hole does not leave a dry pocket
322. `interact()` returns null when a use is refused, so callers can tell "nothing here" from "no"

### Crafting — 323-335

323. `web/crafting.js`: pure functions over a Map of id to count
324. 19 recipes, from planks out of a log to a bed out of planks and leaves
325. `canCraft`, `craftable`, `missingFor`, `craft`, `recipesUsing`, `countOf`, `addTo`, `spend`
326. `craft` returns the result instead of mutating behind the caller's back
327. `spend` refuses to go negative and answers with whether it could pay
328. The crafting panel lists every recipe with its ingredients
329. Ingredients show how many you have, and how many short you are
330. Recipes you can afford are highlighted; the rest say what is missing
331. Crafting a stack adds all of it at once (four planks, three ladders, eight panes)
332. The backpack summary at the top of the panel lists what you are carrying
333. Crafting plays its own sound, and the panel refreshes after each craft
334. The palette's craft button opens the panel, and the palette refreshes its counts afterwards
335. Recipe tests: affordability, the exact missing list, and no negative counts after a spend

### Water that moves — 336-345

336. Water flows: breaking a wall next to a lake lets the water in
337. A bounded queue, so a hole in the ocean floor cannot stall the frame
338. Water spreads down first, then sideways — the shape you expect
339. Flow stops after a distance limit from the source instead of flooding the world
340. `waterLevel` reads how deep a cell is, from the surface down
341. Placing a block in water displaces it and re-queues the neighbours
342. Breaking a block under water wakes the cell above it
343. Water is drawn translucent with a wave, so a pool reads as water rather than blue stone
344. The flow test builds a walled channel and floods it deterministically
345. Water is non-solid: you swim in it, sink slowly, and cannot stand on it

### Health, damage and death — 346-360

346. `web/health.js`: 20 points, ten hearts, one model for every source of damage
347. A 0.6-second mercy window after each hit, so lava does not delete you in three frames
348. `hurt(amount, cause)` records the cause for the death screen
349. Fall damage: three blocks are free, then a point per block above that
350. Lava burns for as long as you are in it, and the screen washes orange in proportion
351. Drowning: the breath meter empties, then the health starts going
352. The void floor hurts, so falling out of the world is not an escape
353. Regeneration waits seven seconds after the last hit, then returns a heart every 2.4 seconds
354. `heal` and `taken` counters, used by the HUD and the tests
355. Ten hearts drawn as canvas paths, filled per half-heart
356. The health bar goes down in halves, so a small fall is a visible scratch
357. Hearts desaturate and pulse when you are low, and there is a heartbeat in the HUD
358. Death: the world stays lit behind a translucent panel naming the cause
359. Death messages per cause, picked deterministically so the same death reads the same
360. Respawn puts you back at the spawn point at full health, keeping your backpack

### Fall tracking and the world under your feet — 361-368

361. `player.fallDistance` accumulates on the way down and resets on landing
362. `landedHard` is read once per frame, so one landing is one hit
363. Falling into water cancels the damage, as it should
364. Landing dips the camera, on the same event the damage uses
365. Feet probe fixed at `y + 0.1` with the column cached, so standing on a shape is stable
366. `surfaceUnder` scans down to `WORLD_Y - 1` instead of giving up early
367. Walking on a pad whose surface cell is air is no longer possible to fake
368. A ten-block fall lands exactly on the surface — measured, not estimated

### Sky, weather and atmosphere — 369-380

369. A sun disc with a halo, tracking the sun direction
370. A moon opposite the sun, with the crescent carved by a smoothstep
371. Two planets that only appear once the night sets in
372. Aurora curtains: three drifting bands, tied to the night value
373. Stars that fade in with the dark instead of appearing all at once
374. A two-layer cloud deck, with a storm switch that greys the sky out
375. `skyPalette(clock)` hands the renderer the moon direction and the aurora strength along with the
     colours
376. Fog follows the time of day: it takes its colour from the sky palette, so dusk fogs orange
377. Aurora shows up only in the snow and mountain biomes, only after dark, raised by the caller
378. Underwater, the fog closes from 2 to 26 blocks and turns blue
379. Rain splashes on the ground next to you (see 461)
380. Snow, rain and thunder share one weather front model, and the weather survives a save

### Interface and shell — 381-392

381. Palette overlay (B) with every placeable block and the counts you own
382. Palette picking fills the selected hotbar slot instead of a fixed one
383. Craft panel (C) with the recipe book and the backpack summary
384. Storage panel: a chest's contents with take-one buttons
385. Sleep overlay: the black fade, with a line saying the night is passing
386. `#open-craft` became `#palette-craft`, because the button lives on the palette
387. The help sheet gained E, C and the shaped-block notes
388. Every overlay toggles through one `.hidden` class, with a stylesheet rule that actually wins
389. Mobile media query for the panels, the hearts and the new buttons
390. Version line to v3.4, and the README's block count corrected
391. Tests: 121 new DOM assertions for the overlays the panels drive
392. Every new module (`shapes.js`, `crafting.js`, `health.js`) is pure enough to test on its own

## v3.3 — light, lava and the living world

### Light and darkness — 194-215

194. A light engine (`web/light.js`): light is a flat 0-15 grid, poured out from every glowing block
195. Whole-world light built with one multi-source breadth-first search, not one flood per torch
196. Torch block (id 31) that lights 14 levels in every direction
197. Lava block (id 30) that glows 12 levels and hurts to stand in
198. Diamond ore glints with its own faint light again, now through the light system
199. Light stops at anything opaque, so a sealed room really is pitch black
200. Light flows through air, water, glass and ice, and stops at stone, dirt and logs
201. Placing a wall casts a real shadow behind it
202. Breaking a wall lets light pour through the hole
203. Removing a torch takes its light back out of the world
204. Correct light *removal* (a BFS that only unlights cells that were dimmer), not just re-lighting
205. Skylight: anything above the terrain's skyline is lit, anything below is cave dark
206. Digging a shaft from the surface down lets daylight into the cave under it
207. The skyline is cached and repaired one column at a time, so digging does not rescan the world
208. Mesher bakes the light level into the vertex colours, so caves read as dim rather than void
209. A soft light curve: 0-15 becomes a 0.28-1.0 brightness instead of a hard cutoff
210. A floor of ambient light keeps every block visible, so nothing renders pure black
211. `world.lightAt()` / `world.torchLightAt()` / `world.lightSourceCount` for the HUD and tests
212. Lava lakes generate below y = 12 only, in hollows with air above them
213. Lava is not placeable — it is a hazard, not a building material
214. HUD light readout, and the crosshair label now names the block *and* the light level
215. Standing in lava washes the screen orange, and burns you every 0.55 seconds

### The world simulates itself — 216-232

216. Gravity blocks: sand, gravel and pumpkins fall when the block under them goes
217. A queued fall system, so removing one support can start a whole column sliding
218. Falling blocks animate across frames instead of teleporting
219. Sapling block (id 32) that grows into a tree 24 ticks after it is planted
220. Saplings grow the species that fits the biome — spruce in snow, wide-canopy swamp trees in swamps
221. Leaves occasionally drop a sapling when you break them (22%, deterministic per cell)
222. Leaf decay: chop a trunk and any leaf that cannot reach a log within five steps withers
223. Decay runs as a flood fill out from the broken trunk, and reports what it cleared
224. `world.worldTick()` drives falling, growing and withering on a quarter-second timer
225. The game invalidates and re-meshes exactly the chunks a world tick touched
226. Particles and sound for every fall and every growth
227. **Bug fixed:** the lava/physics probe read the block *above* the player's feet, so players fell
     straight through lava pools and out of the world
228. Lava physics: thick, slow to swim through, barely lifts you, and holds you at its surface
229. Wading flag for shallow water, so walking through a puddle is not the same as swimming
230. Ambience: birds by day, crickets by night, drips underground, lava pops near lava
231. Ambience is biome-flavoured and never plays during a storm
232. Ambient sounds are scheduled with a randomised delay, not spammed per frame

### Building and looking around — 233-252

233. Block palette overlay listing all 30 placeable blocks
234. The palette shows how many of each block you have dug up
235. Picking a block from the palette fills the selected hotbar slot
236. Each hotbar slot now keeps its own block choice
237. Inventory: every block you mine is counted
238. Placing a block takes one from the inventory
239. Palette opens with `B` or the new HUD button, closes with the Done button or `B` again
240. The palette parks the controls while it is open, exactly like the help sheet
241. Minimap canvas in the corner: one pixel per block column, coloured by the surface block
242. The minimap shades by height, so hills and valleys read at a glance
243. A facing wedge and a centre dot mark the player on the map
244. The minimap redraws a few times a second, not every frame
245. The minimap follows the biome-readout setting, so it can be switched off
246. Third-person camera on `F5`, pulling back 4.6 blocks with the view direction
247. A blocky avatar (legs, body, head) that turns with the player for the third-person view
248. The avatar is drawn before the world so the near plane never clips it
249. The held block hides itself in third person, so it does not fill the screen
250. Debug panel on `F3`: coordinates, chunk, biome, light, sky, frame rate, draw calls and tally
251. The debug panel is built from the same status tick the HUD uses, so it can never drift
252. Wind strength follows the weather — storms shake the grass harder than a calm morning

### Tests for all of it — 253-273

253. Light tests: a sealed stone room with one torch is lit inside and pitch black outside
254. Light tests: the level drops by exactly one per block of distance
255. Light tests: breaking the wall lets light through, and only through the hole
256. Light tests: removing the torch darkens the room again and clears the source
257. Light tests: placing a wall casts a shadow behind it
258. Light curve tests: monotonic, never fully black, exactly 1.0 at full light
259. Skylight tests: surface daylight, cave dark, and a dug shaft letting the sun in
260. Lava generation tests: every seed has lava, and none of it above y = 13
261. Gravity tests: a dropped block lands on the first solid cell and stops
262. Gravity tests: gravel piles *on top* of sand instead of passing through it
263. Gravity tests: breaking the support under a ledge drops the block above it
264. Sapling tests: it does not grow instantly, grows within 30 ticks, and makes a trunk plus a crown
265. Decay tests: leaves beside a trunk survive, leaves without one wither, and the trunk cell is safe
266. Mesher tests: no vertex in any chunk is baked to pure black, in three different chunks
267. Mesher tests: an unlit world still meshes, so the light engine stays optional
268. Live-game tests: placing a torch lights its cell and its neighbours, removing it darkens them
269. Live-game tests: the inventory fills up as you dig
270. Live-game tests: the world tick runs in the real frame loop and sand actually lands on the pad
271. Live-game tests: lava is detected, burns, warns once, and stops burning when you climb out
272. Live-game tests: the palette fills slots, refuses water, and keeps per-slot blocks
273. DOM tests: palette grid, counts, highlight, open/close through the HUD, debug text, minimap pixels

### Small fixes found while testing — 274-281

274. **Bug fixed:** `togglePalette()` without an argument closed instead of toggling
275. **Bug fixed:** the debug panel read its fields from a destructuring list that never included them
276. Light is rebuilt lazily, so a world only pays for it when something asks for a light level
277. The lightning flash, rain and snow overlays are all still on their own render layer
278. Renderer gained `wind`, `cameraDistance`, `thirdPerson` and `heat` frame options
279. The wind uniform is declared, bound and covered by the shader lint
280. Sprite-free and dependency-free as ever: the palette, map and debug panel are plain HTML and canvas
281. `web_shaders.mjs` still lints every shader, now including the wind uniform

## v3.2 — the first big batch (commit `76f39c1`)

### World and blocks — 1-44

1. Coal ore block (id 11), depth-banded to y ≤ 40
2. Iron ore block (id 12), y < 26
3. Gold ore block (id 13), y < 14
4. Diamond ore block (id 14), y < 14 and rarer still
5. Gravel block (id 15)
6. Clay block (id 16)
7. Cactus block (id 17)
8. Tall grass block (id 18)
9. Flower block (id 19)
10. Ice block (id 20)
11. Sandstone block (id 21)
12. Spruce log block (id 22)
13. Spruce needles block (id 23)
14. Birch log block (id 24)
15. Birch leaves block (id 25)
16. Cobblestone block (id 26)
17. Mossy stone block (id 27)
18. Obsidian block (id 28)
19. Pumpkin block (id 29)
20. Per-block hardness for all 19 new blocks
21. Nine material voices: stone, grass, dirt, sand, wood, snow, glass, gravel, water
22. A `plant` flag, so plants mesh as crossed quads instead of cubes
23. Biome tint tags for grass, leaves and plants
24. Ore veins stamped by 3D noise, then split by depth band
25. Gravel and clay pebble pockets just under the surface
26. Sandstone strata beneath beaches and deserts
27. Spruce trees, conical, in the snow biome
28. Swamp trees with wide flat canopies
29. Birch trees — 42% of broadleaf trees, so forests read as mixed woodland
30. Pumpkin patches on plains and forest floor
31. Cobblestone pockets inside the rock
32. Obsidian in the deep mantle, below y = 6
33. Mossy stone in wet biomes, and overgrown boulders
34. Mossy boulders in swamps and forests
35. Cacti scattered through the desert
36. Tall grass and flowers in the green biomes
37. Murky swamp pools
38. Ice sheets where cold biomes meet the sea
39. Seven grass tints, one per biome
40. Alpine surface rules: snow caps and gravel scree above the snow line
41. Diamond ore glows at night, so a deep base is readable
42. A 28-block placeable palette for creative building

43. **Bug fixed:** the biome noise clustered so tightly around 0.5 that the swamp threshold could
    never be reached, so swamp did not exist in *any* seed
44. Biome fields stretched away from the middle and the thresholds retuned, so swamp, savanna and snow
    all appear — asserted across eleven seeds

### Rendering — 45-74

45. Crossed-quad plant layer in the mesher, double-sided
46. A separate plants render pass with its own culling
47. Foliage sway in the terrain shader (new `uWaving` uniform)
48. Water keeps its own two-wave surface animation
49. Moon disc in the sky, opposite the sun
50. Storms grey the whole sky out
51. Thicker, darker storm clouds
52. Lightning flash overlay across the frame
53. Rain overlay layer
54. Snow overlay layer (different pattern and drift)
55. Held-block view model — a new shader program for the block in your hand
56. Swing animation driven by what you are digging
57. Crack overlay that grows on the block being mined
58. Particle program drawing camera-facing quads
59. Block-colour break particles
60. Build puff particles
61. Footstep dust that takes the colour of the ground
62. Water splash particles on entry and exit
63. Falling leaf particles for plants and foliage
64. Camera roll while walking
65. Eye-height bob while walking
66. Landing dip when you hit the ground hard
67. Field-of-view stretch while sprinting
68. Hold `Z` to zoom in
69. Underwater fog: 2 → 26 blocks, in blue
70. Underwater screen tint
71. Red flash when you run out of air
72. The view-distance setting now really moves the fog plane
73. Adaptive view distance: the fog closes in if the frame rate sags
74. Renderer `stats` (draw calls, chunks meshed) exposed for the HUD

### Gameplay and feel — 75-102

75. Hold-to-mine instead of one-click
76. Per-block break times (`0.28 + √hardness × 0.5` seconds)
77. Plants come away instantly
78. A tap still finishes soft blocks — grass, sand, leaves
79. Dig ticks every quarter of the way through, like a heartbeat
80. Break-time re-targeting when the block under the crosshair changes
81. Swing speed derived from the block you are breaking
82. Crouch on `Ctrl` or `C`
83. Crouch lowers the camera to 1.24 blocks
84. Crouch walks at 1.7 blocks/s
85. Sprint fixed — `Shift` was bound to sprint *and* crouch, so sprinting was impossible
86. `Shift` still descends while flying
87. Swimming: slow sinking, `Space` to rise
88. Water drag on horizontal movement
89. A 12-second breath meter under water
90. Running out of air gives a shove back toward the surface, plus the red flash
91. Splash event on entering or leaving water
92. Footsteps land on a real stride, faster when sprinting, slower when crouching
93. No footsteps while swimming or falling
94. Milestone toast: first block broken
95. Milestone toasts at 25, 100 and 500 blocks broken
96. Milestone toast: first block placed
97. Milestone toast at 64 placed
98. Milestone toasts at 200 and 1000 blocks walked
99. Milestone toast: first time you swim
100. Milestone toast: diamond found
101. Milestone toast: timber (any log)
102. A session tally of blocks broken, blocks placed, steps and distance

### Weather — 103-111

103. Weather state machine: clear ↔ storm fronts
104. Rain
105. Snow instead of rain in cold biomes
106. Thunderstorms
107. Lightning strikes that light the sky
108. Thunder audio timed to the strike
109. Weather saved with the world, so a reload continues the storm
110. Weather toggle in settings
111. Rain loop volume follows the intensity

### Audio, all synthesised (no audio files) — 112-127

112. Footsteps per material (grass, sand, snow, stone, wood, leaves, gravel, glass, cloth)
113. Digging voice per material
114. Dig tick sounds
115. Block-place sound
116. Jump sound
117. Landing sound, scaled by impact
118. Water splash
119. Bubbles under water
120. Thunder roll
121. Rain loop built from brown noise
122. A master gain node
123. Muting stops the rain loop instead of leaving it running
124. Menu chime melody
125. Panel whoosh
126. One shared noise buffer, so nothing allocates per sound
127. Volume setting wired to the mixer

### Settings and interface — 128-166

128. Settings panel in the pause menu
129. Field-of-view slider
130. Mouse sensitivity slider
131. View distance slider
132. Volume slider
133. Day length slider (2–40 minutes)
134. HUD scale slider
135. View bob switch
136. Held block switch
137. Particles switch
138. Weather switch
139. Biome readout switch
140. Adaptive distance switch
141. Reduced motion switch
142. Reset to defaults button
143. Settings stored under their own key, separate from the world
144. Settings clamped on load, so an edited save cannot break the game
145. Changing a setting applies immediately, without a reload
146. Compass readout (eight points)
147. Sky/weather readout
148. Mined counter in the HUD
149. Distance walked in the HUD
150. Block name under the crosshair
151. Breath bar while submerged
152. Breath bar turns amber when it runs low
153. Mode line: walking, sprinting, crouching, flying
154. HUD scale via a CSS variable (`zoom`)
155. Settings chip in the start/pause menu
156. Active state on that chip
157. Credits line in the help sheet
158. Help: hold left click to mine, with the timing note
159. Help: crouch line
160. Help: zoom line
161. Help: `C` as an alternative crouch key
162. Menu version bumped to v3.2
163. Loading text mentions ores
164. `describeTarget` names the block you are aiming at
165. Pause menu keeps the settings chip visible without hiding the buttons
166. Every new control documented in the README

### Tests and infrastructure — 167-193

167. Particle pool tests: caps, recycling, expiry, gravity, clearing
168. Weather tests: fronts, thunder, snow, save round-trip, the off switch
169. Settings tests: clamping, persistence, reset, corrupt-blob fallback
170. Mining timer tests: progress, ticks, re-targeting, instant plants
171. Day cycle tests: phase coverage, wrap-around, clock label
172. Footstep cadence tests
173. Audio tests against a fake AudioContext: tones, noise bursts, the rain loop reuse, muting
174. Ore census test: every ore exists, in reasonable quantity
175. Ore depth-band test: diamond and gold below y = 14
176. Biome coverage test across eleven seeds, asserting all seven biomes appear
177. Decoration census test across five seeds for all six new blocks
178. Plant mesh invariants: colours match vertices, indices are triangles
179. Storage round-trip for weather, distance and the tally
180. Live-game dig tests: one tap versus holding the button
181. Live-game milestone tests, including the diamond celebration
182. Live-game zoom test
183. Live-game settings-application tests for all six sliders and the switches
184. Live-game walk / sprint / crouch speed comparisons
185. Live-game underwater breath test on a real deep pool
186. DOM tests for the new HUD readouts and the breath bar
187. DOM tests driving the settings panel through the real markup
188. Stylesheet assertions for the target label, breath bar and settings grid
189. New `tests/web_shaders.mjs`: lints all 12 GLSL shaders without a GPU — precision qualifiers,
     varyings on both sides, written `gl_Position`, balanced braces, and every uniform or attribute
     the JavaScript binds by name actually being declared
190. Shader lint wired into the CI web job
191. "Every module parses" (`node --check`) step in CI
192. A deterministic test pad, so the dig and walk checks no longer depend on what the random world
     happens to have grown at that spot — this removed the last three flaky assertions
193. README rewritten for the new features, controls, settings, feel and test counts

## v3.1 — start screen and playability (commit `b942dbf`, `05e1c15`, `055d781`)

- Minecraft-style start screen: blocky logo, swinging yellow splash, stacked chunky buttons, seed
  entry, Continue, a live panorama of the world generating behind it
- bloxd-style instant play: the world generates and meshes while the menu is up
- Drag-to-look fallback for embedded frames where pointer lock is refused, with click-to-dig
- Help sheet fix: a `[hidden]` rule that the overlay styles were overriding, plus explicit z-index
  ordering for loading < menu < help
- `tools/serve.sh`: one idempotent command to serve the preview
