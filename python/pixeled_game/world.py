"""The 3D voxel world: generation, block access, the edit list that gets saved, and the
heightfield plus block index the software renderer draws from.
"""

import math

from .blocks import (
    AIR, DIRT, GRASS, LEAVES, LOG, SAND, SEA_LEVEL, SNOW, STONE, WATER,
    WORLD_X, WORLD_Y, WORLD_Z, BIOMES, is_solid_id,
)
from .noise import Noise, hash_coords

TERRAIN = frozenset((GRASS, DIRT, STONE, SAND, SNOW))
CHUNK = 8                      # columns per render chunk


def _clamp01(value):
    return 0.0 if value < 0 else 1.0 if value > 1 else value


class VoxelWorld:
    """A dense 96 x 48 x 96 block grid with the same rules as the other editions."""

    def __init__(self, seed=2408):
        self.seed = int(seed) & 0x7FFFFFFF
        self.noise = Noise(self.seed)
        self.data = bytearray(WORLD_X * WORLD_Y * WORLD_Z)
        self.edits = {}
        # Terrain surfaces (terrain blocks only) and water, per column: the heightfield the
        # renderer marches. Trees and player-built blocks live above them as cubes.
        self.ground_top = [[-1] * WORLD_Z for _ in range(WORLD_X)]
        self.water_top = [[-1] * WORLD_Z for _ in range(WORLD_X)]
        self.objects = {}                                   # (x, z) -> [(y, id), ...]
        self.chunks = {}                                    # (cx, cz) -> set of (x, z)
        self.version = 0                                    # bumped whenever a block changes
        self.continent_mean = 0.42
        self.calibrate()
        self.generate()

    # ------------------------------------------------------------------ blocks

    @staticmethod
    def index(x, y, z):
        return (y * WORLD_Z + z) * WORLD_X + x

    def inside(self, x, y, z):
        return 0 <= x < WORLD_X and 0 <= y < WORLD_Y and 0 <= z < WORLD_Z

    def get(self, x, y, z):
        if not self.inside(x, y, z):
            return AIR
        return self.data[self.index(x, y, z)]

    def is_solid(self, x, y, z):
        if y < 0:
            return True
        if x < 0 or x >= WORLD_X or z < 0 or z >= WORLD_Z or y >= WORLD_Y:
            return False
        return is_solid_id(self.data[self.index(x, y, z)])

    def set(self, x, y, z, block_id):
        """Write one block, remember it for the save file and refresh the render index."""
        if not self.inside(x, y, z):
            return False
        self.data[self.index(x, y, z)] = block_id
        self.edits["%d,%d,%d" % (x, y, z)] = int(block_id)
        self.version += 1
        self.refresh_column(x, z)
        return True

    def surface(self, x, z):
        """(surface_y, block_id, is_water) of one column, or (-1, AIR, False) for the void."""
        ground = self.ground_top[x][z]
        water = self.water_top[x][z]
        if water > ground:
            return water, WATER, True
        if ground < 0:
            return -1, AIR, False
        return ground, self.data[self.index(x, ground, z)], False

    def refresh_column(self, x, z):
        """Recache one column: terrain top, water top and the cubes standing on them."""
        ground = water = -1
        for y in range(WORLD_Y - 1, -1, -1):
            if ground >= 0 and water >= 0:
                break
            block_id = self.data[self.index(x, y, z)]
            if block_id == AIR:
                continue
            if block_id == WATER:
                if water < 0:
                    water = y
            elif block_id in TERRAIN:
                if ground < 0:
                    ground = y
        self.ground_top[x][z] = ground
        self.water_top[x][z] = water

        stack = []
        for y in range(max(ground, water) + 1, WORLD_Y):
            block_id = self.data[self.index(x, y, z)]
            if block_id != AIR:
                stack.append((y, block_id))
        key = (x, z)
        if stack:
            self.objects[key] = stack
        else:
            self.objects.pop(key, None)
        chunk = (x // CHUNK, z // CHUNK)
        bucket = self.chunks.get(chunk)
        if stack:
            if bucket is None:
                self.chunks[chunk] = bucket = set()
            bucket.add(key)
        elif bucket is not None:
            bucket.discard(key)

    def objects_near(self, x, z, radius):
        """Every cube within `radius` columns of a point, as (x, y, z, id)."""
        found = []
        min_cx, max_cx = int((x - radius) // CHUNK), int((x + radius) // CHUNK)
        min_cz, max_cz = int((z - radius) // CHUNK), int((z + radius) // CHUNK)
        radius_squared = radius * radius
        for chunk_x in range(min_cx, max_cx + 1):
            for chunk_z in range(min_cz, max_cz + 1):
                for column in self.chunks.get((chunk_x, chunk_z), ()):
                    delta_x = column[0] + 0.5 - x
                    delta_z = column[1] + 0.5 - z
                    if delta_x * delta_x + delta_z * delta_z > radius_squared:
                        continue
                    for y, block_id in self.objects[column]:
                        found.append((column[0], y, column[1], block_id))
        return found

    # ------------------------------------------------------------------ terrain

    def calibrate(self):
        """Average the continental noise so every seed gets a similar land/water balance."""
        total, count = 0.0, 0
        for x in range(0, WORLD_X, 4):
            for z in range(0, WORLD_Z, 4):
                total += self.continent(x, z)
                count += 1
        self.continent_mean = total / count

    def continent(self, x, z):
        return self.noise.fbm2(x * 0.0038, z * 0.0038, 5)

    def surface_height(self, x, z):
        land = _clamp01((self.continent(x, z) - (self.continent_mean - 0.065)) / 0.14)
        # A ridged noise only bites on high ground, which keeps plains flatter and makes real peaks.
        ridge = abs(self.noise.fbm2(x * 0.011 + 31, z * 0.011 - 17, 3) - 0.5) * 2
        mask = _clamp01((land - 0.58) / 0.42)
        # Rolling hills: mid-frequency noise that bites harder on high ground, plus 1-block grain.
        hills = (self.noise.fbm2(x * 0.021 + 11, z * 0.021 - 5, 3) - 0.5) * (3 + land * 8)
        grain = (self.noise.fbm2(x * 0.085 - 3, z * 0.085 + 19, 2) - 0.5) * 1.8
        height = 11 + (land ** 1.1) * 38 + (ridge ** 3) * 9 * mask + hills + grain
        return max(2, min(WORLD_Y - 6, int(math.floor(height))))

    def biome_at(self, x, z):
        temperature = self.noise.fbm2(x * 0.0031 + 7.3, z * 0.0031 + 2.1, 3)
        moisture = self.noise.fbm2(x * 0.0043 - 4.7, z * 0.0043 + 9.4, 3)
        if temperature < 0.34:
            return 3                      # snow
        if moisture < 0.36 and temperature > 0.5:
            return 2                      # desert
        if moisture > 0.6:
            return 1                      # forest
        return 0                          # plains

    def biome_name(self, x, z):
        return BIOMES[self.biome_at(int(x), int(z))]

    def generate(self):
        """Fill the grid: continents, biomes, water, coarse caves and little trees."""
        data = self.data
        for i in range(len(data)):
            data[i] = AIR
        for z in range(WORLD_Z):
            for x in range(WORLD_X):
                height = self.surface_height(x, z)
                biome = self.biome_at(x, z)
                beach = height <= SEA_LEVEL + 1
                alpine = height > 34 and not beach
                for y in range(0, height + 1):
                    if y > height - 4:
                        if beach:
                            block_id = SAND
                        elif y == height:
                            block_id = SNOW if (alpine or biome == 3) else SAND if biome == 2 else GRASS
                        else:
                            block_id = STONE if alpine else DIRT
                    else:
                        block_id = STONE
                    data[self.index(x, y, z)] = block_id
                self.ground_top[x][z] = height
                if height < SEA_LEVEL:
                    for y in range(height + 1, SEA_LEVEL + 1):
                        data[self.index(x, y, z)] = WATER
                    self.water_top[x][z] = SEA_LEVEL
        # Caves: sampled on a 2x2 lattice so generation stays quick in pure Python.
        for z in range(2, WORLD_Z - 2, 2):
            for x in range(2, WORLD_X - 2, 2):
                height = self.surface_height(x, z)
                for y in range(2, max(3, height - 2), 2):
                    if self.noise.value3(x * 0.055, y * 0.085, z * 0.055) > 0.72:
                        for dy in (0, 1):
                            for dz in (0, 1):
                                for dx in (0, 1):
                                    if self.inside(x + dx, y + dy, z + dz):
                                        data[self.index(x + dx, y + dy, z + dz)] = AIR
        for z in range(WORLD_Z):
            for x in range(WORLD_X):
                self.plant_tree(x, z)

    def plant_tree(self, x, z):
        """Grow one tree, recorded as cubes above the terrain."""
        height = self.surface_height(x, z)
        if height <= SEA_LEVEL + 1:
            return
        if x < 3 or z < 3 or x > WORLD_X - 4 or z > WORLD_Z - 4:
            return
        biome = self.biome_at(x, z)
        if biome == 2:
            return
        density = 0.055 if biome == 1 else 0.02 if biome == 3 else 0.012
        if hash_coords(x, 7, z, self.seed) > density:
            return
        tall = biome == 3
        trunk = (5 if tall else 4) + int(hash_coords(x, 11, z, self.seed) * 3)
        crown = height + trunk
        for i in range(1, trunk + 1):
            self.place_cube(x, height + i, z, LOG)
        for dy in range(-2, 2):
            spread = 2 if dy <= -1 else 2 - (dy + 2) * 0.6
            for dz in range(-2, 3):
                for dx in range(-2, 3):
                    if math.hypot(dx, dz) + abs(dy) * 0.35 > spread + 0.45:
                        continue
                    if dx == 0 and dz == 0 and dy < 1:
                        continue
                    self.place_cube(x + dx, crown + dy, z + dz, LEAVES)

    def place_cube(self, x, y, z, block_id):
        """Placement during generation: writes the grid and the render index."""
        if not self.inside(x, y, z):
            return
        if self.data[self.index(x, y, z)] != AIR:
            return
        self.data[self.index(x, y, z)] = block_id
        key = (x, z)
        stack = self.objects.get(key)
        if stack is None:
            self.objects[key] = stack = []
        if not stack or stack[-1][0] < y:
            stack.append((y, block_id))
        else:
            stack.append((y, block_id))
            stack.sort()
        chunk = (x // CHUNK, z // CHUNK)
        bucket = self.chunks.get(chunk)
        if bucket is None:
            self.chunks[chunk] = {key}
        else:
            bucket.add(key)

    def spawn_point(self):
        """A dry, open spot near the middle of the map."""
        for attempt in range(400):
            angle = attempt * 0.7
            radius = 5 + attempt * 0.3
            x = int(WORLD_X / 2 + math.cos(angle) * radius)
            z = int(WORLD_Z / 2 + math.sin(angle) * radius)
            if x < 2 or z < 2 or x > WORLD_X - 3 or z > WORLD_Z - 3:
                continue
            height = self.surface_height(x, z)
            if height <= SEA_LEVEL + 2:
                continue
            if self.get(x, height, z) == AIR:
                continue
            if self.get(x, height + 1, z) != AIR or self.get(x, height + 2, z) != AIR:
                continue
            return (x + 0.5, float(height + 1), z + 0.5)
        return (WORLD_X / 2 + 0.5, float(SEA_LEVEL + 6), WORLD_Z / 2 + 0.5)

    def apply_edits(self, edits):
        """Replay a saved edit list (used when loading a world)."""
        for key, block_id in edits.items():
            x, y, z = (int(part) for part in key.split(","))
            if self.inside(x, y, z):
                self.data[self.index(x, y, z)] = int(block_id)
            self.edits[key] = int(block_id)
        columns = set()
        for key in edits:
            x, _y, z = (int(part) for part in key.split(","))
            columns.add((x, z))
        for x, z in columns:
            self.refresh_column(x, z)
        self.version += 1
