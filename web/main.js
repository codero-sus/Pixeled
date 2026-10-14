/**
 * The 3D web edition of Pixeled: a first-person voxel sandbox rendered with WebGL.
 *
 * This module wires the pieces together — world generator, player physics, mesher, renderer,
 * input, HUD — and owns the frame loop, mining/placing rules and autosave.
 */

import { AIR, HOTBAR, MOUSE_SENSITIVITY, REACH, WATER, blockById } from './constants.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Renderer } from './renderer.js';
import { StartMenu } from './menu.js';
import { BrowserSave, randomSeed, seedFromLocation } from './storage.js';
import { Ui } from './ui.js';
import { VoxelWorld } from './world.js';
import { placementCell, raycast } from './raycast.js';

const DAY_SECONDS = 600;      // one full day/night cycle
const AUTOSAVE_SECONDS = 5;
const ACTION_REPEAT = 0.2;

export class PixeledGame {
  constructor(canvas = document.getElementById('game')) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.storage = new BrowserSave();
    this.audio = new Audio();
    this.fov = (72 * Math.PI) / 180;
    this.lastFrame = performance.now();
    this.lastSave = 0;
    this.lastDig = 0;
    this.lastPlace = 0;
    this.dirty = false;
    this.frames = 0;
    this.fpsTimer = 0;
    this.fps = 0;
    this.loaded = false;
    this.statusTimer = 0;
    this.paused = true;          // the start screen is up until the player presses Play
    this.panorama = 0;           // seconds the menu camera has been turning
    this.viewYaw = 0;            // the player's own view, restored when the game resumes
    this.viewPitch = 0;

    this.ui = new Ui({
      newWorld: () => this.newWorld(),
      toggleFly: () => this.toggleFly(),
      help: () => this.openHelp(),
      closeHelp: () => this.closeHelp(),
      openMenu: () => this.pause(true),
      fullscreen: () => this.toggleFullscreen(),
      toggleSound: () => { const enabled = this.audio.toggle(); this.ui.setSound(enabled); this.menu?.setSound(enabled); return enabled; },
      selectHotbar: index => this.selectHotbar(index),
    });

    this.input = new Input(canvas, {
      onDig: () => this.mine(),
      onPlace: () => this.build(),
      onPick: () => this.pickBlock(),
      toggleFly: () => this.toggleFly(),
      toggleHelp: () => (document.getElementById('help-modal')?.hidden ? this.openHelp() : this.closeHelp()),
      closeHelp: () => this.closeHelp(),
      onEscape: () => this.escape(),
      onKey: code => Boolean(this.menu?.onKey(code)),
      onLookFallback: () => this.dragLookNotice(),
      selectHotbar: index => this.selectHotbar(index),
      scrollHotbar: direction => this.selectHotbar((this.selected + direction + HOTBAR.length) % HOTBAR.length),
      onLockChange: locked => {
        if (locked) this.ui.fadeHint();
        document.getElementById('start-hint')?.classList.toggle('hidden', locked || this.paused || this.input.isTouch);
      },
    });

    this.saved = this.storage.load();
    const seed = seedFromLocation() ?? (this.saved ? this.saved.seed : randomSeed());
    this.createWorld(seed, this.saved && this.saved.seed === seed);
    this.ui.setSound(this.audio.enabled);

