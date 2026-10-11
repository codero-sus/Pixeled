# Pixeled

A cozy, Minecraft-inspired **3D voxel sandbox** in four editions that share one world format, one
generator and one look:

- **Web** — instant play in a browser, with real WebGL lighting, keyboard/mouse **and** touch controls.
- **Python** — a desktop edition drawn with Tkinter, no pip packages required.
- **Java** — a desktop edition drawn with Swing/Java2D, no native libraries required.
- **Rockz** — a native Android edition with a thumb-friendly interface, shipped as an APK.

Walk out of the valley, dig a staircase into the hillside, build a tower out of the sunset, and come
back tomorrow: the world is saved. Everything you see is made of blocks, and every block is yours.

## What is in the game

- **Seeded, random worlds.** Every new world rolls its own seed, so no two are alike.
- **Shareable seeds.** Type the same seed in any edition — web, Python, Java or Rockz — and you get
  the *same* terrain, block for block. The tests assert exactly that.
- **Real 3D everywhere.** Every edition does perspective projection with a camera you can aim,
  painter's-algorithm sorting, per-vertex ambient occlusion and fog. No 2D side-scrollers left.
- **Terrain worth exploring.** Continents, hills, mountain ridges, beaches, five biomes (plains,
  forest, desert, snow, mountain), caves with glowstone, oceans, oaks and spruces, cacti, tall grass
  and flowers.
- **Chunk streaming.** The world is generated and meshed in 16×96×16 chunks around you, on a budget
  per frame, and unloaded when you walk away — so the horizon keeps going.
- **Dig and build.** Nineteen block types over two hotbar pages, creative-style instant digging,
  reach of six blocks, and a highlight on whatever you are looking at.
- **A living sky.** A day–night clock drives sunlight, sky colour, fog and the bright window of the
  caves; sunrise, noon, dusk and night all read at a glance.
- **Water, swimming and flying.** Submerge and the screen tints blue and the fog closes in; press
  `F` to fly and build in mid-air.
- **Autosave.** The seed, your edits, your position and the time of day are stored quietly in the
  background.

## How the project is organised

Every edition is built from small, single-purpose modules instead of one long script. The same ideas
(noise, blocks, generator, world, mesher, renderer, player, storage, app) map onto each language, so
a change to the generator or the physics is easy to find and easy to port.

| Concern | Web (ES modules) | Python (package) | Java (Swing) | Rockz (Android) |
| --- | --- | --- | --- | --- |
| Entry point | `index.html` → `web/main.js` | `python/pixeled.py` | `Pixeled.main` | `MainActivity` |
| Noise & seeds | `web/noise.js` | `pixeled_game/noise.py` | `Noise` | `Noise` |
| Blocks & palette | `web/constants.js` | `pixeled_game/blocks.py` | `Blocks` | `Blocks` |
| Terrain | `web/generator.js` | `pixeled_game/generator.py` | `Generator` | `Generator` |
| World & saves of edits | `web/world.js` | `pixeled_game/world.py` | `World` | `WorldModel` |
| Mesher (AO, skylight) | `web/mesher.js` | `pixeled_game/mesher.py` | `Mesher` | `Mesher` |
| Renderer | `web/renderer.js` (+ `web/sky.js`) | `pixeled_game/renderer.py` | `Renderer` | `RockzRenderer` |
| Player physics | `web/player.js` | `pixeled_game/player.py` | `Player` | `PlayerModel` |
| Storage | `web/storage.js` | `pixeled_game/storage.py` | `Storage` | `WorldModel` (`SharedPreferences`) |
| Interface | `web/hud.js`, `web/controls.js`, `web/sprites.js`, `web/audio.js` | `pixeled_game/app.py` | `Pixeled` | `RockzView`, `TouchControls` |

`Noise`, `Blocks`, `Generator` and `Mesher` are **byte-for-byte twins** between the desktop Java
edition and the Android edition (only the package line differs), and `tests/java_parity.py` fails the
build if that ever stops being true.

### How each edition draws 3D

| Edition | 3D technique |
| --- | --- |
| Web | three.js (vendored, no CDN): one `BufferGeometry` per chunk per pass, baked vertex colours, fog, a shader sky dome with sun/moon and instanced clouds. |
| Python | A software renderer on a Tkinter canvas: project the visible faces, sort far-to-near, fill polygons. |
| Java | A software renderer on Swing/Java2D: near-plane clipping, painter's-algorithm sorting, fog blending. |
| Rockz | A software renderer on Android Canvas: `Path` polygons, sorted and fogged, at a phone-sized render distance. |

