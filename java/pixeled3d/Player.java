package pixeled3d;

import static pixeled3d.Blocks.*;

/**
 * The explorer's physics and camera — the Java twin of {@code web/player.js} and {@code player.py}.
 *
 * <p>An axis-aligned box that walks, swims, flies and jumps through the voxel world, resolving
 * collisions one axis at a time in small steps so a long fall cannot tunnel through the ground.
 */
public final class Player {

    public static final double WIDTH = 0.6;
    public static final double HEIGHT = 1.7;
    public static final double EYE_HEIGHT = 1.55;
    public static final double WALK_SPEED = 4.6;
    public static final double SPRINT_SPEED = 6.4;
    public static final double FLY_SPEED = 11.0;
    public static final double GRAVITY = 30.0;
    public static final double JUMP_SPEED = 9.1;
    public static final double TERMINAL_VELOCITY = 52.0;

    private static final double EPSILON = 0.0005;

    private final World world;
    private double px, py, pz;
    private double vx, vy, vz;
    public boolean onGround;
    public boolean inWater;
    public boolean flying;
    public double yaw;
    public double pitch;
    public double walkPhase;
    public double walkSpeed;
    public int blocksPlaced;

    /** What the player is holding down this frame. */
    public static final class Input {
        public boolean forward, back, left, right, jump, sneak, sprint;
    }

    public Player(World world, double[] spawn) {
        this.world = world;
        this.px = spawn[0];
        this.py = spawn[1];
        this.pz = spawn[2];
    }

    public double x() { return px; }
    public double y() { return py; }
    public double z() { return pz; }
    public double eyeY() { return py + EYE_HEIGHT; }

    public double[] direction() {
        double cosPitch = Math.cos(pitch);
        return new double[]{-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch};
    }

    public void look(double deltaYaw, double deltaPitch) {
        double limit = Math.PI / 2 - 0.001;
        yaw -= deltaYaw;
        pitch = Math.max(-limit, Math.min(limit, pitch - deltaPitch));
    }

    public boolean toggleFly(boolean creative) {
        if (!creative) return false;
        flying = !flying;
        if (flying) vy = 0;
        return flying;
    }

    public boolean jump() {
        if (inWater) { vy = 3.4; return true; }
        if (!onGround) return false;
        vy = JUMP_SPEED;
        onGround = false;
        return true;
    }

    private boolean solidAt(int x, int y, int z) {
        int block = world.getBlock(x, y, z);
        return Blocks.isSolid(block) && !Blocks.isPlant(block);
    }

    public void update(double dt, Input input) {
        int feetY = (int) Math.floor(py + 0.2);
        int headY = (int) Math.floor(py + 1.2);
        int blockX = (int) Math.floor(px), blockZ = (int) Math.floor(pz);
        inWater = world.getBlock(blockX, feetY, blockZ) == WATER || world.getBlock(blockX, headY, blockZ) == WATER;

        double speed = flying ? FLY_SPEED : inWater ? WALK_SPEED * 0.65 : (input.sprint ? SPRINT_SPEED : WALK_SPEED);
        double forwardAxis = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
        double strafeAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        double wishX = 0, wishZ = 0;
        if (forwardAxis != 0 || strafeAxis != 0) {
            double sin = Math.sin(yaw), cos = Math.cos(yaw);
            wishX = -sin * forwardAxis + cos * strafeAxis;
            wishZ = -cos * forwardAxis - sin * strafeAxis;
            double length = Math.sqrt(wishX * wishX + wishZ * wishZ) ;
            if (length > 0) { wishX /= length; wishZ /= length; }
        }
        double acceleration = (onGround || flying) ? 16 : 6;
        double factor = Math.min(1, acceleration * dt);
        vx += (wishX * speed - vx) * factor;
        vz += (wishZ * speed - vz) * factor;

        if (flying) {
            double vertical = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
            vy += (vertical * FLY_SPEED - vy) * Math.min(1, 12 * dt);
            onGround = false;
        } else if (inWater) {
            vy += (input.jump ? 2.6 : -1.4 - vy * 0.35) * dt * 6;
            vy = Math.max(-6, Math.min(4.5, vy));
        } else {
            vy = Math.max(-TERMINAL_VELOCITY, vy - GRAVITY * dt);
        }

        moveAxis('x', vx * dt);
        moveAxis('z', vz * dt);
        moveAxis('y', vy * dt);

        double horizontal = Math.sqrt(vx * vx + vz * vz);
        walkSpeed = horizontal;
        walkPhase += horizontal * dt * 2.1;
        if (py < -8) respawn();
    }

    private void moveAxis(char axis, double amount) {
        if (amount == 0) return;
        int steps = Math.max(1, (int) Math.ceil(Math.abs(amount) / 0.4));
        double step = amount / steps;
        for (int i = 0; i < steps; i++) {
            if (axis == 'x') px += step;
            else if (axis == 'y') py += step;
            else pz += step;
            if (collides()) {
                if (axis == 'x') { px -= step; vx = 0; }
                else if (axis == 'y') {
                    py -= step;
                    if (step < 0) onGround = true;
                    vy = 0;
                } else { pz -= step; vz = 0; }
                return;
            }
        }
        if (axis == 'y' && step < 0) onGround = false;
    }

    private boolean collides() {
        if (py < -4) return false;
        double half = WIDTH / 2;
        int minX = (int) Math.floor(px - half + EPSILON);
        int maxX = (int) Math.floor(px + half - EPSILON);
        int minY = (int) Math.floor(py + EPSILON);
        int maxY = (int) Math.floor(py + HEIGHT - EPSILON);
        int minZ = (int) Math.floor(pz - half + EPSILON);
        int maxZ = (int) Math.floor(pz + half - EPSILON);
        for (int y = minY; y <= maxY; y++) {
            if (y < 0 || y >= WORLD_HEIGHT) continue;
            for (int z = minZ; z <= maxZ; z++) {
                for (int x = minX; x <= maxX; x++) {
                    if (solidAt(x, y, z)) return true;
                }
            }
        }
        return false;
    }

    /** True when the player box overlaps this block — used when placing blocks. */
    public boolean overlapsBlock(int x, int y, int z) {
        double half = WIDTH / 2;
        return px - half < x + 1 && px + half > x
            && pz - half < z + 1 && pz + half > z
            && py < y + 1 && py + HEIGHT > y;
    }

    public void respawn() {
        double[] spawn = world.findSpawn((int) Math.floor(px), (int) Math.floor(pz));
        px = spawn[0];
        py = spawn[1] + 0.2;
        pz = spawn[2];
        vx = vy = vz = 0;
        onGround = false;
    }

    public void restore(double[] state) {
        px = state[0];
        py = state[1];
        pz = state[2];
        yaw = state[3];
        pitch = state[4];
        vx = vy = vz = 0;
    }

    public double[] serialize() {
        return new double[]{px, py, pz, yaw, pitch};
    }
}
