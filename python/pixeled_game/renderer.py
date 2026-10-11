"""A small software 3D renderer for Tkinter — real perspective, no OpenGL required.

Every visible block face is projected by hand into screen space, sorted back to front (the painter's
algorithm), then drawn as a filled polygon on a Tk canvas with fog blended into the colour. Item
ids are recycled between frames, which is what makes a pure-Python painter fast enough to walk
around in.

The maths lives in :class:`SceneRenderer` and the Tk drawing in :class:`TkPainter`, so the renderer
can be tested without a display.
"""

from __future__ import annotations

import math

from .blocks import CHUNK_SIZE, SEA_LEVEL
from .mesher import chunk_column_tops, mesh_chunk

NEAR_PLANE = 0.2
SCREEN_LIMIT = 4000.0


class Camera:
    """Eye, yaw, pitch and field of view."""

    def __init__(self, x=0.0, y=0.0, z=0.0, yaw=0.0, pitch=0.0, fov=72.0):
        self.x = x
        self.y = y
        self.z = z
        self.yaw = yaw
        self.pitch = pitch
        self.fov = fov
        self._basis()

    def _basis(self):
        cos_pitch = math.cos(self.pitch)
        self.forward = (
            -math.sin(self.yaw) * cos_pitch,
            math.sin(self.pitch),
            -math.cos(self.yaw) * cos_pitch,
        )
        self.right = (math.cos(self.yaw), 0.0, -math.sin(self.yaw))
        # up = right × forward
        rx, ry, rz = self.right
        fx, fy, fz = self.forward
        self.up = (ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx)

    def move_to(self, x, y, z, yaw, pitch):
        self.x, self.y, self.z = x, y, z
        self.yaw, self.pitch = yaw, pitch
        self._basis()

    def project(self, point, width, height):
        """World point → camera-space point: (right, up, depth)."""
        px, py, pz = point[0] - self.x, point[1] - self.y, point[2] - self.z
        rx, ry, rz = self.right
        ux, uy, uz = self.up
        fx, fy, fz = self.forward
        return (
            px * rx + py * ry + pz * rz,
            px * ux + py * uy + pz * uz,
            px * fx + py * fy + pz * fz,
        )

    def screen_point(self, camera_point, width, height):
        focal = (height / 2) / math.tan(math.radians(self.fov) / 2)
        depth = camera_point[2]
        return (
            width / 2 + camera_point[0] * focal / depth,
            height / 2 - camera_point[1] * focal / depth,
        )


def _clip_near(points):
    """Clip a camera-space polygon against the near plane (Sutherland–Hodgman)."""
    out = []
    count = len(points)
    for index in range(count):
        current = points[index]
        following = points[(index + 1) % count]
        current_inside = current[2] >= NEAR_PLANE
        following_inside = following[2] >= NEAR_PLANE
        if current_inside:
            out.append(current)
        if current_inside != following_inside:
            t = (NEAR_PLANE - current[2]) / (following[2] - current[2])
            out.append((
                current[0] + (following[0] - current[0]) * t,
                current[1] + (following[1] - current[1]) * t,
                NEAR_PLANE,
            ))
    return out


def _mix(color_a, color_b, amount):
    """Blend two ``#rrggbb`` colours; ``amount`` 0 keeps a, 1 keeps b."""
    a = int(color_a[1:], 16)
    b = int(color_b[1:], 16)
    red = int(((a >> 16) & 0xFF) * (1 - amount) + ((b >> 16) & 0xFF) * amount)
    green = int(((a >> 8) & 0xFF) * (1 - amount) + ((b >> 8) & 0xFF) * amount)
    blue = int((a & 0xFF) * (1 - amount) + (b & 0xFF) * amount)
    return f"#{red:02x}{green:02x}{blue:02x}"


def shade(color: str, factor: float) -> str:
    """Multiply a colour by a brightness factor."""
    value = int(color[1:], 16)
    red = max(0, min(255, int(((value >> 16) & 0xFF) * factor)))
    green = max(0, min(255, int(((value >> 8) & 0xFF) * factor)))
    blue = max(0, min(255, int((value & 0xFF) * factor)))
    return f"#{red:02x}{green:02x}{blue:02x}"


