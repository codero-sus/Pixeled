"""Minimal PNG writer (standard library only) for screenshots and headless renders."""

import struct
import zlib


def _chunk(tag, payload):
    body = tag + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, buffer, width, height):
    """Write an RGB bytearray as a PNG file and return the path."""
    rows = []
    stride = width * 3
    for row in range(height):
        start = row * stride
        rows.append(b"\x00" + bytes(buffer[start:start + stride]))
    raw = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, 6))
    png += _chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)
    return path


def write_ppm(path, buffer, width, height):
    """The format Tkinter's photo images read natively."""
    with open(path, "wb") as handle:
        handle.write(("P6\n%d %d\n255\n" % (width, height)).encode("ascii"))
        handle.write(bytes(buffer))
    return path
