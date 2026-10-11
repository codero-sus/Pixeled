# Pixeled — Java/Swing edition

A dependency-free 3D voxel sandbox: the same world generator, physics and block palette as the web
and Python editions, rendered with a software ray-caster straight into a Swing window (no LWJGL,
no assets, nothing to download).

## Run it

```bash
javac -d out java/pixeled/*.java
java -cp out pixeled.Pixeled
```

Useful flags:

```bash
java -cp out pixeled.Pixeled --seed 1234            # replay a specific world
java -cp out pixeled.Pixeled --width 384 --height 216 --scale 2
java -cp out pixeled.Pixeled --no-save              # ignore the save file
java -cp out pixeled.Pixeled --render --out shot.png   # headless screenshot, no window
```

Requires a JDK 17+ (the code targets Java 8 language level, so older JDKs work too). The
`.github/workflows/tests.yml` workflow compiles the package, runs the smoke suite and writes a
headless screenshot on every push.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` or arrows | walk |
| Mouse drag | look around (Swing has no pointer lock) |
| Left click | mine the aimed block |
| Right click | place the selected block |
| Middle click | pick the aimed block into the hotbar |
| Space | jump, or fly up |
| Shift | sprint, or fly down |
| `F` | toggle flight |
| `1`–`9`, mouse wheel | choose a block |
| `N` | brand-new random world |
| `T` | skip two hours |
| `P` | screenshot into the working directory |
| `H` | show or hide the controls |

## Tests

```bash
javac -d out java/pixeled/*.java
java -Djava.awt.headless=true -cp out pixeled.Smoke
```

`pixeled.Smoke` checks the shared noise contract (a seed means the same world in every edition),
world generation, ray casting, the player sweep and step-up, the renderer and the save round-trip —
all without opening a window.

## Modules

| File | Responsibility |
| --- | --- |
| `Noise.java` | mulberry32 + value noise, bit-for-bit the same as `web/noise.js` |
| `Blocks.java` | palette, metrics, colour helpers |
| `World.java` | generation, block access, render indices, edit list |
| `Raycast.java` | 3D DDA voxel ray casting |
| `Player.java` | swept AABB movement, step-up, gravity, flight |
| `Renderer.java` | heightfield row sweep + voxel cubes + sky, into a `BufferedImage` |
| `Hud.java` | Java2D overlay: stats, minimap, hotbar, toasts, help |
| `Storage.java` | the save file in `~/.pixeled/world.txt` |
| `Game.java` | game state, editing rules, day cycle, autosave |
| `Pixeled.java` | the Swing window, input bindings and the frame loop |
| `Smoke.java` | the headless smoke test |
