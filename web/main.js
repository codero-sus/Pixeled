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

    this.ui = new Ui({
      newWorld: () => this.newWorld(),
      toggleFly: () => this.toggleFly(),
      toggleHelp: () => this.ui.setHelp(document.getElementById('help-modal').hidden),
      fullscreen: () => this.toggleFullscreen(),
      toggleSound: () => this.audio.toggle(),
      selectHotbar: index => this.selectHotbar(index),
    });

    this.input = new Input(canvas, {
      onDig: () => this.mine(),
      onPlace: () => this.build(),
      onPick: () => this.pickBlock(),
      toggleFly: () => this.toggleFly(),
      toggleHelp: () => this.ui.setHelp(true),
      closeHelp: () => this.ui.setHelp(false),
      selectHotbar: index => this.selectHotbar(index),
      scrollHotbar: direction => this.selectHotbar((this.selected + direction + HOTBAR.length) % HOTBAR.length),
      onLockChange: locked => {
        if (locked) this.ui.fadeHint();
        document.getElementById('start-hint')?.classList.toggle('hidden', locked || this.input.isTouch);
      },
    });

    this.saved = this.storage.load();
    const seed = seedFromLocation() ?? (this.saved ? this.saved.seed : randomSeed());
    this.createWorld(seed, this.saved && this.saved.seed === seed);
    this.ui.setSound(this.audio.enabled);

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
    this.ui.loading({ show: true, progress: 0, message: 'Carving hills, caves and trees…' });
  }

  newWorld() {
    this.save();
    this.storage.clear();
    this.saved = null;
    this.createWorld(randomSeed(), false);
    this.ui.toast('Brand new world — every seed is different');
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

    if (!this.loaded) {
      const remaining = this.renderer.buildPending(this.world, 3);
      this.remaining = this.renderer.pending.length;
      this.ui.loading({
        show: true,
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
