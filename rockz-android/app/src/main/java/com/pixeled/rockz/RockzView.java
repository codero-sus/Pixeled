package com.pixeled.rockz;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.text.InputType;
import android.view.MotionEvent;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;

import java.util.List;

/**
 * Rockz — the mobile edition of Pixeled, in 3D.
 *
 * <p>Draws the world with a software 3D renderer ({@link RockzRenderer}) onto Android's Canvas:
 * chunk meshes, perspective projection, painter's-algorithm sorting, baked shading, fog and a
 * day/night cycle. Touch controls live in {@link TouchControls} and the physics in
 * {@link PlayerModel}, so this class only wires them together and paints the HUD.
 */
public final class RockzView extends View implements Runnable {

    private static final double REACH = 6.0;
    private static final double DAY_LENGTH_SECONDS = 600;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();

    private final TouchControls controls = new TouchControls();
    private final SharedPreferences preferences;
    private final float density;

    private WorldModel world;
    private PlayerModel player;
    private RockzRenderer renderer;

    private long lastFrame;
    private long lastSave;
    private long startTime;
    private boolean running = true;
    private String toast = "Welcome to Rockz — drag to look, stick to walk";
    private long toastUntil;
    private double breakProgress;
    private int[] breakKey;
    private double placeCooldown;
    private double elapsedSeconds;
    private double timeOfDay = 0.32;
    private boolean inWater;
    private int lookPointer = -1;
    private float lookX, lookY;
    private int hotbarSlot = 0;
    private final Paint gradient = new Paint();
    private final Paint hud = new Paint(Paint.ANTI_ALIAS_FLAG);

