package pixeled;

import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;

import static pixeled.Blocks.AIR;
import static pixeled.Blocks.SAND;
import static pixeled.Blocks.SEA_LEVEL;
import static pixeled.Blocks.SNOW;
import static pixeled.Blocks.WATER;
import static pixeled.Blocks.WORLD_X;
import static pixeled.Blocks.WORLD_Z;

/**
 * Software 3D renderer: a heightfield row sweep for the landscape plus true voxel cubes for trees
 * and player-built blocks, with a depth buffer between them. The same technique and the same
 * shading rules as the Python edition, so both look like the WebGL one.
 */
public final class Renderer {

  public static final double MAX_DISTANCE = 128, FOG_DISTANCE = 190, CUBE_RADIUS = 26;
  private static final double FOV = Math.toRadians(76);

  private static final int[] FACE_LIGHT = new int[64];
  private static final int[][] FACES = {
      // {axis, sign, corner offsets...} - six quads of a unit cube
      {1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1},
      {1, -1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0},
      {0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1},
      {0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0},
      {2, -1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0},
      {2, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1},
  };

  static {
    FACE_LIGHT[(1 << 4) | 1] = 255;
    FACE_LIGHT[(1 << 4) | 0] = 128;
    FACE_LIGHT[(0 << 4) | 0] = 184;
    FACE_LIGHT[(0 << 4) | 1] = 184;
    FACE_LIGHT[(2 << 4) | 0] = 220;
    FACE_LIGHT[(2 << 4) | 1] = 220;
  }

  public final int width, height;
  public final BufferedImage image;
  public final int[] pixels;
  private final double[] invDepth;
  private final double focal;
  private final double[] rowColours;
  private final double[] baseX, baseZ, distances, steps;
  private final int[] topRow, rowPixels;
  private double[] ground, water, land;
  private int flatVersion = -1;
  public int lastSamples;

  public Renderer(int width, int height) {
    this.width = width;
    this.height = height;
    this.image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
    this.pixels = ((DataBufferInt) image.getRaster().getDataBuffer()).getData();
    this.invDepth = new double[width * height];
    this.rowColours = new double[height * 3];
    this.baseX = new double[width];
    this.baseZ = new double[width];
    this.distances = new double[width];
    this.steps = new double[width];
    this.topRow = new int[width];
    this.rowPixels = new int[width];
    this.focal = (width / 2.0) / Math.tan(FOV / 2);
  }

  // ------------------------------------------------------------------ frame

  public int[] render(World world, Player player, double clock, boolean targetSet,
                      int targetX, int targetY, int targetZ, double time) {
    double[] palette = skyPalette(clock);
    double[] forward = new double[3], right = new double[3], up = new double[3];
    cameraBasis(player.yaw, player.pitch, forward, right, up);
    double eyeX = player.x, eyeY = player.eyeY(), eyeZ = player.z;
    java.util.Arrays.fill(invDepth, 0);
    paintSky(palette, forward, right, up, eyeY);
    paintTerrain(world, eyeX, eyeY, eyeZ, forward, right, up, palette, time);
    drawObjects(world, eyeX, eyeY, eyeZ, forward, up);
    if (targetSet) drawBlockOutline(targetX, targetY, targetZ, eyeX, eyeY, eyeZ, forward, up);
    drawCrosshair();
    return pixels;
  }

