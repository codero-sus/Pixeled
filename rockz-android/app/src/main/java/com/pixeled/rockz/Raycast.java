package com.pixeled.rockz;

/** 3D DDA voxel ray casting for aiming, mining and placing — the shared contract. */
final class Raycast {

    /** A ray hit: block coordinates, face normal, distance and the block id. */
    static final class Hit {
        final int x, y, z, nx, ny, nz, id;
        final float distance;

        Hit(int x, int y, int z, int nx, int ny, int nz, float distance, int id) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.nx = nx;
            this.ny = ny;
            this.nz = nz;
            this.distance = distance;
            this.id = id;
        }
    }

    static Hit cast(WorldModel world, double ox, double oy, double oz,
                    double dx, double dy, double dz, double maxDistance, boolean hitLiquid) {
        int x = (int) Math.floor(ox), y = (int) Math.floor(oy), z = (int) Math.floor(oz);
        int stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
        double deltaX = Math.abs(dx) < 1e-9 ? 1e9 : Math.abs(1 / dx);
        double deltaY = Math.abs(dy) < 1e-9 ? 1e9 : Math.abs(1 / dy);
        double deltaZ = Math.abs(dz) < 1e-9 ? 1e9 : Math.abs(1 / dz);
        double maxX = (dx > 0 ? x + 1 - ox : ox - x) * deltaX;
        double maxY = (dy > 0 ? y + 1 - oy : oy - y) * deltaY;
        double maxZ = (dz > 0 ? z + 1 - oz : oz - z) * deltaZ;

        double distance = 0;
        int nx = 0, ny = 0, nz = 0;
        while (distance <= maxDistance) {
            if (x < 0 || x >= Blocks.WORLD_X || z < 0 || z >= Blocks.WORLD_Z) break;
            if (y >= 0 && y < Blocks.WORLD_Y) {
                int id = world.data[WorldModel.index(x, y, z)] & 255;
                if (id != Blocks.AIR && (id != Blocks.WATER || hitLiquid)) {
                    return new Hit(x, y, z, nx, ny, nz, (float) distance, id);
                }
            } else if ((y < 0 && dy <= 0) || (y >= Blocks.WORLD_Y && dy >= 0)) {
                break;
            }
            if (maxX < maxY && maxX < maxZ) {
                x += stepX;
                distance = maxX;
                maxX += deltaX;
                nx = -stepX; ny = 0; nz = 0;
            } else if (maxY < maxZ) {
                y += stepY;
                distance = maxY;
                maxY += deltaY;
                nx = 0; ny = -stepY; nz = 0;
            } else {
                z += stepZ;
                distance = maxZ;
                maxZ += deltaZ;
                nx = 0; ny = 0; nz = -stepZ;
            }
        }
        return null;
    }

    /** The empty cell in front of the face that was hit. */
    static int[] placementCell(Hit hit) {
        return new int[]{hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz};
    }

    private Raycast() {
    }
}