    public RockzView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        preferences = context.getSharedPreferences("rockz_world", Context.MODE_PRIVATE);
        String stored = preferences.getString("seed", null);
        Integer parsed = stored == null ? null : Noise.parseSeed(stored);
        int seed = parsed != null ? parsed : Noise.randomSeed();
        startWorld(seed, false);
        setFocusable(true);
        setContentDescription("Rockz, a 3D voxel sandbox. Drag to look around, use the joystick to walk, "
            + "and the buttons to jump, fly, dig and place blocks.");
    }

    // ------------------------------------------------------------------ world

    private void startWorld(int seed, boolean clearSave) {
        if (clearSave) world.clearSave();
        world = new WorldModel(getContext(), seed);
        player = new PlayerModel(world);
        timeOfDay = world.timeOfDay;
        renderer = new RockzRenderer(world);
        renderer.renderDistance = 4;
        // Fill the first chunks before the first frame so the player never spawns in an empty sky.
        ensureAround(true);
        preferences.edit().putString("seed", String.valueOf(seed)).apply();
        breakProgress = 0;
        breakKey = null;
    }

    private void ensureAround(boolean immediate) {
        int budget = immediate ? 1024 : 2;
        renderer.streamChunks(player.x, player.z, budget);
    }

    private int seed() {
        return world.seed;
    }

    /** Save the seed's world: only what changed, so the file stays tiny. */
    public void saveWorld() {
        world.timeOfDay = timeOfDay;
        world.elapsedMs += (long) (elapsedSeconds * 1000);
        world.save(player.serialize(), world.blocksPlaced, world.elapsedMs, timeOfDay);
        lastSave = SystemClock.uptimeMillis();
    }

    private void showToast(String value) {
        toast = value;
        toastUntil = SystemClock.uptimeMillis() + 2200;
    }

    // ------------------------------------------------------------------ the loop

    @Override
    public void run() {
        if (!running) return;
        invalidate();
        postDelayed(this, 16);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        running = true;
        startTime = SystemClock.uptimeMillis();
        lastFrame = startTime;
        postDelayed(this, 16);
    }

    @Override
    protected void onDetachedFromWindow() {
        running = false;
        saveWorld();
        super.onDetachedFromWindow();
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        controls.layout(width, height, density);
    }

    private void tick() {
        long now = SystemClock.uptimeMillis();
        double dt = Math.min(0.05, (now - lastFrame) / 1000.0);
        lastFrame = now;
        elapsedSeconds += dt;

        List<String> taps = controls.takeTaps();
        for (String tap : taps) {
            if (tap.equals("jump")) {
                player.jump();
            } else if (tap.equals("fly")) {
                showToast(player.toggleFly() ? "Flying — hold JUMP to rise, DOWN to sink" : "Back on your feet");
            } else if (tap.equals("seed")) {
                askForSeed();
            } else if (tap.equals("new")) {
                startWorld(Noise.randomSeed(), true);
                showToast("New world · seed " + seed());
            }
        }

        boolean sprinting = controls.stickMagnitude() > 0.9f;
        player.update(dt, controls.forwardAxis(), controls.strafeAxis(),
            controls.active("jump"), controls.active("sneak"), sprinting);

        // Digging: hold DIG to chip through a block, hold PUT to keep building.
        placeCooldown -= dt;
        if (controls.active("dig")) {
            updateDigging(dt);
        } else {
            breakProgress = 0;
            breakKey = null;
        }
        if (controls.active("place") && placeCooldown <= 0) {
            placeCooldown = 0.24;
            placeBlock();
        }

        timeOfDay = (timeOfDay + dt / DAY_LENGTH_SECONDS) % 1;

        inWater = world.getBlock((int) Math.floor(player.x), (int) Math.floor(player.eyeY()),
            (int) Math.floor(player.z)) == Blocks.WATER;

        ensureAround(false);
        if (now - lastSave > 15000) saveWorld();
    }

    private void updateDigging(double dt) {
        WorldModel.Hit hit = target();
        if (hit == null) {
            breakProgress = 0;
            breakKey = null;
            return;
        }
        if (breakKey == null || breakKey[0] != hit.x || breakKey[1] != hit.y || breakKey[2] != hit.z) {
            breakKey = new int[]{hit.x, hit.y, hit.z};
            breakProgress = 0;
        }
        double hardness = Math.max(0.16, Blocks.hardnessOf(hit.block));
        breakProgress += dt / hardness;
        if (breakProgress >= 1) {
            breakBlock(hit);
            breakProgress = 0;
            breakKey = null;
        }
    }

    private WorldModel.Hit target() {
        double[] eye = {player.x, player.eyeY(), player.z};
        double[] direction = player.direction();
        return world.raycast(eye[0], eye[1], eye[2], direction[0], direction[1], direction[2], REACH);
    }

    private void breakBlock(WorldModel.Hit hit) {
        if (!world.setBlock(hit.x, hit.y, hit.z, 0, true)) return;
        renderer.markDirty(hit.x, hit.z);
        showToast("Dug " + Blocks.nameOf(hit.block).toLowerCase());
    }

    private void placeBlock() {
        WorldModel.Hit hit = target();
        if (hit == null) return;
        int x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
        if (y < 0 || y >= Blocks.WORLD_HEIGHT) return;
        int block = selectedBlock();
        int existing = world.getBlock(x, y, z);
        if (existing != 0 && !Blocks.isLiquid(existing)) return;
        if (player.overlapsBlock(x, y, z) && Blocks.isSolid(block)) {
            showToast("No room — step back");
            return;
        }
        if (!world.setBlock(x, y, z, block, true)) return;
        renderer.markDirty(x, z);
        world.blocksPlaced++;
        showToast("Placed " + Blocks.nameOf(block).toLowerCase());
    }

    private int selectedBlock() {
        return Blocks.HOTBAR_PAGES[0][hotbarSlot];
    }

    // ------------------------------------------------------------------ seeding

    private void askForSeed() {
        EditText field = new EditText(getContext());
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setHint("Leave blank to roll a new seed");
        field.setText(String.valueOf(seed()));

        FrameLayout wrap = new FrameLayout(getContext());
        wrap.setPadding((int) (20 * density), (int) (12 * density), (int) (20 * density), 0);
        wrap.addView(field);

        new AlertDialog.Builder(getContext())
            .setTitle("World seed")
            .setMessage("The same seed always grows the same world — on every edition of Pixeled.")
            .setView(wrap)
            .setPositiveButton("Use seed", (dialog, which) -> {
                Integer parsed = Noise.parseSeed(field.getText().toString());
                int next = parsed != null ? parsed : Noise.randomSeed();
                saveWorld();
                startWorld(next, true);
                showToast("Fresh world · seed " + next);
            })
            .setNeutralButton("Surprise me", (dialog, which) -> {
                saveWorld();
                startWorld(Noise.randomSeed(), true);
                showToast("New world · seed " + seed());
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        int index = event.getActionIndex();
        int pointerId = event.getPointerId(index);
        float x = event.getX(index);
        float y = event.getY(index);

        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                if (y > getHeight() - 52 * density) {   // the hotbar sits along the bottom edge
                    selectHotbar(x, y);
                    return true;
                }
                String grabbed = controls.onDown(pointerId, x, y);
                if (grabbed == null) {
                    // Not a control: this finger turns the camera.
                    lookPointer = pointerId;
                    lookX = x;
                    lookY = y;
                }
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                for (int i = 0; i < event.getPointerCount(); i++) {
                    int id = event.getPointerId(i);
                    float px = event.getX(i);
                    float py = event.getY(i);
                    if (id == lookPointer) {
                        player.look((px - lookX) * 0.0055f, (py - lookY) * 0.0055f);
                        lookX = px;
                        lookY = py;
                    } else {
                        controls.onMove(id, px, py);
                    }
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP: {
                if (pointerId == lookPointer) lookPointer = -1;
                controls.onUp(pointerId);
                return true;
            }
            case MotionEvent.ACTION_CANCEL: {
                controls.clear();
                lookPointer = -1;
                return true;
            }
            default:
                return super.onTouchEvent(event);
        }
    }

    // ------------------------------------------------------------------ drawing

    @Override
    protected void onDraw(Canvas canvas) {
        tick();

        int width = getWidth();
        int height = getHeight();
        double light = RockzRenderer.daylight(timeOfDay);
        int sky = RockzRenderer.skyColor(timeOfDay);

        gradient.setShader(new LinearGradient(0, 0, 0, height,
            RockzRenderer.mixColor(sky, 0x05070d, 0.35), sky, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, gradient);

        if (light > 0.15) {
            paint.setColor(RockzRenderer.withAlpha(0xFFF6D8, (int) (140 * light)));
            canvas.drawCircle(width - 74 * density, 110 * density, 30 * density, paint);
        }

        renderer.moveCamera(player.x, player.eyeY(), player.z, player.yaw, player.pitch);
        renderer.render(canvas, width, height, light, sky);

        if (inWater) {
            paint.setColor(Color.argb(90, 40, 110, 200));
            canvas.drawRect(0, 0, width, height, paint);
        }

        drawHud(canvas, width, height);

        if (toast != null && !toast.isEmpty() && SystemClock.uptimeMillis() < toastUntil) {
            drawToast(canvas, width, height);
        }
        controls.draw(canvas, paint);
    }

    private void drawHud(Canvas canvas, int width, int height) {
        // Status bar.
        hud.setColor(Color.argb(210, 12, 22, 32));
        canvas.drawRect(0, 0, width, 34 * density, hud);
        text.setColor(Color.rgb(238, 243, 234));
        text.setTextSize(11 * density);
        text.setTextAlign(Paint.Align.LEFT);
        text.setFakeBoldText(false);
        canvas.drawText(world.generator.biomeAt((int) player.x, (int) player.z) + "  ·  "
            + String.format("%.0f %.0f %.0f", player.x, player.y, player.z), 12 * density, 22 * density, text);
        String right = RockzRenderer.clockText(timeOfDay) + "  " + RockzRenderer.phaseName(timeOfDay)
            + "  ·  seed " + seed();
        text.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText(right, width - 12 * density, 22 * density, text);

        // Crosshair.
        float cx = width / 2f, cy = height / 2f;
        hud.setColor(Color.argb(215, 255, 255, 255));
        canvas.drawRect(cx - 9 * density, cy - 1 * density, cx + 9 * density, cy + 1 * density, hud);
        canvas.drawRect(cx - 1 * density, cy - 9 * density, cx + 1 * density, cy + 9 * density, hud);

        WorldModel.Hit hit = target();
        if (hit != null) {
            text.setColor(Color.argb(230, 255, 255, 255));
            text.setTextSize(10.5f * density);
            text.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(Blocks.nameOf(hit.block), cx, cy - 16 * density, text);
        }
        if (breakProgress > 0) {
            hud.setColor(Color.rgb(179, 223, 158));
            canvas.drawRect(cx - 30 * density, cy + 16 * density,
                cx - 30 * density + (float) (60 * density * Math.min(1, breakProgress)),
                cy + 21 * density, hud);
        }

        // Hotbar.
        int slots = Blocks.HOTBAR_PAGES[0].length;
        float slot = 44 * density;
        float startX = (width - slot * slots) / 2f;
        float startY = height - 46 * density;
        for (int i = 0; i < slots; i++) {
            int blockId = Blocks.HOTBAR_PAGES[0][i];
            Blocks.Block block = Blocks.BLOCKS[blockId];
            rect.set(startX + i * slot, startY, startX + (i + 1) * slot - 3 * density, startY + slot - 4 * density);
            hud.setColor(i == hotbarSlot ? Color.argb(230, 58, 85, 64) : Color.argb(190, 22, 35, 46));
            canvas.drawRoundRect(rect, 5 * density, 5 * density, hud);
            hud.setStyle(Paint.Style.STROKE);
            hud.setStrokeWidth(1.5f * density);
            hud.setColor(i == hotbarSlot ? Color.rgb(179, 223, 158) : Color.argb(120, 43, 59, 71));
            canvas.drawRoundRect(rect, 5 * density, 5 * density, hud);
            hud.setStyle(Paint.Style.FILL);
            hud.setColor(block.color("top"));
            rect.inset(10 * density, 9 * density);
            canvas.drawRect(rect, hud);
            rect.inset(-10 * density, -9 * density);
        }
    }

    private void drawToast(Canvas canvas, int width, int height) {
        text.setTextSize(12 * density);
        text.setTextAlign(Paint.Align.CENTER);
        float textWidth = text.measureText(toast);
        hud.setColor(Color.argb(215, 12, 22, 32));
        rect.set(width / 2f - textWidth / 2f - 14 * density, height - 152 * density,
            width / 2f + textWidth / 2f + 14 * density, height - 122 * density);
        canvas.drawRoundRect(rect, 8 * density, 8 * density, hud);
        text.setColor(Color.rgb(238, 243, 234));
        canvas.drawText(toast, width / 2f, height - 133 * density, text);
    }

    /** Called by the activity when the player taps a hotbar slot. */
    public void selectHotbar(float x, float y) {
        int slots = Blocks.HOTBAR_PAGES[0].length;
        float slot = 44 * density;
        float startX = (getWidth() - slot * slots) / 2f;
        float startY = getHeight() - 46 * density;
        if (y < startY) return;
        int index = (int) ((x - startX) / slot);
        if (index >= 0 && index < slots) {
            hotbarSlot = index;
            showToast(Blocks.nameOf(selectedBlock()));
        }
    }
}
