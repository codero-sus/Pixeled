"""The voxel world — the Python twin of ``web/world.js``.

Owns the chunks, the blocks the player changed, and the two queries the game asks constantly:
"what is at this coordinate" and "what is the player looking at" (a voxel raycast).
"""

from __future__ import annotations

import math

from .blocks import BLOCKS, CHUNK_SIZE, IS_LIQUID, IS_OPAQUE, IS_PLANT, IS_SOLID, SEA_LEVEL, WORLD_HEIGHT
from .generator import Chunk, TerrainGenerator


class Hit:
    """What a raycast found: the block, its face normal, and how far away it was."""

    __slots__ = ("x", "y", "z", "block", "normal", "distance")

    def __init__(self, x, y, z, block, normal, distance):
        self.x = x
        self.y = y
        self.z = z
        self.block = block
        self.normal = normal
        self.distance = distance

    def __repr__(self):  # pragma: no cover - debugging helper
        return f"Hit({self.x},{self.y},{self.z} block={self.block} normal={self.normal})"


class VoxelWorld:
    def __init__(self, seed: int, edits=None):
        self.seed = seed & 0xFFFFFFFF
        self.edits: dict[tuple[int, int, int], int] = edits if edits is not None else {}
        self.chunks: dict[tuple[int, int], Chunk] = {}
        self.generator = TerrainGenerator(self.seed, self.edits)
        self.meshed = 0

    # ------------------------------------------------------------------ chunks

    def chunk(self, cx: int, cz: int) -> Chunk | None:
        return self.chunks.get((cx, cz))

    def has_chunk(self, cx: int, cz: int) -> bool:
        return (cx, cz) in self.chunks

    def ensure_chunk(self, cx: int, cz: int) -> Chunk:
        chunk = self.chunks.get((cx, cz))
        if chunk is None:
            chunk = self.generator.generate_chunk(cx, cz)
            self.chunks[(cx, cz)] = chunk
        return chunk

    def unload_chunk(self, cx: int, cz: int) -> bool:
        return self.chunks.pop((cx, cz), None) is not None

    def mark_dirty(self, cx: int, cz: int) -> None:
        chunk = self.chunks.get((cx, cz))
        if chunk is not None:
            chunk.dirty = True

    # ------------------------------------------------------------------ blocks

    def get_block(self, x: int, y: int, z: int) -> int:
        if y < 0 or y >= WORLD_HEIGHT:
            return 0
        cx, cz = x >> 4, z >> 4
        chunk = self.chunks.get((cx, cz))
        if chunk is None:
            return 0
        return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)

    def set_block(self, x: int, y: int, z: int, block_id: int, record: bool = True) -> bool:
        if y < 0 or y >= WORLD_HEIGHT:
            return False
        cx, cz = x >> 4, z >> 4
        chunk = self.chunks.get((cx, cz))
        if chunk is None:
            return False
        lx, lz = x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE
        if chunk.get(lx, y, lz) == block_id:
            return False
        chunk.set(lx, y, lz, block_id)
        chunk.dirty = True
        if block_id and y > chunk.height(lx, lz):
            chunk.set_height(lx, lz, y)
        elif block_id == 0 and y == chunk.height(lx, lz):
            for scan in range(y, -1, -1):
                if chunk.get(lx, scan, lz) != 0:
                    chunk.set_height(lx, lz, scan)
                    break
            else:
                chunk.set_height(lx, lz, 0)
        if record:
            self.edits[(x, y, z)] = block_id
        # Neighbouring chunks need rebuilding when a border block changes.
        if lx == 0:
            self.mark_dirty(cx - 1, cz)
        elif lx == CHUNK_SIZE - 1:
            self.mark_dirty(cx + 1, cz)
        if lz == 0:
            self.mark_dirty(cx, cz - 1)
        elif lz == CHUNK_SIZE - 1:
            self.mark_dirty(cx, cz + 1)
        return True

    def is_solid(self, x: int, y: int, z: int) -> bool:
        return IS_SOLID[self.get_block(x, y, z)]

    def is_opaque(self, x: int, y: int, z: int) -> bool:
        return IS_OPAQUE[self.get_block(x, y, z)]

    def is_liquid(self, x: int, y: int, z: int) -> bool:
        return IS_LIQUID[self.get_block(x, y, z)]

    def is_plant(self, x: int, y: int, z: int) -> bool:
        return IS_PLANT[self.get_block(x, y, z)]

    def is_targetable(self, x: int, y: int, z: int) -> bool:
        block = self.get_block(x, y, z)
        return block != 0 and not IS_LIQUID[block]

    def name_of(self, block_id: int) -> str:
        return BLOCKS[block_id].name if 0 <= block_id < len(BLOCKS) else "Air"

    def hardness_of(self, block_id: int) -> float:
        return BLOCKS[block_id].hardness if 0 <= block_id < len(BLOCKS) else 1.0

    def column_top(self, x: int, z: int) -> int:
        chunk = self.ensure_chunk(x >> 4, z >> 4)
        return chunk.height(x - (x >> 4) * CHUNK_SIZE, z - (z >> 4) * CHUNK_SIZE)

    # ------------------------------------------------------------------ raycast

    def raycast(self, origin, direction, max_distance: float = 6.0) -> Hit | None:
        """Amanatides & Woo voxel traversal — the block the player is looking at."""
        length = math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2) or 1.0
        dx, dy, dz = direction[0] / length, direction[1] / length, direction[2] / length
        x, y, z = math.floor(origin[0]), math.floor(origin[1]), math.floor(origin[2])

        step_x = 1 if dx > 0 else -1
        step_y = 1 if dy > 0 else -1
        step_z = 1 if dz > 0 else -1
        t_delta_x = abs(1 / dx) if dx else float("inf")
        t_delta_y = abs(1 / dy) if dy else float("inf")
        t_delta_z = abs(1 / dz) if dz else float("inf")
        t_max_x = ((x + 1 - origin[0]) / dx) if dx > 0 else ((x - origin[0]) / dx) if dx < 0 else float("inf")
        t_max_y = ((y + 1 - origin[1]) / dy) if dy > 0 else ((y - origin[1]) / dy) if dy < 0 else float("inf")
        t_max_z = ((z + 1 - origin[2]) / dz) if dz > 0 else ((z - origin[2]) / dz) if dz < 0 else float("inf")

        normal = (0, 0, 0)
        travelled = 0.0
        while travelled <= max_distance:
            block = self.get_block(x, y, z)
            if block != 0 and not IS_LIQUID[block]:
                return Hit(x, y, z, block, normal, travelled)
            if t_max_x <= t_max_y and t_max_x <= t_max_z:
                x += step_x
                travelled = t_max_x
                t_max_x += t_delta_x
                normal = (-step_x, 0, 0)
            elif t_max_y <= t_max_z:
                y += step_y
                travelled = t_max_y
                t_max_y += t_delta_y
                normal = (0, -step_y, 0)
            else:
                z += step_z
                travelled = t_max_z
                t_max_z += t_delta_z
                normal = (0, 0, -step_z)
            if y < 0 or y >= WORLD_HEIGHT:
                return None
        return None

    # ------------------------------------------------------------------ spawning

    def find_spawn(self, prefer_x: int = 0, prefer_z: int = 0) -> dict:
        """Look for dry land near the preferred column and return a safe standing spot."""
        cx, cz = prefer_x >> 4, prefer_z >> 4
        for ring in range(0, 8):
            for dx in range(-ring, ring + 1):
                for dz in range(-ring, ring + 1):
                    if ring and abs(dx) != ring and abs(dz) != ring:
                        continue
                    x = prefer_x + dx * 8
                    z = prefer_z + dz * 8
                    self.ensure_chunk(x >> 4, z >> 4)
                    top = self.column_top(x, z)
                    block = self.get_block(x, top, z)
                    if top > SEA_LEVEL and block not in (0, 10, 16, 17, 18):
                        return {"x": x + 0.5, "y": float(top + 1), "z": z + 0.5}
        self.ensure_chunk(cx, cz)
        top = self.column_top(prefer_x, prefer_z)
        return {"x": prefer_x + 0.5, "y": float(max(SEA_LEVEL + 2, top + 1)), "z": prefer_z + 0.5}

    def describe_column(self, x: int, z: int) -> str:
        top = self.column_top(x, z)
        block = self.get_block(x, top, z)
        biome = self.generator.biome_at(x, z)
        return f"{biome} · {self.name_of(block)} at y={top}"
