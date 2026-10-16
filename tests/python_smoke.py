#!/usr/bin/env python3
"""Smoke test for the Python edition (3D raycaster) — standard library only, no window.

Run it with:

    python3 tests/python_smoke.py

It checks the shared contracts (noise parity with the web edition, world generation, the terrain
formula, the ray caster, the player sweep and step-up), then drives a whole game headlessly and
round-trips a save file.
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

from pixeled_game import storage                                    # noqa: E402
from pixeled_game.blocks import (                                   # noqa: E402
    AIR, GRASS, HOTBAR, LEAVES, LOG, SEA_LEVEL, SNOW, STONE, WATER,
    WORLD_X, WORLD_Y, WORLD_Z, is_solid_id, name_of,
)
from pixeled_game.game import Game, headless_frames                 # noqa: E402
from pixeled_game.image import write_png                            # noqa: E402
from pixeled_game.noise import Noise, hash_coords                   # noqa: E402
from pixeled_game.player import Player                              # noqa: E402
from pixeled_game.raycast import placement_cell, raycast             # noqa: E402
from pixeled_game.renderer import SoftwareRenderer, sky_palette      # noqa: E402
from pixeled_game.ui import Hud                                     # noqa: E402
from pixeled_game.world import VoxelWorld                           # noqa: E402


def skyline(world):
    """Sample of the surface profile, used to prove that different seeds differ."""
    return [world.surface_height(x * 2 + 4, 30) for x in range(48)]


class NoiseTests(unittest.TestCase):
    """The noise must be byte-for-byte the same contract as web/noise.js."""

    def test_known_values(self):
        noise = Noise(2408)
        self.assertAlmostEqual(noise.fbm2(0.5, 0.5, 5), 0.482606, places=6)
        self.assertAlmostEqual(noise.value3(1.5, 2.5, 3.5), 0.446569, places=6)
        self.assertAlmostEqual(hash_coords(3, 4, 5, 2408), 0.028467, places=6)

    def test_range_and_seed_changes(self):
        first, second = Noise(1), Noise(2)
        for index in range(1, 60):
            value = first.fbm2(index * 0.37, index * 0.11, 3)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)
        self.assertNotAlmostEqual(first.fbm2(0.3, 0.7, 4), second.fbm2(0.3, 0.7, 4), places=6)


class WorldTests(unittest.TestCase):
    def setUp(self):
        self.world = VoxelWorld(2408)

    def test_dimensions_and_layers(self):
        self.assertEqual((WORLD_X, WORLD_Y, WORLD_Z), (96, 48, 96))
        self.assertEqual(len(self.world.data), WORLD_X * WORLD_Y * WORLD_Z)
        surface, block_id, liquid = self.world.surface(53, 48)
        self.assertGreater(surface, SEA_LEVEL)
        self.assertTrue(is_solid_id(block_id))
        self.assertFalse(liquid)
        # Bedrock is stone and the column below the surface is solid all the way down.
        for y in range(0, surface):
            self.assertTrue(is_solid_id(self.world.get(53, y, 48)))

    def test_seed_is_reproducible(self):
        self.assertEqual(skyline(VoxelWorld(2408)), skyline(self.world))
        self.assertNotEqual(skyline(VoxelWorld(99)), skyline(self.world))

    def test_water_beaches_and_peaks(self):
        water = 0
        lowest, highest = WORLD_Y, 0
        for x in range(WORLD_X):
            for z in range(WORLD_Z):
                if self.world.water_top[x][z] >= 0:
                    water += 1
                height = self.world.surface_height(x, z)
                lowest = min(lowest, height)
                highest = max(highest, height)
        self.assertGreater(water, 200, "a world with a decent sea")
        self.assertGreater(highest - lowest, 18, "terrain has relief")
        self.assertGreaterEqual(lowest, 2)
        self.assertLessEqual(highest, WORLD_Y - 6)

    def test_trees_and_biomes(self):
        objects = self.world.objects
        self.assertGreater(len(objects), 40, "forested worlds have plenty of trees")
        logs = sum(1 for stack in objects.values() for _y, block_id in stack if block_id == LOG)
        leaves = sum(1 for stack in objects.values() for _y, block_id in stack if block_id == LEAVES)
        self.assertGreater(logs, 20)
        self.assertGreater(leaves, 60)
        names = {self.world.biome_name(x * 7, z * 7) for x in range(12) for z in range(12)}
        self.assertTrue(names <= {"plains", "forest", "desert", "snow"})
        self.assertGreater(len(names), 1, "a world usually shows more than one biome")

    def test_spawn_is_open_and_dry(self):
        x, y, z = self.world.spawn_point()
        column_x, column_z = int(x), int(z)
        surface, _block, liquid = self.world.surface(column_x, column_z)
        self.assertFalse(liquid)
        self.assertAlmostEqual(y, surface + 1, places=3)
        self.assertEqual(self.world.get(column_x, surface + 1, column_z), AIR)

    def test_set_and_edit_list(self):
        self.world.set(10, 40, 10, STONE)
        self.assertEqual(self.world.get(10, 40, 10), STONE)
        self.assertEqual(self.world.edits["10,40,10"], STONE)
        self.assertEqual(self.world.surface(10, 10)[0], 40)
        self.world.set(10, 40, 10, AIR)
        self.assertLess(self.world.surface(10, 10)[0], 40)


class RaycastTests(unittest.TestCase):
    def setUp(self):
        self.world = VoxelWorld(2408)

    def test_downwards_hit_and_place_cell(self):
        hit = raycast(self.world, (48.5, 44.0, 48.5), (0.0, -1.0, 0.0), 40.0)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["ny"], 1)
        self.assertEqual(hit["y"], self.world.surface(48, 48)[0])
        cell = placement_cell(hit)
        self.assertEqual(cell, (48, hit["y"] + 1, 48))

    def test_upwards_leaves_the_world_cleanly(self):
        self.assertIsNone(raycast(self.world, (48.5, 44.0, 48.5), (0.0, 1.0, 0.0), 40.0))

    def test_horizontal_reach_is_limited(self):
        self.assertIsNone(raycast(self.world, (48.5, 46.0, 48.5), (1.0, 0.0, 0.0), 2.0))


class PlayerTests(unittest.TestCase):
    def test_falls_to_the_ground_and_stands_still(self):
        world = VoxelWorld(2408)
        player = Player(world)
        start = player.y
        for _ in range(90):
            player.update(1 / 60, 0, 0, False, False, False, world)
        self.assertTrue(player.on_ground)
        self.assertLess(player.y, start + 0.01)
        self.assertFalse(player.collides(world))
        surface, _block, _liquid = world.surface(int(player.x), int(player.z))
        self.assertAlmostEqual(player.y, surface + 1, places=2)

    def test_jump_leaves_the_ground_and_lands(self):
        world = VoxelWorld(2408)
        player = Player(world)
        for _ in range(40):
            player.update(1 / 60, 0, 0, False, False, False, world)
        player.update(1 / 60, 0, 0, True, False, False, world)
        self.assertFalse(player.on_ground)
        for _ in range(120):
            player.update(1 / 60, 0, 0, False, False, False, world)
        self.assertTrue(player.on_ground)
        self.assertFalse(player.collides(world))

    def test_step_up_walks_onto_a_one_block_ledge_without_embedding(self):
        world = VoxelWorld(7)
        # A carved track with a single-block step at x = 12.
        for x in range(6, 17):
            for z in range(8, 15):
                for y in range(40, 45):
                    world.set(x, y, z, AIR)
                world.set(x, 39, z, STONE)
        for z in range(8, 15):
            for y in range(40, 45):
                world.set(12, y, z, AIR)
            world.set(12, 40, z, STONE)
        player = Player(world)
        player.x, player.y, player.z = 9.5, 40.02, 11.5
        player.yaw, player.pitch = -1.5707963, 0.0
        highest = player.y
        for _ in range(240):
            player.update(1 / 60, 1, 0, False, False, True, world)
            highest = max(highest, player.y)
            self.assertFalse(player.collides(world), "the box must never end up inside a block")
        self.assertGreater(highest, 40.9, "the walker steps up onto the ledge")
        self.assertGreater(player.x, 12.5, "and keeps going past it")
        self.assertTrue(player.on_ground)
        self.assertAlmostEqual(player.y, 40.0, places=1)

    def test_flight_holds_altitude_without_gravity(self):
        world = VoxelWorld(2408)
        player = Player(world)
        player.flying = True
        player.y += 6
        height = player.y
        for _ in range(60):
            player.update(1 / 60, 0, 0, False, False, False, world)
        self.assertAlmostEqual(player.y, height, places=4)


class RendererTests(unittest.TestCase):
    def test_frame_is_coloured_and_horizon_is_visible(self):
        game, buffer = headless_frames(seed=2408, width=160, height=90, frames=4)
        self.assertEqual(len(buffer), 160 * 90 * 3)
        colours = {tuple(buffer[i:i + 3]) for i in range(0, len(buffer), 3)}
        self.assertGreater(len(colours), 24, "frames are shaded, not flat")
        self.assertGreater(game.renderer.last_samples, 1000, "the terrain sweep painted terrain")

    def test_sky_palette_moves_through_the_day(self):
        noon = sky_palette(0.5)
        midnight = sky_palette(0.0)
        self.assertGreater(noon["day"], midnight["day"])
        self.assertGreater(noon["sun_direction"][1], midnight["sun_direction"][1])

    def test_hud_draws_over_a_frame(self):
        renderer = SoftwareRenderer(200, 112)
        hud = Hud(renderer)
        game = Game(renderer, seed=2408, hud=hud)
        hud.notify("HELLO WORLD")
        first = bytes(game.draw())
        hud.help_visible = True
        second = bytes(game.draw())
        self.assertEqual(len(first), 200 * 112 * 3)
        self.assertNotEqual(first, second, "the help overlay changes the frame")

    def test_png_writer_produces_a_readable_signature(self):
        game, buffer = headless_frames(seed=2408, width=64, height=36, frames=2)
        path = Path(tempfile.mkdtemp()) / "shot.png"
        write_png(path, buffer, 64, 36)
        data = path.read_bytes()
        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(data), 200)
        shutil.rmtree(path.parent, ignore_errors=True)


class GameTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.old_home = storage.SAVE_DIR, storage.SAVE_FILE
        storage.SAVE_DIR = os.path.join(self.home, ".pixeled")
        storage.SAVE_FILE = os.path.join(storage.SAVE_DIR, "world.json")
        self.renderer = SoftwareRenderer(96, 54)
        self.game = Game(self.renderer, seed=2408, hud=Hud(self.renderer))

    def tearDown(self):
        storage.SAVE_DIR, storage.SAVE_FILE = self.old_home
        shutil.rmtree(self.home, ignore_errors=True)

    def test_mining_and_placing_edit_the_world(self):
        self.game.player.pitch = -1.5
        self.game.player.y += 2
        hit = self.game.mine()
        self.assertIsNotNone(hit, "looking straight down mines the block below")
        self.assertEqual(self.game.world.get(hit["x"], hit["y"], hit["z"]), AIR)
        self.assertEqual(self.game.mined, 1)
        cell = self.game.place(GRASS)
        self.assertIsNotNone(cell)
        self.assertEqual(self.game.world.get(*cell), GRASS)
        self.assertEqual(self.game.placed, 1)

    def test_unbreakable_bedrock_and_hotbar_selection(self):
        world = self.game.world
        for y in range(1, 8):
            world.set(20, y, 20, AIR)
        self.game.player.x, self.game.player.y, self.game.player.z = 20.5, 4.6, 20.5
        self.game.player.pitch = -1.5
        aimed = self.game.target()
        self.assertIsNotNone(aimed, "the shaft is aimed at the bottom layer")
        self.assertEqual(aimed["y"], 0)
        self.assertIsNone(self.game.mine(), "the bottom layer cannot be mined")
        self.assertEqual(world.get(20, 0, 20), STONE)
        self.assertIn("BEDROCK", self.game.hud.messages[-1][0])
        for index in range(len(HOTBAR)):
            self.assertEqual(self.game.select(index), index)
        self.assertEqual(HOTBAR[self.game.selected], HOTBAR[len(HOTBAR) - 1])
        self.assertEqual(name_of(HOTBAR[0]), "Grass")
        self.game.wheel(1)
        self.assertEqual(self.game.selected, 0, "the wheel wraps around the hotbar")
        self.game.wheel(-1)
        self.assertEqual(self.game.selected, len(HOTBAR) - 1)
        self.game.select(0)

    def test_save_load_round_trip(self):
        self.game.player.x += 3.5
        self.game.clock = 0.61
        self.game.world.set(30, 40, 30, SNOW)
        payload = self.game.save()
        self.assertEqual(payload["seed"], 2408)
        reloaded = Game(self.renderer, hud=Hud(self.renderer))
        self.assertEqual(reloaded.world.seed, 2408)
        self.assertEqual(reloaded.world.get(30, 40, 30), SNOW)
        self.assertAlmostEqual(reloaded.player.x, self.game.player.x, places=3)
        self.assertAlmostEqual(reloaded.clock, 0.61, places=3)

    def test_new_world_is_random_and_forgets_the_save(self):
        first = self.game.world.seed
        self.game.new_world()
        second = self.game.world.seed
        self.assertNotEqual(first, second)
        self.assertIsNone(storage.load(), "a new world clears the save file")
        self.assertNotEqual(skyline(self.game.world), skyline(VoxelWorld(first)))

    def test_walking_forward_moves_the_player(self):
        start = (self.game.player.x, self.game.player.z)
        for _ in range(30):
            self.game.update(1 / 30, {"forward": 1})
        moved = abs(self.game.player.x - start[0]) + abs(self.game.player.z - start[1])
        self.assertGreater(moved, 0.4)
        self.assertFalse(self.game.player.collides(self.game.world))

    def test_fly_toggle_and_day_cycle(self):
        self.assertFalse(self.game.player.flying)
        self.assertTrue(self.game.toggle_fly())
        self.assertTrue(self.game.player.flying)
        self.game.player.flying = True
        before = self.game.clock
        self.game.skip_time(6)
        self.assertAlmostEqual(self.game.clock, (before + 0.25) % 1.0, places=4)
        height = self.game.player.y
        for _ in range(20):
            self.game.update(1 / 30, {})
        self.assertAlmostEqual(self.game.player.y, height, places=3, msg="flight holds altitude")


def main():
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("python smoke test passed — %d checks" % result.testsRun)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
