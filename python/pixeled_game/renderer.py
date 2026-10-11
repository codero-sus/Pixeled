"""Software 3D renderer for the Python edition.

Terrain is drawn with a heightfield row sweep (the classic Voxel-Space technique): every screen
pixel solves for the world distance at which its ray meets the landscape, so hills, valleys,
cliffs and the sea all come out of one pass, lit by the sun direction and faded into the sky
colour behind them. Trees and player-built blocks are then drawn as true voxel cubes with a
depth buffer, so they can be built up, hidden behind hills and walked around exactly like in the
WebGL edition. Everything lands in one flat RGB bytearray that Tk reads as a PPM photo image.
"""

import math
from array import array

from .blocks import (
    AIR, LEAVES, SAND, SEA_LEVEL, SNOW, WATER, WORLD_X, WORLD_Z, face_colour,
)
from .noise import hash_coords

FOV = math.radians(76)
MAX_DISTANCE = 128.0         # how far rays march
FOG_DISTANCE = 190.0         # distance at which terrain has faded into the sky
CUBE_RADIUS = 26.0          # how far individual tree/built blocks are drawn

DAY = {"zenith": (58, 124, 216), "horizon": (188, 218, 243), "sun": (255, 244, 214)}
DUSK = {"zenith": (62, 82, 152), "horizon": (250, 158, 96), "sun": (255, 214, 156)}
NIGHT = {"zenith": (9, 16, 48), "horizon": (26, 38, 74), "sun": (206, 218, 255)}

FACES = (
    # (axis, sign, corners) with corner offsets in 0..1
    (1, 1, ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1))),      # top
    (1, -1, ((0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0))),     # bottom
    (0, -1, ((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1))),     # -x
    (0, 1, ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0))),      # +x
    (2, -1, ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0))),     # -z
    (2, 1, ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),      # +z
)
FACE_LIGHT = {(1, 1): 1.0, (1, -1): 0.5, (0, -1): 0.72, (0, 1): 0.72, (2, -1): 0.86, (2, 1): 0.86}

_TOP_CACHE = {}
_SIDE_CACHE = {}


def _block_top(block_id):
    """Top colour of a block id, cached (hot path)."""
    colour = _TOP_CACHE.get(block_id)
    if colour is None:
        colour = face_colour(block_id, 1, 1)
        _TOP_CACHE[block_id] = colour
    return colour


def _face_side(block_id):
    """Side colour of a block id, cached (hot path)."""
    colour = _SIDE_CACHE.get(block_id)
    if colour is None:
        colour = face_colour(block_id, 0, 1)
        _SIDE_CACHE[block_id] = colour
    return colour


WATER_TOP = face_colour(WATER, 1, 1)
WATER_SHALLOW = (0x8E, 0xC8, 0xF0)


def _mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def _clamp01(value):
    return 0.0 if value < 0 else 1.0 if value > 1 else value


def _byte(value):
    return 0 if value < 0 else 255 if value > 255 else int(value)


def sky_palette(clock):
    """Sun direction and colours for a 0..1 day clock (0 midnight, 0.5 noon)."""
    height = math.sin((clock - 0.25) * math.pi * 2)
    day = _clamp01((height + 0.08) / 0.5)
    dusk = _clamp01(1 - abs(height) / 0.32)
    zenith = _mix(NIGHT["zenith"], DAY["zenith"], day)
    horizon = _mix(NIGHT["horizon"], DAY["horizon"], day)
    zenith = _mix(zenith, DUSK["zenith"], dusk * 0.5)
    horizon = _mix(horizon, DUSK["horizon"], dusk * 0.8)
    sun = _mix(NIGHT["sun"], DAY["sun"], day)
    sun = _mix(sun, DUSK["horizon"], dusk * 0.55)
    angle = (clock - 0.25) * math.pi * 2
    direction = (math.cos(angle), max(0.06, math.sin(angle)), 0.34)
    length = math.sqrt(sum(component * component for component in direction))
    direction = tuple(component / length for component in direction)
    return {"zenith": zenith, "horizon": horizon, "sun": sun, "sun_direction": direction, "day": day}


