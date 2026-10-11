"""Tiny feedback sounds for the Python edition.

Pure standard library: on Windows it beeps through `winsound`, everywhere else it stays silent so
the game never depends on an audio device. Sound is a nicety here, never a requirement.
"""

import sys

try:                                    # pragma: no cover - platform specific
    import winsound
except ImportError:                     # pragma: no cover - non Windows
    winsound = None

ENABLED = winsound is not None


def _beep(frequency, duration):
    if winsound is None:
        return False
    try:
        winsound.Beep(int(frequency), int(duration))
        return True
    except Exception:                   # pragma: no cover - no audio device
        return False


def mine(block_id=1):
    """Mining a block: a short, slightly different blip per material."""
    return _beep(300 + (int(block_id) % 6) * 45, 45)


def place(block_id=1):
    return _beep(520 + (int(block_id) % 6) * 35, 45)


def jump():
    return _beep(700, 40)


def hurt():
    return _beep(180, 90)


def describe():
    """Human readable note for the help overlay."""
    if ENABLED:
        return "sound on"
    if sys.platform.startswith("win"):
        return "sound unavailable"
    return "sound off"
