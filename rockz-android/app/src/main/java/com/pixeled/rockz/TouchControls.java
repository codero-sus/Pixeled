package com.pixeled.rockz;

import java.util.HashMap;
import java.util.Map;

/**
 * Multi-touch input for Rockz: a movement joystick in the bottom-left corner, MINE / PLACE /
 * JUMP / FLY / DOWN buttons on the right, a hotbar strip above them and drag-anywhere-else to look.
 *
 * Buttons are hit-tested before the joystick so the two clusters can sit close together on small
 * screens without the stick stealing taps. The class only understands screen coordinates and
 * pointer ids, so it can be exercised by tests.
 */
final class TouchControls {

    static final float JOYSTICK_RADIUS = 46;      // in dp
    static final float BUTTON_RADIUS = 30;        // in dp

    private final Map<Integer, String> pointers = new HashMap<>();
    private final Map<String, float[]> anchors = new HashMap<>();
    private float joystickX, joystickY;           // anchor of the movement stick, in pixels
    private float moveX, moveY;                   // -1..1 stick output
    private int joystickPointer = -1;
    private float width;
    float density = 1;

    /** Recomputes every anchor for the current screen size (call on layout changes). */
    void layout(int width, int height, float densityPixels) {
        density = densityPixels;
        this.width = width;
        float margin = 26 * density;
        joystickX = margin + JOYSTICK_RADIUS * density;
        joystickY = height - margin - JOYSTICK_RADIUS * density;
        // A 3x2 cluster in the bottom-right: mining and building by the edge, movement above the
        // thumb, and the descend control tucked between them. Spacing stays wider than two hit
        // radii, so a tap never lands on the wrong button.
        float finger = margin + BUTTON_RADIUS * density;
        float step = BUTTON_RADIUS * 2.6f * density;
        float bottom = height - finger;
        float upper = bottom - step;
        anchors.put("mine", new float[]{width - finger, upper});
        anchors.put("place", new float[]{width - finger, bottom});
        anchors.put("crouch", new float[]{width - finger - step, upper});
        anchors.put("jump", new float[]{width - finger - step, bottom});
        anchors.put("fly", new float[]{width - finger - step * 2, upper});
        float slot = 40 * density;
        float total = Blocks.HOTBAR.length * slot + (Blocks.HOTBAR.length - 1) * 6 * density;
        float left = (width - total) / 2f;
        float top = height - 30 * density;
        anchors.put("hotbar", new float[]{left, top, slot, 6 * density});
        // The status bar in the top-left doubles as the "new world" button.
        anchors.put("new", new float[]{130 * density, 30 * density});
    }

    float joystickAnchorX() {
        return joystickX;
    }

    float joystickAnchorY() {
        return joystickY;
    }

    float moveX() {
        return moveX;
    }

    float moveY() {
        return moveY;
    }

    /** How far the stick is pushed, 0..1 — pushed to the rim means sprint. */
    float joystickStrength() {
        return (float) Math.min(1, Math.hypot(moveX, moveY));
    }

    boolean pointerDown(int id, float x, float y) {
        float[] newWorld = anchors.get("new");
        if (newWorld != null && x < 270 * density && y < 58 * density) {
            pointers.put(id, "new");
            return true;
        }
        for (Map.Entry<String, float[]> entry : anchors.entrySet()) {
            float[] anchor = entry.getValue();
            if (entry.getKey().equals("hotbar") || entry.getKey().equals("new")) continue;
            if (Math.hypot(x - anchor[0], y - anchor[1]) < BUTTON_RADIUS * 1.18f * density) {
                pointers.put(id, entry.getKey());
                return true;
            }
        }
        // The stick owns its own corner, but only once no button wanted the touch.
        float reach = JOYSTICK_RADIUS * 1.5f * density;
        if (joystickPointer < 0 && x < width * 0.55f && Math.hypot(x - joystickX, y - joystickY) < reach) {
            joystickPointer = id;
            pointers.put(id, "move");
            drag(id, x, y);
            return true;
        }
        pointers.put(id, "look");
        return false;
    }

    void drag(int id, float x, float y) {
        if (id == joystickPointer) {
            float radius = JOYSTICK_RADIUS * density;
            float dx = x - joystickX, dy = y - joystickY;
            float length = (float) Math.hypot(dx, dy);
            if (length > radius) {
                dx = dx / length * radius;
                dy = dy / length * radius;
            }
            moveX = dx / radius;
            moveY = dy / radius;
        }
    }

    void pointerUp(int id) {
        String action = pointers.remove(id);
        if (id == joystickPointer) {
            joystickPointer = -1;
            moveX = 0;
            moveY = 0;
        }
        if (action == null) return;
    }

    void clear() {
        pointers.clear();
        joystickPointer = -1;
        moveX = 0;
        moveY = 0;
    }

    boolean isTracked(int id) {
        return pointers.containsKey(id);
    }

    boolean isHold(String action) {
        return pointers.containsValue(action);
    }

    String actionOf(int id) {
        return pointers.get(id);
    }

    boolean isNewWorldTap(int id) {
        return "new".equals(pointers.get(id));
    }

    /** Index of the hotbar slot under a point, or -1. */
    int hotbarSlot(float x, float y) {
        float[] strip = anchors.get("hotbar");
        if (strip == null) return -1;
        float slot = strip[2], gap = strip[3];
        float stride = slot + gap;
        if (y < strip[1] - 10 * density || y > strip[1] + slot + 10 * density) return -1;
        int index = (int) Math.floor((x - strip[0]) / stride);
        if (index < 0 || index >= Blocks.HOTBAR.length) return -1;
        return x <= strip[0] + index * stride + slot + gap / 2 ? index : -1;
    }

    float[] anchor(String action) {
        return anchors.get(action);
    }

}
