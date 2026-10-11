package com.pixeled.rockz;

/** First-person player for Rockz: swept AABB movement with step-up, gravity, flight and look. */
final class PlayerModel {

    static final double WIDTH = 0.6, HEIGHT = 1.8, EYE_HEIGHT = 1.62;
    private static final double GRAVITY = 30, JUMP_SPEED = 9.2,
            WALK_SPEED = 4.6, SPRINT_SPEED = 7.4, FLY_SPEED = 11;

    double x, y, z;
    double velocityX, velocityY, velocityZ;
    double yaw = 0.6, pitch = -0.12;
    boolean onGround, flying;

    PlayerModel(WorldModel world) {
        if (world.hasSavedPlayer) {
            x = world.savedPlayerX;
            y = world.savedPlayerY;
            z = world.savedPlayerZ;
            yaw = world.savedYaw;
            pitch = world.savedPitch;
        } else {
            spawn(world);
        }
    }

    double eyeY() {
        return y + EYE_HEIGHT;
    }

    double[] direction() {
        double cosPitch = Math.cos(pitch);
        return new double[]{-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch};
    }

    void look(double deltaYaw, double deltaPitch) {
        yaw -= deltaYaw;
        pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch - deltaPitch));
    }

    void spawn(WorldModel world) {
        double[] spawn = world.spawnPoint();
        x = spawn[0];
        y = spawn[1];
        z = spawn[2];
        velocityX = velocityY = velocityZ = 0;
        onGround = false;
    }

    /** One physics step; returns true when the player fell out of the world. */
    boolean update(double dt, double forward, double right, boolean jump, boolean crouch,
                   boolean sprint, WorldModel world) {
        double speed = flying ? FLY_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
        double sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
        double wishX = 0, wishZ = 0;
        if (Math.abs(forward) > 1e-4 || Math.abs(right) > 1e-4) {
            wishX = -sinYaw * forward + cosYaw * right;
            wishZ = -cosYaw * forward - sinYaw * right;
            double length = Math.hypot(wishX, wishZ);
            if (length > 1e-6) {
                wishX /= length;
                wishZ /= length;
            }
        }

        if (flying) {
            velocityX = wishX * speed;
            velocityZ = wishZ * speed;
            velocityY = ((jump ? 1 : 0) - (crouch ? 1 : 0)) * speed;
        } else {
            double blend = Math.min(1, (onGround ? 42 : 12) * dt);
            velocityX += (wishX * speed - velocityX) * blend;
            velocityZ += (wishZ * speed - velocityZ) * blend;
            if (onGround && jump) {
                velocityY = JUMP_SPEED;
                onGround = false;
            }
            velocityY = Math.max(-60, velocityY - GRAVITY * dt);
        }

        move(world, velocityX * dt, velocityY * dt, velocityZ * dt);
        if (!flying && y < -8) {
            spawn(world);
            return true;
        }
        return false;
    }

    boolean collides(WorldModel world) {
        return collidesAt(world, x, y, z);
    }

    boolean collidesAt(WorldModel world, double px, double py, double pz) {
        double half = WIDTH / 2 - 1e-3;
        int minX = (int) Math.floor(px - half), maxX = (int) Math.floor(px + half);
        int minY = (int) Math.floor(py + 1e-3), maxY = (int) Math.floor(py + HEIGHT - 1e-3);
        int minZ = (int) Math.floor(pz - half), maxZ = (int) Math.floor(pz + half);
        for (int by = minY; by <= maxY; by++) {
            for (int bz = minZ; bz <= maxZ; bz++) {
                for (int bx = minX; bx <= maxX; bx++) {
                    if (world.isSolid(bx, by, bz)) return true;
                }
            }
        }
        return false;
    }

    void move(WorldModel world, double dx, double dy, double dz) {
        final double epsilon = 1e-4;
        x += dx;
        if (collides(world)) {
            x -= dx;
            velocityX = 0;
            attemptStep(world, dx, 0);
        }
        z += dz;
        if (collides(world)) {
            z -= dz;
            velocityZ = 0;
            attemptStep(world, 0, dz);
        }
        y += dy;
        onGround = false;
        if (!collides(world)) return;
        if (dy > 0) {
            double ceiling = Math.floor(y + HEIGHT - 1e-3);
            y = ceiling - HEIGHT - epsilon;
            velocityY = 0;
        } else {
            double ground = Math.floor(y + 1e-3);
            y = ground + 1 + epsilon;
            velocityY = 0;
            onGround = true;
        }
    }

    /** Walk up a single block, but only when the box really ends up free. */
    private boolean attemptStep(WorldModel world, double dx, double dz) {
        if (!onGround) return false;
        double probeX = x + (dx > 0 ? 0.09 : dx < 0 ? -0.09 : 0) + dx;
        double probeZ = z + (dz > 0 ? 0.09 : dz < 0 ? -0.09 : 0) + dz;
        if (collidesAt(world, probeX, y + 1.02, probeZ)) return false;
        double previousY = y;
        y += 1.02;
        x += dx;
        z += dz;
        if (collides(world)) {
            y = previousY;
            x -= dx;
            z -= dz;
            return false;
        }
        return true;
    }

    boolean reaches(int bx, int by, int bz) {
        return Math.hypot(bx + 0.5 - x, by + 0.5 - (y + HEIGHT / 2), bz + 0.5 - z) < 6.5;
    }

    boolean overlaps(int bx, int by, int bz) {
        double half = WIDTH / 2;
        return bx + 1 > x - half && bx < x + half
                && bz + 1 > z - half && bz < z + half
                && by + 1 > y && by < y + HEIGHT;
    }
}
