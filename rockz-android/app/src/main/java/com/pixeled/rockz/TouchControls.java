package com.pixeled.rockz;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Touch input: a floating movement joystick in the bottom-left corner and action buttons on the
 * right, with a look area covering the rest of the screen.
 *
 * <p>Every finger is tracked separately, so you can hold the stick, look around and dig at the same
 * time. Buttons that act once (jump, fly, seed, new world) are queued and drained by the view.
 */
final class TouchControls {

    private static final String[] BUTTON_NAMES = {"jump", "dig", "place", "fly", "sneak", "seed", "new"};

    private final Map<Integer, String> pointers = new HashMap<>();
    private final List<String> taps = new ArrayList<>();
    private final float[] buttonX = new float[BUTTON_NAMES.length];
    private final float[] buttonY = new float[BUTTON_NAMES.length];
    private final float[] buttonRadius = new float[BUTTON_NAMES.length];

    private float width, height, density;
    private float stickCenterX, stickCenterY, stickRadius, knobX, knobY;
    private int stickPointer = -1;
    private float stickAxisX, stickAxisY;

    /** Geometry for this screen size. */
    void layout(float width, float height, float density) {
        this.width = width;
        this.height = height;
        this.density = density;
        stickCenterX = 98 * density;
        stickCenterY = height - 104 * density;
        stickRadius = 62 * density;
        knobX = stickCenterX;
        knobY = stickCenterY;

        float right = width;
        button("jump", right - 80 * density, height - 90 * density, 37 * density);
        button("dig", right - 156 * density, height - 106 * density, 31 * density);
        button("place", right - 156 * density, height - 178 * density, 31 * density);
        button("fly", right - 80 * density, height - 176 * density, 27 * density);
        button("sneak", right - 230 * density, height - 96 * density, 26 * density);
        button("seed", right - 44 * density, 96 * density, 25 * density);
        button("new", right - 44 * density, 156 * density, 25 * density);
    }

    private void button(String name, float x, float y, float radius) {
        int index = indexOf(name);
        buttonX[index] = x;
        buttonY[index] = y;
        buttonRadius[index] = radius;
    }

    private static int indexOf(String name) {
        for (int i = 0; i < BUTTON_NAMES.length; i++) {
            if (BUTTON_NAMES[i].equals(name)) return i;
        }
        return 0;
    }

    /** @return the action this finger grabbed, or null when it should turn the camera. */
    String onDown(int pointerId, float x, float y) {
        for (int i = 0; i < BUTTON_NAMES.length; i++) {
            float dx = x - buttonX[i], dy = y - buttonY[i];
            float radius = buttonRadius[i] * 1.25f;
            if (dx * dx + dy * dy <= radius * radius) {
                String action = BUTTON_NAMES[i];
                pointers.put(pointerId, action);
                taps.add(action);
                return action;
            }
        }
        if (x < width * 0.45f && y > height * 0.45f) {
            stickPointer = pointerId;
            stickCenterX = x;
            stickCenterY = y;
            stickAxisX = stickAxisY = 0;
            knobX = x;
            knobY = y;
            return "stick";
        }
        return null;
    }

    void onMove(int pointerId, float x, float y) {
        if (pointerId == stickPointer) {
            float dx = x - stickCenterX, dy = y - stickCenterY;
            float distance = (float) Math.sqrt(dx * dx + dy * dy);
            float limit = stickRadius * 0.7f;
            if (distance > limit) {
                dx = dx / distance * limit;
                dy = dy / distance * limit;
                distance = limit;
            }
            knobX = stickCenterX + dx;
            knobY = stickCenterY + dy;
            stickAxisX = dx / limit;
            stickAxisY = dy / limit;
        }
    }

    void onUp(int pointerId) {
        if (pointerId == stickPointer) {
            stickPointer = -1;
            stickAxisX = stickAxisY = 0;
            knobX = stickCenterX;
            knobY = stickCenterY;
        }
        pointers.remove(pointerId);
    }

    void clear() {
        pointers.clear();
        stickPointer = -1;
        stickAxisX = stickAxisY = 0;
    }

    /** Buttons pressed since the last call — jump, fly, seed and new are acted on once. */
    List<String> takeTaps() {
        List<String> copy = new ArrayList<>(taps);
        taps.clear();
        return copy;
    }

    boolean active(String action) {
        return pointers.containsValue(action);
    }

    boolean stickActive() {
        return stickPointer != -1;
    }

    float forwardAxis() {
        float magnitude = (float) Math.sqrt(stickAxisX * stickAxisX + stickAxisY * stickAxisY);
        if (magnitude < 0.08f) return 0;   // a dead zone, so a resting thumb does not creep
        return -stickAxisY;
    }

    float strafeAxis() {
        float magnitude = (float) Math.sqrt(stickAxisX * stickAxisX + stickAxisY * stickAxisY);
        if (magnitude < 0.08f) return 0;
        return stickAxisX;
    }

    float stickMagnitude() {
        return (float) Math.sqrt(stickAxisX * stickAxisX + stickAxisY * stickAxisY);
    }

    /** Draw the pads and buttons. */
    void draw(Canvas canvas, Paint paint) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.argb(60, 255, 255, 255));
        canvas.drawCircle(stickCenterX, stickCenterY, stickRadius, paint);
        paint.setColor(Color.argb(stickActive() ? 150 : 90, 255, 255, 255));
        canvas.drawCircle(knobX, knobY, stickRadius * 0.36f, paint);

        for (int i = 0; i < BUTTON_NAMES.length; i++) {
            String name = BUTTON_NAMES[i];
            boolean held = active(name);
            int alpha = held ? 210 : 120;
            paint.setColor(withAlpha(labelColor(name), alpha));
            canvas.drawCircle(buttonX[i], buttonY[i], buttonRadius[i], paint);
            paint.setColor(Color.argb(alpha + 30, 255, 255, 255));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2 * density);
            canvas.drawCircle(buttonX[i], buttonY[i], buttonRadius[i], paint);
            paint.setStyle(Paint.Style.FILL);

            paint.setColor(Color.argb(235, 12, 20, 28));
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(11 * density);
            paint.setFakeBoldText(true);
            canvas.drawText(label(name), buttonX[i], buttonY[i] + 4 * density, paint);
            paint.setFakeBoldText(false);
        }
    }

    private static String label(String action) {
        switch (action) {
            case "jump": return "JUMP";
            case "dig": return "DIG";
            case "place": return "PUT";
            case "fly": return "FLY";
            case "sneak": return "DOWN";
            case "seed": return "SEED";
            case "new": return "NEW";
            default: return action;
        }
    }

    private static int labelColor(String action) {
        switch (action) {
            case "dig": return 0xE0705A;
            case "place": return 0x7FBF6A;
            case "jump": return 0x8AB6E0;
            case "fly": return 0xC7A7E0;
            case "sneak": return 0x9AA7B0;
            default: return 0x9AA7B0;
        }
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | ((alpha & 0xFF) << 24);
    }
}
