"""Pixeled (Python edition) — a dependency-free 3D voxel sandbox.

The edition is split into small, single-purpose modules:

* :mod:`pixeled_game.blocks`   — the block palette and world metrics.
* :mod:`pixeled_game.noise`    — mulberry32 + value noise, identical to the web edition.
* :mod:`pixeled_game.world`    — terrain generation, block access, the render indices.
* :mod:`pixeled_game.raycast`  — voxel DDA used for aiming, mining and placing.
* :mod:`pixeled_game.player`   — AABB movement, gravity, flight and step-up.
* :mod:`pixeled_game.renderer` — the software 3D renderer (heightfield sweep + voxel cubes).
* :mod:`pixeled_game.ui`       — the bitmap-font HUD: hotbar, stats, minimap, help.
* :mod:`pixeled_game.game`     — game state, the loop, editing rules and the day cycle.
* :mod:`pixeled_game.storage`  — the JSON save file under ``~/.pixeled``.
* :mod:`pixeled_game.image`    — tiny PNG/PPM writers for screenshots and headless renders.
* :mod:`pixeled_game.audio`    — optional feedback sounds.
* :mod:`pixeled_game.window`   — the Tkinter window, input bindings and frame pacing.
"""

__all__ = [
    "audio", "blocks", "game", "image", "noise", "player", "raycast", "renderer",
    "storage", "ui", "window", "world",
]
__version__ = "3.0"
