#!/usr/bin/env python3
"""Python edition smoke test — no window, no display, no dependencies.

Checks the whole 3D pipeline of the Tkinter edition: noise, terrain, biomes, caves, the world
store, raycasting, the mesher, the software renderer's projection and culling, player physics,
and the save file. When Node is available it also proves both editions generate the *same* world
from the same seed.

    python3 tests/python_smoke.py
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

# Keep the save file inside a scratch directory so a real save is never touched.
SCRATCH = tempfile.mkdtemp(prefix="pixeled-test-")
os.environ["PIXELED_HOME"] = SCRATCH

from pixeled_game import storage  # noqa: E402
from pixeled_game.blocks import (  # noqa: E402
    BLOCKS, CHUNK_SIZE, DEFAULT_SETTINGS, HOTBAR_PAGES, IS_SOLID, SEA_LEVEL, TILE_COLORS, WATER, WORLD_HEIGHT,
)
from pixeled_game.generator import TerrainGenerator  # noqa: E402
from pixeled_game.mesher import count_faces, mesh_chunk  # noqa: E402
from pixeled_game.noise import mulberry32, parse_seed, random_seed, seed_label  # noqa: E402
from pixeled_game.player import PlayerModel  # noqa: E402
from pixeled_game.renderer import SceneRenderer, _clip_near, Camera  # noqa: E402
from pixeled_game.world import VoxelWorld  # noqa: E402

SEED = 20261011
failures: list[str] = []


def check(condition, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        failures.append(message)


def section(title: str) -> None:
    print(f"\n{title}")


# ------------------------------------------------------------------ noise

section("noise")
rng = mulberry32(12345)
values = [rng() for _ in range(5)]
check(all(0.0 <= value < 1.0 for value in values), "mulberry32 stays inside [0, 1)")
fresh = mulberry32(12345)
check(values == [fresh() for _ in range(5)], "mulberry32 is deterministic")
check(values[0] != values[1], "and keeps producing new numbers")
check(parse_seed("12345") == 12345, "numeric seeds pass through")
check(parse_seed("a lovely glade") == parse_seed("a lovely glade"), "text seeds are stable")
check(parse_seed("a lovely glade") != parse_seed("a gloomy cave"), "different text, different world")
check(parse_seed("") is None, "a blank seed means 'surprise me'")
check(random_seed() != random_seed(), "random seeds differ")
check(seed_label(42) == "0000000042", "seed labels are padded for sharing")

# ------------------------------------------------------------------ terrain

section("terrain")
generator = TerrainGenerator(SEED)
heights = [generator.height_at(x, z) for x in range(-40, 40, 5) for z in range(-40, 40, 5)]
check(all(2 <= height <= WORLD_HEIGHT - 12 for height in heights), "heights stay inside the world")
check(max(heights) - min(heights) > 5, "the landscape has relief")
check(TerrainGenerator(SEED).height_at(123, -45) == generator.height_at(123, -45), "the same seed rebuilds the same column")
check(TerrainGenerator(SEED + 1).height_at(123, -45) != generator.height_at(123, -45), "a new seed changes the terrain")

biomes = {}
for x in range(-300, 300, 17):
    for z in range(-300, 300, 17):
        biome = generator.biome_at(x, z)
        biomes[biome] = biomes.get(biome, 0) + 1
check(len(biomes) >= 4, f"several biomes exist ({', '.join(sorted(biomes))})")
check(all(count > 20 for count in biomes.values()), "and each one actually occurs")

check(generator.surface_layers("plains", SEA_LEVEL + 10)[0] == 1, "plains surface is grass")
check(generator.surface_layers("desert", SEA_LEVEL + 10)[0] == 5, "desert surface is sand")
check(generator.surface_layers("snow", SEA_LEVEL + 10)[0] == 11, "snow surface is snow")
check(generator.surface_layers("plains", SEA_LEVEL)[0] == 5, "the shoreline becomes a beach")

# ------------------------------------------------------------------ world

section("world")
world = VoxelWorld(SEED)
for cx in range(-2, 3):
    for cz in range(-2, 3):
        world.ensure_chunk(cx, cz)

stone = water = leaves = 0
for chunk in world.chunks.values():
    for value in chunk.data:
        if value == 3:
            stone += 1
        elif value == WATER:
            water += 1
        elif value == 8:
            leaves += 1
check(stone > 50000, f"solid stone fills the underground ({stone} blocks)")
check(leaves > 500, f"and trees ({leaves} leaf blocks)")

# Water: count submerged columns over a wide area (cheap), then fill one of their chunks for real.
submerged = []
for x in range(-400, 401, 16):
    for z in range(-400, 401, 16):
        if generator.height_at(x, z) < SEA_LEVEL:
            submerged.append((x, z))
check(len(submerged) > 20, f"a good part of the world is under the sea ({len(submerged)} of 2601 probes)")
if submerged:
    wet_x, wet_z = submerged[0]
    wet_chunk = world.ensure_chunk(wet_x >> 4, wet_z >> 4)
    wet_water = sum(1 for value in wet_chunk.data if value == WATER)
    check(wet_water > 100, f"sea water fills the chunks below sea level ({wet_water} blocks)")

spawn = world.find_spawn(0, 0)
check(spawn["y"] > SEA_LEVEL, f"the spawn point is on dry land (y={spawn['y']:.0f})")
check(IS_SOLID[world.get_block(int(spawn["x"]), int(spawn["y"] - 1), int(spawn["z"]))], "and stands on a solid block")

top = world.column_top(4, 4)
check(world.is_targetable(4, top, 4), "the column top is a real, aimable block")
hit = world.raycast((4.5, top + 3, 4.5), (0, -1, 0), 8)
check(hit is not None and hit.y == top, "a ray straight down finds the surface")
check(hit is not None and hit.normal == (0, 1, 0), "with the top face as its normal")
assert world.set_block(6, top + 1, 4, 3), "safe to build a test wall"
hit_side = world.raycast((4.5, top + 1.5, 4.5), (1, 0, 0), 8)
check(hit_side is not None and hit_side.x == 6 and hit_side.normal == (-1, 0, 0),
      "a sideways ray reports the wall's face")
world.set_block(6, top + 1, 4, 0, record=False)

check(world.set_block(4, top + 1, 4, 13), "a block can be placed")
check(world.get_block(4, top + 1, 4) == 13, "and read back")
check(world.edits[(4, top + 1, 4)] == 13, "and is recorded for the save file")
check(world.set_block(4, top + 1, 4, 0), "and removed again")
check((4, top + 1, 4) in world.edits, "removals are recorded too")

# ------------------------------------------------------------------ mesher

section("mesher")
for cx in range(-2, 3):
    for cz in range(-2, 3):
        world.ensure_chunk(cx, cz)
faces = mesh_chunk(world, world.chunk(0, 0))
counts = count_faces(faces)
check(len(faces) > 300, f"a chunk meshes into real faces ({len(faces)})")
check(counts["opaque"] > 200, "mostly solid faces")
check(all(len(face.points) == 4 for face in faces), "every face is a quad")
check(all(0.0 < face.shade <= 1.1 for face in faces), "shading stays in a sane range")
tops = [face for face in faces if face.normal == (0, 1, 0)]
check(len(tops) > 10, "upward faces exist for the surface")

# A single floating block: exactly six faces, none hidden.
tiny = VoxelWorld(SEED)
tiny.ensure_chunk(0, 0)
for y in range(0, WORLD_HEIGHT):
    for z in range(CHUNK_SIZE):
        for x in range(CHUNK_SIZE):
            tiny.chunks[(0, 0)].data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = 0
for z in range(CHUNK_SIZE):
    for x in range(CHUNK_SIZE):
        tiny.chunks[(0, 0)].set_height(x, z, 0)
tiny.chunks[(0, 0)].set(4, 40, 4, 3)
tiny.chunks[(0, 0)].set_height(4, 4, 40)
lone = mesh_chunk(tiny, tiny.chunk(0, 0))
check(count_faces(lone)["opaque"] == 6, f"a lone block has six visible faces ({count_faces(lone)['opaque']})")

# ------------------------------------------------------------------ renderer

section("renderer")
settings = dict(DEFAULT_SETTINGS)
settings["render_distance"] = 3
renderer = SceneRenderer(world, settings)
player = PlayerModel(world, spawn)
renderer.stream_chunks(player)
check(len(renderer.chunk_faces) > 10, f"chunks stream into the renderer ({len(renderer.chunk_faces)})")
check(renderer.chunks_drawn == 0, "nothing is drawn before the first frame")

polygons = renderer.frame(player, 640, 400)
check(len(polygons) > 100, f"a frame produces polygons ({len(polygons)})")
depths = [entry[0] for entry in polygons]
check(depths == sorted(depths, reverse=True), "polygons are sorted far to near for the painter's algorithm")
check(all(len(entry[1]) >= 3 for entry in polygons), "every polygon has at least three screen points")
xs = [point[0] for _, points, _, _ in polygons for point in points]
ys = [point[1] for _, points, _, _ in polygons for point in points]
check(min(xs) >= -4000 and max(xs) <= 4000, "screen coordinates stay bounded")
check(min(ys) >= -4000 and max(ys) <= 4000, "in both directions")

# Looking straight down at your feet must show the ground below and nothing behind you.
looking_down = PlayerModel(world, spawn)
looking_down.pitch = -1.2
down_frame = renderer.frame(looking_down, 640, 400)
check(len(down_frame) > 0, "looking down still draws the ground")
looking_up = PlayerModel(world, spawn)
looking_up.pitch = 1.2
up_frame = renderer.frame(looking_up, 640, 400)
check(len(up_frame) < len(down_frame), "looking at the sky draws far less")

# Projection sanity: a point straight ahead lands near the middle of the screen.
camera = Camera(0, 0, 0, 0, 0, 72)
ahead = camera.project((0, 0, -5), 640, 400)
check(abs(ahead[0]) < 1e-6 and abs(ahead[1]) < 1e-6 and abs(ahead[2] - 5) < 1e-6, "a point straight ahead is on the camera axis")
screen = camera.screen_point(ahead, 640, 400)
check(abs(screen[0] - 320) < 1e-6 and abs(screen[1] - 200) < 1e-6, "and projects to the centre of the screen")
right = camera.project((5, 0, -5), 640, 400)
check(camera.screen_point(right, 640, 400)[0] > 320, "a point to the right lands right of centre")

# Near-plane clipping keeps polygons in front of the camera.
clipped = _clip_near([(-1, 0, -0.5), (1, 0, -0.5), (1, 0, 4), (-1, 0, 4)])
check(all(point[2] >= 0.12 - 1e-9 for point in clipped), "near-plane clipping removes points behind the camera")
check(len(clipped) >= 3, "and keeps a drawable polygon")

# ------------------------------------------------------------------ physics

section("physics")
flat = VoxelWorld(SEED)
flat.ensure_chunk(0, 0)
for z in range(CHUNK_SIZE):
    for x in range(CHUNK_SIZE):
        for y in range(WORLD_HEIGHT):
            flat.chunks[(0, 0)].data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = 3 if y < 40 else 0
        flat.chunks[(0, 0)].set_height(x, z, 39)

walker = PlayerModel(flat, {"x": 8.5, "y": 50.0, "z": 8.5})
for _ in range(240):
    walker.update(1 / 60, {})
check(walker.on_ground and abs(walker.position["y"] - 40.0) < 0.02, f"falling lands on the floor (y={walker.position['y']:.2f})")

start = dict(walker.position)
for _ in range(60):
    walker.update(1 / 60, {"forward": 1})
distance = math.hypot(walker.position["x"] - start["x"], walker.position["z"] - start["z"])
check(2 < distance < 6, f"walking covers ground at a walking pace ({distance:.2f} blocks/s)")
check(abs(walker.position["y"] - 40.0) < 0.05, "and stays on the flat ground")

jump_start = walker.position["y"]
walker.jump()
peak = jump_start
for _ in range(45):
    walker.update(1 / 60, {})
    peak = max(peak, walker.position["y"])
check(peak > jump_start + 0.7, f"jumping gains height ({peak - jump_start:.2f} blocks)")
for _ in range(120):
    walker.update(1 / 60, {})
check(walker.on_ground, "and lands again")

# A wall stops the player.
wall = VoxelWorld(SEED)
wall.ensure_chunk(0, 0)
for z in range(CHUNK_SIZE):
    for x in range(CHUNK_SIZE):
        for y in range(WORLD_HEIGHT):
            solid = y < 40 or (x >= 6 and y < 44)
            wall.chunks[(0, 0)].data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = 3 if solid else 0
        wall.chunks[(0, 0)].set_height(x, z, 43 if x >= 6 else 39)
wallwalker = PlayerModel(wall, {"x": 2.5, "y": 41.0, "z": 8.5})
for _ in range(300):
    wallwalker.update(1 / 60, {"forward": 1})
check(wallwalker.position["x"] < 6, f"a wall stops the player (x={wallwalker.position['x']:.2f})")
check(not wallwalker.overlaps_block(6, 41, 8), "and they never end up inside it")

# Swimming.
swim_world = VoxelWorld(SEED)
swim_world.ensure_chunk(0, 0)
for z in range(CHUNK_SIZE):
    for x in range(CHUNK_SIZE):
        for y in range(WORLD_HEIGHT):
            if y < 30:
                block = 3
            elif y <= 40:
                block = WATER
            else:
                block = 0
            swim_world.chunks[(0, 0)].data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = block
        swim_world.chunks[(0, 0)].set_height(x, z, 40)
swimmer = PlayerModel(swim_world, {"x": 8.5, "y": 39.0, "z": 8.5})
for _ in range(30):
    swimmer.update(1 / 60, {"jump": True})
check(swimmer.in_water, "standing in water is detected")
check(swimmer.velocity["y"] > 0, "and pressing space swims upwards")

flyer = PlayerModel(flat, {"x": 8.5, "y": 42.0, "z": 8.5})
flyer.toggle_fly(True)
start_y = flyer.position["y"]
for _ in range(30):
    flyer.update(1 / 60, {"jump": True})
check(flyer.position["y"] > start_y, "flying rises with space")

# ------------------------------------------------------------------ storage

section("storage")
edits = {(1, 40, 2): 13, (-5, 41, 0): 0}
check(storage.save_world(SEED, {"x": 1.5, "y": 40.0, "z": -3.25, "yaw": 1.2, "pitch": 0.1}, edits, 7, 3.5, 0.75),
      "the world saves")
loaded = storage.load_world()
check(loaded and loaded["seed"] == SEED, "the seed survives the round trip")
check(loaded and loaded["edits"][(1, 40, 2)] == 13, "and so do the player's blocks")
check(loaded and abs(loaded["player"]["z"] + 3.25) < 1e-9, "and where they were standing")
check(loaded and loaded["blocks_placed"] == 7, "and the block counter")
storage.save_settings({"render_distance": 5, "fov": 80})
settings_back = storage.load_settings(DEFAULT_SETTINGS)
check(settings_back["render_distance"] == 5 and settings_back["fov"] == 80, "settings round-trip")
check(settings_back["sound"] is True, "and keep their defaults")
storage.clear_world()
check(storage.load_world() is None, "clearing the save works")

# ------------------------------------------------------------------ blocks

section("blocks")
check(len(BLOCKS) == 19, f"the block palette has nineteen entries ({len(BLOCKS)})")
check(BLOCKS[0].name == "Air" and BLOCKS[0].solid is False, "index 0 is air and is not solid")
check(len(TILE_COLORS) == 24, "every atlas tile has a colour")
check(all(block.color("top").startswith("#") for block in BLOCKS), "every block has drawable colours")
check(len(HOTBAR_PAGES[0]) == 9 and len(HOTBAR_PAGES[1]) == 9, "two pages of nine blocks")
check(all(IS_SOLID[block] is False for block in (0, 10, 16, 17, 18)), "air, water and plants are not solid")
check(all(not BLOCKS[block_id].solid or BLOCKS[block_id].hardness > 0 for block_id in range(1, 19)), "solid blocks are breakable")

# ------------------------------------------------------------------ cross-edition parity

section("web / python parity")
node = shutil.which("node")
if node and (ROOT / "web" / "generator.js").exists():
    script = (
        "import('" + str(ROOT / "web" / "generator.js") + "').then(({TerrainGenerator}) => {"
        " const g = new TerrainGenerator(" + str(SEED) + ");"
        " const probes = [[0,0],[7,-13],[-129,88],[400,-260],[13,13],[-7,7],[64,64],[-64,-64]];"
        " console.log(JSON.stringify(probes.map(([x,z]) => g.heightAt(x,z))));"
        "});"
    )
    result = subprocess.run([node, "-e", script], capture_output=True, text=True, timeout=60)
    if result.returncode == 0:
        web_heights = json.loads(result.stdout.strip())
        probes = [(0, 0), (7, -13), (-129, 88), (400, -260), (13, 13), (-7, 7), (64, 64), (-64, -64)]
        python_heights = [generator.height_at(x, z) for x, z in probes]
        check(python_heights == web_heights,
              f"both editions agree on the same seed ({python_heights} vs {web_heights})")
    else:
        print(f"  skip node probe failed: {result.stderr.strip()[:120]}")
else:
    print("  skip node is not installed; parity check skipped")

# ------------------------------------------------------------------ done

shutil.rmtree(SCRATCH, ignore_errors=True)
print()
if failures:
    print(f"python smoke test FAILED — {len(failures)} problem(s):")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("python smoke test passed — world, renderer, physics and saves all behave")
