"""Block palette and world metrics for the 3D edition."""

WORLD_X = 96
WORLD_Y = 48
WORLD_Z = 96
SEA_LEVEL = 20

AIR = 0
GRASS = 1
DIRT = 2
STONE = 3
SAND = 4
LOG = 5
LEAVES = 6
SNOW = 7
PLANKS = 8
GLASS = 9
WATER = 10

# id -> (name, top colour, side colour, bottom colour, solid, transparent, placeable)
BLOCKS = {
    GRASS: ("Grass", (0x79, 0xC0, 0x5A), (0x8F, 0x7F, 0x4A), (0x8A, 0x5A, 0x3B), True, False, True),
    DIRT: ("Dirt", (0x96, 0x65, 0x4A), (0x8A, 0x5A, 0x3B), (0x7D, 0x51, 0x36), True, False, True),
    STONE: ("Stone", (0xA6, 0xAD, 0xB3), (0x9A, 0xA0, 0xA6), (0x8D, 0x94, 0x9A), True, False, True),
    SAND: ("Sand", (0xEF, 0xE3, 0xB0), (0xE6, 0xD7, 0xA0), (0xD8, 0xC6, 0x8F), True, False, True),
    LOG: ("Log", (0xB0, 0x8A, 0x52), (0x7F, 0x5A, 0x35), (0xB0, 0x8A, 0x52), True, False, True),
    LEAVES: ("Leaves", (0x5F, 0xAE, 0x52), (0x4F, 0x9C, 0x47), (0x3F, 0x84, 0x3C), True, False, True),
    SNOW: ("Snow", (0xFF, 0xFF, 0xFF), (0xEA, 0xF2, 0xF8), (0xD7, 0xE3, 0xEC), True, False, True),
    PLANKS: ("Planks", (0xC7, 0x93, 0x57), (0xB9, 0x85, 0x4B), (0xA9, 0x76, 0x3F), True, False, True),
    GLASS: ("Glass", (0xDF, 0xF2, 0xF8), (0xCF, 0xE8, 0xF2), (0xCF, 0xE8, 0xF2), True, True, True),
    WATER: ("Water", (0x4B, 0x8F, 0xE0), (0x2F, 0x74, 0xD0), (0x24, 0x5A, 0xA8), False, True, False),
}

HOTBAR = (GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, PLANKS, GLASS)

BIOMES = ("plains", "forest", "desert", "snow")


def block(block_id):
    """Metadata for an id, with air for anything outside the palette."""
    return BLOCKS.get(block_id, ("Air", (0, 0, 0), (0, 0, 0), (0, 0, 0), False, True, False))


def name_of(block_id):
    return block(block_id)[0]


def is_solid_id(block_id):
    return block(block_id)[4]


def is_transparent(block_id):
    return block(block_id)[5] or block_id == AIR


def face_colour(block_id, axis, sign):
    """Colour of one face: axis 1 is vertical (sign 1 = top, -1 = bottom)."""
    _name, top, side, bottom, _solid, _transparent, _placeable = block(block_id)
    if axis == 1:
        return top if sign > 0 else bottom
    return side
