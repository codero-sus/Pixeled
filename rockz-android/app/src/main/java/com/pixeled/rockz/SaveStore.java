package com.pixeled.rockz;

/**
 * The handful of persistence calls the world needs. Android implements this with
 * SharedPreferences ({@link PreferencesStore}); tests and tools use an in-memory version, which is
 * what keeps {@link WorldModel} free of any Android dependency.
 */
interface SaveStore {
    int getInt(String key, int fallback);

    float getFloat(String key, float fallback);

    String getString(String key, String fallback);

    void putInt(String key, int value);

    void putFloat(String key, float value);

    void putString(String key, String value);

    /** Commit the pending values. */
    void apply();

    /** Forget everything (used by "new world"). */
    void clear();
}
