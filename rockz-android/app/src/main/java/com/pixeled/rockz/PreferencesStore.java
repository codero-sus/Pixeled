package com.pixeled.rockz;

import android.content.Context;
import android.content.SharedPreferences;

/** {@link SaveStore} backed by the app's SharedPreferences. */
final class PreferencesStore implements SaveStore {

    private final SharedPreferences preferences;
    private final SharedPreferences.Editor editor;

    PreferencesStore(Context context) {
        preferences = context.getApplicationContext()
                .getSharedPreferences("pixeled-rockz", Context.MODE_PRIVATE);
        editor = preferences.edit();
    }

    @Override
    public int getInt(String key, int fallback) {
        return preferences.getInt(key, fallback);
    }

    @Override
    public float getFloat(String key, float fallback) {
        return preferences.getFloat(key, fallback);
    }

    @Override
    public String getString(String key, String fallback) {
        return preferences.getString(key, fallback);
    }

    @Override
    public void putInt(String key, int value) {
        editor.putInt(key, value);
    }

    @Override
    public void putFloat(String key, float value) {
        editor.putFloat(key, value);
    }

    @Override
    public void putString(String key, String value) {
        editor.putString(key, value);
    }

    @Override
    public void apply() {
        editor.apply();
    }

    @Override
    public void clear() {
        editor.clear().apply();
    }
}
