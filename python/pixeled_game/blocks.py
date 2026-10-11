"""The block palette — the Python twin of ``web/constants.js``.

Every block carries the colours its faces are drawn with (baked from the web edition's procedural
atlas), plus the physical flags the world, the mesher and the interface need. Because it is a plain
table, the Java and Android editions can mirror it one-to-one.
"""

from __future__ import annotations

CHUNK_SIZE = 16
WORLD_HEIGHT = 96
SEA_LEVEL = 38

# Tile indices, matching the atlas order of the web edition.
TILES = {
    "grass_top": 0, "grass_side": 1, "dirt": 2, "stone": 3, "cobblestone": 4, "sand": 5,
    "sandstone_top": 6, "sandstone_side": 7, "log_top": 8, "log_side": 9, "leaves": 10,
    "planks": 11, "water": 12, "snow_top": 13, "snow_side": 14, "glass": 15, "brick": 16,
    "cactus_top": 17, "cactus_side": 18, "glowstone": 19, "tall_grass": 20, "flower_red": 21,
    "flower_yellow": 22, "cloud": 23,
}

# Average colour of each atlas tile in the web edition, so both editions look like one game.
TILE_COLORS = [
    "#7bbb55", "#827e45", "#87593c", "#8d8d8d", "#7d7d7d", "#e2d8a7", "#dccf9b", "#d9cb98",
    "#a97a46", "#725532", "#438238", "#aa824c", "#3b7ed8", "#f1f6fb", "#b39a8b", "#c3dfeb",
    "#bb9283", "#508c3c", "#4f853c", "#dfad53", "#59a545", "#977f40", "#a1b148", "#ffffff",
]


class Block:
    """One entry of the block table."""

    __slots__ = ("id", "name", "top", "side", "bottom", "liquid", "plant", "cutout", "opaque",
                 "solid", "hardness", "material", "light")

    def __init__(self, block_id, name, top, side, bottom, *, liquid=False, plant=False, cutout=False,
                 opaque=True, solid=True, hardness=0.5, material="dirt", light=0):
        self.id = block_id
        self.name = name
        self.top = top
        self.side = side
        self.bottom = bottom
        self.liquid = liquid
        self.plant = plant
        self.cutout = cutout
        self.opaque = opaque
        self.solid = solid
        self.hardness = hardness
        self.material = material
        self.light = light

    def color(self, face: str) -> str:
        """Colour of the top, side or bottom face."""
        tile = self.top if face == "top" else self.bottom if face == "bottom" else self.side
        return TILE_COLORS[tile % len(TILE_COLORS)]


def _build_blocks():
    air = Block(0, "Air", 0, 0, 0, opaque=False, solid=False, hardness=0, material="")

    def block(*args, **kwargs):
        return Block(len(table), *args, **kwargs)

    table = [air]
    table.append(block("Grass", TILES["grass_top"], TILES["grass_side"], TILES["dirt"], hardness=0.6, material="dirt"))
    table.append(block("Dirt", TILES["dirt"], TILES["dirt"], TILES["dirt"], hardness=0.5, material="dirt"))
    table.append(block("Stone", TILES["stone"], TILES["stone"], TILES["stone"], hardness=1.5, material="stone"))
    table.append(block("Cobblestone", TILES["cobblestone"], TILES["cobblestone"], TILES["cobblestone"], hardness=1.6, material="stone"))
    table.append(block("Sand", TILES["sand"], TILES["sand"], TILES["sand"], hardness=0.5, material="sand"))
    table.append(block("Sandstone", TILES["sandstone_top"], TILES["sandstone_side"], TILES["sandstone_side"], hardness=0.9, material="stone"))
    table.append(block("Oak Log", TILES["log_top"], TILES["log_side"], TILES["log_side"], hardness=1.4, material="wood"))
    table.append(block("Leaves", TILES["leaves"], TILES["leaves"], TILES["leaves"], cutout=True, opaque=False, hardness=0.25, material="plant"))
    table.append(block("Planks", TILES["planks"], TILES["planks"], TILES["planks"], hardness=1.2, material="wood"))
    table.append(block("Water", TILES["water"], TILES["water"], TILES["water"], liquid=True, opaque=False, solid=False, hardness=0, material="water"))
    table.append(block("Snow", TILES["snow_top"], TILES["snow_side"], TILES["dirt"], hardness=0.4, material="snow"))
    table.append(block("Glass", TILES["glass"], TILES["glass"], TILES["glass"], cutout=True, opaque=False, hardness=0.3, material="glass"))
    table.append(block("Bricks", TILES["brick"], TILES["brick"], TILES["brick"], hardness=1.6, material="stone"))
    table.append(block("Cactus", TILES["cactus_top"], TILES["cactus_side"], TILES["cactus_side"], hardness=0.4, material="plant"))
    table.append(block("Glowstone", TILES["glowstone"], TILES["glowstone"], TILES["glowstone"], hardness=0.6, material="stone", light=14))
    table.append(block("Tall Grass", TILES["tall_grass"], TILES["tall_grass"], TILES["tall_grass"], plant=True, cutout=True, opaque=False, solid=False, hardness=0.05, material="plant"))
    table.append(block("Red Flower", TILES["flower_red"], TILES["flower_red"], TILES["flower_red"], plant=True, cutout=True, opaque=False, solid=False, hardness=0.05, material="plant"))
    table.append(block("Yellow Flower", TILES["flower_yellow"], TILES["flower_yellow"], TILES["flower_yellow"], plant=True, cutout=True, opaque=False, solid=False, hardness=0.05, material="plant"))
    return table


BLOCKS = _build_blocks()

BLOCK_BY_NAME = {block.name: block.id for block in BLOCKS}

AIR = 0
GRASS = 1
DIRT = 2
STONE = 3
COBBLESTONE = 4
SAND = 5
SANDSTONE = 6
OAK_LOG = 7
LEAVES = 8
PLANKS = 9
WATER = 10
SNOW = 11
GLASS = 12
BRICKS = 13
CACTUS = 14
GLOWSTONE = 15
TALL_GRASS = 16
RED_FLOWER = 17
YELLOW_FLOWER = 18

# Two pages of nine blocks, exactly like the web hotbar.
HOTBAR_PAGES = (
    (GRASS, DIRT, STONE, COBBLESTONE, SAND, SANDSTONE, OAK_LOG, LEAVES, PLANKS),
    (SNOW, GLASS, BRICKS, CACTUS, GLOWSTONE, TALL_GRASS, RED_FLOWER, YELLOW_FLOWER, WATER),
)

IS_SOLID = [block.solid for block in BLOCKS]
IS_OPAQUE = [block.opaque for block in BLOCKS]
IS_LIQUID = [block.liquid for block in BLOCKS]
IS_PLANT = [block.plant for block in BLOCKS]

# How bright each face of a cube is drawn, before ambient occlusion and daylight.
FACE_SHADE = {"top": 1.0, "bottom": 0.52, "north": 0.78, "south": 0.78, "east": 0.78, "west": 0.78}

FACE_TILES = {"top": "top", "bottom": "bottom", "north": "side", "south": "side", "east": "side", "west": "side"}

DEFAULT_SETTINGS = {
    "render_distance": 3,       # chunks; the pure-Python painter likes a slightly smaller world
    "fov": 72,
    "sensitivity": 0.0022,
    "sound": True,
    "creative": True,
    "day_cycle": True,
    "day_length": 600,
    "time_of_day": 0.32,
}
