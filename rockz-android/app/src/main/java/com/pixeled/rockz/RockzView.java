package com.pixeled.rockz;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

/**
 * Rockz — the native, touch-first mobile edition. A 3D voxel world rendered by {@link Renderer},
 * driven by an on-screen joystick, drag-to-look, and MINE / PLACE / JUMP / FLY buttons.
 *
 * Nothing here needs the network, and the world is a fresh random one the first time the app runs;
 * the seed, your edits and your position are kept in SharedPreferences.
 */
public final class RockzView extends View {

    private static final int CLOCK_START = 0;
    private static final double DAY_LENGTH = 480;

    private Renderer renderer;
    private WorldModel world;
    private final PlayerModel player;
    private final TouchControls controls = new TouchControls();
    private final float density;

    private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint hud = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect source = new Rect();
    private final RectF bounds = new RectF();

    private Bitmap frame;
    private int[] pixels;
    private int frameWidth, frameHeight;
    private long lastFrameMs, elapsedMs, lastSecondMs, framesThisSecond;

    private double clock = 0.24;
    private int selected;
    private double fps;
    private boolean dirty = true;
    private float lastTouchX, lastTouchY;
    private int lookPointer = -1;
    private String toast = "New world! Drag to look, tap the buttons to build";
    private long toastUntil;

    public RockzView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        world = WorldModel.open(new PreferencesStore(context));
        player = new PlayerModel(world);
        selected = world.hasSavedPlayer ? world.savedSelected : 0;
        clock = world.hasSavedPlayer ? world.savedClock : 0.24;

