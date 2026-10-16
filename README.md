# Pixeled

A tiny, cozy, Minecraft-inspired **3D voxel sandbox** in four editions, all sharing one world
generator, one block palette and one physics contract — so seed `1234` grows the same hills whether
you play it in a browser, on the desktop, or on a phone.

- **Web** — instant play in a browser (WebGL, zero dependencies, works offline).
- **Python** — a desktop version built with Tkinter.
- **Java** — a desktop version built with Swing.
- **Rockz** — a native Android edition with a touch-first interface and a shareable APK.

Every world is randomly generated: hills, seas, deserts, swamps, forests, savannas, snowfields,
caves, ore veins, birches, spruces, cacti, pumpkins and flowers are all rolled fresh from a random
seed the first time you play. Pick one of **four modes** — survival, creative, sandbox or speedrun —
or play **today's challenge**, the same three goals and the same seed for everyone. Fly with `F`,
hold the left mouse button to mine, place blocks with the right, and build something nice.

## What's in the world

| Feature | Detail |
| --- | --- |
| Terrain | continent noise + ridges + hills + grain, ~60% land, seas down to bedrock |
| Biomes | plains, forest, desert, savanna, swamp, snow, mountains — each with its own grass tint and surface blocks |
| Caves | 3D noise carving real caverns under the surface |
| Ores | coal, iron, gold and diamond in depth-banded veins, plus gravel, clay, cobblestone and obsidian |
| Trees | oaks, birches, conical spruces and wide swamp trees, denser in forest and snow biomes |
| Plants | crossed-quad tall grass, flowers, desert cacti and pumpkins — all swaying in the wind |
| Day cycle | a 10-minute day: sun, moon, sky gradient, fog colour and skylight all move with it |
| Weather | clear, rain, snow and thunderstorms with lightning flashes and rolling thunder |
| Water | semi-transparent, animated ripples, sun glints, swimming, splashes and breath |
| Sky | gradient dome, moon disc, drifting clouds, storms that grey the sky, stars at night |
| Light | torches and lava light the world; sealed rooms are dark, and digging a shaft lets the sun in |
| Simulation | sand and gravel fall, saplings grow into trees, chopped trunks take their leaves with them |
| Lava | glowing pools below y = 12 that burn, haze the screen and pop and bubble |
| Feel | hold-to-mine with crack overlays, block particles, carried block with a swing, footsteps, sprint FOV |
| Modes | survival, creative (free blocks + flight + instant mining), sandbox (flat world), speedrun (a clock) |
| Daily challenge | three goals a day, the same seed for everyone, with a streak that survives reloads |
| Shapes | slabs, stairs, fences, panes, ladders, doors, chests and beds — partial blocks with real collision |
| Building | 19 crafting recipes, a chest to store things in, and a bed to sleep the night away |
| Health | ten hearts, fall damage, lava and drowning, regeneration, a death screen and a respawn |
| Water flow | break a wall next to a lake and the water comes through, a few cells per tick |

## How the project is organised

Every edition is built from small, single-purpose modules instead of one long script. The same ideas
(noise, blocks, world, raycast, player, renderer, storage, UI) map onto each language, so a change to
the generator or the physics is easy to find and easy to port.

| Concern | Web (ES modules) | Python (package) | Java (Swing) | Rockz (Android) |
| --- | --- | --- | --- | --- |
| Entry point | `index.html` → `web/main.js` | `python/pixeled.py` | `pixeled.Pixeled` | `MainActivity` |
| Noise | `web/noise.js` | `pixeled_game/noise.py` | `Noise.java` | `Noise.java` |
| Blocks & palette | `web/constants.js` | `pixeled_game/blocks.py` | `Blocks.java` | `Blocks.java` |
| World | `web/world.js` | `pixeled_game/world.py` | `World.java` | `WorldModel.java` |
| Ray casting | `web/raycast.js` | `pixeled_game/raycast.py` | `Raycast.java` | `Raycast.java` |
| Player | `web/player.js` | `pixeled_game/player.py` | `Player.java` | `PlayerModel.java` |
| Meshing | `web/mesher.js` | — | — | — |
| Particles | `web/particles.js` | — | — | — |
| Weather | `web/weather.js` | — | — | — |
| Settings | `web/settings.js`, `web/options.js` | — | — | — |
| Game rules | `web/gameplay.js` | — | — | — |
| Renderer | `web/renderer.js` | `pixeled_game/renderer.py` | `Renderer.java` | `Renderer.java` |
| HUD | `web/ui.js` | `pixeled_game/ui.py` | `Hud.java` | `RockzView` overlay |
| Storage | `web/storage.js` | `pixeled_game/storage.py` | `Storage.java` | `SaveStore` / `PreferencesStore` |
| Game rules | `web/main.js` | `pixeled_game/game.py` | `Game.java` | `RockzView` |
| Input & shell | `web/input.js`, `web/main.js` | `pixeled_game/window.py` | `Pixeled.java` | `TouchControls.java` |

