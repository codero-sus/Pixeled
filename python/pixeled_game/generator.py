"""Terrain generation — the Python twin of ``web/generator.js``.

A chunk is derived from the world seed alone, so the same seed always rebuilds the same landscape
and a brand-new seed gives a brand-new world. The layer order matches the web edition exactly:

1. continental shape, hills, mountains and beach flattening
2. a sea-level fill, so low ground becomes ocean or lakes
3. biomes from temperature and humidity: plains, forest, desert, snow, mountains
4. caves carved with 3D noise, occasionally lit by glowstone
5. trees, cacti, tall grass and flowers
6. the player's saved edits, replayed on top so builds survive regeneration
"""

from __future__ import annotations

import math

from .blocks import AIR, CHUNK_SIZE, GLOWSTONE, SEA_LEVEL, SNOW, STONE, WATER, WORLD_HEIGHT
from .noise import fbm2, fbm3, hash3, hash_float, noise2

BEDROCK = 1
STRUCTURE_REACH = 3  # how far a tree or cactus can lean into a neighbouring chunk


def contrast(value: float, strength: float = 1.8) -> float:
    """Push a noise value away from the average so biomes cover their full range."""
    return max(0.0, min(1.0, 0.5 + (value - 0.5) * strength))


class Chunk:
    """A 16×96×16 block of the world."""

    __slots__ = ("cx", "cz", "data", "heights", "highest", "generated", "dirty")

    def __init__(self, cx: int, cz: int):
        self.cx = cx
        self.cz = cz
        self.data = bytearray(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE)
        self.heights = bytearray(CHUNK_SIZE * CHUNK_SIZE)
        self.highest = 0
        self.generated = False
        self.dirty = True

    @staticmethod
    def index(x: int, y: int, z: int) -> int:
        return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x

    def get(self, x: int, y: int, z: int) -> int:
        if 0 <= x < CHUNK_SIZE and 0 <= z < CHUNK_SIZE and 0 <= y < WORLD_HEIGHT:
            return self.data[Chunk.index(x, y, z)]
        return 0

    def set(self, x: int, y: int, z: int, block_id: int) -> None:
        self.data[Chunk.index(x, y, z)] = block_id
        if block_id and y > self.highest:
            self.highest = y

    def height(self, x: int, z: int) -> int:
        """Topmost non-air block in a column."""
        return self.heights[z * CHUNK_SIZE + x]

    def set_height(self, x: int, z: int, y: int) -> None:
        self.heights[z * CHUNK_SIZE + x] = y


