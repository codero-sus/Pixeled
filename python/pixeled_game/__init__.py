"""Pixeled — a cozy 3D voxel sandbox (Python/Tkinter edition).

The edition is split into small, single-purpose modules:

* :mod:`pixeled_game.noise`     — deterministic, seedable noise (shared maths with the web edition).
* :mod:`pixeled_game.blocks`    — the block palette, tile colours and physical flags.
* :mod:`pixeled_game.generator` — terrain, biomes, caves and decoration.
* :mod:`pixeled_game.world`     — chunks, block access, raycasting and spawning.
* :mod:`pixeled_game.mesher`    — visible faces with baked shading.
* :mod:`pixeled_game.renderer`  — the software 3D painter: projection, culling, fog.
* :mod:`pixeled_game.player`    — movement, gravity, swimming and block collision.
* :mod:`pixeled_game.storage`   — the JSON save file.
* :mod:`pixeled_game.app`       — window, input, interface and the game loop.
"""

__all__ = [
    "app", "blocks", "generator", "mesher", "noise", "player", "renderer", "storage", "world",
]
__version__ = "2.0"