  public static double[] skyPalette(double clock) {
    double heightSin = Math.sin((clock - 0.25) * Math.PI * 2);
    double day = clamp01((heightSin + 0.08) / 0.5);
    double dusk = clamp01(1 - Math.abs(heightSin) / 0.32);
    int zenith = Blocks.mix(0x091030, 0x3A7CD8, day);
    int horizon = Blocks.mix(0x1A264A, 0xBCDAF3, day);
    zenith = Blocks.mix(zenith, 0x3E5298, dusk * 0.5);
    horizon = Blocks.mix(horizon, 0xFA9E60, dusk * 0.8);
    int sun = Blocks.mix(0xCEDAFF, 0xFFF4D6, day);
    sun = Blocks.mix(sun, 0xFA9E60, dusk * 0.55);
    double angle = (clock - 0.25) * Math.PI * 2;
    double[] direction = {Math.cos(angle), Math.max(0.06, Math.sin(angle)), 0.34};
    double length = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1]
        + direction[2] * direction[2]);
    direction[0] /= length;
    direction[1] /= length;
    direction[2] /= length;
    return new double[] {zenith, horizon, sun, direction[0], direction[1], direction[2], day};
  }

  public static void cameraBasis(double yaw, double pitch, double[] forward, double[] right, double[] up) {
    double cosPitch = Math.cos(pitch);
    forward[0] = -Math.sin(yaw) * cosPitch;
    forward[1] = Math.sin(pitch);
    forward[2] = -Math.cos(yaw) * cosPitch;
    right[0] = Math.cos(yaw);
    right[1] = 0;
    right[2] = -Math.sin(yaw);
    up[0] = right[1] * forward[2] - right[2] * forward[1];
    up[1] = right[2] * forward[0] - right[0] * forward[2];
    up[2] = right[0] * forward[1] - right[1] * forward[0];
  }

  private static double clamp01(double value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  // ------------------------------------------------------------------ sky

  private void paintSky(double[] palette, double[] forward, double[] right, double[] up, double eyeY) {
    int zenith = (int) palette[0], horizon = (int) palette[1];
    int sunColour = (int) palette[2], void0 = Blocks.mix(horizon, 0x000000, 0.34);
    double half = height / 2.0;
    double pitch = Math.asin(Math.max(-1, Math.min(1, forward[1])));
    for (int row = 0; row < height; row++) {
      double elevation = Math.atan((half - row - 0.5) / focal) + pitch;
      int colour = elevation >= 0
          ? Blocks.mix(horizon, zenith, Math.pow(clamp01(elevation / 1.1), 0.75))
          : Blocks.mix(horizon, void0, Math.pow(clamp01(-elevation / 0.7), 0.7));
      rowColours[row * 3] = (colour >> 16) & 255;
      rowColours[row * 3 + 1] = (colour >> 8) & 255;
      rowColours[row * 3 + 2] = colour & 255;
      java.util.Arrays.fill(pixels, row * width, (row + 1) * width, colour);
    }
    // Sun disc and halo.
    double[] sunDirection = {palette[3], palette[4], palette[5]};
    double depth = dot(sunDirection, forward);
    if (depth <= 0.08) return;
    double sunX = width / 2.0 + (dot(sunDirection, right) / depth) * focal;
    double sunY = height / 2.0 - (dot(sunDirection, up) / depth) * focal;
    double radius = focal * 0.03, halo = radius * 3.4;
    for (int row = (int) Math.max(0, sunY - halo); row < Math.min(height, sunY + halo + 1); row++) {
      for (int column = (int) Math.max(0, sunX - halo); column < Math.min(width, sunX + halo + 1); column++) {
        double distance = Math.hypot(column - sunX, row - sunY);
        if (distance >= halo) continue;
        double glow = 1 - distance / halo;
        double strength = distance < radius ? 1 : Math.min(1, glow * glow * 1.25);
        pixels[row * width + column] = Blocks.mix(pixels[row * width + column], sunColour, strength);
      }
    }
  }

  private static double dot(double[] a, double[] b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  // ------------------------------------------------------------------ terrain

  private void buildFlat(World world) {
    if (flatVersion == world.version && ground != null) return;
    int span = WORLD_Z + 2;
    int total = (WORLD_X + 2) * span;
    ground = new double[total];
    water = new double[total];
    land = new double[total];
    java.util.Arrays.fill(ground, -2);
    java.util.Arrays.fill(water, -3);
    for (int x = 0; x < WORLD_X; x++) {
      for (int z = 0; z < WORLD_Z; z++) {
        int index = (x + 1) * span + z + 1;
        int height = world.groundTop[x][z];
        int level = world.waterTop[x][z];
        water[index] = level >= 0 ? level : -3;
        if (height >= 0) {
          land[index] = world.data[World.index(x, height, z)] & 255;
          ground[index] = height + 1.0;
        }
      }
    }
    // Pad the borders so slope lookups never leave the arrays.
    for (int x = -1; x <= WORLD_X; x++) {
      int source = x < 0 ? 0 : x >= WORLD_X ? WORLD_X - 1 : x;
      for (int z = -1; z <= WORLD_Z; z++) {
        int sourceZ = z < 0 ? 0 : z >= WORLD_Z ? WORLD_Z - 1 : z;
        int target = (x + 1) * span + z + 1;
        int from = (source + 1) * span + sourceZ + 1;
        ground[target] = ground[from];
        water[target] = water[from];
        land[target] = land[from];
      }
    }
    flatVersion = world.version;
  }

  private void paintTerrain(World world, double eyeX, double eyeY, double eyeZ,
                            double[] forward, double[] right, double[] up,
                            double[] palette, double time) {
    buildFlat(world);
    int span = WORLD_Z + 2;
    double focalLocal = focal;
    double half = height / 2.0;
    double sunX = palette[3], sunY = palette[4], sunZ = palette[5];
    columnTops(world, eyeX, eyeY, eyeZ, forward, right);
    int firstRow = height;
    for (int column = 0; column < width; column++) firstRow = Math.min(firstRow, topRow[column]);
    firstRow = Math.max(0, firstRow);

    double forwardX = forward[0], forwardY = forward[1], forwardZ = forward[2];
    double stepX = up[0], stepY = up[1], stepZ = up[2];
    for (int column = 0; column < width; column++) {
      double u = (column + 0.5 - width / 2.0) / focalLocal;
      baseX[column] = forwardX + right[0] * u;
      baseZ[column] = forwardZ + right[2] * u;
      distances[column] = 1.2;
      steps[column] = 0.35;
    }

    int samples = 0;
    for (int row = height - 1; row >= firstRow; row--) {
      double v = (half - row - 0.5) / focalLocal;
      double dirY = forwardY + stepY * v;
      if (Math.abs(dirY) < 1e-7) continue;
      double stepVX = stepX * v, stepVZ = stepZ * v;
      double skyRed = rowColours[row * 3], skyGreen = rowColours[row * 3 + 1], skyBlue = rowColours[row * 3 + 2];
      System.arraycopy(pixels, row * width, rowPixels, 0, width);
      boolean painted = false;
      for (int column = 0; column < width; column++) {
        if (row < topRow[column]) continue;
        double dirX = baseX[column] + stepVX;
        double dirZ = baseZ[column] + stepVZ;
        double distance = distances[column];
        double step = steps[column];
        double previous = distance > step ? distance - step : 0.25;
        int cellX = -1, cellZ = -1;
        double surfaceTop = 0;
        for (int guard = 0; guard < 400; guard++) {
          if (distance >= MAX_DISTANCE) {
            cellX = -1;
            break;
          }
          double pointX = eyeX + dirX * distance;
          double pointZ = eyeZ + dirZ * distance;
          if (pointX < 0 || pointZ < 0) {
            cellX = -1;
            break;
          }
          cellX = (int) pointX;
          cellZ = (int) pointZ;
          if (cellX >= WORLD_X || cellZ >= WORLD_Z) {
            cellX = -1;
            break;
          }
          int index = (cellX + 1) * span + cellZ + 1;
          double columnGround = ground[index];
          if (columnGround < -1) {
            cellX = -1;
            break;
          }
          double columnWater = water[index];
          surfaceTop = (columnWater > columnGround ? columnWater : columnGround) + 1.0;
          if (eyeY + dirY * distance <= surfaceTop) break;
          previous = distance;
          distance += step;
          step += step * 0.02 + 0.01;
          if (step > 2.5) step = 2.5;
        }
        if (cellX < 0) continue;
        // Bisect inside [previous, distance] to pin the crossing down.
        double low = previous, high = distance;
        for (int iteration = 0; iteration < 6; iteration++) {
          double middle = (low + high) * 0.5;
          int mx = (int) (eyeX + dirX * middle), mz = (int) (eyeZ + dirZ * middle);
          if (mx < 0 || mz < 0 || mx >= WORLD_X || mz >= WORLD_Z) {
            high = middle;
            continue;
          }
          double top = ground[(mx + 1) * span + mz + 1] + 1.0;
          if (eyeY + dirY * middle <= top) high = middle;
          else low = middle;
        }
        distance = high;
        cellX = (int) (eyeX + dirX * distance);
        cellZ = (int) (eyeZ + dirZ * distance);
        if (cellX < 0 || cellZ < 0 || cellX >= WORLD_X || cellZ >= WORLD_Z) continue;
        int index = (cellX + 1) * span + cellZ + 1;
        surfaceTop = ground[index] + 1.0;
        double entry = Math.min(previous, distance - step);
        boolean wall = eyeY + dirY * entry <= surfaceTop - 0.02;
        distances[column] = distance;
        steps[column] = step;
        samples++;

        double columnGround = ground[index];
        double columnWater = water[index];
        boolean isWater = columnWater > columnGround && !wall;
        double surface = isWater ? columnWater : columnGround;
        int colour;
        int blockId = (int) land[index];
        if (isWater) {
          double depthWater = columnWater - columnGround;
          int base = Blocks.mix(0x4B8FE0, 0x8EC8F0, 1.0 / (1.0 + depthWater));
          double ripple = 0.94 + 0.06 * Math.sin(time * 1.9 + cellX * 0.55 + cellZ * 0.4);
          colour = Blocks.scale(base, (0.86 + 0.26 * sunY) * ripple);
        } else {
          int base = Blocks.topColour(blockId);
          double slopeX = columnGround - ground[index - span];
          double slopeZ = columnGround - ground[index - 1];
          double normalX = -slopeX * 0.7, normalZ = -slopeZ * 0.7;
          double inverse = 1.0 / Math.sqrt(normalX * normalX + normalZ * normalZ + 1.0);
          double lambert = Math.max(0, (normalX * sunX + normalZ * sunZ) * inverse + sunY * inverse);
          double light = 0.52 + 0.6 * lambert;
          if (wall) {
            double depthInFace = clamp01((surfaceTop - (eyeY + dirY * distance)) / 3.0);
            light *= 0.62 + 0.2 * depthInFace;
            base = Blocks.sideColour(blockId);
          }
          if (blockId == SNOW || (blockId == SAND && surface <= SEA_LEVEL + 1)) {
            light = Math.min(1.26, light + 0.07);
          }
          colour = Blocks.scale(base, light);
        }
        double grain = 0.93 + Noise.hashCoords(cellX, (int) surface, cellZ, 17) * 0.1;
        if (((cellX + cellZ) & 1) != 0) grain *= 1.03;
        double fog = clamp01(Math.pow(distance / FOG_DISTANCE, 1.45));
        if (isWater) fog = Math.min(1, fog + 0.08);
        int red = (int) (((colour >> 16) & 255) * grain);
        int green = (int) (((colour >> 8) & 255) * grain);
        int blue = (int) ((colour & 255) * grain);
        rowPixels[column] = mixWithSky(Blocks.clamp(red) << 16 | Blocks.clamp(green) << 8 | Blocks.clamp(blue),
            skyRed, skyGreen, skyBlue, fog);
        painted = true;
        double forwardDepth = distance * (dirX * forwardX + dirY * forwardY + dirZ * forwardZ);
        if (forwardDepth > 0.12) invDepth[row * width + column] = 1.0 / forwardDepth;
      }
      if (painted) System.arraycopy(rowPixels, 0, pixels, row * width, width);
    }
    lastSamples = samples;
  }

  private static int mixWithSky(int colour, double skyRed, double skyGreen, double skyBlue, double t) {
    if (t <= 0) return colour;
    int red = (int) (((colour >> 16) & 255) + (skyRed - ((colour >> 16) & 255)) * t);
    int green = (int) (((colour >> 8) & 255) + (skyGreen - ((colour >> 8) & 255)) * t);
    int blue = (int) ((colour & 255) + (skyBlue - (colour & 255)) * t);
    return Blocks.clamp(red) << 16 | Blocks.clamp(green) << 8 | Blocks.clamp(blue);
  }

  private void columnTops(World world, double eyeX, double eyeY, double eyeZ,
                          double[] forward, double[] right) {
    for (int column = 0; column < width; column += 2) {
      double u = (column + 0.5 - width / 2.0) / focal;
      double dirX = forward[0] + right[0] * u;
      double dirZ = forward[2] + right[2] * u;
      double length = Math.hypot(dirX, dirZ);
      if (length < 1e-6) length = 1;
      dirX /= length;
      dirZ /= length;
      double step = 1, distance = 1, best = -1e9;
      while (distance < MAX_DISTANCE) {
        int cellX = (int) (eyeX + dirX * distance);
        if (cellX < 0 || cellX >= WORLD_X) break;
        int cellZ = (int) (eyeZ + dirZ * distance);
        if (cellZ < 0 || cellZ >= WORLD_Z) break;
        int[] surface = world.surface(cellX, cellZ);
        if (surface[0] >= 0) {
          double rise = (surface[0] + 1.0 - eyeY) / distance;
          if (rise > best) best = rise;
        }
        distance += step;
        step += 0.08;
      }
      int top = best > -1e8 ? (int) (height / 2.0 - best * focal) : 0;
      top = Math.max(0, Math.min(height - 1, top));
      topRow[column] = top;
      if (column + 1 < width) topRow[column + 1] = top;
    }
  }

  // ------------------------------------------------------------------ cubes

  private void drawObjects(World world, double eyeX, double eyeY, double eyeZ,
                           double[] forward, double[] up) {
    java.util.List<int[]> cubes = world.objectsNear(eyeX, eyeZ, CUBE_RADIUS);
    java.util.List<double[]> visible = new java.util.ArrayList<>();
    for (int[] cube : cubes) {
      double relX = cube[0] + 0.5 - eyeX, relY = cube[1] + 0.5 - eyeY, relZ = cube[2] + 0.5 - eyeZ;
      double depth = relX * forward[0] + relY * forward[1] + relZ * forward[2];
      if (depth < 0.4 || depth > MAX_DISTANCE) continue;
      if (hidden(world, cube[0], cube[1], cube[2])) continue;
      visible.add(new double[] {depth, cube[0], cube[1], cube[2], cube[3]});
    }
    visible.sort((a, b) -> Double.compare(b[0], a[0]));
    for (double[] item : visible) {
      drawCube(world, (int) item[1], (int) item[2], (int) item[3], (int) item[4],
          eyeX, eyeY, eyeZ, forward, up);
    }
  }

  private static boolean hidden(World world, int x, int y, int z) {
    return world.isSolid(x + 1, y, z) && world.isSolid(x - 1, y, z)
        && world.isSolid(x, y + 1, z) && world.isSolid(x, y - 1, z)
        && world.isSolid(x, y, z + 1) && world.isSolid(x, y, z - 1);
  }

  private void drawCube(World world, int x, int y, int z, int blockId,
                        double eyeX, double eyeY, double eyeZ, double[] forward, double[] up) {
    double toEyeX = eyeX - (x + 0.5), toEyeY = eyeY - (y + 0.5), toEyeZ = eyeZ - (z + 0.5);
    for (int[] face : FACES) {
      int axis = face[0], sign = face[1];
      double normalX = axis == 0 ? sign : 0, normalY = axis == 1 ? sign : 0, normalZ = axis == 2 ? sign : 0;
      if (toEyeX * normalX + toEyeY * normalY + toEyeZ * normalZ <= 0.02) continue;
      if (faceCulled(world, x, y, z, axis, sign, blockId)) continue;
      double[] screenX = new double[4], screenY = new double[4], depths = new double[4];
      boolean behind = false;
      for (int corner = 0; corner < 4; corner++) {
        double pointX = x + face[2 + corner * 3];
        double pointY = y + face[3 + corner * 3];
        double pointZ = z + face[4 + corner * 3];
        double relX = pointX - eyeX, relY = pointY - eyeY, relZ = pointZ - eyeZ;
        double depth = relX * forward[0] + relY * forward[1] + relZ * forward[2];
        if (depth <= 0.08) {
          behind = true;
          break;
        }
        double rightX = -forward[2], rightZ = forward[0];
        double rightLength = Math.hypot(rightX, rightZ);
        if (rightLength < 1e-6) rightLength = 1;
        double side = (relX * rightX + relZ * rightZ) / rightLength;
        double vertical = relX * up[0] + relY * up[1] + relZ * up[2];
        screenX[corner] = width / 2.0 + (side / depth) * focal;
        screenY[corner] = height / 2.0 - (vertical / depth) * focal;
        depths[corner] = depth;
      }
      if (behind) continue;
      int row = Math.max(0, Math.min(height - 1, (int) screenY[0]));
      double skyRed = rowColours[row * 3], skyGreen = rowColours[row * 3 + 1], skyBlue = rowColours[row * 3 + 2];
      double light = FACE_LIGHT[(axis << 4) | (sign > 0 ? 1 : 0)] / 255.0;
      int base = sign > 0 ? Blocks.colour(blockId, axis == 1 ? 0 : 1) : Blocks.colour(blockId, 2);
      double grain = 0.95 + Noise.hashCoords(x, y, z, 23) * 0.1;
      if (blockId == Blocks.LEAVES) grain *= 0.86 + 0.28 * ((x + y * 2 + z * 3) & 1);
      double average = (depths[0] + depths[1] + depths[2] + depths[3]) / 4.0;
      double fog = clamp01(Math.pow(average / FOG_DISTANCE, 2.2));
      int colour = Blocks.scale(base, light * grain);
      int red = (int) (((colour >> 16) & 255) * 1.0);
      int green = (int) (((colour >> 8) & 255) * 1.0);
      int blue = (int) ((colour & 255) * 1.0);
      int blended = Blocks.mix(Blocks.clamp(red) << 16 | Blocks.clamp(green) << 8 | Blocks.clamp(blue),
          (Blocks.clamp((int) skyRed) << 16) | (Blocks.clamp((int) skyGreen) << 8) | Blocks.clamp((int) skyBlue), fog);
      fillQuad(screenX, screenY, depths, blended);
    }
  }

  private static boolean faceCulled(World world, int x, int y, int z, int axis, int sign, int blockId) {
    int nx = x, ny = y, nz = z;
    if (axis == 0) nx += sign;
    else if (axis == 1) ny += sign;
    else nz += sign;
    int neighbour = world.get(nx, ny, nz);
    if (neighbour == AIR || neighbour == WATER) return false;
    return world.isSolid(nx, ny, nz) || neighbour == blockId;
  }

  private void fillQuad(double[] px, double[] py, double[] depths, int colour) {
    int red = (colour >> 16) & 255, green = (colour >> 8) & 255, blue = colour & 255;
    int[][] triangles = {{0, 1, 2}, {0, 2, 3}};
    for (int[] triangle : triangles) {
      int i0 = triangle[0], i1 = triangle[1], i2 = triangle[2];
      double ax = px[i0], ay = py[i0], bx = px[i1], by = py[i1], cx = px[i2], cy = py[i2];
      double da = depths[i0], db = depths[i1], dc = depths[i2];
      if (da <= 0.05 || db <= 0.05 || dc <= 0.05) continue;
      int minX = (int) Math.max(0, Math.floor(Math.min(ax, Math.min(bx, cx))));
      int maxX = (int) Math.min(width - 1, Math.ceil(Math.max(ax, Math.max(bx, cx))));
      int minY = (int) Math.max(0, Math.floor(Math.min(ay, Math.min(by, cy))));
      int maxY = (int) Math.min(height - 1, Math.ceil(Math.max(ay, Math.max(by, cy))));
      if (minX > maxX || minY > maxY) continue;
      double area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-6) continue;
      double inverse = 1.0 / area;
      double ia = 1.0 / da, ib = 1.0 / db, ic = 1.0 / dc;
      double w0x = -(by - ay) * inverse, w0y = (bx - ax) * inverse;
      double w1x = -(cy - by) * inverse, w1y = (cx - bx) * inverse;
      double startX = minX + 0.5, startY = minY + 0.5;
      double w0Row = ((bx - ax) * (startY - ay) - (startX - ax) * (by - ay)) * inverse;
      double w1Row = ((cx - bx) * (startY - by) - (startX - bx) * (cy - by)) * inverse;
      double stepInverse0 = w0x * (ia - ic), stepInverse1 = w1x * (ib - ic);
      for (int row = minY; row <= maxY; row++) {
        double w0 = w0Row, w1 = w1Row;
        double pixelInverse = ic + w0 * (ia - ic) + w1 * (ib - ic);
        int base = row * width;
        for (int column = minX; column <= maxX; column++) {
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) {
            int index = base + column;
            if (pixelInverse > invDepth[index]) {
              invDepth[index] = pixelInverse;
              pixels[index] = (red << 16) | (green << 8) | blue;
            }
          }
          w0 += w0x;
          w1 += w1x;
          pixelInverse += stepInverse0 + stepInverse1;
        }
        w0Row += w0y;
        w1Row += w1y;
      }
    }
  }

  // ------------------------------------------------------------------ overlays

  private void drawBlockOutline(int x, int y, int z, double eyeX, double eyeY, double eyeZ,
                                double[] forward, double[] up) {
    double[] xs = new double[8], ys = new double[8];
    int corner = 0;
    for (int dy = 0; dy < 2; dy++) {
      for (int dz = 0; dz < 2; dz++) {
        for (int dx = 0; dx < 2; dx++) {
          double pointX = x + (dx == 0 ? -0.004 : 1.004);
          double pointY = y + (dy == 0 ? -0.004 : 1.004);
          double pointZ = z + (dz == 0 ? -0.004 : 1.004);
          double relX = pointX - eyeX, relY = pointY - eyeY, relZ = pointZ - eyeZ;
          double depth = relX * forward[0] + relY * forward[1] + relZ * forward[2];
          if (depth <= 0.08) return;
          double rightX = -forward[2], rightZ = forward[0];
          double rightLength = Math.hypot(rightX, rightZ);
          if (rightLength < 1e-6) rightLength = 1;
          double side = (relX * rightX + relZ * rightZ) / rightLength;
          double vertical = relX * up[0] + relY * up[1] + relZ * up[2];
          xs[corner] = width / 2.0 + (side / depth) * focal;
          ys[corner] = height / 2.0 - (vertical / depth) * focal;
          corner++;
        }
      }
    }
    int[][] edges = {{0, 1}, {1, 3}, {3, 2}, {2, 0}, {4, 5}, {5, 7}, {7, 6}, {6, 4},
        {0, 4}, {1, 5}, {2, 6}, {3, 7}};
    for (int[] edge : edges) line(xs[edge[0]], ys[edge[0]], xs[edge[1]], ys[edge[1]], 0x121216);
  }

  private void line(double x0, double y0, double x1, double y1, int colour) {
    int steps = (int) Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1;
    if (steps > 4096) return;
    for (int index = 0; index < steps; index++) {
      double t = index / (double) steps;
      plot((int) (x0 + (x1 - x0) * t), (int) (y0 + (y1 - y0) * t), colour);
    }
  }

  private void drawCrosshair() {
    int centreX = width / 2, centreY = height / 2;
    for (int offset = 3; offset < 8; offset++) {
      plot(centreX + offset, centreY, 0xFFFFFF);
      plot(centreX - offset, centreY, 0xFFFFFF);
      plot(centreX, centreY + offset, 0xFFFFFF);
      plot(centreX, centreY - offset, 0xFFFFFF);
    }
  }

  public void plot(int x, int y, int colour) {
    if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = colour;
  }
}
