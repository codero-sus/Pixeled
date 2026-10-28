"""Game state for the Python edition: the loop, editing rules, day cycle and saving.

Kept free of Tkinter so the whole game can be driven (and tested) headless — `python/pixeled.py`
is only the window around it.
"""

import math
import time

from . import audio, storage
from .blocks import AIR, HOTBAR, WATER, name_of
from .player import Player
from .raycast import placement_cell, raycast
from .renderer import SoftwareRenderer
from .ui import Hud
from .world import VoxelWorld

DAY_LENGTH = 480.0              # seconds for a full day/night cycle
CLOCK_START = 0.32              # morning
AUTOSAVE_EVERY = 25.0

class Game:
    """Owns the world, the player, the clock and everything the input layer can change."""

    def __init__(self, renderer, seed=None, hud=None):
        self.renderer = renderer
        self.hud = hud
        self.started = time.time()
        self.autosave_timer = AUTOSAVE_EVERY
        self.mined = 0
        self.placed = 0
        self.selected = 0
        self.clock = CLOCK_START
        self.frames = 0
        self.fps = 0.0
        self._fps_timer = time.time()
        self._fps_frames = 0
        self.walked = 0.0
        self.load_or_new(seed)

    # ------------------------------------------------------------------ worlds

    def load_or_new(self, seed=None):
        """Continue the saved world, or make a fresh random one."""
        document = None if seed is not None else storage.load()
        if document:
            world = VoxelWorld(document["seed"])
            world.apply_edits(document.get("edits", {}))
            player = Player(world)
            saved = document.get("player") or []
            if len(saved) == 5:
                player.x, player.y, player.z, player.yaw, player.pitch = saved
            self.selected = int(document.get("selected", 0)) % len(HOTBAR)
            self.clock = float(document.get("clock", CLOCK_START))
            self.notify("CONTINUING SEED %d" % world.seed)
        else:
            if seed is None:
                seed = storage.random_seed()
            world = VoxelWorld(seed)
            player = Player(world)
            self.clock = CLOCK_START
            self.notify("NEW WORLD SEED %d" % world.seed)
        self.world = world
        self.player = player
        if self.hud:
            self.hud.messages.clear()

    def new_world(self, seed=None):
        """Throw the old world away and generate a random one."""
        if seed is None:
            seed = storage.random_seed()
        storage.clear()
        self.world = VoxelWorld(seed)
        self.player = Player(self.world)
        self.selected = 0
        self.clock = CLOCK_START
        self.mined = 0
        self.placed = 0
        self.notify("NEW WORLD SEED %d" % seed)

    def save(self):
        payload = storage.build_payload(self.world, self.player, self.selected, self.clock)
        storage.save(payload)
        return payload

    def notify(self, message):
        if self.hud:
            self.hud.notify(message)
        return message

    # ------------------------------------------------------------------ loop

    def update(self, dt, controls):
        """One frame: clock, physics, autosave. `controls` is a dict of input flags."""
        dt = max(0.001, min(0.1, dt))
        self.clock = (self.clock + dt / DAY_LENGTH) % 1.0
        before = (self.player.x, self.player.z)
        fell = self.player.update(
            dt,
            controls.get("forward", 0),
            controls.get("right", 0),
            controls.get("jump", False),
            controls.get("crouch", False),
            controls.get("sprint", False),
            self.world,
        )
        moved = math.hypot(self.player.x - before[0], self.player.z - before[1])
        self.walked += moved
        if fell:
            self.notify("FELL OUT - BACK AT SPAWN")
            audio.hurt()
        self.autosave_timer -= dt
        if self.autosave_timer <= 0:
            self.autosave_timer = AUTOSAVE_EVERY
            self.save()
            self.notify("AUTOSAVED")
        if self.hud:
            self.hud.update(dt)
        self._fps_frames += 1
        self.frames += 1
        now = time.time()
        if now - self._fps_timer >= 0.5:
            self.fps = self._fps_frames / (now - self._fps_timer)
            self._fps_timer = now
            self._fps_frames = 0

    def elapsed(self):
        return time.time() - self.started

    # ------------------------------------------------------------------ actions

    def look(self, delta_yaw, delta_pitch):
        self.player.look(delta_yaw, delta_pitch)

    def target(self):
        """The block the crosshair is on, with its face and distance."""
        return raycast(self.world, self.player.eye, self.player.direction(), 6.5, False)

    def mine(self):
        """Remove the block being aimed at (if it is in reach and not the bedrock)."""
        hit = self.target()
        if hit is None:
            return None
        if not self.player.reaches(hit["x"], hit["y"], hit["z"]):
            return None
        if hit["y"] <= 0:
            self.notify("BEDROCK IS UNBREAKABLE")
            return None
        self.world.set(hit["x"], hit["y"], hit["z"], AIR)
        self.mined += 1
        audio.mine(hit["id"])
        return hit

    def place(self, block_id=None):
        """Put the selected block on the face in front of the crosshair."""
        if block_id is None:
            block_id = HOTBAR[self.selected]
        hit = self.target()
        if hit is None:
            return None
        cell = placement_cell(hit)
        if not self.world.inside(*cell):
            return None
        if self.player.overlaps(*cell):
            self.notify("THAT IS WHERE YOU STAND")
            return None
        if self.world.get(*cell) not in (AIR, WATER):
            return None
        self.world.set(cell[0], cell[1], cell[2], block_id)
        self.placed += 1
        audio.place(block_id)
        return cell

    def pick(self):
        """Middle click: copy the aimed block into the hotbar."""
        hit = self.target()
        if hit is None:
            return None
        if hit["id"] in HOTBAR:
            self.selected = HOTBAR.index(hit["id"])
            self.notify("PICKED " + name_of(hit["id"]).upper())
        else:
            self.notify("%s IS NOT PLACEABLE" % name_of(hit["id"]).upper())
        return hit

    def select(self, index):
        if 0 <= index < len(HOTBAR):
            self.selected = index
        return self.selected

    def wheel(self, direction):
        self.selected = (self.selected + (1 if direction > 0 else -1)) % len(HOTBAR)
        return self.selected

    def toggle_fly(self):
        self.player.flying = not self.player.flying
        self.player.velocity_y = 0.0
        self.notify("FLYING" if self.player.flying else "WALKING")
        return self.player.flying

    def skip_time(self, hours=2):
        self.clock = (self.clock + hours / 24.0) % 1.0
        return self.clock

    # ------------------------------------------------------------------ rendering

    def draw(self):
        """Render the world and lay the HUD on top; returns the RGB buffer."""
        hit = self.target()
        target = (hit["x"], hit["y"], hit["z"]) if hit else None
        self.renderer.render(self.world, self.player, clock=self.clock, target=target,
                             time=self.elapsed())
        if self.hud:
            hud = self.hud
            hud.stats(self.world.seed, (int(self.player.x), int(self.player.y), int(self.player.z)),
                      self.world.biome_name(self.player.x, self.player.z).upper(), self.fps,
                      self.player.flying)
            hud.minimap(self.world, self.player)
            hud.crosshair()
            hud.highlight_note(hit)
            hud.hotbar(self.selected)
            hud.selected_name(self.selected)
            hud.toasts()
            if hud.help_visible:
                hud.help()
        return self.renderer.buffer


def default_renderer(width=224, height=126):
    return SoftwareRenderer(width, height)


def headless_frames(seed=None, width=224, height=126, frames=1, clock=None, forward=0, hud=True):
    """Build a game without any window and render a few frames: used by tests and --render."""
    renderer = SoftwareRenderer(width, height)
    game = Game(renderer, seed=seed, hud=Hud(renderer) if hud else None)
    if clock is not None:
        game.clock = clock
    for _ in range(max(1, frames)):
        game.update(1.0 / 30.0, {"forward": forward})
    return game, game.draw()