The web modules are side-effect free — `web/main.js` exports `start()` and `index.html` calls it — and
the Python game logic lives in a headless `Game` class that `window.py` merely draws. That is what
lets both editions be tested without a browser or a display.

## Shared contracts

All four editions are generated from the same numbers, and `Smoke`/`Smoke`-style tests assert them:

| Contract | Value |
| --- | --- |
| Noise parity (seed 2408) | `fbm2(0.5, 0.5, 5) = 0.482606`, `value3(1.5, 2.5, 3.5) = 0.446569`, `hashCoords(3, 4, 5, 2408) = 0.028467` |
| World size | web 128×64×128, others 96×48×96, sea level 20, chunks 8×8 |
| Blocks | 0 air, 1 grass, 2 dirt, 3 stone, 4 sand, 5 log, 6 leaves, 7 snow, 8 planks, 9 glass, 10 water; 11–48 are web-edition extras (ores, plants, torches, lava, bricks, blocks, shaped blocks and furniture) |
| Physics | gravity 30, jump 9.2, walk 4.6, sprint 7.4, crouch 1.7, fly 11, box 0.6×1.8, eye 1.62, reach 6.5 |
| Day | 600 s (adjustable 120–2400), starting at 0.36 of the cycle, autosave every 5 s |

## Web edition

Open `index.html` directly, or serve the folder:

```bash
./tools/serve.sh            # binds 0.0.0.0:8000, safe to run twice
python3 -m http.server 8000 # or the same thing by hand
```

Then visit <http://localhost:8000>. Add `?seed=1234` to replay a specific world; progress is saved in
browser local storage (`pixeled-voxel-v2` — the seed, the blocks you changed, the metadata, the chests
and your backpack). The daily challenge and the recent-worlds shelf keep to their own small keys, so
clearing one never touches the other.

### The start screen

The game opens on a title screen in the spirit of Minecraft and bloxd: the logo, a swinging splash,
and the world already turning slowly behind it as a panorama. From there you can **Play**, roll a
**New world**, **Play a seed** you liked, open **How to play**, or flip the **Sound**. `Esc` (or the
☰ button) brings the same screen back as a pause menu, and everything is saved as you go.

Below the buttons sits the shelf the start screen earns you:

- **Four mode cards** — Survival, Creative, Sandbox, Speedrun — each with its rules in one line.
  Picking one switches the live game immediately; nothing restarts.
- **Today's challenge** — the date, the day's seed, today's three goals and your streak, with a
  button that drops you straight into the daily world.
- **Recent worlds** — the last four seeds you played, newest first, each remembering its mode. Click
  one to go back. **Surprise me** rolls a random mode and a random seed at once.

### Controls

`W A S D` walk · `Space` jump · `Shift` sprint · `Ctrl` (or `C`) crouch · `Z` zoom · `F` fly ·
hold left click to mine · right click build · middle click pick a block · `1`–`9` or the wheel choose
one · `E` use a door, chest or bed · `C` crafting · `J` today's challenge · `B` block palette ·
`F5` third-person camera · `F3` debug panel · `N` new random world · `T` skip time · `P` screenshot ·
`H` help · `Esc` menu.

Mining takes time: soft blocks (grass, sand, leaves, plants) come away in a tap, stone needs the
button held for about a second, and diamond takes a little longer. A dark crack overlay grows as you
dig, the block throws its own colour when it breaks, and each material has its own sound.

