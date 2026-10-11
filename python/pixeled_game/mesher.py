"""Turns voxels into drawable faces — the Python twin of ``web/mesher.js``.

The mesher walks a chunk once and emits only the faces that can actually be seen (a block face is
skipped when a solid neighbour hides it), baking in the same light the web edition uses: a face
direction tint, per-vertex ambient occlusion, a skylight estimate sampled from the air cell in front
of the face, and a small per-block colour jitter so large walls do not look flat. The face table,
the corner order and every constant below match the web mesher one for one.
"""

from __future__ import annotations

from .blocks import BLOCKS, CHUNK_SIZE, FACE_SHADE, IS_LIQUID, IS_OPAQUE, WORLD_HEIGHT, FACE_TILES
from .noise import hash_float

AO_LEVELS = (0.45, 0.62, 0.8, 1.0)
WATER_DROP = 0.12
SKY_SEARCH = 12

# The six cube faces, described exactly like the web mesher does it: a base corner, the two tangent
# directions u and v that span the quad, and the outward normal. Corners are
# [base, base+u, base+u+v, base+v] and carry the texture axes [[0,0], [1,0], [1,1], [0,1]].
RAW_FACE_DEFS = {
    "east": {"normal": (1, 0, 0), "base": (1, 0, 0), "u": (0, 0, 1), "v": (0, 1, 0), "tile": "side"},
    "west": {"normal": (-1, 0, 0), "base": (0, 0, 1), "u": (0, 0, -1), "v": (0, 1, 0), "tile": "side"},
    "top": {"normal": (0, 1, 0), "base": (0, 1, 1), "u": (1, 0, 0), "v": (0, 0, -1), "tile": "top"},
    "bottom": {"normal": (0, -1, 0), "base": (0, 0, 0), "u": (1, 0, 0), "v": (0, 0, 1), "tile": "bottom"},
    "south": {"normal": (0, 0, 1), "base": (0, 0, 1), "u": (1, 0, 0), "v": (0, 1, 0), "tile": "side"},
    "north": {"normal": (0, 0, -1), "base": (1, 0, 0), "u": (-1, 0, 0), "v": (0, 1, 0), "tile": "side"},
}


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _add(*vectors):
    return (sum(vector[0] for vector in vectors),
            sum(vector[1] for vector in vectors),
            sum(vector[2] for vector in vectors))


def _build_face_table():
    """Corners and corner signs per face, with the same winding correction the web mesher applies.

    When ``u × v`` points into the block, the corner list (and with it the texture axes) is
    reversed, which is what keeps every quad counter-clockwise and the textures upright. The u/v
    sign of each corner is what the ambient-occlusion samples are offset by.
    """
    table = {}
    for name, definition in RAW_FACE_DEFS.items():
        base, u, v = definition["base"], definition["u"], definition["v"]
        corners = [base, _add(base, u), _add(base, u, v), _add(base, v)]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        if _dot(_cross(u, v), definition["normal"]) < 0:
            corners.reverse()
            uvs.reverse()
        table[name] = {
            **definition,
            "corners": tuple(corners),
            "signs": tuple((-1 if uv[0] == 0 else 1, -1 if uv[1] == 0 else 1) for uv in uvs),
        }
    return table


FACE_DEFS = _build_face_table()

#: Faces in the order the web mesher emits them — the same order as the table above.
FACE_ORDER = tuple(FACE_DEFS)
FACE_NORMALS = {name: definition["normal"] for name, definition in FACE_DEFS.items()}
FACE_TILE = {name: definition["tile"] for name, definition in FACE_DEFS.items()}
FACE_INDEX = {"west": 0, "east": 1, "bottom": 2, "top": 3, "north": 4, "south": 5}


def face_corners(face: str):
    """The four corner offsets of a face, already wound the way the web mesher winds them."""
    return FACE_DEFS[face]["corners"]


class Face:
    """One drawable quad, already in world space."""

    __slots__ = ("kind", "points", "color", "shade", "block", "tile", "normal")

    def __init__(self, kind, points, color, shade, normal, block, tile):
        self.kind = kind
        self.points = points
        self.color = color
        self.shade = shade
        self.normal = normal
        self.block = block
        self.tile = tile


def _shade_color(color: str, factor: float) -> str:
    """Multiply an ``#rrggbb`` colour by ``factor``."""
    value = int(color[1:], 16)
    red = min(255, int(((value >> 16) & 0xFF) * factor))
    green = min(255, int(((value >> 8) & 0xFF) * factor))
    blue = min(255, int((value & 0xFF) * factor))
    return f"#{red:02x}{green:02x}{blue:02x}"


def block_shade_color(block_id: int, face: str, shade: float) -> str:
    """The flat colour a face is painted with."""
    block = BLOCKS[block_id]
    return _shade_color(block.color(FACE_TILES[face]), shade)


def sky_light(world, x: int, y: int, z: int, column_top: int) -> float:
    """How much sky reaches a cell.

    A cell at or above its column top sees the sky; below it, the upward scan stops at the first
    opaque block. Fully covered cells fade towards 0.3, which is what makes caves and overhangs read
    as dark without a light engine.
    """
    if y >= column_top:
        return 1.0
    opened = 0
    for scan in range(y + 1, WORLD_HEIGHT + 1):
        if IS_OPAQUE[world.get_block(x, scan, z)]:
            break
        opened += 1
        if opened >= SKY_SEARCH:
            return 1.0
    return 0.3 + 0.7 * (opened / SKY_SEARCH)


