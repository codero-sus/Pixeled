"""Saving — worlds and settings live in ``~/.pixeled``.

Only the seed, what the player changed and where they were standing are stored: everything else is
regenerated from the seed, so a save file stays tiny no matter how far you walk.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

SAVE_DIR = Path(os.environ.get("PIXELED_HOME", Path.home() / ".pixeled"))
WORLD_FILE = SAVE_DIR / "world.json"
SETTINGS_FILE = SAVE_DIR / "settings.json"


def _ensure_dir() -> None:
    try:
        SAVE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def save_world(seed: int, player_state: dict, edits: dict, blocks_placed: int, minutes: float, time_of_day: float) -> bool:
    """Write the world. Failures are reported, never fatal — you can always keep playing."""
    _ensure_dir()
    packed = [[x, y, z, block] for (x, y, z), block in list(edits.items())[:60000]]
    payload = {
        "version": 3,
        "seed": int(seed),
        "player": player_state,
        "placed": int(blocks_placed),
        "minutes": round(minutes, 1),
        "time": round(float(time_of_day), 4),
        "edits": packed,
    }
    try:
        WORLD_FILE.write_text(json.dumps(payload), encoding="utf-8")
        return True
    except OSError:
        return False


def load_world() -> dict | None:
    try:
        raw = WORLD_FILE.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("seed"), int):
        return None
    edits = {}
    for entry in data.get("edits", []):
        if isinstance(entry, list) and len(entry) == 4:
            edits[(int(entry[0]), int(entry[1]), int(entry[2]))] = int(entry[3])
    return {
        "seed": data["seed"] & 0xFFFFFFFF,
        "player": data.get("player"),
        "blocks_placed": int(data.get("placed", 0)),
        "minutes": float(data.get("minutes", 0)),
        "time_of_day": float(data.get("time", 0.32)),
        "edits": edits,
    }


def clear_world() -> None:
    try:
        WORLD_FILE.unlink()
    except OSError:
        pass


def has_world() -> bool:
    return WORLD_FILE.exists()


def save_settings(settings: dict) -> bool:
    _ensure_dir()
    try:
        SETTINGS_FILE.write_text(json.dumps(settings), encoding="utf-8")
        return True
    except OSError:
        return False


def load_settings(defaults: dict) -> dict:
    merged = dict(defaults)
    try:
        merged.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return merged