The mouse works in two ways and the game is fully playable in both. Normally the first click
*captures* the pointer (an invisible cursor, like Minecraft) — hold a button to mine or build
continuously. If the browser refuses to capture it, as happens when the game runs inside an embedded
frame that was not granted the pointer-lock permission, it quietly switches to **drag to look**: hold
a button and move to turn, let go of a quick click to mine, right click to build. A toast explains
the switch, and the menu says `Drag to look`.

On touch devices there is a joystick, a drag-look area, and MINE / PLACE / JUMP buttons.

### Settings

The pause menu's **Settings** chip opens a panel with six sliders (field of view, mouse sensitivity,
view distance, volume, day length, HUD scale) and seven switches (view bob, held block, particles,
weather, biome readout, adaptive view distance, reduced motion) plus a reset button. Settings are
stored separately from the world (`pixeled-settings-v1`), so a new seed never resets how you play.

### Building tools

Press `B` (or the ▦ button) for the **block palette**: every placeable block with a count of how many
you have dug up. Picking one drops it into the selected hotbar slot, and each slot remembers its own
block. A **minimap** in the corner shows the terrain around you, shaded by height, with a wedge for
the direction you are facing. `F5` swaps to a third-person camera, and `F3` opens a debug panel with
your coordinates, chunk, biome, light level and frame rate.

### Light and lava

Torches (14 levels) and lava (12) pour light into the world, and the mesher bakes it into the
colours — so a sealed stone room really is pitch black until you light it, a wall really does cast a
shadow, and digging a shaft from the surface lets daylight down into the cave. Lava pools generate
below y = 12: it glows, it bubbles, it washes the screen orange and it burns you about twice a
second, so bridge across it or fly over it.

### The sea and the held block

Water is a real shader surface: two waves move it, a third of a block of drop makes it read as liquid,
fresnel pales it at grazing angles, the sun glitters off its ripples, foam rides the crests, and
underwater turns the screen to moving caustics. Rain splashes back up wherever it lands near you. The
block in your hand is the block you are holding — a slab is flat, a fence post is a stick, a chest is
a chest, and the swing, bob and tilt all still work.

### Feel

The world is alive while you play: footsteps land on a real stride and change with the material under
your feet, dust puffs up as you walk, water splashes when you jump in, the air bar drains under water
until you kick back to the surface, rain and snow fall from the sky, lightning whitens the screen and
thunders a moment later, and the block in your hand swings as you dig. Mining, placing, walking far
and finding diamond each earn a one-off congratulation toast.

### Modes

| Mode | Rules |
| --- | --- |
| Survival | Health on, blocks cost what you dug up, mining takes as long as it should |
| Creative | Infinite blocks, flight, instant mining, and nothing can hurt you |
| Sandbox | A flat world at y 28 with free blocks and flight, but honest mining times |
| Speedrun | Survival rules plus a stopwatch, with a diamond as the finish line |

The mode rules are applied to the live player the moment you pick a card, so switching is instant.
A small chip in the HUD always shows which mode you are in, and a speedrun keeps a clock in the
corner: it counts in tenths and turns green with a star when you find that diamond.

### The daily challenge

Every day has a seed (`hash(day)` in the 1000–901000 range) and three goals drawn from a catalogue of
ten: mine thirty blocks, place twenty, walk a hundred and fifty, light two torches, fell a tree,
craft twice, find a diamond, reach y 14, live through a dawn, or get properly wet. The same three
goals and the same world for everyone on that date. Press `J` for the panel: a progress bar per goal,
the day's seed, and a button that copies a link to it. Finish all three in a day and the streak goes
up; miss a day and it resets while the best stays on record.

### Blocks you can shape

Slabs, stairs, fences, glass panes, ladders, doors, chests, beds and bookshelves are all placeable,
craftable and drawn from one description of their geometry (`web/shapes.js`), so what you see is
exactly what you can stand on and walk through. A stair faces the way you were looking, a ladder
hangs on the wall you aimed at, a door remembers which way it swings, an open door is a thin leaf
against its frame that you can walk straight through, and a torch left in a slot is still a torch.