    this.menu = new StartMenu({
      play: () => this.resume(),
      resume: () => this.resume(),
      fresh: () => { this.newWorld(); this.resume(); },
      seed: value => { this.startSeed(value); },
      help: () => { this.ui.setHelp(true); },
      sound: () => { const enabled = this.audio.toggle(); this.ui.setSound(enabled); this.menu.setSound(enabled); return enabled; },
    });
    this.menu.setSound(this.audio.enabled);
    this.menu.setWorld({ seed: this.world.seed, hasSave: Boolean(this.saved), edits: this.world.edits.size });
    this.menu.show(false);

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => this.save());
    canvas.addEventListener('click', () => this.audio.resume());
    requestAnimationFrame(now => this.frame(now));
  }

  // ------------------------------------------------------------------ world

  createWorld(seed, restore) {
    this.world = new VoxelWorld(seed);
    if (restore && this.saved?.edits) this.world.applyEdits(this.saved.edits);
    this.player = new Player(this.world);
    if (restore && this.saved?.player) {
      const saved = this.saved.player;
      this.player.x = saved.x; this.player.y = saved.y; this.player.z = saved.z;
      this.player.yaw = saved.yaw; this.player.pitch = saved.pitch;
      this.player.velocityX = this.player.velocityY = this.player.velocityZ = 0;
    }
    this.selected = restore && Number.isInteger(this.saved?.selected) ? Math.max(0, Math.min(HOTBAR.length - 1, this.saved.selected)) : 0;
    this.clock = restore && typeof this.saved?.clock === 'number' ? this.saved.clock : 0.36;
    this.ui.setSelected(this.selected);
    this.renderer.meshes.clear();
    this.total = this.renderer.requestAllChunks();
    this.remaining = this.total;
    this.loaded = false;
    this.ui.loading({ show: !this.paused, progress: 0, message: 'Carving hills, caves and trees…' });
    this.menu?.setWorld({ seed: this.world.seed, hasSave: Boolean(this.saved), edits: this.world.edits.size });
  }

  newWorld() {
    this.save();
    this.storage.clear();
    this.saved = null;
    this.createWorld(randomSeed(), false);
    this.ui.toast('Brand new world — every seed is different');
  }

  /** Show the start or pause screen and hand the cursor back. */
  pause(paused = false) {
    this.paused = true;
    this.panorama = 0;
    this.viewYaw = this.player.yaw;
    this.viewPitch = this.player.pitch;
    this.save();
    this.input.enabled = false;
    this.input.release();
    this.ui.setHelp(false);
    this.ui.loading({ show: false });
    this.menu.show(paused);
    document.getElementById('start-hint')?.classList.add('hidden');
  }

  /** Leave the menu and take control of the player again. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.player.yaw = this.viewYaw;
    this.player.pitch = this.viewPitch;
    this.input.enabled = true;
    this.menu.hide();
    this.ui.setHelp(false);
    this.ui.loading({
      show: !this.loaded,
      message: this.loaded ? '' : `Building terrain… ${Math.round((1 - this.remaining / (this.total || 1)) * 100)}%`,
    });
    if (!this.input.isTouch) {
      this.input.requestLock();
      document.getElementById('start-hint')?.classList.toggle('hidden', this.input.pointerLocked);
    }
  }

  /** Play a world from an explicit seed typed into the menu. */
  startSeed(seed) {
    this.save();
    this.storage.clear();
    this.saved = null;
    this.createWorld(seed, false);
    this.ui.toast(`World ${seed} — same seed always grows the same hills`);
    this.resume();
  }

  /**
   * Open the help sheet. While it is up the controls are parked and the pointer is released, so the
   * buttons are clickable even when the mouse was captured.
   */
  openHelp() {
    this.ui.setHelp(true);
    this.input.enabled = false;
    this.input.release();
    document.getElementById('start-hint')?.classList.add('hidden');
  }

  /** Close the help sheet: back to the menu if it was open behind, otherwise back to the game. */
  closeHelp() {
    this.ui.setHelp(false);
    if (this.paused) {
      this.menu.show(this.menu.paused);
      return;
    }
    this.input.enabled = true;
    if (!this.input.isTouch) this.input.requestLock();
  }

  /** Escape closes help, then toggles the menu. */
  escape() {
    const help = document.getElementById('help-modal');
    if (help && !help.hidden) { this.closeHelp(); return; }
    if (this.paused) this.resume();
    else this.pause(true);
  }

  /**
   * The browser would not capture the pointer — usually because the game is inside an embedded
   * frame. Dragging now looks around, and clicks still dig and build.
   */
  dragLookNotice() {
    this.menu?.setLookMode(true);
    this.ui.setHint('Drag with the mouse to look around');
    if (!this.paused && !this.loaded) return;
    if (!this.input.isTouch) this.ui.toast('Mouse capture is blocked here — drag to look', 3600);
  }

  toggleFly() {
    this.player.flying = !this.player.flying;
    this.player.velocityY = 0;
    this.ui.setFly(this.player.flying);
    this.ui.toast(this.player.flying ? 'Flying — Space up, Shift down' : 'Walking');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) this.canvas.requestFullscreen?.().catch(() => this.ui.toast('Fullscreen was blocked'));
    else document.exitFullscreen?.();
  }

  selectHotbar(index) {
    this.selected = Math.max(0, Math.min(HOTBAR.length - 1, index));
    this.ui.setSelected(this.selected);
    this.audio.select();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ interaction

  target() {
    return raycast(this.world, { x: this.player.x, y: this.player.eyeY, z: this.player.z }, this.player.direction(), REACH);
  }

  mine() {
    const hit = this.target();
    if (!hit) { this.ui.toast('Nothing in reach'); return; }
    const id = this.world.get(hit.x, hit.y, hit.z);
    if (id === AIR || id === WATER) return;
    this.world.set(hit.x, hit.y, hit.z, AIR);
    this.renderer.invalidate(this.world, hit.x, hit.z);
    this.audio.dig(id);
    this.dirty = true;
  }

  build() {
    const hit = this.target();
    if (!hit) { this.ui.toast('Aim at a block first'); return; }
    const cell = placementCell(hit);
    if (!this.world.inside(cell.x, cell.y, cell.z)) { this.ui.toast('That is outside the world'); return; }
    if (this.world.get(cell.x, cell.y, cell.z) !== AIR) return;
    const id = HOTBAR[this.selected];
    if (this.playerOccupies(cell)) { this.ui.toast('Make a little room first'); return; }
    this.world.set(cell.x, cell.y, cell.z, id);
    this.renderer.invalidate(this.world, cell.x, cell.z);
    this.audio.place(id);
    this.dirty = true;
  }

  pickBlock() {
    const hit = this.target();
    if (!hit) return;
    const block = blockById(this.world.get(hit.x, hit.y, hit.z));
    const index = HOTBAR.indexOf(block.id);
    if (index >= 0) this.selectHotbar(index);
    else this.ui.toast(`${block.name} cannot be placed`);
  }

  playerOccupies(cell) {
    const half = this.player.width / 2;
    return cell.x + 1 > this.player.x - half && cell.x < this.player.x + half
      && cell.z + 1 > this.player.z - half && cell.z < this.player.z + half
      && cell.y + 1 > this.player.y && cell.y < this.player.y + this.player.height;
  }

  // ------------------------------------------------------------------ loop

  frame(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - this.lastFrame) / 1000)) || 1 / 60;
    this.lastFrame = now;

    // Keep building the world while the menu is up, so Play drops straight into a finished scene.
    if (!this.loaded) {
      const remaining = this.renderer.buildPending(this.world, 3);
      this.remaining = this.renderer.pending.length;
      this.ui.loading({
        show: !this.paused,
        progress: this.total ? 1 - this.remaining / this.total : 1,
        message: `Building terrain… ${Math.round((1 - this.remaining / (this.total || 1)) * 100)}%`,
      });
      if (!remaining) {
        this.loaded = true;
        this.ui.loading({ show: false });
      }
    } else if (this.renderer.pending.length) {
      this.renderer.buildPending(this.world, 2);
    }

    if (this.paused) {
      // A slow turn of the camera makes the start screen a living panorama, like Minecraft's.
      this.panorama += dt;
      this.player.yaw = this.viewYaw + this.panorama * 0.045;
      this.player.pitch = -0.16 + Math.sin(this.panorama * 0.25) * 0.05;
      this.clock = (this.clock + dt / (DAY_SECONDS * 6)) % 1;
      this.input.takeLook();
      this.renderer.render({
        world: this.world, player: this.player, target: null,
        time: now / 1000, clock: this.clock, fov: this.fov,
      });
      requestAnimationFrame(next => this.frame(next));
      return;
    }

    const look = this.input.takeLook();
    if (look.x || look.y) this.player.look(look.x * MOUSE_SENSITIVITY, look.y * MOUSE_SENSITIVITY);

    const axes = this.input.axes();
    this.player.update(dt, {
      forward: axes.forward > 0.15, back: axes.forward < -0.15,
      right: axes.right > 0.15, left: axes.right < -0.15,
      jump: this.input.takeJump(),
      crouch: this.input.crouch,
      sprint: this.input.sprint,
    }, this.world);

    this.clock = (this.clock + dt / DAY_SECONDS) % 1;

    // Held mouse buttons repeat, so digging and building feel continuous.
    this.lastDig += dt; this.lastPlace += dt;
    if (this.input.mining && this.lastDig > ACTION_REPEAT) { this.lastDig = 0; this.mine(); }
    if (this.input.placing && this.lastPlace > ACTION_REPEAT) { this.lastPlace = 0; this.build(); }

    const target = this.target();
    this.renderer.render({
      world: this.world, player: this.player, target,
      time: now / 1000, clock: this.clock, fov: this.fov,
    });

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer > 0.4) { this.fps = Math.round(this.frames / this.fpsTimer); this.frames = 0; this.fpsTimer = 0; }
    this.updateStatus(dt);

    if (now - this.lastSave > AUTOSAVE_SECONDS * 1000 && this.dirty) this.save();
    requestAnimationFrame(next => this.frame(next));
  }

  updateStatus(dt) {
    this.statusTimer += dt;
    if (this.statusTimer < 0.25) return;
    this.statusTimer = 0;
    this.ui.setStatus({
      fps: this.fps,
      position: { x: Math.floor(this.player.x), y: Math.floor(this.player.y), z: Math.floor(this.player.z) },
      biome: this.world.biomeNameAt(this.player.x, this.player.z),
      seed: this.world.seed,
      clock: this.clock,
      flying: this.player.flying,
      blocksPlaced: this.world.edits.size,
    });
  }

  save() {
    const ok = this.storage.write({
      seed: this.world.seed,
      edits: this.world.edits,
      player: this.player,
      selected: this.selected,
      clock: this.clock,
    });
    if (!ok) this.ui.toast('This browser blocked saving');
    this.dirty = false;
    this.lastSave = performance.now();
  }
}

/** Boot the game and keep it handy for the console. */
export function start() {
  const canvas = document.getElementById('game');
  try {
    window.pixeled = new PixeledGame(canvas);
  } catch (error) {
    const overlay = document.getElementById('loading');
    if (overlay) {
      overlay.classList.remove('hidden');
      const text = document.getElementById('loading-text');
      if (text) text.textContent = String(error.message ?? error);
    }
    throw error;
  }
  return window.pixeled;
}
