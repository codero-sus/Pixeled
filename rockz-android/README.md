# Rockz — Android edition

Rockz is the native Android/mobile edition of Pixeled: an offline, touch-first **3D voxel sandbox**
written in Java with Android's Canvas API. No network, no third-party libraries, no OpenGL required —
a small software renderer draws the same world the web, Python and Java editions generate from the
same seed.

## What's in it

- **Real 3D**: perspective projection, painter's-algorithm sorting, baked ambient occlusion,
  skylight, fog and a sun that moves with the time of day.
- **Seeded, random worlds**: a new world rolls a new seed; type a seed in the SEED dialog to replay a
  world from any other edition of Pixeled.
- **Touch-first controls**: a floating joystick for the left thumb, drag anywhere to look, and
  buttons for JUMP, FLY, DIG, PUT and DOWN.
- **Digging and building**: hold DIG to chip through a block, hold PUT to keep building; tap a hotbar
  slot to choose from the six-block palette (grass, dirt, stone, planks, leaves, sand, glowstone).
- **Chunk streaming**: the world grows in 16×96×16 chunks around you, only a couple per frame.
- **Automatic saves**: the seed, your edits, your position and the time of day are written to app
  storage every 15 seconds and whenever the app goes to the background.

## Source layout

The app is split into small classes under `app/src/main/java/com/pixeled/rockz/`:

| File | What it does |
| --- | --- |
| `MainActivity.java` | Activity, immersive mode and saving when the app pauses. |
| `RockzView.java` | The frame loop, HUD, hotbar and seed dialog. |
| `RockzRenderer.java` | The software 3D renderer: projection, clipping, sorting, fog, day/night. |
| `WorldModel.java` | Chunk map, block edits, ray casting, spawning and the local save file. |
| `PlayerModel.java` | Movement, gravity, swimming, flying and collision. |
| `TouchControls.java` | Joystick and button hit testing, multi-touch, and drawing the pads. |
| `Noise.java`, `Blocks.java`, `Generator.java`, `Mesher.java` | The world maths — the same files the desktop Java edition uses (only the package line differs), so both editions build the identical world. |

## Build a debug APK

Requirements: Android Studio (or Android SDK 35 + JDK 17) and Gradle 8.9 or newer.

From this directory:

```bash
gradle :app:assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/app-debug.apk`. Install it on a device with:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Actions workflow [`.github/workflows/build-rockz-apk.yml`](../.github/workflows/build-rockz-apk.yml)
builds the same APK on every change to `rockz-android/**` and publishes it as the `rockz-debug-apk`
artifact, so you can download and sideload it without a local SDK.

## Controls on a phone

| Gesture | Action |
| --- | --- |
| Left thumb on the lower-left area | Walk (the joystick follows your thumb) |
| Drag anywhere else | Look around |
| JUMP | Jump — or rise while flying |
| DOWN | Sink while flying, steady yourself in water |
| DIG (hold) | Break the block under the crosshair |
| PUT (hold) | Place the selected block |
| SEED | Type a seed, or roll a surprise one |
| NEW | Start a fresh random world right away |
| Tap a hotbar slot | Choose a block |

The game is 0.6 × 1.7 blocks tall, walks at 4.6 blocks a second, runs at 6.4 when the stick is pushed
all the way, jumps 1.3 blocks and swims upwards with JUMP — the same numbers as every other edition.
