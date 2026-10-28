"""First-person player: swept AABB against the voxel grid, movement and look direction."""

import math

WIDTH = 0.6
HEIGHT = 1.8
EYE_HEIGHT = 1.62
GRAVITY = 30.0
JUMP_SPEED = 9.2
WALK_SPEED = 4.6
SPRINT_SPEED = 7.4
FLY_SPEED = 11.0
REACH = 6.5


class Player:
    def __init__(self, world):
        self.width = WIDTH
        self.height = HEIGHT
        self.x, self.y, self.z = world.spawn_point()
        self.velocity_x = self.velocity_y = self.velocity_z = 0.0
        self.yaw = 0.6
        self.pitch = -0.12
        self.on_ground = False
        self.flying = False
        self.walking = 0.0

    @property
    def eye(self):
        return (self.x, self.y + EYE_HEIGHT, self.z)

    def direction(self):
        cos_pitch = math.cos(self.pitch)
        return (-math.sin(self.yaw) * cos_pitch, math.sin(self.pitch), -math.cos(self.yaw) * cos_pitch)

    def look(self, delta_yaw, delta_pitch):
        self.yaw -= delta_yaw
        self.pitch = max(-math.pi / 2 + 0.02, min(math.pi / 2 - 0.02, self.pitch - delta_pitch))

    def spawn(self, world):
        self.x, self.y, self.z = world.spawn_point()
        self.velocity_x = self.velocity_y = self.velocity_z = 0.0
        self.on_ground = False

    def update(self, dt, forward, right, jump, crouch, sprint, world):
        """One physics step. Returns True when the player fell out of the world."""
        speed = FLY_SPEED if self.flying else SPRINT_SPEED if sprint else WALK_SPEED
        sin_yaw, cos_yaw = math.sin(self.yaw), math.cos(self.yaw)
        wish_x = wish_z = 0.0
        if forward or right:
            wish_x = -sin_yaw * forward + cos_yaw * right
            wish_z = -cos_yaw * forward - sin_yaw * right
            length = math.hypot(wish_x, wish_z) or 1.0
            wish_x /= length
            wish_z /= length

        if self.flying:
            self.velocity_x = wish_x * speed
            self.velocity_z = wish_z * speed
            self.velocity_y = (float(jump) - float(crouch)) * speed
            if sprint and not jump and not crouch:
                self.velocity_x *= 1.6
                self.velocity_z *= 1.6
        else:
            blend = min(1.0, (42.0 if self.on_ground else 12.0) * dt)
            self.velocity_x += (wish_x * speed - self.velocity_x) * blend
            self.velocity_z += (wish_z * speed - self.velocity_z) * blend
            if self.on_ground and jump:
                self.velocity_y = JUMP_SPEED
                self.on_ground = False
            self.velocity_y = max(-60.0, self.velocity_y - GRAVITY * dt)

        self.move(world, self.velocity_x * dt, self.velocity_y * dt, self.velocity_z * dt)
        self.walking += math.hypot(self.velocity_x, self.velocity_z) * dt * 0.7
        if not self.flying and self.y < -8:
            self.spawn(world)
            return True
        return False

    # ------------------------------------------------------------------ collision

    def collides(self, world):
        return self.collides_at(world, self.x, self.y, self.z)

    def collides_at(self, world, x, y, z):
        half = self.width / 2 - 1e-3
        min_x, max_x = math.floor(x - half), math.floor(x + half)
        min_y, max_y = math.floor(y + 1e-3), math.floor(y + self.height - 1e-3)
        min_z, max_z = math.floor(z - half), math.floor(z + half)
        for by in range(min_y, max_y + 1):
            for bz in range(min_z, max_z + 1):
                for bx in range(min_x, max_x + 1):
                    if world.is_solid(bx, by, bz):
                        return True
        return False

    def move(self, world, dx, dy, dz):
        """Axis-separated sweep; the box never penetrates by more than one block."""
        epsilon = 1e-4
        self.x += dx
        if self.collides(world):
            self.x -= dx
            self.velocity_x = 0.0
            self.attempt_step(world, dx, 0.0)

        self.z += dz
        if self.collides(world):
            self.z -= dz
            self.velocity_z = 0.0
            self.attempt_step(world, 0.0, dz)

        self.y += dy
        self.on_ground = False
        if not self.collides(world):
            return
        if dy > 0:
            ceiling = math.floor(self.y + self.height - 1e-3)
            self.y = ceiling - self.height - epsilon
            self.velocity_y = 0.0
        else:
            ground = math.floor(self.y + 1e-3)
            self.y = ground + 1 + epsilon
            self.velocity_y = 0.0
            self.on_ground = True

    def attempt_step(self, world, dx, dz):
        """Walk up a single block, but only when the box really ends up free."""
        if not self.on_ground:
            return False
        probe_x = self.x + (0.09 if dx > 0 else -0.09 if dx < 0 else 0.0) + dx
        probe_z = self.z + (0.09 if dz > 0 else -0.09 if dz < 0 else 0.0) + dz
        if self.collides_at(world, probe_x, self.y + 1.02, probe_z):
            return False
        previous_y = self.y
        self.y += 1.02
        self.x += dx
        self.z += dz
        if self.collides(world):
            self.y = previous_y
            self.x -= dx
            self.z -= dz
            return False
        return True

    # ------------------------------------------------------------------ helpers

    def reaches(self, x, y, z):
        """True when a block centre is inside the player's reach."""
        return math.hypot((x + 0.5) - self.x, (y + 0.5) - (self.y + self.height / 2), (z + 0.5) - self.z) < REACH

    def overlaps(self, x, y, z):
        half = self.width / 2
        return (x + 1 > self.x - half and x < self.x + half
                and z + 1 > self.z - half and z < self.z + half
                and y + 1 > self.y and y < self.y + self.height)
