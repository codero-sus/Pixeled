#!/usr/bin/env python3
"""Pixeled — a dependency-free 3D voxel sandbox (Python edition).

    python3 python/pixeled.py                 # play (Tkinter window)
    python3 python/pixeled.py --seed 1234     # start a specific world
    python3 python/pixeled.py --render shot.png   # headless screenshot, no window
    python3 python/pixeled.py --help

Every world is generated from a random seed the first time you play; the seed, your edits and
your position are stored in ``~/.pixeled/world.json`` so the next run continues where you left
off. Press N for a brand-new random world, H for the controls, P for a screenshot.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pixeled_game.image import write_png  # noqa: E402  (path tweak must come first)


def build_parser():
    parser = argparse.ArgumentParser(prog="pixeled", description="Pixeled - 3D voxel sandbox (Python edition)")
    parser.add_argument("--seed", type=int, default=None, help="world seed (default: the saved world, or a random one)")
    parser.add_argument("--width", type=int, default=224, help="render width in pixels (default 224)")
    parser.add_argument("--height", type=int, default=126, help="render height in pixels (default 126)")
    parser.add_argument("--scale", type=int, default=3, help="window zoom factor (default 3)")
    parser.add_argument("--fps", type=int, default=24, help="frame rate target (default 24)")
    parser.add_argument("--render", metavar="FILE", help="render one frame to a PNG and exit, no window")
    parser.add_argument("--frames", type=int, default=6, help="frames to simulate before --render writes (default 6)")
    parser.add_argument("--clock", type=float, default=None, help="time of day 0..1 for --render (0.5 is noon)")
    parser.add_argument("--no-save", action="store_true", help="do not read or write the save file")
    return parser


def main(argv=None):
    arguments = build_parser().parse_args(argv)

    if arguments.render:
        from pixeled_game.game import headless_frames
        game, buffer = headless_frames(
            seed=arguments.seed, width=arguments.width, height=arguments.height,
            frames=arguments.frames, clock=arguments.clock,
        )
        write_png(arguments.render, buffer, game.renderer.width, game.renderer.height)
        print("wrote %s  (seed %d, %s, %d blocks mined, %d placed)" % (
            arguments.render, game.world.seed, game.world.biome_name(game.player.x, game.player.z),
            game.mined, game.placed))
        return 0

    from pixeled_game import window as window_module
    try:
        window_module.require_tk()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    window = window_module.Window(seed=arguments.seed, width=arguments.width, height=arguments.height,
                                  scale=arguments.scale, fps=arguments.fps, save=not arguments.no_save)
    window.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