def camera_basis(yaw, pitch):
    """Forward / right / up unit vectors for a yaw-pitch camera."""
    cos_pitch = math.cos(pitch)
    forward = (-math.sin(yaw) * cos_pitch, math.sin(pitch), -math.cos(yaw) * cos_pitch)
    right = (math.cos(yaw), 0.0, -math.sin(yaw))
    up = (right[1] * forward[2] - right[2] * forward[1],
          right[2] * forward[0] - right[0] * forward[2],
          right[0] * forward[1] - right[1] * forward[0])
    return forward, right, up


class SoftwareRenderer:
    """Renders the world into a flat RGB bytearray (Tk shows it as a PPM photo image)."""

    def __init__(self, width=224, height=126, fov=FOV, distance=MAX_DISTANCE):
        self.width = width
        self.height = height
        self.focal = (width / 2) / math.tan(fov / 2)
        self.buffer = bytearray(width * height * 3)
        self.inv_depth = array("f", [0.0]) * (width * height)
        self.max_distance = distance
        self.row_colours = [(0.0, 0.0, 0.0)] * height
        self.last_samples = 0
        self._flat_version = None

    # ------------------------------------------------------------------ frame

    def render(self, world, player, clock=0.35, target=None, time=0.0):
        """Paint one frame from the player's eyes and return the RGB buffer."""
        palette = sky_palette(clock)
        forward, right, up = camera_basis(player.yaw, player.pitch)
        eye = player.eye
        self.paint_sky(palette, forward, right, up)
        self.inv_depth[:] = array("f", [0.0]) * (self.width * self.height)
        self.paint_terrain(world, eye, forward, right, up, palette, time)
        self.draw_objects(world, eye, forward, right, up)
        if target is not None:
            self.draw_block_outline(target, eye, forward, up)
        self.draw_crosshair()
        return self.buffer

    # ------------------------------------------------------------------ sky

    def paint_sky(self, palette, forward, right, up):
        """Sky gradient with a sun glow and a hazy void below the horizon."""
        width, height = self.width, self.height
        buffer = self.buffer
        zenith, horizon = palette["zenith"], palette["horizon"]
        void = _mix(horizon, (0, 0, 0), 0.34)
        half = height / 2
        pitch = math.asin(max(-1.0, min(1.0, forward[1])))
        rows = self.row_colours
        for row in range(height):
            elevation = math.atan((half - row - 0.5) / self.focal) + pitch
            if elevation >= 0:
                colour = _mix(horizon, zenith, _clamp01(elevation / 1.1) ** 0.75)
            else:
                colour = _mix(horizon, void, _clamp01(-elevation / 0.7) ** 0.7)
            rows[row] = colour
            index = row * width * 3
            buffer[index:index + width * 3:3] = bytes([_byte(colour[0])]) * width
            buffer[index + 1:index + width * 3:3] = bytes([_byte(colour[1])]) * width
            buffer[index + 2:index + width * 3:3] = bytes([_byte(colour[2])]) * width
        self.paint_sun(palette, forward, right, up)

    def paint_sun(self, palette, forward, right, up):
        position = self.project(palette["sun_direction"], forward, right, up)
        if position is None:
            return
        centre_x, centre_y = position
        radius = self.focal * 0.03
        halo = radius * 3.4
        sun_colour = palette["sun"]
        for row in range(max(0, int(centre_y - halo)), min(self.height, int(centre_y + halo) + 1)):
            for column in range(max(0, int(centre_x - halo)), min(self.width, int(centre_x + halo) + 1)):
                distance = math.hypot(column - centre_x, row - centre_y)
                if distance >= halo:
                    continue
                glow = 1 - distance / halo
                strength = 1.0 if distance < radius else min(1.0, glow * glow * 1.25)
                index = (row * self.width + column) * 3
                current = (self.buffer[index], self.buffer[index + 1], self.buffer[index + 2])
                blended = _mix(current, sun_colour, strength)
                self.buffer[index] = _byte(blended[0])
                self.buffer[index + 1] = _byte(blended[1])
                self.buffer[index + 2] = _byte(blended[2])

    # ------------------------------------------------------------------ terrain

    def flat_surfaces(self, world):
        """Padded, flattened surface heights and block ids, rebuilt only after an edit.

        The padding duplicates the border columns so slope lookups never need bounds checks.
        """
        if self._flat_version != world.version:
            span = WORLD_Z + 2
            total = (WORLD_X + 2) * span
            ground = [-2.0] * total          # surface height of the visible ground / water
            water = [-3.0] * total           # water surface height, -3 where there is none
            land = [0] * total               # block id of the terrain column top
            ground_top, water_top, data = world.ground_top, world.water_top, world.data
            for x in range(WORLD_X):
                column = ground_top[x]
                wet = water_top[x]
                row = (x + 1) * span + 1
                for z in range(WORLD_Z):
                    index = row + z
                    height = column[z]
                    level = wet[z]
                    if height >= 0:
                        land[index] = data[(height * WORLD_Z + z) * WORLD_X + x]
                        ground[index] = float(height + 1)
                        water[index] = float(level) if level >= 0 else -3.0
                    else:
                        water[index] = float(level) if level >= 0 else -3.0
            last_x = WORLD_X * span
            for x in range(-1, WORLD_X + 1):
                source = 0 if x < 0 else WORLD_X - 1 if x >= WORLD_X else x
                row = (source + 1) * span
                for z in (-1, WORLD_Z):
                    target = row + z + 1
                    source_z = row + (0 if z < 0 else WORLD_Z - 1) + 1
                    ground[target] = ground[source_z]
                    water[target] = water[source_z]
                    land[target] = land[source_z]
            for z in range(-1, WORLD_Z + 1):
                target = z + 1
                ground[target] = ground[span + target]
                water[target] = water[span + target]
                land[target] = land[span + target]
                ground[last_x + target] = ground[last_x - span + target]
                water[last_x + target] = water[last_x - span + target]
                land[last_x + target] = land[last_x - span + target]
            self._flat_version = world.version
            self._flat_ground = ground
            self._flat_water = water
            self._flat_land = land
        return self._flat_ground, self._flat_water, self._flat_land

    def paint_terrain(self, world, eye, forward, right, up, palette, time):
        """Row sweep with a marching pointer per column (the classic Voxel-Space loop).

        Rows go bottom-up and the hit distance of a column only ever grows as the row climbs, so
        each column keeps its own distance and step and carries them into the next row. A pixel
        that meets a column's top face is refined to the exact plane crossing (a crisp
        silhouette); one that runs into a vertical side keeps its entry distance and is shaded
        with the side colour, so cliffs read as real faces.
        """
        width, height = self.width, self.height
        half = height / 2
        focal = self.focal
        eye_x, eye_y, eye_z = eye
        sun = palette["sun_direction"]
        step_x, step_y, step_z = up
        distances = [1.2] * width           # marching pointer, per column
        steps = [0.35] * width              # adaptive march step, per column
        buffer = self.buffer
        inv_depth = self.inv_depth
        row_colours = self.row_colours
        ground, water, land = self.flat_surfaces(world)
        span = WORLD_Z + 2
        max_distance = self.max_distance
        samples = 0

        top_row = self.column_tops(world, eye, forward, right, up)
        first_row = max(0, min(top_row))

        base_x = [0.0] * width              # per-column ray directions, minus the row step term
        base_z = [0.0] * width
        for column in range(width):
            u = (column + 0.5 - width / 2) / focal
            base_x[column] = forward[0] + right[0] * u
            base_z[column] = forward[2] + right[2] * u
        forward_x, forward_y, forward_z = forward

        row_pixels = bytearray(width * 3)
        for row in range(height - 1, first_row - 1, -1):
            v = (half - row - 0.5) / focal
            diry = forward_y + step_y * v
            if abs(diry) < 1e-7:
                continue
            sky = row_colours[row]
            row_offset = row * width
            start = row_offset * 3
            # Keep whatever is on screen (sky or void) in the pixels this row does not paint.
            row_pixels[:] = buffer[start:start + width * 3]
            step_vx = step_x * v
            step_vz = step_z * v
            painted = False
            for column in range(width):
                if row < top_row[column]:
                    continue
                dir_x = base_x[column] + step_vx
                dir_z = base_z[column] + step_vz
                distance = distances[column]
                step = steps[column]
                previous = distance - step if distance > step else 0.25
                cell_x = cell_z = -1
                surface_top = 0.0
                # Coarse phase: march until the ray is at or below the surface of the column of
                # landscape it is passing over. Because the step can overshoot, a bisection pass
                # then pins the crossing down inside the interval it was found in.
                for _ in range(400):
                    if distance >= max_distance:
                        cell_x = -1
                        break
                    point_x = eye_x + dir_x * distance
                    point_z = eye_z + dir_z * distance
                    if point_x < 0.0 or point_z < 0.0:
                        cell_x = -1
                        break
                    cell_x = int(point_x)
                    cell_z = int(point_z)
                    if cell_x >= WORLD_X or cell_z >= WORLD_Z:
                        cell_x = -1
                        break
                    index = (cell_x + 1) * span + cell_z + 1
                    column_ground = ground[index]
                    if column_ground < -1.0:
                        cell_x = -1
                        break                     # void: outside the island
                    column_water = water[index]
                    surface_top = (column_water if column_water > column_ground else column_ground) + 1.0
                    if eye_y + diry * distance <= surface_top:
                        break                     # inside the landscape column
                    previous = distance
                    distance += step
                    step += step * 0.02 + 0.01
                    if step > 2.5:
                        step = 2.5
                if cell_x < 0:
                    continue
                # Refine inside [previous, distance], where the crossing must lie.
                low, high = previous, distance
                for _ in range(6):
                    middle = (low + high) * 0.5
                    cell_x = int(eye_x + dir_x * middle)
                    cell_z = int(eye_z + dir_z * middle)
                    if cell_x < 0 or cell_z < 0 or cell_x >= WORLD_X or cell_z >= WORLD_Z:
                        high = middle
                        continue
                    top = ground[(cell_x + 1) * span + cell_z + 1] + 1.0
                    if eye_y + diry * middle <= top:
                        high = middle
                    else:
                        low = middle
                distance = high
                cell_x = int(eye_x + dir_x * distance)
                cell_z = int(eye_z + dir_z * distance)
                if cell_x < 0 or cell_z < 0 or cell_x >= WORLD_X or cell_z >= WORLD_Z:
                    continue
                index = (cell_x + 1) * span + cell_z + 1
                surface_top = ground[index] + 1.0
                # A ray that entered this cell already below its top plane ran into a cliff face.
                entry = previous if previous < distance else distance - step
                wall = eye_y + diry * entry <= surface_top - 0.02
                distances[column] = distance
                steps[column] = step
                samples += 1
                column_ground = ground[index]
                column_water = water[index]
                is_water = column_water > column_ground and not wall
                surface = column_water if is_water else column_ground
                if is_water:
                    depth_water = column_water - column_ground
                    base = _mix(WATER_TOP, WATER_SHALLOW, 1.0 / (1.0 + depth_water))
                    ripple = 0.94 + 0.06 * math.sin(time * 1.9 + cell_x * 0.55 + cell_z * 0.4)
                    light = (0.86 + 0.26 * sun[1]) * ripple
                else:
                    block_id = land[index]
                    base = _block_top(block_id)
                    slope_x = column_ground - ground[index - span]
                    slope_z = column_ground - ground[index - 1]
                    normal_x, normal_z = -slope_x * 0.7, -slope_z * 0.7
                    inverse = 1.0 / math.sqrt(normal_x * normal_x + normal_z * normal_z + 1.0)
                    lambert = max(0.0, (normal_x * sun[0] + normal_z * sun[2]) * inverse + sun[1] * inverse)
                    light = 0.52 + 0.6 * lambert
                    if wall:
                        # A cliff face: side colour, shaded by how deep below its top we hit.
                        depth_in_face = _clamp01((surface_top - (eye_y + diry * distance)) / 3.0)
                        light *= 0.62 + 0.2 * depth_in_face
                        base = _face_side(block_id)
                    if block_id == SNOW or (block_id == SAND and surface <= SEA_LEVEL + 1):
                        light = min(1.26, light + 0.07)
                grain = 0.93 + hash_coords(cell_x, int(surface), cell_z, 17) * 0.1
                if (cell_x + cell_z) & 1:
                    grain *= 1.03
                fog = _clamp01((distance / FOG_DISTANCE) ** 1.45)
                if is_water:
                    fog = min(1.0, fog + 0.08)
                colour = _mix((base[0] * light * grain, base[1] * light * grain,
                               base[2] * light * grain), sky, fog)
                column_offset = column * 3
                row_pixels[column_offset] = _byte(colour[0])
                row_pixels[column_offset + 1] = _byte(colour[1])
                row_pixels[column_offset + 2] = _byte(colour[2])
                painted = True
                forward_depth = distance * (dir_x * forward_x + diry * forward_y + dir_z * forward_z)
                if forward_depth > 0.12:
                    inv_depth[row_offset + column] = 1.0 / forward_depth
            if painted:
                buffer[start:start + width * 3] = row_pixels
        self.last_samples = samples

    def column_tops(self, world, eye, forward, right, up):
        """Topmost screen row that can show terrain for each column.

        Marches each column's azimuth once and keeps the greatest angular height, which is what
        lets a mountain at or above eye level poke over the horizon line.
        """
        width = self.width
        eye_x, eye_y, eye_z = eye
        tops = [0] * width
        forward_x, forward_z = forward[0], forward[2]
        right_x, right_z = right[0], right[2]
        for column in range(0, width, 2):
            u = (column + 0.5 - width / 2) / self.focal
            dir_x = forward_x + right_x * u
            dir_z = forward_z + right_z * u
            length = math.hypot(dir_x, dir_z) or 1.0
            dir_x, dir_z = dir_x / length, dir_z / length
            step = 1.0
            distance = 1.0
            best = -1e9
            while distance < self.max_distance:
                cell_x = int(eye_x + dir_x * distance)
                if cell_x < 0 or cell_x >= WORLD_X:
                    break
                cell_z = int(eye_z + dir_z * distance)
                if cell_z < 0 or cell_z >= WORLD_Z:
                    break
                surface, _block, _liquid = world.surface(cell_x, cell_z)
                if surface >= 0:
                    rise = (surface + 1.0 - eye_y) / distance
                    if rise > best:
                        best = rise
                distance += step
                step += 0.08
            top = self.height / 2 - best * self.focal if best > -1e8 else 0
            top = max(0, min(self.height - 1, int(top)))
            tops[column] = top
            if column + 1 < width:
                tops[column + 1] = top
        del up
        return tops

    # ------------------------------------------------------------------ cubes

    def draw_objects(self, world, eye, forward, right, up):
        """Voxel cubes for trees and player-built blocks, far to near with a depth test."""
        eye_x, eye_y, eye_z = eye
        items = []
        for x, y, z, block_id in world.objects_near(eye_x, eye_z, CUBE_RADIUS):
            rel_x, rel_y, rel_z = x + 0.5 - eye_x, y + 0.5 - eye_y, z + 0.5 - eye_z
            depth = rel_x * forward[0] + rel_y * forward[1] + rel_z * forward[2]
            if depth < 0.4 or depth > self.max_distance:
                continue
            if self.hidden(world, x, y, z):
                continue
            items.append((depth, x, y, z, block_id))
        if not items:
            return
        items.sort(key=lambda item: -item[0])
        for depth, x, y, z, block_id in items:
            self.draw_cube(world, x, y, z, block_id, eye, forward, up)

    @staticmethod
    def hidden(world, x, y, z):
        """True when a cube is buried in solid neighbours and can never be seen."""
        return (world.is_solid(x + 1, y, z) and world.is_solid(x - 1, y, z)
                and world.is_solid(x, y + 1, z) and world.is_solid(x, y - 1, z)
                and world.is_solid(x, y, z + 1) and world.is_solid(x, y, z - 1))

    @staticmethod
    def face_culled(world, x, y, z, axis, sign, block_id):
        """Skip a face that is hidden by the neighbouring block (leaves against leaves too)."""
        neighbour = [x, y, z]
        neighbour[axis] += sign
        block = world.get(neighbour[0], neighbour[1], neighbour[2])
        if block == AIR or block == WATER:
            return False
        return world.is_solid(*neighbour) or block == block_id

    def draw_cube(self, world, x, y, z, block_id, eye, forward, up):
        eye_x, eye_y, eye_z = eye
        to_eye = (eye_x - (x + 0.5), eye_y - (y + 0.5), eye_z - (z + 0.5))
        width, height = self.width, self.height
        for axis, sign, corners in FACES:
            normal = [0, 0, 0]
            normal[axis] = sign
            if to_eye[0] * normal[0] + to_eye[1] * normal[1] + to_eye[2] * normal[2] <= 0.02:
                continue
            if self.face_culled(world, x, y, z, axis, sign, block_id):
                continue
            projected = []
            for corner_x, corner_y, corner_z in corners:
                point = self.project_point(eye, forward, up, x + corner_x, y + corner_y, z + corner_z)
                if point is None:
                    projected = None
                    break
                projected.append(point)
            if projected is None:
                continue
            sky = self.row_colours[max(0, min(height - 1, int(projected[0][1])))]
            light = FACE_LIGHT[(axis, sign)]
            base = face_colour(block_id, axis, sign)
            grain = 0.95 + hash_coords(x, y, z, 23) * 0.1
            if block_id == LEAVES:
                # Chequered leaf texels so canopies read as foliage rather than plastic.
                grain *= 0.86 + 0.28 * ((x + y * 2 + z * 3) & 1)
            corner_depths = []
            for corner_x, corner_y, corner_z in corners:
                point_x = x + corner_x - eye_x
                point_y = y + corner_y - eye_y
                point_z = z + corner_z - eye_z
                corner_depths.append(point_x * forward[0] + point_y * forward[1] + point_z * forward[2])
            average = sum(corner_depths) / 4.0
            fog = _clamp01((average / FOG_DISTANCE) ** 2.2)
            colour = _mix((base[0] * light * grain, base[1] * light * grain, base[2] * light * grain), sky, fog)
            self.fill_quad(projected, colour, corner_depths)
        del width, height

    def fill_quad(self, projected, colour, depths):
        """Rasterise a convex quad with per-pixel perspective-correct depth.

        Inverse depths interpolate linearly in screen space, so the inner loop is just edge
        function increments plus one compare per pixel.
        """
        red, green, blue = _byte(colour[0]), _byte(colour[1]), _byte(colour[2])
        width, height = self.width, self.height
        inv_depth = self.inv_depth
        buffer = self.buffer
        p0, p1, p2, p3 = projected
        d0, d1, d2, d3 = depths
        for (ax, ay), (bx, by), (cx, cy), da, db, dc in ((p0, p1, p2, d0, d1, d2), (p0, p2, p3, d0, d2, d3)):
            if da <= 0.05 or db <= 0.05 or dc <= 0.05:
                continue
            min_x = max(0, int(min(ax, bx, cx)))
            max_x = min(width - 1, int(max(ax, bx, cx)) + 1)
            min_y = max(0, int(min(ay, by, cy)))
            max_y = min(height - 1, int(max(ay, by, cy)) + 1)
            if min_x > max_x or min_y > max_y:
                continue
            area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            if abs(area) < 1e-5:
                continue
            inverse = 1.0 / area
            ia, ib, ic = 1.0 / da, 1.0 / db, 1.0 / dc
            # Edge functions w0(x, y) and w1(x, y), and the inverse depth they interpolate.
            w0_x = -(by - ay) * inverse
            w0_y = (bx - ax) * inverse
            w1_x = -(cy - by) * inverse
            w1_y = (cx - bx) * inverse
            start_x, start_y = min_x + 0.5, min_y + 0.5
            w0_row = ((bx - ax) * (start_y - ay) - (start_x - ax) * (by - ay)) * inverse
            w1_row = ((cx - bx) * (start_y - by) - (start_x - bx) * (cy - by)) * inverse
            step_inv0 = w0_x * (ia - ic)
            step_inv1 = w1_x * (ib - ic)
            row_inv0 = w0_y * (ia - ic)
            row_inv1 = w1_y * (ib - ic)
            for row in range(min_y, max_y + 1):
                w0 = w0_row
                w1 = w1_row
                pixel_inv = ic + w0 * (ia - ic) + w1 * (ib - ic)
                base = row * width
                for column in range(min_x, max_x + 1):
                    if w0 >= 0.0 and w1 >= 0.0 and (w0 + w1) <= 1.0:
                        index = base + column
                        if pixel_inv > inv_depth[index]:
                            inv_depth[index] = pixel_inv
                            offset = index * 3
                            buffer[offset] = red
                            buffer[offset + 1] = green
                            buffer[offset + 2] = blue
                    w0 += w0_x
                    w1 += w1_x
                    pixel_inv += step_inv0 + step_inv1
                w0_row += w0_y
                w1_row += w1_y

    # ------------------------------------------------------------------ overlays

    def draw_block_outline(self, target, eye, forward, up):
        """Wireframe cube around the block being aimed at."""
        x, y, z = target
        corners = []
        for dy in (-0.004, 1.004):
            for dz in (-0.004, 1.004):
                for dx in (-0.004, 1.004):
                    corners.append(self.project_point(eye, forward, up, x + dx, y + dy, z + dz))
        if any(point is None for point in corners):
            return
        for a, b in ((0, 1), (1, 3), (3, 2), (2, 0), (4, 5), (5, 7), (7, 6), (6, 4),
                     (0, 4), (1, 5), (2, 6), (3, 7)):
            self.draw_line(corners[a], corners[b], (18, 18, 22))

    def draw_line(self, start, end, colour):
        x0, y0 = start
        x1, y1 = end
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        if steps > 4096:
            return
        for index in range(steps):
            t = index / steps
            self.pixel(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t), colour)

    def draw_crosshair(self):
        centre_x, centre_y = self.width // 2, self.height // 2
        for offset in range(3, 8):
            self.pixel(centre_x + offset, centre_y, (255, 255, 255))
            self.pixel(centre_x - offset, centre_y, (255, 255, 255))
            self.pixel(centre_x, centre_y + offset, (255, 255, 255))
            self.pixel(centre_x, centre_y - offset, (255, 255, 255))
        self.pixel(centre_x, centre_y, (255, 255, 255))

    def pixel(self, x, y, colour):
        if 0 <= x < self.width and 0 <= y < self.height:
            index = (y * self.width + x) * 3
            self.buffer[index] = _byte(colour[0])
            self.buffer[index + 1] = _byte(colour[1])
            self.buffer[index + 2] = _byte(colour[2])

    def project(self, direction, forward, right, up):
        """Project a world direction to screen pixels, or None when it is behind the camera."""
        depth = sum(direction[i] * forward[i] for i in range(3))
        if depth <= 0.08:
            return None
        side = sum(direction[i] * right[i] for i in range(3))
        vertical = sum(direction[i] * up[i] for i in range(3))
        return (self.width / 2 + (side / depth) * self.focal,
                self.height / 2 - (vertical / depth) * self.focal)

    def project_point(self, eye, forward, up, x, y, z):
        """Screen position of a world point, or None when it is behind the camera."""
        rel_x, rel_y, rel_z = x - eye[0], y - eye[1], z - eye[2]
        depth = rel_x * forward[0] + rel_y * forward[1] + rel_z * forward[2]
        if depth <= 0.08:
            return None
        right_x, right_z = -forward[2], forward[0]
        length = math.hypot(right_x, right_z) or 1.0
        side = (rel_x * right_x + rel_z * right_z) / length
        vertical = rel_x * up[0] + rel_y * up[1] + rel_z * up[2]
        return (self.width / 2 + (side / depth) * self.focal,
                self.height / 2 - (vertical / depth) * self.focal)


def to_ppm(buffer, width, height):
    """Wrap an RGB bytearray in binary PPM, the format Tk's photo images read natively."""
    header = ("P6\n%d %d\n255\n" % (width, height)).encode("ascii")
    return header + bytes(buffer)