`C` opens the crafting panel: 19 recipes with your ingredient counts, the missing pieces spelled out,
and only the recipes you can afford lit up. `E` on a chest shows its contents and moves one stack at a
time in either direction — and a chest you break spills everything into your backpack.

### Hearts

Twenty points, ten hearts, and a real reason to look before you jump. Falls over three blocks hurt,
lava burns while you stand in it, water stops being generous after twelve seconds, and the world
below y = 0 is fatal. Health comes back on its own: seven quiet seconds, then a heart every 2.4. At
zero the world stays where it is, a panel tells you what happened, and **Respawn** puts you back at
the spawn point with your backpack intact.

## Python edition

Requires Python 3. Tkinter is needed for the window (on some Linux distributions it is a separate
package, for example `python3-tk`); no pip packages are needed.

```bash
python3 python/pixeled.py                       # play
python3 python/pixeled.py --seed 1234           # replay a world
python3 python/pixeled.py --render shot.png     # headless screenshot, no Tk needed
```

Optional flags: `--width`, `--height`, `--scale`, `--fps`, `--frames`, `--clock`, `--no-save`.
Progress is saved in `~/.pixeled/world.json`.

## Java edition

Requires a JDK 17+ (the language level is Java 8, so older JDKs work too).

```bash
javac -d out java/pixeled/*.java
java -cp out pixeled.Pixeled
```

The same `--seed`, `--width`, `--height`, `--scale`, `--no-save` flags work, plus `--render --out
shot.png` for a headless screenshot. Progress is saved in `~/.pixeled/world.txt`. See
[`java/README.md`](java/README.md) for the module map and controls.

## Tests

All three headless suites run in CI on every push (`.github/workflows/tests.yml`):

```bash
node tests/web_smoke.mjs          # 715 checks: world, shapes, mesher, light, physics, water, crafting, health, modes, dailies, save, the live game
node tests/web_dom_smoke.mjs      # 219 checks: boots the game against the real index.html markup, the menu, the modes and the panels
node tests/web_shaders.mjs        # 56 checks: lints all 12 GLSL shaders without a GPU
python3 tests/python_smoke.py     # 25 checks: noise parity, world gen, physics, renderer, HUD, save
javac -d out java/pixeled/*.java && java -Djava.awt.headless=true -cp out pixeled.Smoke
```

`web_dom_smoke.mjs` reads the id list out of `index.html` and makes `getElementById` return null for
anything else, so the start screen cannot silently lose a button the code expects; it then plays
through the menu, pauses, drags to look, replays a typed seed and drives the settings panel.

`web_smoke.mjs` drives the real game loop with a stubbed canvas: it digs, builds, crafts, sleeps,
gets hurt, dies, respawns, plays a speedrun, completes a daily goal and reloads its own save. It seeds
the live world deterministically and steps frame by frame while re-aiming, so a run that passes once
passes every time.

`web_shaders.mjs` exists because the headless suites run on a stub WebGL context, where a shader that
would fail to compile in a real browser passes silently. It reads the GLSL out of `renderer.js` and
checks the things a driver would: precision qualifiers, varyings declared on both sides, a written
`gl_Position`, and every uniform or attribute the JavaScript binds by name actually being declared.

The Rockz core (everything except the Android `View`/`Activity` glue) is compiled and tested by the
same workflow without needing an emulator.

## Rockz Android edition

A native Android game lives in [`rockz-android/`](rockz-android/). Build a debug APK with Android
Studio, or from that directory with JDK 17, Android SDK 35 and Gradle 8.9+:

```bash
cd rockz-android
gradle :app:assembleDebug
```

APK output: `rockz-android/app/build/outputs/apk/debug/app-debug.apk`. The
[`Build Rockz APK`](.github/workflows/build-rockz-apk.yml) workflow builds and publishes it as a
downloadable artifact when the Android project changes. See
[`rockz-android/README.md`](rockz-android/README.md) for installation details.

Rockz saves to Android app-private storage. The Python, Java and Rockz saves all store the same
things — seed, edits, player position, clock and hotbar selection — so a new world is always one tap
away.
