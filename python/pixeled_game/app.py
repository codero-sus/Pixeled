"""The Tkinter application: window, key bindings, interface and the game loop.

Tkinter has no 3D, so the world is drawn by :mod:`pixeled_game.renderer` — every visible face is
projected and painted back to front on a canvas. The interface (hotbar, status bar, crosshair,
pause menu) is drawn on top of it with canvas items, which keeps the whole game in one window.
"""

from __future__ import annotations

import math
import platform
import time
import tkinter as tk
from tkinter import font as tkfont

from . import storage
from .blocks import BLOCKS, DEFAULT_SETTINGS, HOTBAR_PAGES, SEA_LEVEL
from .noise import parse_seed, random_seed, seed_label
from .player import PlayerModel
from .renderer import SceneRenderer, TkPainter, shade
from .world import VoxelWorld

REACH = 6.0
HOTBAR_SLOTS = 9
DAY_LENGTH = 600.0


class PixeledApp:
    """The whole game: state, interface and the frame loop."""

    def __init__(self, root: tk.Tk, seed: int | None = None):
        self.root = root
        self.settings = storage.load_settings(DEFAULT_SETTINGS)
        self.saved = storage.load_world()
        self.seed = seed if seed is not None else (self.saved["seed"] if self.saved else random_seed())

        self.world = VoxelWorld(self.seed, dict(self.saved["edits"]) if self.saved else {})
        spawn = self.world.find_spawn(0, 0)
        self.player = PlayerModel(self.world, spawn)
        if self.saved and self.saved.get("player"):
            self.player.restore(self.saved["player"])
        self.blocks_placed = self.saved["blocks_placed"] if self.saved else 0
        self.minutes_played = self.saved["minutes"] if self.saved else 0.0
        self.time_of_day = self.saved["time_of_day"] if self.saved else self.settings["time_of_day"]

        self.renderer = SceneRenderer(self.world, self.settings)
        self.renderer.stream_chunks(self.player)

        self.width = 960
        self.height = 600
        self.canvas = tk.Canvas(root, width=self.width, height=self.height, highlightthickness=0, bg="#9fc6e8")
        self.canvas.pack(fill="both", expand=True)
        self.painter = TkPainter(self.canvas, self.width, self.height)

        self.keys: set[str] = set()
        self.page = 0
        self.selected = 0
        self.paused = True
        self.third_person = False
        self.break_target = None
        self.break_progress = 0.0
        self.break_key = None
        self.mouse_locked = False
        self.dragging = False
        self.last_mouse = (0, 0)
        self.status = "Click the world to play · Esc pauses"
        self.toast_text = ""
        self.toast_until = 0.0
        self.fps = 0.0
        self.frames = 0
        self.fps_timer = 0.0
        self.last_frame = time.perf_counter()
        self.last_save = time.perf_counter()
        self.hud_items: list[int] = []

        self.build_overlay()
        self.bind_events()
        self.canvas.focus_set()
        self.tick()

    # ------------------------------------------------------------------ window

    def build_overlay(self):
        """Create the items drawn on top of the world once, then only update their text."""
        self.overlay_font = tkfont.Font(family="Courier", size=11, weight="bold")
        self.small_font = tkfont.Font(family="Courier", size=9)
        self.crosshair = [
            self.canvas.create_line(0, 0, 0, 0, fill="#ffffff", width=2),
            self.canvas.create_line(0, 0, 0, 0, fill="#ffffff", width=2),
        ]

    def bind_events(self):
        canvas = self.canvas
        canvas.bind("<KeyPress>", self.on_key_down)
        canvas.bind("<KeyRelease>", self.on_key_up)
        canvas.bind("<Button-1>", self.on_mouse_down)
        canvas.bind("<ButtonRelease-1>", self.on_mouse_up)
        canvas.bind("<Button-3>", self.on_right_click)
        canvas.bind("<Button-2>", self.on_pick)
        canvas.bind("<Motion>", self.on_motion)
        canvas.bind("<MouseWheel>", self.on_wheel)
        canvas.bind("<Button-4>", lambda event: self.cycle_selection(1))
        canvas.bind("<Button-5>", lambda event: self.cycle_selection(-1))
        canvas.bind("<Configure>", self.on_resize)
        self.root.bind("<Escape>", lambda event: self.set_paused(True))
        self.root.protocol("WM_DELETE_WINDOW", self.quit)

    def on_resize(self, event):
        self.width = max(320, event.width)
        self.height = max(240, event.height)

    # ------------------------------------------------------------------ input

    def on_key_down(self, event):
        key = event.keysym.lower()
        self.keys.add(key)
        if key == "escape":
            self.set_paused(True)
        elif key == "f":
            self.toggle_fly()
        elif key == "v":
            self.third_person = not self.third_person
            self.toast("Third person" if self.third_person else "First person")
        elif key == "e":
            self.page = (self.page + 1) % len(HOTBAR_PAGES)
            self.toast(f"Blocks page {self.page + 1} of {len(HOTBAR_PAGES)}")
        elif key == "space":
            self.player.jump()
        elif key in [str(number) for number in range(1, 10)]:
            self.selected = int(key) - 1
        elif key == "r":
            self.player.respawn()
            self.toast("Back to the surface")

    def on_key_up(self, event):
        self.keys.discard(event.keysym.lower())

    def on_mouse_down(self, event):
        self.canvas.focus_set()
        if self.paused:
            self.set_paused(False)
            return
        self.dragging = True
        self.last_mouse = (event.x, event.y)
        hit = self.current_target()
        if hit:
            self.break_block(hit)

    def on_mouse_up(self, event):
        self.dragging = False

    def on_right_click(self, event):
        if self.paused:
            self.set_paused(False)
            return
        hit = self.current_target()
        if hit:
            self.place_block(hit)

    def on_pick(self, event):
        hit = self.current_target()
        if not hit:
            return
        for page, blocks in enumerate(HOTBAR_PAGES):
            if hit.block in blocks:
                self.page = page
                self.selected = blocks.index(hit.block)
                self.toast(BLOCKS[hit.block].name)
                return
        self.toast("That block is not in your hotbar")

    def on_motion(self, event):
        if self.paused or not self.dragging:
            self.last_mouse = (event.x, event.y)
            return
        delta_x = event.x - self.last_mouse[0]
        delta_y = event.y - self.last_mouse[1]
        self.last_mouse = (event.x, event.y)
        sensitivity = self.settings["sensitivity"] * 6
        self.player.look(delta_x * sensitivity, delta_y * sensitivity)

    def on_wheel(self, event):
        self.cycle_selection(1 if event.delta > 0 else -1)

    def cycle_selection(self, delta):
        self.selected = (self.selected + delta) % HOTBAR_SLOTS

    def set_paused(self, paused: bool):
        self.paused = paused
        self.status = "Click the world to play · Esc pauses" if paused else "WASD move · click dig · right click place"
        if paused:
            self.save()

    def toggle_fly(self):
        if not self.settings.get("creative"):
            self.toast("Flying needs creative mode")
            return
        flying = self.player.toggle_fly(True)
        self.toast("Flying — space up, shift down" if flying else "Back on your feet")

    # ------------------------------------------------------------------ interaction

    def move_input(self):
        keys = self.keys
        return {
            "forward": 1 if "w" in keys else 0,
            "back": 1 if "s" in keys else 0,
            "left": 1 if "a" in keys else 0,
            "right": 1 if "d" in keys else 0,
            "jump": "space" in keys,
            "sneak": "shift" in keys,
            "sprint": "control" in keys,
        }

    def current_target(self):
        eye = self.player.eye()
        return self.world.raycast((eye["x"], eye["y"], eye["z"]), self.player.direction(), REACH)

    def break_block(self, hit):
        block = BLOCKS[hit.block]
        if not self.world.set_block(hit.x, hit.y, hit.z, 0):
            return
        self.renderer.mark_block_dirty(hit.x, hit.z)
        self.toast(f"Dug {block.name.lower()}")
        self.schedule_save()

    def place_block(self, hit):
        x = hit.x + hit.normal[0]
        y = hit.y + hit.normal[1]
        z = hit.z + hit.normal[2]
        if y < 0 or y >= 96:
            return
        block_id = HOTBAR_PAGES[self.page][self.selected]
        existing = self.world.get_block(x, y, z)
        if existing not in (0, 10):
            return
        half = 0.32
        p = self.player.position
        overlaps = (
            p["x"] + half > x and p["x"] - half < x + 1
            and p["z"] + half > z and p["z"] - half < z + 1
            and p["y"] + 1.7 > y and p["y"] < y + 1
        )
        if overlaps and BLOCKS[block_id].solid:
            self.toast("Make a little room first")
            return
        if not self.world.set_block(x, y, z, block_id):
            return
        self.renderer.mark_block_dirty(x, z)
        self.blocks_placed += 1
        self.toast(f"Placed {BLOCKS[block_id].name.lower()}")
        self.schedule_save()

    def new_world(self, seed_text: str = ""):
        parsed = parse_seed(seed_text)
        self.seed = parsed if parsed is not None else random_seed()
        self.world = VoxelWorld(self.seed)
        spawn = self.world.find_spawn(0, 0)
        self.player = PlayerModel(self.world, spawn)
        self.renderer.set_world(self.world)
        self.renderer.stream_chunks(self.player)
        self.blocks_placed = 0
        self.minutes_played = 0.0
        self.time_of_day = 0.32
        storage.clear_world()
        self.toast(f"New world · seed {self.seed_label}")
        self.save()

    # ------------------------------------------------------------------ saving

    @property
    def seed_label(self) -> str:
        return f"{self.seed} ({seed_label(self.seed)})"

    def schedule_save(self):
        """Save on the next loop (used right after the player changes a block)."""
        self.last_save = 0.0

    def save(self):
        storage.save_world(self.seed, self.player.serialize(), self.world.edits, self.blocks_placed,
                           self.minutes_played, self.time_of_day)
        storage.save_settings(self.settings)

    def quit(self):
        self.save()
        self.root.destroy()

    # ------------------------------------------------------------------ interface

    def toast(self, text: str):
        self.toast_text = text
        self.toast_until = time.perf_counter() + 2.0

    def selected_block(self) -> int:
        return HOTBAR_PAGES[self.page][self.selected]

    def draw_hud(self, polygons_drawn: int, daylight: float):
        canvas = self.canvas
        for item in self.hud_items:
            canvas.delete(item)
        self.hud_items = []
        width, height = self.width, self.height

        # crosshair
        colour = "#ffffff"
        self.hud_items.append(canvas.create_line(width / 2 - 9, height / 2, width / 2 + 9, height / 2, fill=colour, width=2))
        self.hud_items.append(canvas.create_line(width / 2, height / 2 - 9, width / 2, height / 2 + 9, fill=colour, width=2))
        if self.break_progress > 0:
            self.hud_items.append(canvas.create_rectangle(
                width / 2 - 30, height / 2 + 18, width / 2 - 30 + 60 * min(1.0, self.break_progress), height / 2 + 22,
                fill="#b3df9e", outline=""))

        # status bar
        biome = self.world.generator.biome_at(int(self.player.position["x"]), int(self.player.position["z"]))
        clock = self.clock_text()
        position = self.player.position
        left = f"{biome}   {position['x']:.1f} {position['y']:.1f} {position['z']:.1f}"
        right = f"{clock}  {self.phase_name()}  {self.fps:.0f} fps  {len(self.renderer.chunk_faces)} chunks  seed {self.seed}"
        self.hud_items.append(canvas.create_rectangle(0, 0, width, 26, fill="#0e1a26", outline=""))
        self.hud_items.append(canvas.create_text(10, 13, text=left, fill="#eef3ea", anchor="w", font=self.overlay_font))
        self.hud_items.append(canvas.create_text(width - 10, 13, text=right, fill="#b3df9e", anchor="e", font=self.overlay_font))

        # hotbar
        slot_width, slot_height = 54, 46
        total = slot_width * HOTBAR_SLOTS
        start_x = (width - total) / 2
        start_y = height - slot_height - 16
        for slot in range(HOTBAR_SLOTS):
            block_id = HOTBAR_PAGES[self.page][slot]
            block = BLOCKS[block_id]
            x0 = start_x + slot * slot_width
            active = slot == self.selected
            self.hud_items.append(canvas.create_rectangle(
                x0 + 2, start_y, x0 + slot_width - 2, start_y + slot_height,
                fill="#3a5540" if active else "#16232e", outline="#b3df9e" if active else "#2b3b47", width=2 if active else 1))
            self.hud_items.append(canvas.create_rectangle(
                x0 + 8, start_y + 6, x0 + slot_width - 8, start_y + 30,
                fill=block.color("top"), outline=shade(block.color("top"), 0.6)))
            self.hud_items.append(canvas.create_text(
                x0 + slot_width / 2, start_y + 38, text=f"{slot + 1} {block.name}", fill="#eef3ea",
                anchor="center", font=self.small_font))
        self.hud_items.append(canvas.create_text(
            width / 2, start_y - 12, text=f"{BLOCKS[self.selected_block()].name}  ·  seed {self.seed}  ·  {polygons_drawn} faces",
            fill="#ffffff", anchor="center", font=self.overlay_font))

        # target label + toast
        hit = self.current_target()
        if hit:
            self.hud_items.append(canvas.create_text(
                width / 2, height / 2 - 24, text=BLOCKS[hit.block].name, fill="#ffffff", anchor="center",
                font=self.small_font))
        if self.toast_text and time.perf_counter() < self.toast_until:
            self.hud_items.append(canvas.create_rectangle(
                width / 2 - 130, height - 150, width / 2 + 130, height - 122, fill="#0e1a26", outline="#2b3b47"))
            self.hud_items.append(canvas.create_text(
                width / 2, height - 136, text=self.toast_text, fill="#eef3ea", anchor="center", font=self.overlay_font))

        if self.paused:
            self.draw_pause_menu()
        elif self.status:
            self.hud_items.append(canvas.create_text(
                width / 2, 44, text=self.status, fill="#eef3ea", anchor="center", font=self.small_font))

    def draw_pause_menu(self):
        canvas = self.canvas
        width, height = self.width, self.height
        panel_width, panel_height = 460, 300
        x0 = (width - panel_width) / 2
        y0 = (height - panel_height) / 2
        self.hud_items.append(canvas.create_rectangle(x0, y0, x0 + panel_width, y0 + panel_height,
                                                      fill="#0d1a26", outline="#2b3b47", width=2))
        lines = [
            ("Pixeled", self.overlay_font, "#b3df9e"),
            (f"seed {self.seed}", self.small_font, "#9fb0ae"),
            ("", self.small_font, "#9fb0ae"),
            ("W A S D  move        Space  jump / fly up", self.small_font, "#eef3ea"),
            ("Shift  sneak         Ctrl   sprint", self.small_font, "#eef3ea"),
            ("Mouse drag  look     Click  dig", self.small_font, "#eef3ea"),
            ("Right click  place   Middle click  pick block", self.small_font, "#eef3ea"),
            ("1-9 / wheel  choose  E  change block page", self.small_font, "#eef3ea"),
            ("F  fly   R  respawn   V  camera   Esc  pause", self.small_font, "#eef3ea"),
            ("", self.small_font, "#9fb0ae"),
            ("Click to play · N for a brand-new world", self.overlay_font, "#b3df9e"),
        ]
        y = y0 + 26
        for text, font, colour in lines:
            self.hud_items.append(canvas.create_text(width / 2, y, text=text, fill=colour, anchor="center", font=font))
            y += 24

    # ------------------------------------------------------------------ clock

    def clock_text(self) -> str:
        total = int(self.time_of_day * 24 * 60)
        return f"{total // 60:02d}:{total % 60:02d}"

    def phase_name(self) -> str:
        if self.time_of_day < 0.22:
            return "Night"
        if self.time_of_day < 0.30:
            return "Dawn"
        if self.time_of_day < 0.66:
            return "Daytime"
        if self.time_of_day < 0.78:
            return "Dusk"
        return "Night"

    def daylight(self) -> float:
        angle = (self.time_of_day - 0.25) * math.pi * 2
        return max(0.0, min(1.0, math.sin(angle) * 1.6 + 0.28))

    def sky_color(self) -> str:
        light = self.daylight()
        night = (10, 16, 32)
        day = (159, 198, 232)
        red = int(night[0] + (day[0] - night[0]) * light)
        green = int(night[1] + (day[1] - night[1]) * light)
        blue = int(night[2] + (day[2] - night[2]) * light)
        return f"#{red:02x}{green:02x}{blue:02x}"

    # ------------------------------------------------------------------ the loop

    def tick(self):
        now = time.perf_counter()
        dt = min(0.05, now - self.last_frame or 0.016)
        self.last_frame = now

        if not self.paused:
            self.player.update(dt, self.move_input())
            self.update_breaking(dt)
            if self.settings.get("day_cycle", True):
                self.time_of_day = (self.time_of_day + dt / self.settings.get("day_length", DAY_LENGTH)) % 1
            self.minutes_played += dt / 60
            if now - getattr(self, "last_save", now) > 20:
                self.save()
                self.last_save = now
            if self.player.position["y"] < -4:
                self.player.respawn()

        self.renderer.stream_chunks(self.player)
        light = self.daylight()
        polygons = self.renderer.frame(self.player, self.width, self.height,
                                       sky_color=self.sky_color(), fog_color=self.sky_color(), daylight=light)
        self.painter.set_sky(self.sky_color())
        self.painter.begin()
        for _distance, screen, colour, kind in polygons:
            self.painter.polygon(screen, colour, "")
        self.painter.end()

        self.frames += 1
        self.fps_timer += dt
        if self.fps_timer >= 0.5:
            self.fps = self.frames / self.fps_timer
            self.frames = 0
            self.fps_timer = 0

        self.draw_hud(len(polygons), light)
        self.root.after(16, self.tick)

    def update_breaking(self, dt):
        if not self.dragging:
            self.break_progress = 0.0
            self.break_key = None
            return
        hit = self.current_target()
        if not hit:
            self.break_progress = 0.0
            self.break_key = None
            return
        key = (hit.x, hit.y, hit.z)
        if key != self.break_key:
            self.break_key = key
            self.break_progress = 0.0
        hardness = 0.18 if self.settings.get("creative") else max(0.12, self.world.hardness_of(hit.block))
        self.break_progress += dt / hardness
        if self.break_progress >= 1.0:
            self.break_block(hit)
            self.break_progress = 0.0
            self.break_key = None


def run(seed: int | None = None) -> int:
    """Start the game. Returns a process exit code."""
    try:
        root = tk.Tk()
    except tk.TclError as error:      # pragma: no cover - depends on the machine
        print("Pixeled could not open a window:", error)
        print("This edition needs a graphical desktop (Tkinter). On a headless machine, try:")
        print("  python3 tests/python_smoke.py     # the world and physics without a window")
        return 1

    root.title("Pixeled — a 3D voxel world")
    root.minsize(640, 420)
    app = PixeledApp(root, seed)
    root.bind("<n>", lambda event: app.new_world())
    if platform.system() == "Darwin":
        root.tk.call("tk", "windowingsystem")  # keeps Tk happy on macOS
    root.mainloop()
    return 0