def _occlusion(world, x, y, z, face, corner_index) -> float:
    """Ambient occlusion for one vertex, from the three blocks tucked beside it."""
    definition = FACE_DEFS[face]
    normal = definition["normal"]
    u_sign, v_sign = definition["signs"][corner_index]
    ux, uy, uz = definition["u"]
    vx, vy, vz = definition["v"]

    def solid(along_u, along_v):
        px = x + normal[0] + (ux * u_sign if along_u else 0) + (vx * v_sign if along_v else 0)
        py = y + normal[1] + (uy * u_sign if along_u else 0) + (vy * v_sign if along_v else 0)
        pz = z + normal[2] + (uz * u_sign if along_u else 0) + (vz * v_sign if along_v else 0)
        return IS_OPAQUE[world.get_block(px, py, pz)]

    side_a = solid(True, False)
    side_b = solid(False, True)
    if side_a and side_b:
        return AO_LEVELS[0]
    diagonal = solid(True, True)
    count = (1 if side_a else 0) + (1 if side_b else 0) + (1 if diagonal else 0)
    return AO_LEVELS[min(3, 3 - count)]


def _visible(world, x, y, z, face, block_id) -> bool:
    """Would this face be seen, or does a neighbour hide it?"""
    normal = FACE_NORMALS[face]
    nx, ny, nz = x + normal[0], y + normal[1], z + normal[2]
    neighbour = world.get_block(nx, ny, nz)
    if IS_OPAQUE[neighbour]:
        return False
    if IS_LIQUID[block_id] and IS_LIQUID[neighbour]:
        return False
    block = BLOCKS[block_id]
    if block.cutout and neighbour == block_id:
        return False     # glass and leaves merge with their own kind
    return True


def mesh_chunk(world, chunk, column_tops=None) -> list[Face]:
    """Every visible face of a chunk, ready to sort and draw."""
    faces: list[Face] = []
    base_x = chunk.cx * CHUNK_SIZE
    base_z = chunk.cz * CHUNK_SIZE
    tops = column_tops or {}

    for y in range(chunk.highest + 1):
        for z in range(CHUNK_SIZE):
            for x in range(CHUNK_SIZE):
                block_id = chunk.get(x, y, z)
                if block_id == 0:
                    continue
                world_x = base_x + x
                world_z = base_z + z
                block = BLOCKS[block_id]
                top = tops.get((x, z), chunk.height(x, z))

                if block.plant:
                    faces.extend(_mesh_plant(world, block_id, world_x, y, world_z, top))
                    continue

                liquid = block.liquid
                jitter = 0.95 + hash_float(world_x, y, world_z, 7717) * 0.1
                # The top layer of a liquid sits a little lower, so the surface reads as water.
                drop = WATER_DROP if liquid and world.get_block(world_x, y + 1, world_z) == 0 else 0.0

                for face in FACE_ORDER:
                    if not _visible(world, world_x, y, world_z, face, block_id):
                        continue
                    normal = FACE_NORMALS[face]
                    light = FACE_SHADE[face] * jitter * sky_light(
                        world, world_x + normal[0], y + normal[1], world_z + normal[2], top)

                    points = []
                    for corner in face_corners(face):
                        px = world_x + corner[0]
                        py = y + corner[1] - (drop if corner[1] == 1 else 0.0)
                        pz = world_z + corner[2]
                        points.append((px, py, pz))

                    if liquid:
                        shade = light
                    else:
                        occlusion = sum(
                            _occlusion(world, world_x, y, world_z, face, index) for index in range(4)
                        ) / 4.0
                        shade = light * occlusion
                    kind = "water" if liquid else "cutout" if block.cutout else "opaque"
                    faces.append(Face(kind, tuple(points), block.color(FACE_TILES[face]),
                                      shade, normal, block_id, FACE_TILE[face]))
    return faces


def _mesh_plant(world, block_id: int, x: int, y: int, z: int, column_top: int) -> list[Face]:
    """Plants are two crossed quads, jittered so a field never looks like a grid."""
    block = BLOCKS[block_id]
    offset_x = (hash_float(x, 1, z, 131) - 0.5) * 0.3
    offset_z = (hash_float(x, 2, z, 131) - 0.5) * 0.3
    height = 0.86 + hash_float(x, 3, z, 131) * 0.18
    light = sky_light(world, x, y, z, column_top) * (0.9 + hash_float(x, y, z, 991) * 0.16)
    colour = block.color("side")

    quads = (
        ((0, 0, 1), ((0.0, 0.0, 0.5), (1.0, 0.0, 0.5), (1.0, height, 0.5), (0.0, height, 0.5))),
        ((1, 0, 0), ((0.5, 0.0, 1.0), (0.5, 0.0, 0.0), (0.5, height, 0.0), (0.5, height, 1.0))),
    )
    faces = []
    for normal, corners in quads:
        points = tuple(
            (x + corner[0] + offset_x, y + corner[1], z + corner[2] + offset_z) for corner in corners
        )
        faces.append(Face("plant", points, colour, light, normal, block_id, block.side))
    return faces


def count_faces(faces) -> dict:
    """How many faces of each kind a mesh holds."""
    counts = {"opaque": 0, "water": 0, "cutout": 0, "plant": 0}
    for face in faces:
        counts[face.kind] = counts.get(face.kind, 0) + 1
    return counts


def chunk_column_tops(chunk) -> dict:
    """Column tops for a chunk, used for the skylight estimate."""
    return {(x, z): chunk.height(x, z) for z in range(CHUNK_SIZE) for x in range(CHUNK_SIZE)}
