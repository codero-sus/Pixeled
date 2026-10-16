"""Save files for the Python edition: one JSON document under ~/.pixeled/world.json."""

import json
import os
import random
import time

SAVE_DIR = os.path.join(os.path.expanduser("~"), ".pixeled")
SAVE_FILE = os.path.join(SAVE_DIR, "world.json")
VERSION = 2


def random_seed():
    """A fresh seed for a brand-new world (the whole point of the random worlds)."""
    return random.randrange(1, 2 ** 31 - 1)


def save(payload):
    """Write the world state, creating the folder on first use."""
    os.makedirs(SAVE_DIR, exist_ok=True)
    document = dict(payload)
    document["version"] = VERSION
    document["saved"] = time.time()
    temporary = SAVE_FILE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(document, handle, separators=(",", ":"))
    os.replace(temporary, SAVE_FILE)
    return SAVE_FILE


def load():
    """Read the saved world, or None when there is nothing usable."""
    try:
        with open(SAVE_FILE, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(document, dict) or document.get("version") != VERSION:
        return None
    if "seed" not in document:
        return None
    return document


def clear():
    """Forget the saved world (used by New world)."""
    try:
        os.remove(SAVE_FILE)
        return True
    except OSError:
        return False


def build_payload(world, player, selected, clock):
    """Everything the game needs to come back exactly where it left off."""
    return {
        "seed": world.seed,
        "edits": world.edits,
        "player": [player.x, player.y, player.z, player.yaw, player.pitch],
        "selected": selected,
        "clock": clock,
    }
