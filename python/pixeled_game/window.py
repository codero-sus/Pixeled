"""The Tkinter window around the Python edition: input bindings and frame pacing.

Everything interesting lives in :mod:`pixeled_game.game`; this module only turns Tk events into
game actions and blits the RGB frame into a canvas photo image. Tk has no pointer lock, so
looking around works by dragging with any mouse button held.
"""

import base64
import time

try:                                    # Tkinter ships with most Python builds, but not all
    import tkinter as tk
except ImportError as error:            # pragma: no cover - depends on the Python build
    tk = None
    TK_IMPORT_ERROR = error
else:
    TK_IMPORT_ERROR = None

from .game import Game, headless_frames
from .image import write_png
from .renderer import SoftwareRenderer
from .ui import Hud

LOOK_SENSITIVITY = 0.006
TARGET_FPS = 24


class Window:
    """Owns the Tk root, the canvas, the bindings and the frame loop."""

    def __init__(self, seed=None, width=224, height=126, scale=3, fps=TARGET_FPS, save=True):
        self.root = tk.Tk()
        self.root.title("Pixeled - 3D voxel sandbox (Python edition)")
        self.root.configure(bg="#0b0f16")
        self.renderer = SoftwareRenderer(width, height, distance=96.0)
        self.fps_target = fps
        self.save_enabled = save
        self.game = Game(self.renderer, seed=seed, hud=Hud(self.renderer))
        self.scale = max(1, int(scale))
        self.canvas = tk.Canvas(self.root, width=width * self.scale, height=height * self.scale,
                                highlightthickness=0, bg="#0b0f16")
        self.canvas.pack()
        self._photo = None
        self._image_id = None
        self._image_format = None
        self._keys = set()
        self._pressed = {}
        self._last = time.time()
        self._accumulator = 0.0
        self._blit_mode = "data"
        self._drag = None
        self._bind()
        self.screenshot_count = 0

    # ------------------------------------------------------------------ bindings

    def _bind(self):
        root = self.root
        root.bind("<KeyPress>", self._on_key_down)
        root.bind("<KeyRelease>", self._on_key_up)
        self.canvas.bind("<ButtonPress-1>", lambda event: self._on_click(event, 1))
        self.canvas.bind("<ButtonPress-3>", lambda event: self._on_click(event, 3))
        self.canvas.bind("<ButtonPress-2>", lambda event: self._on_click(event, 2))
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<B3-Motion>", self._on_drag)
        self.canvas.bind("<B2-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease>", self._on_release)
        root.bind("<MouseWheel>", lambda event: self._on_wheel(event.delta))
        root.bind("<Button-4>", lambda _event: self._on_wheel(1))
        root.bind("<Button-5>", lambda _event: self._on_wheel(-1))
        root.bind("<Escape>", lambda _event: self.quit())
        root.protocol("WM_DELETE_WINDOW", self.quit)

    def _on_key_down(self, event):
        name = event.keysym.lower()
        if name in self._keys:
            return
        self._keys.add(name)
        self._pressed[name] = time.time()
        if name in ("1", "2", "3", "4", "5", "6", "7", "8", "9"):
            self.game.select(int(name) - 1)
        elif name == "f":
            self.game.toggle_fly()
        elif name == "h":
            self.game.hud.help_visible = not self.game.hud.help_visible
        elif name == "n":
            self.game.new_world()
            if self.save_enabled:
                self.game.save()
        elif name == "t":
            self.game.skip_time(2)
            self.game.notify("TIME %.0f:00" % (self.game.clock * 24))
        elif name == "p":
            self.snapshot()
        elif name == "s" and (event.state & 0x4):
            self.game.save()
            self.game.notify("SAVED")

    def _on_key_up(self, event):
        self._keys.discard(event.keysym.lower())

    def _on_click(self, event, button):
        self.canvas.focus_set()
        self._drag = (event.x, event.y)
        if button == 1:
            self.game.mine()
        elif button == 3:
            self.game.place()
        else:
            self.game.pick()

    def _on_drag(self, event):
        if self._drag is None:
            self._drag = (event.x, event.y)
            return
        delta_x = event.x - self._drag[0]
        delta_y = event.y - self._drag[1]
        self._drag = (event.x, event.y)
        self.game.look(delta_x * LOOK_SENSITIVITY, delta_y * LOOK_SENSITIVITY)

    def _on_release(self, _event):
        self._drag = None

    def _on_wheel(self, delta):
        self.game.wheel(1 if delta > 0 else -1)

    # ------------------------------------------------------------------ controls

    def controls(self):
        """Translate the held keys into the movement flags the game expects."""
        keys = self._keys
        forward = int("w" in keys or "up" in keys) - int("s" in keys or "down" in keys)
        right = int("d" in keys or "right" in keys) - int("a" in keys or "left" in keys)
        return {
            "forward": forward,
            "right": right,
            "jump": "space" in keys,
            "crouch": "shift_l" in keys or "shift_r" in keys,
            "sprint": "ctrl_l" in keys or "ctrl_r" in keys,
        }

    # ------------------------------------------------------------------ frames

    def blit(self, buffer):
        """Push the RGB buffer into the canvas photo image."""
        ppm = write_ppm_to_memory(buffer, self.renderer.width, self.renderer.height)
        if self._blit_mode == "data":
            try:
                self._photo = tk.PhotoImage(master=self.root, data=ppm)
            except Exception:
                self._blit_mode = "put"
        if self._blit_mode == "put":
            if self._photo is None:
                self._photo = tk.PhotoImage(master=self.root, width=self.renderer.width,
                                            height=self.renderer.height)
            self._photo.put(base64.b16encode(bytes(buffer)).decode("ascii"), format="RGB")
        if self._image_id is None:
            self._image_id = self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        else:
            self.canvas.itemconfig(self._image_id, image=self._photo)

    def snapshot(self, path=None):
        """Write the current frame to a PNG next to the working directory."""
        self.screenshot_count += 1
        path = path or "pixeled-%03d.png" % self.screenshot_count
        write_png(path, self.renderer.buffer, self.renderer.width, self.renderer.height)
        self.game.notify("SCREENSHOT " + path)
        return path

    def step(self):
        """One frame: update the game by real elapsed time, then redraw."""
        now = time.time()
        dt = now - self._last
        self._last = now
        self.game.update(dt, self.controls())
        self.blit(self.game.draw())

    def loop(self):
        """Schedule the next frame and keep the frame rate near the target."""
        try:
            self.step()
        except tk.TclError:
            return
        target = 1.0 / max(1, self.fps_target)
        elapsed = time.time() - self._last
        delay = max(1, int((target - elapsed) * 1000))
        self.root.after(delay, self.loop)

    def run(self):
        self.root.after(60, self.loop)
        self.root.mainloop()

    def quit(self):
        if self.save_enabled:
            try:
                self.game.save()
            except OSError:
                pass
        try:
            self.root.destroy()
        except tk.TclError:
            pass


def write_ppm_to_memory(buffer, width, height):
    """A PPM image in memory — Tk 8.6 reads this straight from a bytes object."""
    return ("P6\n%d %d\n255\n" % (width, height)).encode("ascii") + bytes(buffer)


def require_tk():
    """Fail with advice instead of a bare ImportError when Tkinter is missing."""
    if tk is None:
        raise RuntimeError(
            "Pixeled needs Tkinter for its window (%s). Install it (Debian/Ubuntu: sudo apt "
            "install python3-tk, macOS: brew install python-tk, Windows: re-run the Python "
            "installer and tick tcl/tk), or use --render FILE for a headless screenshot."
            % TK_IMPORT_ERROR)
    return tk
