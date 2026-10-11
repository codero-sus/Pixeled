"""The explorer's physics — the Python twin of the model half of ``web/player.js``.

An axis-aligned box that walks, swims, flies and jumps through the voxel world, resolving
collisions one axis at a time in small steps so a long fall cannot tunnel through the ground.
"""

from __future__ import annotations

import math

from .blocks import IS_PLANT, IS_SOLID, WATER, WORLD_HEIGHT

WIDTH = 0.6
HEIGHT = 1.7
EYE_HEIGHT = 1.55
WALK_SPEED = 4.6
SPRINT_SPEED = 6.4
FLY_SPEED = 11.0
GRAVITY = 30.0
JUMP_SPEED = 9.1
TERMINAL_VELOCITY = 52.0

EPSILON = 0.0005


class PlayerModel:
    def __init__(self, world, spawn=None):
        spawn = spawn or {"x": 0.5, "y": 60.0, "z": 0.5}
        self.world = world
        self.position = {"x": float(spawn["x"]), "y": float(spawn["y"]), "z": float(spawn["z"])}
        self.velocity = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.on_ground = False
        self.in_water = False
        self.flying = False
        self.yaw = 0.0
        self.pitch = 0.0
        self.walk_phase = 0.0
        self.walk_speed = 0.0

    # ------------------------------------------------------------------ queries

    def eye(self):
        return {
            "x": self.position["x"],
            "y": self.position["y"] + EYE_HEIGHT,
            "z": self.position["z"],
        }

    def direction(self):
        cos_pitch = math.cos(self.pitch)
        return (
            -math.sin(self.yaw) * cos_pitch,
            math.sin(self.pitch),
            -math.cos(self.yaw) * cos_pitch,
        )

    def look(self, delta_yaw, delta_pitch):
        limit = math.pi / 2 - 0.001
        self.yaw -= delta_yaw
        self.pitch = max(-limit, min(limit, self.pitch - delta_pitch))

    def is_solid_at(self, x, y, z):
        block = self.world.get_block(x, y, z)
        if not IS_SOLID[block]:
            return False
        return not IS_PLANT[block]

    def overlaps_block(self, x, y, z):
        half = WIDTH / 2
        return (
            self.position["x"] - half < x + 1 and self.position["x"] + half > x
            and self.position["z"] - half < z + 1 and self.position["z"] + half > z
            and self.position["y"] < y + 1 and self.position["y"] + HEIGHT > y
        )

    # ------------------------------------------------------------------ movement

    def toggle_fly(self, creative=True):
        if not creative:
            return False
        self.flying = not self.flying
        if self.flying:
            self.velocity["y"] = 0.0
        return self.flying

    def jump(self):
        if self.in_water:
            self.velocity["y"] = 3.4
            return True
        if not self.on_ground:
            return False
        self.velocity["y"] = JUMP_SPEED
        self.on_ground = False
        return True

    def wish_direction(self, move):
        forward = move.get("forward", 0) - move.get("back", 0)
        strafe = move.get("right", 0) - move.get("left", 0)
        if not forward and not strafe:
            return 0.0, 0.0
        sin, cos = math.sin(self.yaw), math.cos(self.yaw)
        x = -sin * forward + cos * strafe
        z = -cos * forward - sin * strafe
        length = math.hypot(x, z) or 1.0
        return x / length, z / length

    def update(self, dt, move):
        feet = self.world.get_block(int(math.floor(self.position["x"])), int(math.floor(self.position["y"] + 0.2)), int(math.floor(self.position["z"])))
        head = self.world.get_block(int(math.floor(self.position["x"])), int(math.floor(self.position["y"] + 1.2)), int(math.floor(self.position["z"])))
        self.in_water = feet == WATER or head == WATER

        speed = FLY_SPEED if self.flying else WALK_SPEED * 0.65 if self.in_water else (SPRINT_SPEED if move.get("sprint") else WALK_SPEED)
        wish_x, wish_z = self.wish_direction(move)
        target_x, target_z = wish_x * speed, wish_z * speed
        acceleration = 16 if (self.on_ground or self.flying) else 6
        factor = min(1.0, acceleration * dt)
        self.velocity["x"] += (target_x - self.velocity["x"]) * factor
        self.velocity["z"] += (target_z - self.velocity["z"]) * factor

        if self.flying:
            vertical = (1 if move.get("jump") else 0) - (1 if move.get("sneak") else 0)
            self.velocity["y"] += (vertical * FLY_SPEED - self.velocity["y"]) * min(1.0, 12 * dt)
            self.on_ground = False
        elif self.in_water:
            self.velocity["y"] += (2.6 if move.get("jump") else -1.4 - self.velocity["y"] * 0.35) * dt * 6
            self.velocity["y"] = max(-6.0, min(4.5, self.velocity["y"]))
        else:
            self.velocity["y"] = max(-TERMINAL_VELOCITY, self.velocity["y"] - GRAVITY * dt)

        self.move_axis("x", self.velocity["x"] * dt)
        self.move_axis("z", self.velocity["z"] * dt)
        self.move_axis("y", self.velocity["y"] * dt)

        horizontal = math.hypot(self.velocity["x"], self.velocity["z"])
        self.walk_speed = horizontal
        self.walk_phase += horizontal * dt * 2.1

        if self.position["y"] < -8:
            self.respawn()

    def move_axis(self, axis, amount):
        if amount == 0:
            return
        steps = max(1, int(math.ceil(abs(amount) / 0.4)))
        step = amount / steps
        for _ in range(steps):
            self.position[axis] += step
            if self.collides():
                self.position[axis] -= step
                if axis == "y":
                    if step < 0:
                        self.on_ground = True
                    self.velocity["y"] = 0.0
                else:
                    self.velocity[axis] = 0.0
                return
        if axis == "y" and step < 0:
            self.on_ground = False

    def collides(self):
        half = WIDTH / 2
        if self.position["y"] < -4:
            return False
        min_x = int(math.floor(self.position["x"] - half + EPSILON))
        max_x = int(math.floor(self.position["x"] + half - EPSILON))
        min_y = int(math.floor(self.position["y"] + EPSILON))
        max_y = int(math.floor(self.position["y"] + HEIGHT - EPSILON))
        min_z = int(math.floor(self.position["z"] - half + EPSILON))
        max_z = int(math.floor(self.position["z"] + half - EPSILON))
        for y in range(min_y, max_y + 1):
            if y < 0 or y >= WORLD_HEIGHT:
                continue
            for z in range(min_z, max_z + 1):
                for x in range(min_x, max_x + 1):
                    if self.is_solid_at(x, y, z):
                        return True
        return False

    def respawn(self):
        spawn = self.world.find_spawn(int(self.position["x"]), int(self.position["z"]))
        self.position = {"x": spawn["x"], "y": spawn["y"] + 0.2, "z": spawn["z"]}
        self.velocity = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.on_ground = False

    # ------------------------------------------------------------------ saving

    def serialize(self):
        return {
            "x": round(self.position["x"], 2),
            "y": round(self.position["y"], 2),
            "z": round(self.position["z"], 2),
            "yaw": round(self.yaw, 3),
            "pitch": round(self.pitch, 3),
        }

    def restore(self, state):
        if not state:
            return
        for key in ("x", "y", "z"):
            if isinstance(state.get(key), (int, float)):
                self.position[key] = float(state[key])
        if isinstance(state.get("yaw"), (int, float)):
            self.yaw = float(state["yaw"])
        if isinstance(state.get("pitch"), (int, float)):
            self.pitch = float(state["pitch"])
        self.velocity = {"x": 0.0, "y": 0.0, "z": 0.0}
