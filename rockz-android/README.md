# Rockz — Android edition

Rockz is the native Android/mobile edition of Pixeled: the same 3D voxel world as the web, Python
and Java editions, in your pocket. It is an offline, touch-first sandbox written in Java with
Android's Canvas API — no engine, no assets, no network permission. The world is randomly generated
(seas, hills, deserts, forests, snowfields, caves and trees), the sun moves through an eight-minute
day, and progress saves itself every few seconds.

## Source layout

The app is split into small classes under `app/src/main/java/com/pixeled/rockz/`:

- `MainActivity.java` — activity, immersive mode and saving when the app pauses.
- `RockzView.java` — the Canvas view: frame loop, touch routing and the whole HUD overlay.
- `WorldModel.java` — random world generation, block access, edits and save data.
- `SaveStore.java` / `PreferencesStore.java` — the tiny persistence interface, so `WorldModel`
  stays free of Android imports and can be smoke-tested on the desktop JVM.
- `Noise.java`, `Blocks.java`, `Raycast.java`, `PlayerModel.java`, `Renderer.java` — the same noise,
  palette, voxel ray casting, physics and software renderer as the other editions.
- `TouchControls.java` — multi-touch joystick, buttons, hotbar hit testing and layout.

## Controls

- **Drag anywhere** — look around.
- **Joystick (bottom left)** — walk; push it all the way for a sprint.
- **MINE / PLACE (right edge)** — dig the aimed block, or build with the selected one.
- **JUMP** — jump, or rise while flying. **FLY** toggles flight; while flying, JUMP descends.
- **Hotbar (bottom strip)** — tap a slot to choose the block.
- **Status bar (top left)** — tap it to roll a brand-new random world.

## Build a debug APK

Requirements: Android Studio (or Android SDK + JDK 17) and Gradle 8.9 or newer.

From this directory, run:

```bash
gradle :app:assembleDebug
```

The installable APK is generated at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Alternatively, open this `rockz-android` folder in Android Studio and choose **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The project uses Android Gradle Plugin 8.7.3, compile SDK 35, and supports Android 6.0 (API 23) and newer.

To install a locally built APK on a connected device with USB debugging enabled:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

World progress is stored privately on the device (seed, edits, player position, time of day and
hotbar selection). No network permission is requested.

## Tests

The Android-free core is compiled and smoke-tested on the desktop JVM by
[`.github/workflows/tests.yml`](../.github/workflows/tests.yml):

```bash
cd app/src
javac -d /tmp/rockz-core \
  main/java/com/pixeled/rockz/{Blocks,Noise,SaveStore,WorldModel,PlayerModel,Raycast,Renderer}.java \
  test/java/com/pixeled/rockz/{MemoryStore,RockzSmoke}.java
java -cp /tmp/rockz-core com.pixeled.rockz.RockzSmoke
```