class SceneRenderer:
    """Culls, sorts and projects the world into a flat list of polygons."""

    def __init__(self, world, settings):
        self.world = world
        self.settings = settings
        self.camera = Camera(fov=settings.get("fov", 72))
        self.chunk_faces: dict[tuple[int, int], list] = {}
        self.triangles_drawn = 0
        self.chunks_drawn = 0

    # ------------------------------------------------------------------ chunks

    def set_world(self, world):
        self.world = world
        self.chunk_faces.clear()

    def stream_chunks(self, player):
        """Make sure every chunk within the render distance is generated and meshed."""
        radius = self.settings.get("render_distance", 3)
        center_x = int(player.position["x"]) >> 4
        center_z = int(player.position["z"]) >> 4
        wanted = set()
        for dx in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                if dx * dx + dz * dz > radius * radius + radius:
                    continue
                cx, cz = center_x + dx, center_z + dz
                wanted.add((cx, cz))
                chunk = self.world.ensure_chunk(cx, cz)
                if chunk.dirty or (cx, cz) not in self.chunk_faces:
                    self.chunk_faces[(cx, cz)] = mesh_chunk(self.world, chunk, chunk_column_tops(chunk))
                    chunk.dirty = False
        for key in list(self.chunk_faces):
            if key not in wanted:
                del self.chunk_faces[key]

    def rebuild(self, cx, cz):
        """Re-mesh one chunk (after the player changed a block in or next to it)."""
        chunk = self.world.chunk(cx, cz)
        if chunk is None:
            return
        self.chunk_faces[(cx, cz)] = mesh_chunk(self.world, chunk, chunk_column_tops(chunk))
        chunk.dirty = False

    def mark_block_dirty(self, x, z):
        cx, cz = x >> 4, z >> 4
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if self.world.has_chunk(cx + dx, cz + dz):
                    self.rebuild(cx + dx, cz + dz)

    # ------------------------------------------------------------------ drawing

    def frame(self, player, width, height, sky_color="#9fc6e8", fog_color="#c3dbec", daylight=1.0):
        """Return a back-to-front list of polygons ready for the canvas."""
        radius = self.settings.get("render_distance", 3)
        fov = self.settings.get("fov", 72)
        self.camera.fov = fov
        eye = player.eye()
        self.camera.move_to(eye["x"], eye["y"], eye["z"], player.yaw, player.pitch)
        focal = (height / 2) / math.tan(math.radians(fov) / 2)
        fog_near = 24.0
        fog_far = radius * CHUNK_SIZE - 4.0

        forward = self.camera.forward
        eye_x, eye_y, eye_z = self.camera.x, self.camera.y, self.camera.z
        polygons = []
        self.chunks_drawn = 0

        for (cx, cz), faces in self.chunk_faces.items():
            # Skip whole chunks behind the player — a big win for a Python painter.
            center_x = cx * CHUNK_SIZE + 8
            center_z = cz * CHUNK_SIZE + 8
            to_chunk = (center_x - eye_x, center_z - eye_z)
            if to_chunk[0] * forward[0] + to_chunk[1] * forward[2] < -CHUNK_SIZE * 1.5:
                continue
            self.chunks_drawn += 1
            for face in faces:
                points = face.points
                center = (
                    (points[0][0] + points[2][0]) / 2,
                    (points[0][1] + points[2][1]) / 2,
                    (points[0][2] + points[2][2]) / 2,
                )
                distance = math.dist(center, (eye_x, eye_y, eye_z))
                if distance > fog_far + 6:
                    continue
                normal = face.normal
                if face.kind != "plant" and (
                        normal[0] * (center[0] - eye_x)
                        + normal[1] * (center[1] - eye_y)
                        + normal[2] * (center[2] - eye_z)) >= 0:
                    continue    # facing away — plants are two-sided, exactly like the web cutout pass
                camera_points = [self.camera.project(point, width, height) for point in points]
                clipped = _clip_near(camera_points)
                if len(clipped) < 3:
                    continue
                screen = []
                for point in clipped:
                    sx, sy = self.camera.screen_point(point, width, height)
                    # A face right at the near plane projects to wild coordinates; clamp them so
                    # the canvas never chokes on absurd polygon corners.
                    screen.append((
                        max(-SCREEN_LIMIT, min(SCREEN_LIMIT, sx)),
                        max(-SCREEN_LIMIT, min(SCREEN_LIMIT, sy)),
                    ))
                fog = 0.0 if distance <= fog_near else min(0.72, (distance - fog_near) / max(1.0, fog_far - fog_near))
                colour = shade(face.color, face.shade * (0.35 + 0.65 * daylight))
                colour = _mix(colour, fog_color, fog)
                if face.kind == "water":
                    colour = _mix(colour, "#2f6fc0", 0.35)
                polygons.append((distance, screen, colour, face.kind))

        polygons.sort(key=lambda entry: -entry[0])   # far first: the painter's algorithm
        self.triangles_drawn = len(polygons)
        return polygons


class TkPainter:
    """Draws polygons on a Tk canvas, reusing items between frames."""

    def __init__(self, canvas, width, height):
        self.canvas = canvas
        self.width = width
        self.height = height
        self.items = []
        self.used = 0
        self.sky_item = canvas.create_rectangle(0, 0, width, height, fill="#9fc6e8", outline="")
        self.canvas.tag_lower(self.sky_item)

    def set_sky(self, color: str):
        self.canvas.itemconfigure(self.sky_item, fill=color)

    def begin(self):
        self.used = 0

    def polygon(self, points, fill, stipple=""):
        """Draw one polygon, reusing a canvas item when we can."""
        flat = []
        for x, y in points:
            flat.append(x)
            flat.append(y)
        if self.used < len(self.items):
            item = self.items[self.used]
            self.canvas.coords(item, *flat)
            self.canvas.itemconfigure(item, fill=fill, stipple=stipple, state="normal")
        else:
            item = self.canvas.create_polygon(*flat, fill=fill, outline=fill, stipple=stipple or None)
            self.items.append(item)
        self.used += 1

    def end(self):
        """Hide the leftover items from the previous frame."""
        for index in range(self.used, len(self.items)):
            self.canvas.itemconfigure(self.items[index], state="hidden")

    def line(self, x1, y1, x2, y2, colour, width=1):
        return self.canvas.create_line(x1, y1, x2, y2, fill=colour, width=width)

    def text(self, x, y, text, colour="#ffffff", anchor="nw", font=None):
        return self.canvas.create_text(x, y, text=text, fill=colour, anchor=anchor, font=font)
