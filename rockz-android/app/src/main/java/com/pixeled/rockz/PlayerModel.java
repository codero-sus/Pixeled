package com.pixeled.rockz;

/**
 * Player physics and the camera — the Android twin of {@code web/player.js}, {@code player.py} and
 * the desktop Java {@code Player}.
 *
 * <p>A 0.6 × 1.7 box that walks, sprints, swims, jumps and flies through the voxel world, resolving
 * collisions one axis at a time in small steps so a long fall cannot tunnel through the ground.
 */
final class PlayerModel {

    static final double WIDTH = 0.6;
    static final double HEIGHT = 1.7;
    static final double EYE_HEIGHT = 1.55;
    static final double WALK_SPEED = 4.6;
    static final double SPRINT_SPEED = 6.4;
    static final double FLY_SPEED = 11.0;
    static final double GRAVITY = 30.0;
    static final double JUMP_SPEED = 9.1;
    static final double TERMINAL_VELOCITY = 52.0;

    private static final double EPSILON = 0.0005;

    private final WorldModel world;
    double x, y, z;
    double vx, vy, vz;
    boolean onGround;
    boolean inWater;
    boolean flying;
    double yaw;
    double pitch;
    double walkPhase;
    double walkSpeed;

    PlayerModel(WorldModel world) {
        this.world = world;
        double[] spawn = world.findSpawn(0, 0);
        double[] state = world.savedPlayer;
        if (state != null && state.length >= 5) {
            x = state[0];
            y = state[1];
            z = state[2];
            yaw = state[3];
            pitch = state[4];
        } else {
            x = spawn[0];
            y = spawn[1];
            z = spawn[2];
        }
    }

    double eyeY() {
        return y + EYE_HEIGHT;
    }

    double[] direction() {
        double cosPitch = Math.cos(pitch);
        return new double[]{-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch};
    }

    double[] serialize() {
        return new double[]{x, y, z, yaw, pitch};
    }

    void look(double deltaYaw, double deltaPitch) {
        double limit = Math.PI / 2 - 0.001;
        yaw -= deltaYaw;
        pitch = Math.max(-limit, Math.min(limit, pitch - deltaPitch));
    }

    boolean toggleFly() {
        flying = !flying;
        if (flying) vy = 0;
        return flying;
    }

    boolean jump() {
        if (inWater) { vy = 3.4; return true; }
        if (!onGround) return false;
        vy = JUMP_SPEED;
        onGround = false;
        return true;
    }

    /**
     * Advance one frame.
     *
     * @param forwardAxis −1 back, 0 still, 1 forward (the joystick's vertical axis)
     * @param strafeAxis  −1 left, 0 still, 1 right
     */
    void update(double dt, double forwardAxis, double strafeAxis, boolean jumpHeld, boolean sneakHeld,
                boolean sprinting) {
        int feetY = (int) Math.floor(y + 0.2);
        int headY = (int) Math.floor(y + 1.2);
        int blockX = (int) Math.floor(x);
        int blockZ = (int) Math.floor(z);
        inWater = world.getBlock(blockX, feetY, blockZ) == Blocks.WATER
            || world.getBlock(blockX, headY, blockZ) == Blocks.WATER;

        double speed = flying ? FLY_SPEED : inWater ? WALK_SPEED * 0.65 : (sprinting ? SPRINT_SPEED : WALK_SPEED);
        double wishX = 0, wishZ = 0;
        double magnitude = Math.sqrt(forwardAxis * forwardAxis + strafeAxis * strafeAxis);
        if (magnitude > 0.001) {
            double amount = Math.min(1, magnitude);
            forwardAxis /= magnitude;
            strafeAxis /= magnitude;
            double sin = Math.sin(yaw), cos = Math.cos(yaw);
            wishX = (-sin * forwardAxis + cos * strafeAxis) * amount;
            wishZ = (-cos * forwardAxis - sin * strafeAxis) * amount;
        }
        double acceleration = (onGround || flying) ? 16 : 6;
        double factor = Math.min(1, acceleration * dt);
        vx += (wishX * speed - vx) * factor;
        vz += (wishZ * speed - vz) * factor;

        if (flying) {
            double vertical = (jumpHeld ? 1 : 0) - (sneakHeld ? 1 : 0);
            vy += (vertical * FLY_SPEED - vy) * Math.min(1, 12 * dt);
            onGround = false;
        } else if (inWater) {
            vy += (jumpHeld ? 2.6 : -1.4 - vy * 0.35) * dt * 6;
            vy = Math.max(-6, Math.min(4.5, vy));
        } else {
            vy = Math.max(-TERMINAL_VELOCITY, vy - GRAVITY * dt);
        }

        moveAxis(0, vx * dt);
        moveAxis(2, vz * dt);
        moveAxis(1, vy * dt);

        double horizontal = Math.sqrt(vx * vx + vz * vz);
        walkSpeed = horizontal;
        walkPhase += horizontal * dt * 2.1;
        if (y < -8) respawn();
    }

    /** axis: 0 = x, 1 = y, 2 = z. */
    private void moveAxis(int axis, double amount) {
        if (amount == 0) return;
        int steps = Math.max(1, (int) Math.ceil(Math.abs(amount) / 0.4));
        double step = amount / steps;
        for (int i = 0; i < steps; i++) {
            if (axis == 0) x += step;
            else if (axis == 1) y += step;
            else z += step;
            if (collides()) {
                if (axis == 0) { x -= step; vx = 0; }
                else if (axis == 1) {
                    y -= step;
                    if (step < 0) onGround = true;
                    vy = 0;
                } else { z -= step; vz = 0; }
                return;
            }
        }
        if (axis == 1 && step < 0) onGround = false;
    }

    private boolean collides() {
        if (y < -4) return false;
        double half = WIDTH / 2;
        int minX = (int) Math.floor(x - half + EPSILON);
        int maxX = (int) Math.floor(x + half - EPSILON);
        int minY = (int) Math.floor(y + EPSILON);
        int maxY = (int) Math.floor(y + HEIGHT - EPSILON);
        int minZ = (int) Math.floor(z - half + EPSILON);
        int maxZ = (int) Math.floor(z + half - EPSILON);
        for (int blockY = minY; blockY <= maxY; blockY++) {
            if (blockY < 0 || blockY >= Blocks.WORLD_HEIGHT) continue;
            for (int blockZ = minZ; blockZ <= maxZ; blockZ++) {
                for (int blockX = minX; blockX <= maxX; blockX++) {
                    int block = world.getBlock(blockX, blockY, blockZ);
                    if (Blocks.isSolid(block) && !Blocks.isPlant(block)) return true;
                }
            }
        }
        return false;
    }

    boolean overlapsBlock(int blockX, int blockY, int blockZ) {
        double half = WIDTH / 2;
        return x - half < blockX + 1 && x + half > blockX
            && z - half < blockZ + 1 && z + half > blockZ
            && y < blockY + 1 && y + HEIGHT > blockY;
    }

    void respawn() {
        double[] spawn = world.findSpawn((int) Math.floor(x), (int) Math.floor(z));
        x = spawn[0];
        y = spawn[1] + 0.2;
        z = spawn[2];
        vx = vy = vz = 0;
        onGround = false;
    }
}