All four use the same mesher rules — a face is hidden by a solid neighbour, liquids sink slightly,
plants are two crossed quads, ambient occlusion darkens corners, and skylight fades towards 0.3
underground.

## Web edition

Open `index.html` directly, or serve the project folder locally:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. Progress is saved in the browser's local storage.

**Controls**

- **W A S D** — walk, **Shift** — sprint, **Space** — jump (or fly up)
- **Mouse** — look, **left click** — dig, **right click** — place
- **F** — fly, **V** — first/third person, **E** — swap hotbar page, **1–9** — pick a block
- **F3** — debug overlay, **Esc** — pause, settings and a new random world
- **Touch:** a joystick on the left, look by dragging, and DIG / PLACE / JUMP / FLY buttons on the right

## Python edition

Requires Python 3 and Tkinter. On some Linux distributions Tkinter is a separate system package
(for example `python3-tk`). No pip packages are needed.

```bash
python3 python/pixeled.py            # a brand-new random world
python3 python/pixeled.py meadow     # the world behind the seed "meadow"
```

`pixeled.py` is only a launcher; the game lives in the `python/pixeled_game/` package (`blocks`,
`noise`, `generator`, `world`, `mesher`, `renderer`, `player`, `storage`, `app`).

## Java edition

Requires a JDK 17 or newer. Compile and run from the repository root:

```bash
javac -d build java/pixeled3d/*.java
java -cp build pixeled3d.Pixeled
java -cp build pixeled3d.Pixeled 20261011    # optionally start from a seed
```

The game is a set of small classes in `java/pixeled3d/`: `Noise`, `Blocks`, `Generator`, `World`,
`Mesher`, `Renderer`, `Player`, `Storage` and the `Pixeled` window/loop. There is a display-free
smoke test too:

```bash
javac -d build java/pixeled3d/*.java tests/java/pixeled3d/PixeledSmoke.java
java -Djava.awt.headless=true -cp build pixeled3d.PixeledSmoke
```

It checks the seeded terrain against the web edition, the mesher face counts, the physics, the
saves and the software renderer.

## Rockz — Android edition

A native Android game lives in [`rockz-android/`](rockz-android/). Build a debug APK with Android
Studio, or from that directory with JDK 17, Android SDK 35 and Gradle 8.9+:

```bash
cd rockz-android
gradle :app:assembleDebug
```

APK output: `rockz-android/app/build/outputs/apk/debug/app-debug.apk`. A GitHub Actions workflow
builds and publishes the APK as a downloadable workflow artifact whenever the Rockz project changes.
See [`rockz-android/README.md`](rockz-android/README.md) for installation details.

On a phone: the left thumb walks (a floating joystick), dragging anywhere looks around, and the
buttons on the right jump, fly, dig and place. The SEED button opens the seed dialog, so you can
replay a world you liked, or roll a new one.

## Seeds

A seed is a number, or any text — it is hashed, so `meadow` is as good as `20261011`. Leave it blank
(or press *Surprise me* / *New*) and Pixeled rolls a fresh one for you. The current seed is always on
screen:

- the web HUD shows it in the status bar and the pause menu;
- Python shows it in the top bar and on the pause screen;
- Java shows it in the status bar, the pause menu and the debug overlay (`F3`);
- Rockz shows it in the status bar and in the seed dialog.

## Tests

Everything runs headlessly — no browser, no display and no third-party packages:

```bash
node tests/world_test.mjs        # world, atlas, mesher and generator
node tests/web_smoke.mjs         # web modules with a stubbed DOM: world, player, HUD, input, saves
node tests/render_test.mjs       # chunk streaming, edits, sky, particles, avatar, in a fake three.js
python3 tests/python_smoke.py    # the Python edition, including a web/python seed parity probe
python3 tests/java_parity.py     # cross-edition constants, face tables, physics and mirrored modules
node tools/render-preview.mjs artifacts   # PNG previews painted by the web renderer (no GL)
```

`.github/workflows/tests.yml` runs the Node suites, the Python suites, the parity checks, and the
Java job will not pass unless `javac` compiles every class **and** the headless Java smoke test
passes. `.github/workflows/build-rockz-apk.yml` compiles the Android edition into an APK artifact.

## Saves

| Edition | Where the world lives |
| --- | --- |
| Web | browser local storage (`pixeled3d-world-v1`, `pixeled3d-settings-v1`) |
| Python | `~/.pixeled/world.json` and `~/.pixeled/settings.json` |
| Java | `~/.pixeled/world-java.txt` (plain text, one line per edit) |
| Rockz | Android app-private `SharedPreferences` |

Only the seed, your edits, your position and the time of day are stored — everything else is
regenerated from the seed, so a save file stays tiny no matter how far you walk.