class TerrainGenerator:
    """Turns a seed into terrain."""

    def __init__(self, seed: int, edits=None):
        self.seed = seed & 0xFFFFFFFF
        self.edits = edits if edits is not None else {}
        self._cache = None

    # ------------------------------------------------------------------ shape & biome

    def height_at(self, x: int, z: int) -> int:
        """Terrain height (top solid block) at a world column."""
        seed = self.seed
        continent = fbm2(x * 0.0075, z * 0.0075, seed, 4)
        hills = fbm2(x * 0.017, z * 0.017, seed + 101, 3)
        mountain_mask = max(0.0, (fbm2(x * 0.0035, z * 0.0035, seed + 211, 3) - 0.48) * 3.6)
        mountain = mountain_mask ** 1.6 * 46
        ridges = abs(noise2(x * 0.09, z * 0.09, seed + 307) - 0.5) * 2.4
        height = SEA_LEVEL - 3 + (continent - 0.428) * 60 + (hills - 0.45) * 11 + mountain + ridges
        # Flatten shorelines slightly so beaches read clearly.
        beach = max(0.0, 1 - abs(height - SEA_LEVEL) / 3)
        height = height * (1 - beach * 0.25) + SEA_LEVEL * beach * 0.25
        return max(BEDROCK + 1, min(WORLD_HEIGHT - 12, round(height)))

    def temperature_at(self, x: int, z: int) -> float:
        return contrast(fbm2(x * 0.0055, z * 0.0055, self.seed + 401, 3), 2.4)

    def humidity_at(self, x: int, z: int) -> float:
        return contrast(fbm2(x * 0.0072, z * 0.0072, self.seed + 509, 3), 2.2)

    def biome_at(self, x: int, z: int, height: int | None = None) -> str:
        if height is None:
            height = self.height_at(x, z)
        if height > SEA_LEVEL + 26:
            return "mountain"
        temperature = self.temperature_at(x, z)
        humidity = self.humidity_at(x, z)
        if temperature > 0.78 and humidity < 0.55:
            return "desert"
        if temperature < 0.30:
            return "snow"
        if humidity > 0.58:
            return "forest"
        return "plains"

    def surface_layers(self, biome: str, height: int):
        """The stack of natural blocks below the surface, top first."""
        if biome not in ("snow", "mountain") and height <= SEA_LEVEL + 1:
            return [5, 5, 6]                                    # beach
        if biome == "desert":
            return [5, 5, 5, 6]                                 # sand over sandstone
        if biome == "snow":
            return [SNOW, 2, 2]                                 # snow over dirt
        if biome == "mountain" and height > SEA_LEVEL + 34:
            return [SNOW, STONE, STONE]
        return [1, 2, 2, 2]                                     # grass over dirt

    # ------------------------------------------------------------------ chunks

    def generate_chunk(self, cx: int, cz: int) -> Chunk:
        chunk = Chunk(cx, cz)
        base_x = cx * CHUNK_SIZE
        base_z = cz * CHUNK_SIZE
        self._cache = {}

        for z in range(CHUNK_SIZE):
            for x in range(CHUNK_SIZE):
                world_x = base_x + x
                world_z = base_z + z
                height = self.height_at(world_x, world_z)
                layers = self.surface_layers(self.biome_at(world_x, world_z, height), height)
                top = 0
                for y in range(height + 1):
                    if y <= BEDROCK:
                        block = STONE
                    elif y == height:
                        block = layers[0]
                    else:
                        below = height - y - 1
                        block = layers[below] if below < len(layers) else STONE
                    chunk.set(x, y, z, block)
                    top = y
                for y in range(height + 1, SEA_LEVEL + 1):
                    chunk.set(x, y, z, WATER)
                    top = y
                chunk.set_height(x, z, top)

        self.carve_caves(chunk, base_x, base_z)
        self.decorate(chunk, base_x, base_z)
        self.apply_edits(chunk, base_x, base_z)
        self._cache = None
        chunk.generated = True
        chunk.dirty = True
        return chunk

    def carve_caves(self, chunk: Chunk, base_x: int, base_z: int) -> None:
        seed = self.seed + 1301
        for z in range(CHUNK_SIZE):
            for x in range(CHUNK_SIZE):
                world_x = base_x + x
                world_z = base_z + z
                height = self.column(world_x, world_z)[0]
                floor = max(BEDROCK + 2, height - 44)
                for y in range(floor, height - 1):
                    current = chunk.get(x, y, z)
                    if current in (AIR, WATER):
                        continue
                    worm = fbm3(world_x * 0.055, y * 0.09, world_z * 0.055, seed, 3)
                    hollow = fbm3(world_x * 0.02, y * 0.05, world_z * 0.02, seed + 77, 2)
                    if worm > 0.6 and hollow > 0.42:
                        chunk.set(x, y, z, AIR)
                        # Sprinkle glowing stone so caves are worth exploring.
                        if y > 1 and chunk.get(x, y - 1, z) == STONE and hash_float(world_x, y, world_z, seed + 5) < 0.012:
                            chunk.set(x, y - 1, z, GLOWSTONE)

    def decorate(self, chunk: Chunk, base_x: int, base_z: int) -> None:
        """Trees, cacti and ground cover, scanned over a padded band so seams match."""
        for dz in range(-STRUCTURE_REACH, CHUNK_SIZE + STRUCTURE_REACH):
            for dx in range(-STRUCTURE_REACH, CHUNK_SIZE + STRUCTURE_REACH):
                world_x = base_x + dx
                world_z = base_z + dz
                height, biome = self.column(world_x, world_z)
                if height <= SEA_LEVEL:
                    continue    # underwater columns stay bare
                roll = hash_float(world_x, height, world_z, self.seed + 907)

                if biome == "desert":
                    if roll < 0.014:
                        self.place_cactus(chunk, dx, height, dz, world_x, world_z)
                    continue
                if self.has_tree(world_x, world_z) and not self.near_structure(world_x, world_z, 2):
                    self.place_tree(chunk, dx, height, dz, world_x, world_z, biome == "snow")
                    continue
                if biome in ("plains", "forest", "snow"):
                    deco = hash_float(world_x, height + 7, world_z, self.seed + 1907)
                    if deco < 0.15:
                        self.set_local(chunk, dx, height + 1, dz, 16)       # tall grass
                    elif deco < 0.172:
                        self.set_local(chunk, dx, height + 1, dz, 17)       # red flower
                    elif deco < 0.194:
                        self.set_local(chunk, dx, height + 1, dz, 18)       # yellow flower

    def has_tree(self, x: int, z: int) -> bool:
        """Would this column grow a tree? Shared with :meth:`near_structure` so they agree."""
        height, biome = self.column(x, z)
        if height <= SEA_LEVEL or biome == "desert":
            return False
        chance = {"forest": 0.045, "snow": 0.02, "mountain": 0.006}.get(biome, 0.008)
        return hash_float(x, height, z, self.seed + 907) < chance

    def near_structure(self, x: int, z: int, radius: int) -> bool:
        """Keeps trees from growing straight through each other."""
        for dz in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx == 0 and dz == 0:
                    continue
                if self.has_tree(x + dx, z + dz):
                    return True
        return False

    def column(self, x: int, z: int):
        """Height and biome for a column, memoised for the chunk currently being built."""
        if self._cache is None:
            return self.compute_column(x, z)
        key = (x, z)
        entry = self._cache.get(key)
        if entry is None:
            entry = self.compute_column(x, z)
            self._cache[key] = entry
        return entry

    def compute_column(self, x: int, z: int):
        height = self.height_at(x, z)
        return height, self.biome_at(x, z, height)

    def set_local(self, chunk: Chunk, x: int, y: int, z: int, block_id: int) -> None:
        if not (0 <= x < CHUNK_SIZE and 0 <= z < CHUNK_SIZE and 0 <= y < WORLD_HEIGHT):
            return
        chunk.set(x, y, z, block_id)
        if block_id and y > chunk.height(x, z):
            chunk.set_height(x, z, y)

    def place_tree(self, chunk: Chunk, x: int, ground: int, z: int, world_x: int, world_z: int, snowy: bool) -> None:
        rng = hash3(world_x, ground, world_z, self.seed + 31)
        trunk = (6 + rng % 3) if snowy else (4 + rng % 3)
        for i in range(1, trunk + 1):
            self.set_local(chunk, x, ground + i, z, 7)
        top = ground + trunk
        if snowy:
            # Spruce: narrow, layered cone.
            for layer in (3, 2, 1, 0):
                radius = 0 if layer == 0 else 1 if layer == 1 else 2
                y = top + (3 - layer)
                for dz in range(-radius, radius + 1):
                    for dx in range(-radius, radius + 1):
                        if abs(dx) + abs(dz) > radius + 0.5:
                            continue
                        if dx == 0 and dz == 0 and layer != 0:
                            continue
                        self.set_local(chunk, x + dx, y, z + dz, 8)
            self.set_local(chunk, x, top + 4, z, 8)
        else:
            # Oak: fat blobby crown.
            for dy in range(-2, 3):
                radius = 1 if dy <= -2 or dy == 2 else 2
                for dz in range(-radius, radius + 1):
                    for dx in range(-radius, radius + 1):
                        if dx == 0 and dz == 0 and dy <= 0:
                            continue
                        if abs(dx) == radius and abs(dz) == radius and dy != 0:
                            continue
                        self.set_local(chunk, x + dx, top + dy, z + dz, 8)
            self.set_local(chunk, x, top + 3, z, 8)

    def place_cactus(self, chunk: Chunk, x: int, ground: int, z: int, world_x: int, world_z: int) -> None:
        height = 1 + (hash3(world_x, ground, world_z, self.seed + 53) % 3)
        for i in range(1, height + 1):
            self.set_local(chunk, x, ground + i, z, 14)

    def apply_edits(self, chunk: Chunk, base_x: int, base_z: int) -> None:
        """Replay the player's saved edits on top of freshly generated terrain."""
        if not self.edits:
            return
        touched = False
        for key, block_id in self.edits.items():
            x, y, z = key
            lx, lz = x - base_x, z - base_z
            if not (0 <= lx < CHUNK_SIZE and 0 <= lz < CHUNK_SIZE and 0 <= y < WORLD_HEIGHT):
                continue
            chunk.set(lx, y, lz, block_id)
            touched = True
        if not touched:
            return
        # Recompute cached column tops so meshing never misses a player-built tower.
        for z in range(CHUNK_SIZE):
            for x in range(CHUNK_SIZE):
                for y in range(WORLD_HEIGHT - 1, -1, -1):
                    if chunk.get(x, y, z) != AIR:
                        chunk.set_height(x, z, y)
                        break


def describe_seed(seed: int) -> str:
    """A short, friendly label for a seed, used in the window title."""
    return f"seed {seed} · {seed_label(seed)}" if False else f"seed {seed}"


def seed_label(seed: int) -> str:
    from .noise import seed_label as inner

    return inner(seed)


def chunk_key(cx: int, cz: int) -> str:
    return f"{cx},{cz}"


def distance2(ax: float, az: float, bx: float, bz: float) -> float:
    return math.hypot(ax - bx, az - bz)
