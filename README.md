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
seed the first time you play. Fly with `F`, hold the left mouse button to mine, place blocks with the
right, and build something nice.

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
| Feel | hold-to-mine with crack overlays, block particles, carried block with a swing, footsteps, sprint FOV |

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
| Blocks | 0 air, 1 grass, 2 dirt, 3 stone, 4 sand, 5 log, 6 leaves, 7 snow, 8 planks, 9 glass, 10 water; 11–29 are web-edition extras |
| Physics | gravity 30, jump 9.2, walk 4.6, sprint 7.4, crouch 1.7, fly 11, box 0.6×1.8, eye 1.62, reach 6.5 |
| Day | 600 s (adjustable 120–2400), starting at 0.36 of the cycle, autosave every 5 s |

## Web edition

Open `index.html` directly, or serve the folder:

```bash
./tools/serve.sh            # binds 0.0.0.0:8000, safe to run twice
python3 -m http.server 8000 # or the same thing by hand
```

Then visit <http://localhost:8000>. Add `?seed=1234` to replay a specific world; progress is saved in
browser local storage (`pixeled-voxel-v2`).

### The start screen

The game opens on a title screen in the spirit of Minecraft and bloxd: the logo, a swinging splash,
and the world already turning slowly behind it as a panorama. From there you can **Play**, roll a
**New world**, **Play a seed** you liked, open **How to play**, or flip the **Sound**. `Esc` (or the
☰ button) brings the same screen back as a pause menu, and everything is saved as you go.

### Controls

`W A S D` walk · `Space` jump · `Shift` sprint · `Ctrl` (or `C`) crouch · `Z` zoom · `F` fly ·
hold left click to mine · right click build · middle click pick a block · `1`–`9` or the wheel choose
one · `N` new random world · `T` skip time · `P` screenshot · `H` help · `Esc` menu.

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

### Feel

The world is alive while you play: footsteps land on a real stride and change with the material under
your feet, dust puffs up as you walk, water splashes when you jump in, the air bar drains under water
until you kick back to the surface, rain and snow fall from the sky, lightning whitens the screen and
thunders a moment later, and the block in your hand swings as you dig. Mining, placing, walking far
and finding diamond each earn a one-off congratulation toast.

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
node tests/web_smoke.mjs          # 257 checks: world, mesher, physics, particles, weather, mining, save, the live game
node tests/web_dom_smoke.mjs      # 87 checks: boots the game against the real index.html markup and the settings panel
node tests/web_shaders.mjs        # 47 checks: lints all 12 GLSL shaders without a GPU
python3 tests/python_smoke.py     # 25 checks: noise parity, world gen, physics, renderer, HUD, save
javac -d out java/pixeled/*.java && java -Djava.awt.headless=true -cp out pixeled.Smoke
```

`web_dom_smoke.mjs` reads the id list out of `index.html` and makes `getElementById` return null for
anything else, so the start screen cannot silently lose a button the code expects; it then plays
through the menu, pauses, drags to look, replays a typed seed and drives the settings panel.

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
