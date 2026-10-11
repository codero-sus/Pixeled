package com.pixeled.rockz;

import java.util.HashMap;
import java.util.Map;

/** In-memory {@link SaveStore} used by the Rockz smoke test (no Android needed). */
final class MemoryStore implements SaveStore {

    private final Map<String, Object> values = new HashMap<>();

    @Override
    public int getInt(String key, int fallback) {
        Object value = values.get(key);
        return value instanceof Integer ? (Integer) value : fallback;
    }

    @Override
    public float getFloat(String key, float fallback) {
        Object value = values.get(key);
        return value instanceof Float ? (Float) value : fallback;
    }

    @Override
    public String getString(String key, String fallback) {
        Object value = values.get(key);
        return value instanceof String ? (String) value : fallback;
    }

    @Override
    public void putInt(String key, int value) {
        values.put(key, value);
    }

    @Override
    public void putFloat(String key, float value) {
        values.put(key, value);
    }

    @Override
    public void putString(String key, String value) {
        values.put(key, value);
    }

    @Override
    public void apply() {
        // Everything is already stored; nothing to flush.
    }

    @Override
    public void clear() {
        values.clear();
    }

    String[] keys() {
        return values.keySet().toArray(new String[0]);
    }
}