        int shortest = Math.min(getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels);
        int scale = shortest > 1000 ? 4 : 3;                 // adaptive render resolution
        frameWidth = Math.max(180, getResources().getDisplayMetrics().widthPixels / scale);
        frameHeight = Math.max(120, getResources().getDisplayMetrics().heightPixels / scale);
        renderer = new Renderer(frameWidth, frameHeight);
        pixels = new int[frameWidth * frameHeight];
        frame = Bitmap.createBitmap(frameWidth, frameHeight, Bitmap.Config.ARGB_8888);
        toastUntil = SystemClock.uptimeMillis() + 4000;
        setFocusable(true);
    }

    /** Start a brand-new random world (the "new world" button). */
    public void newWorld() {
        world.forget();
        world = new WorldModel(new PreferencesStore(getContext()), WorldModel.randomSeed());
        player.spawn(world);
        player.yaw = 0.6;
        player.pitch = -0.12;
        clock = 0.24;
        selected = 0;
        save();
        notify("Brand-new random world! Seed " + world.seed);
    }

    public void save() {
        world.rememberPlayer(player.x, player.y, player.z, player.yaw, player.pitch, clock, selected);
        world.save();
    }

    private void notify(String message) {
        toast = message;
        toastUntil = SystemClock.uptimeMillis() + 2600;
    }

    // ------------------------------------------------------------------ layout

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        controls.layout(width, height, density);
        int scale = 3;
        while (width / scale > 420 || height / scale > 300) scale++;
        int newWidth = Math.max(160, width / scale);
        int newHeight = Math.max(110, height / scale);
        if (newWidth != frameWidth || newHeight != frameHeight) {
            frameWidth = newWidth;
            frameHeight = newHeight;
            renderer = new Renderer(frameWidth, frameHeight);
            pixels = new int[frameWidth * frameHeight];
            frame = Bitmap.createBitmap(frameWidth, frameHeight, Bitmap.Config.ARGB_8888);
        }
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                int index = event.getActionIndex();
                float x = event.getX(index), y = event.getY(index);
                int slot = controls.hotbarSlot(x, y);
                if (slot >= 0) {
                    selected = slot;
                    notify(Blocks.name(Blocks.HOTBAR[slot]));
                    dirty = true;
                    break;
                }
                controls.pointerDown(event.getPointerId(index), x, y);
                String what = controls.actionOf(event.getPointerId(index));
                if (controls.isNewWorldTap(event.getPointerId(index))) newWorld();
                else if ("mine".equals(what)) mine();
                else if ("place".equals(what)) place();
                else if ("jump".equals(what)) jump();
                else if ("fly".equals(what)) toggleFly();
                else if ("look".equals(what)) {
                    lookPointer = event.getPointerId(index);
                    lastTouchX = x;
                    lastTouchY = y;
                }
                break;
            }
            case MotionEvent.ACTION_MOVE: {
                for (int index = 0; index < event.getPointerCount(); index++) {
                    int id = event.getPointerId(index);
                    float x = event.getX(index), y = event.getY(index);
                    String what = controls.actionOf(id);
                    if ("move".equals(what)) {
                        controls.drag(id, x, y);
                    } else if (id == lookPointer) {
                        player.look((x - lastTouchX) * 0.006, (y - lastTouchY) * 0.006);
                        lastTouchX = x;
                        lastTouchY = y;
                        dirty = true;
                    }
                }
                break;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP:
            case MotionEvent.ACTION_CANCEL: {
                int index = event.getActionIndex();
                int id = event.getPointerId(index);
                controls.pointerUp(id);
                if (id == lookPointer) lookPointer = -1;
                if (action == MotionEvent.ACTION_CANCEL) controls.clear();
                break;
            }
            default:
                break;
        }
        invalidate();
        return true;
    }

    // ------------------------------------------------------------------ actions

    private void mine() {
        double[] direction = player.direction();
        Raycast.Hit hit = Raycast.cast(world, player.x, player.eyeY(), player.z,
                direction[0], direction[1], direction[2], 6.5, false);
        if (hit == null || !player.reaches(hit.x, hit.y, hit.z)) {
            notify("Nothing in reach");
            return;
        }
        if (hit.y <= 0) {
            notify("Bedrock is unbreakable");
            return;
        }
        world.set(hit.x, hit.y, hit.z, Blocks.AIR);
        notify("Mined " + Blocks.name(hit.id));
        dirty = true;
    }

    private void place() {
        double[] direction = player.direction();
        Raycast.Hit hit = Raycast.cast(world, player.x, player.eyeY(), player.z,
                direction[0], direction[1], direction[2], 6.5, false);
        if (hit == null) {
            notify("Nothing in reach");
            return;
        }
        int[] cell = Raycast.placementCell(hit);
        if (!world.inside(cell[0], cell[1], cell[2]) || player.overlaps(cell[0], cell[1], cell[2])) {
            notify("That is where you stand");
            return;
        }
        int existing = world.get(cell[0], cell[1], cell[2]);
        if (existing != Blocks.AIR && existing != Blocks.WATER) return;
        int blockId = Blocks.HOTBAR[selected];
        world.set(cell[0], cell[1], cell[2], blockId);
        notify("Placed " + Blocks.name(blockId));
        dirty = true;
    }

    private void jump() {
        if (player.flying) {
            player.velocityY = 6;
        } else if (player.onGround) {
            player.velocityY = 9.2;
            player.onGround = false;
        }
        dirty = true;
    }

    private void toggleFly() {
        player.flying = !player.flying;
        player.velocityY = 0;
        notify(player.flying ? "Flight on" : "Flight off");
        dirty = true;
    }

    // ------------------------------------------------------------------ frames

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = SystemClock.uptimeMillis();
        double dt = lastFrameMs == 0 ? 0.016 : Math.min(0.1, (now - lastFrameMs) / 1000.0);
        lastFrameMs = now;
        elapsedMs += (long) (dt * 1000);
        framesThisSecond++;
        if (now - lastSecondMs >= 500) {
            fps = framesThisSecond * 1000.0 / Math.max(1, now - lastSecondMs);
            framesThisSecond = 0;
            lastSecondMs = now;
        }

        double forward = -controls.moveY();
        double strafe = controls.moveX();
        boolean sprinting = controls.joystickStrength() > 0.92f;
        if (player.update(dt, forward, strafe, controls.isHold("jump"), controls.isHold("crouch"),
                sprinting, world)) {
            notify("Back at spawn");
        }
        clock = (clock + dt / DAY_LENGTH) % 1;

        double[] direction = player.direction();
        Raycast.Hit hit = Raycast.cast(world, player.x, player.eyeY(), player.z,
                direction[0], direction[1], direction[2], 6.5, false);
        double sunClock = clock;
        pixels = renderer.render(world, player, sunClock, hit != null,
                hit == null ? 0 : hit.x, hit == null ? 0 : hit.y, hit == null ? 0 : hit.z,
                elapsedMs / 1000.0);
        frame.setPixels(pixels, 0, frameWidth, 0, 0, frameWidth, frameHeight);
        source.set(0, 0, frameWidth, frameHeight);
        bounds.set(0, 0, getWidth(), getHeight());
        canvas.drawBitmap(frame, source, bounds, paint);

        drawHud(canvas, hit);
        postInvalidateOnAnimation();
    }

    // ------------------------------------------------------------------ HUD

    private void drawHud(Canvas canvas, Raycast.Hit hit) {
        float width = getWidth(), height = getHeight();
        text.setTextSize(12 * density);
        text.setFakeBoldText(true);

        // Crosshair.
        hud.setColor(Color.argb(230, 255, 255, 255));
        hud.setStrokeWidth(1.6f * density);
        float cx = width / 2, cy = height / 2, gap = 6 * density, arm = 7 * density;
        canvas.drawLine(cx + gap, cy, cx + gap + arm, cy, hud);
        canvas.drawLine(cx - gap, cy, cx - gap - arm, cy, hud);
        canvas.drawLine(cx, cy + gap, cx, cy + gap + arm, hud);
        canvas.drawLine(cx, cy - gap, cx, cy - gap - arm, hud);

        // Targeted block name.
        if (hit != null) {
            hud.setColor(Color.argb(150, 10, 14, 20));
            String label = Blocks.name(hit.id);
            canvas.drawRoundRect(cx - 46 * density, cy - 34 * density, cx + 46 * density,
                    cy - 16 * density, 6 * density, 6 * density, hud);
            text.setColor(Color.WHITE);
            text.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(label, cx, cy - 22 * density, text);
            text.setTextAlign(Paint.Align.LEFT);
        }

        // Stats.
        hud.setColor(Color.argb(150, 10, 14, 20));
        canvas.drawRoundRect(10 * density, 10 * density, 260 * density, 54 * density,
                8 * density, 8 * density, hud);
        text.setColor(Color.rgb(150, 215, 255));
        canvas.drawText(String.format("seed %d   %s", world.seed, world.biomeName(player.x, player.z)),
                18 * density, 28 * density, text);
        text.setColor(Color.rgb(226, 232, 240));
        canvas.drawText(String.format("x %.0f  y %.0f  z %.0f   %.0f fps", player.x, player.y, player.z, fps),
                18 * density, 46 * density, text);

        drawJoystick(canvas);
        drawButtons(canvas, width, height);
        drawHotbar(canvas, width, height);
        drawMinimap(canvas, width);

        if (SystemClock.uptimeMillis() < toastUntil) {
            hud.setColor(Color.argb(170, 10, 14, 20));
            float messageWidth = text.measureText(toast) + 26 * density;
            canvas.drawRoundRect(cx - messageWidth / 2, height * 0.2f, cx + messageWidth / 2,
                    height * 0.2f + 30 * density, 8 * density, 8 * density, hud);
            text.setColor(Color.WHITE);
            text.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(toast, cx, height * 0.2f + 20 * density, text);
            text.setTextAlign(Paint.Align.LEFT);
        }
    }

    private void drawJoystick(Canvas canvas) {
        float radius = TouchControls.JOYSTICK_RADIUS * density;
        hud.setColor(Color.argb(60, 255, 255, 255));
        canvas.drawCircle(controls.joystickAnchorX(), controls.joystickAnchorY(), radius, hud);
        hud.setStyle(Paint.Style.STROKE);
        hud.setStrokeWidth(2 * density);
        hud.setColor(Color.argb(120, 255, 255, 255));
        canvas.drawCircle(controls.joystickAnchorX(), controls.joystickAnchorY(), radius, hud);
        hud.setStyle(Paint.Style.FILL);
        hud.setColor(Color.argb(190, 255, 255, 255));
        canvas.drawCircle(controls.joystickAnchorX() + controls.moveX() * radius,
                controls.joystickAnchorY() + controls.moveY() * radius, radius * 0.42f, hud);
    }

    private void drawButtons(Canvas canvas, float width, float height) {
        drawButton(canvas, "mine", "MINE", Color.rgb(232, 96, 88));
        drawButton(canvas, "place", "PLACE", Color.rgb(96, 190, 120));
        drawButton(canvas, "jump", "JUMP", Color.rgb(96, 150, 232));
        drawButton(canvas, "crouch", "DOWN", Color.rgb(150, 130, 226));
        drawButton(canvas, "fly", player.flying ? "LAND" : "FLY", Color.rgb(226, 190, 96));
        hud.setColor(Color.argb(150, 10, 14, 20));
        canvas.drawRoundRect(width - 214 * density, height - 216 * density,
                width - 10 * density, height - 176 * density, 8 * density, 8 * density, hud);
        text.setColor(Color.WHITE);
        text.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("TAP THE STATUS BAR", width - 112 * density, height - 196 * density, text);
        canvas.drawText("FOR A NEW WORLD", width - 112 * density, height - 182 * density, text);
        text.setTextAlign(Paint.Align.LEFT);
    }

    private void drawButton(Canvas canvas, String action, String label, int colour) {
        float[] anchor = controls.anchor(action);
        if (anchor == null) return;
        float radius = TouchControls.BUTTON_RADIUS * density;
        hud.setColor(Color.argb(170, Color.red(colour) / 3, Color.green(colour) / 3, Color.blue(colour) / 3));
        canvas.drawCircle(anchor[0], anchor[1], radius, hud);
        hud.setStyle(Paint.Style.STROKE);
        hud.setStrokeWidth(2.4f * density);
        hud.setColor(colour);
        canvas.drawCircle(anchor[0], anchor[1], radius, hud);
        hud.setStyle(Paint.Style.FILL);
        text.setColor(Color.WHITE);
        text.setTextAlign(Paint.Align.CENTER);
        canvas.drawText(label, anchor[0], anchor[1] + 4 * density, text);
        text.setTextAlign(Paint.Align.LEFT);
    }

    private void drawHotbar(Canvas canvas, float width, float height) {
        float[] strip = controls.anchor("hotbar");
        if (strip == null) return;
        float slot = strip[2], gap = strip[3];
        for (int index = 0; index < Blocks.HOTBAR.length; index++) {
            float left = strip[0] + index * (slot + gap);
            hud.setColor(index == selected ? Color.WHITE : Color.argb(150, 10, 14, 20));
            canvas.drawRoundRect(left - 2, strip[1] - 2, left + slot + 2, strip[1] + slot + 2,
                    5 * density, 5 * density, hud);
            hud.setColor(Blocks.toArgb(Blocks.topColour(Blocks.HOTBAR[index])));
            canvas.drawRect(left + 3 * density, strip[1] + 3 * density,
                    left + slot - 3 * density, strip[1] + slot - 3 * density, hud);
        }
    }

    private void drawMinimap(Canvas canvas, float width) {
        float size = 78 * density, top = 10 * density, left = width - size - 10 * density;
        hud.setColor(Color.argb(150, 10, 14, 20));
        canvas.drawRoundRect(left - 3, top - 3, left + size + 3, top + size + 3, 6 * density, 6 * density, hud);
        float radius = 24;
        for (int row = 0; row < size; row++) {
            int worldZ = (int) (player.z - radius + row * (radius * 2 / size));
            if (worldZ < 0 || worldZ >= Blocks.WORLD_Z) continue;
            for (int column = 0; column < size; column++) {
                int worldX = (int) (player.x - radius + column * (radius * 2 / size));
                if (worldX < 0 || worldX >= Blocks.WORLD_X) continue;
                int[] surface = world.surface(worldX, worldZ);
                int colour = surface[0] < 0 ? 0xFF101828
                        : surface[2] == 1 ? 0xFF3C6EBE : Blocks.toArgb(Blocks.topColour(surface[1]));
                hud.setColor(colour);
                canvas.drawPoint(left + column, top + row, hud);
            }
        }
        hud.setColor(Color.WHITE);
        canvas.drawRect(left + size / 2 - 1, top + size / 2 - 1, left + size / 2 + 1, top + size / 2 + 1, hud);
    }
}
