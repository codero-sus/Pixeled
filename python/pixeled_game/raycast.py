"""Voxel ray casting (3D DDA) used for aiming, mining and placing, and by the renderer."""

import math

from .blocks import AIR, WATER, WORLD_X, WORLD_Y, WORLD_Z


def raycast(world, origin, direction, max_distance=8.0, hit_liquid=True):
    """Step through the grid and return the first block the ray meets.

    Returns a dict with the block coordinates, the face normal, the distance, or None.
    """
    ox, oy, oz = origin
    dx, dy, dz = direction
    x, y, z = math.floor(ox), math.floor(oy), math.floor(oz)

    step_x = 1 if dx > 0 else -1
    step_y = 1 if dy > 0 else -1
    step_z = 1 if dz > 0 else -1
    delta_x = abs(1.0 / dx) if dx else 1e9
    delta_y = abs(1.0 / dy) if dy else 1e9
    delta_z = abs(1.0 / dz) if dz else 1e9

    max_x = ((x + 1 - ox) if dx > 0 else (ox - x)) * delta_x
    max_y = ((y + 1 - oy) if dy > 0 else (oy - y)) * delta_y
    max_z = ((z + 1 - oz) if dz > 0 else (oz - z)) * delta_z

    distance = 0.0
    normal = (0, 0, 0)
    while distance <= max_distance:
        if x < 0 or x >= WORLD_X or z < 0 or z >= WORLD_Z:
            return None
        if 0 <= y < WORLD_Y:
            block_id = world.data[(y * WORLD_Z + z) * WORLD_X + x]
            if block_id != AIR and (block_id != WATER or hit_liquid):
                return {"x": x, "y": y, "z": z, "nx": normal[0], "ny": normal[1], "nz": normal[2],
                        "distance": distance, "id": block_id}
        elif (y < 0 and dy <= 0) or (y >= WORLD_Y and dy >= 0):
            return None
        if max_x < max_y and max_x < max_z:
            x += step_x
            distance = max_x
            max_x += delta_x
            normal = (-step_x, 0, 0)
        elif max_y < max_z:
            y += step_y
            distance = max_y
            max_y += delta_y
            normal = (0, -step_y, 0)
        else:
            z += step_z
            distance = max_z
            max_z += delta_z
            normal = (0, 0, -step_z)
    return None


def placement_cell(hit):
    """The empty cell in front of the face that was hit."""
    return (hit["x"] + hit["nx"], hit["y"] + hit["ny"], hit["z"] + hit["nz"])
