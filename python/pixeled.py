#!/usr/bin/env python3
"""Pixeled — Python/Tkinter edition launcher.

The game lives in the :mod:`pixeled_game` package next to this file: noise, blocks, generator,
world, mesher, renderer, player, storage and app. Tkinter has no 3D, so the world is drawn by a
hand-written software renderer (perspective projection, back-face culling, fog and a painter's
algorithm), which is why this edition has no dependencies at all.

    python3 pixeled.py                 # continue your saved world
    python3 pixeled.py 20261011        # start (or continue) a world with a given seed
    python3 pixeled.py "a lovely glade"  # text seeds work too

Run `python3 tests/python_smoke.py` for the headless tests (no window needed).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pixeled_game.app import run  # noqa: E402  (the path tweak must come first)


def main(argv: list[str]) -> int:
    seed = None
    if len(argv) > 1:
        from pixeled_game.noise import parse_seed

        seed = parse_seed(" ".join(argv[1:]))
    return run(seed)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
