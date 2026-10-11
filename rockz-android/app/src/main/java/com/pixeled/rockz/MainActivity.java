package com.pixeled.rockz;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

public final class MainActivity extends Activity {
    private RockzView game;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        game = new RockzView(this);
        setContentView(game);
        immersiveMode();
    }

    private void immersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersiveMode();
    }

    @Override
    protected void onPause() {
        if (game != null) game.saveWorld();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        // Saving before leaving means the world is exactly where you left it.
        if (game != null) game.saveWorld();
        super.onBackPressed();
    }
}
