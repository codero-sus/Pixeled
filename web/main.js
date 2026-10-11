/**
 * Pixeled — browser edition, entry point.
 *
 * This module owns the game loop and glues the pieces together: the world and its generator, the
 * player, the three.js renderer, the input layer, the HUD and the save file. Every other module
 * stays independent, which is what makes them testable outside the browser.
 */

import * as THREE from './vendor/three.module.js';

import { BLOCKS, CHUNK_SIZE, DEFAULT_SETTINGS, HOTBAR_PAGES, SEA_LEVEL } from './constants.js';
import { createAtlasCanvas } from './atlas.js';
import { VoxelWorld } from './world.js';
import { PlayerModel } from './player.js';
import { VoxelRenderer } from './renderer.js';
import { Controls } from './controls.js';
import { Hud, drawBlockIcon } from './hud.js';
import { GameStorage } from './storage.js';
import { GameAudio } from './audio.js';
import { parseSeed, randomSeed } from './noise.js';

const REACH = 6;
const AUTOSAVE_SECONDS = 15;

export class PixeledGame {
  constructor({ canvas = document.getElementById('game') } = {}) {
    this.canvas = canvas;
    this.storage = new GameStorage();
    this.settings = { ...DEFAULT_SETTINGS, ...this.storage.loadSettings() };
    this.audio = new GameAudio(this.settings);
    this.minutesPlayed = 0;
    this.blocksPlaced = 0;
    this.breakProgress = 0;
    this.breakTargetKey = null;
    this.placeCooldown = 0;
    this.stepTimer = 0;
    this.thirdPerson = false;
    this.paused = false;
    this.startedPlay = false;
    this.lastFrame = performance.now();
    this.saveTimer = 0;
    this.statusTimer = 0;
    this.lastHit = null;

    this.saved = this.storage.loadWorld();
    const seed = this.saved ? this.saved.seed : randomSeed();
    this.minutesPlayed = this.saved?.minutesPlayed ?? 0;
    this.blocksPlaced = this.saved?.blocksPlaced ?? 0;
    if (this.saved) this.settings.timeOfDay = this.saved.time;

    this.world = new VoxelWorld(seed, this.saved?.edits ?? new Map());
    const spawn = this.world.findSpawn(0, 0);
    this.player = new PlayerModel(this.world, spawn);
    if (this.saved?.player) this.player.restore(this.saved.player);

    this.hud = new Hud(createAtlasCanvas(), this.settings, {
      onPlay: () => this.controls.requestLock(),
      onResume: () => this.controls.requestLock(),
      onNewWorld: seedText => this.newWorld(seedText),
      onCopySeed: () => this.copySeed(),
      onSelectSlot: slot => this.hud.setSelected(slot),
      onToggleFly: () => this.toggleFly(),
      onToggleCamera: () => this.toggleCamera(),
      onSettings: settings => this.applySettings(settings),
      onSoundToggle: enabled => this.audio.setEnabled(enabled),
    });
    this.hud.setSeedText(seed, this.saved ? 'restored' : 'fresh');
    this.hud.setSelected(0);

    this.renderer = new VoxelRenderer(THREE, canvas, this.world, this.settings);
    this.renderer.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

    this.controls = new Controls(canvas, this.settings, {
      onLockChange: locked => this.onLockChange(locked),
      onFirstInput: () => this.audio.unlock(),
      onEscape: () => this.showPause(true),
      onToggleFly: () => this.toggleFly(),
      onToggleCamera: () => this.toggleCamera(),
      onToggleDebug: () => this.hud.toggleDebug(),
      onToggleInventoryPage: () => this.hud.setPage(this.hud.page + 1),
      onHotbarSlot: slot => this.hud.setSelected(slot),
    });
    this.controls.bindTouchButtons(document);

    this.bindEvents();
    this.hud.setLoading(true, this.saved ? 'Rebuilding your world…' : 'Growing a brand-new world…');
    // One frame of meshing before we hand control over, so the first look is not an empty void.
    requestAnimationFrame(() => {
      for (let i = 0; i < 6; i++) {
        this.renderer.streamChunks(this.player);
        this.renderer.processQueue();
      }
      this.hud.setLoading(false);
      this.hud.showPlayPrompt(true);
      this.hud.syncSettings();
      this.frame(performance.now());
    });
  }

  // ------------------------------------------------------------------ setup

  bindEvents() {
    window.addEventListener('resize', () => this.handleResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('contextmenu', event => event.preventDefault());
    // Keep the touch controls from ever fighting with the canvas.
    for (const button of document.querySelectorAll('[data-touch-action], .hud button')) {
      button.addEventListener('click', event => event.stopPropagation());
    }
  }

  handleResize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.resize(width, height);
  }

  onLockChange(locked) {
    if (locked) {
      this.startedPlay = true;
      this.paused = false;
      this.hud.showPlayPrompt(false);
      this.hud.showPause(false);
      this.hud.showHelp(false);
      this.audio.unlock();
    } else if (this.startedPlay) {
      this.paused = true;
      this.hud.showPause(true);
      this.hud.syncSettings();
      this.save();
    }
  }

  showPause(visible) {
    if (visible) {
      this.paused = true;
      this.hud.showPause(true);
      this.hud.syncSettings();
      this.save();
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      this.controls.requestLock();
    }
  }

  applySettings(settings) {
    this.renderer.applySettings(settings);
    const sky = this.renderer.sky;
    if (sky) {
      sky.dayLength = settings.dayLength;
      if (Number.isFinite(settings.timeOfDay) && Math.abs(sky.time - settings.timeOfDay) > 1e-4) {
        sky.setTime(settings.timeOfDay);
      }
    }
    this.storage.saveSettings(this.settings);
  }

  // ------------------------------------------------------------------ world management

  newWorld(seedText = '') {
    const parsed = parseSeed(seedText);
    const seed = parsed === null || parsed === undefined ? randomSeed() : parsed;
    this.world = new VoxelWorld(seed);
    const spawn = this.world.findSpawn(0, 0);
    this.player = new PlayerModel(this.world, spawn);
    this.blocksPlaced = 0;
    this.minutesPlayed = 0;
    this.settings.timeOfDay = 0.3;
    this.renderer.setWorld(this.world);
    if (this.renderer.sky) this.renderer.sky.setTime(0.3);
    this.hud.setSeedText(seed, 'fresh');
    this.storage.clearWorld();
    this.hud.toast(`New world · seed ${seed}`);
    this.save();
    this.controls.requestLock();
  }

  copySeed() {
    const text = String(this.world.seed);
    const done = () => this.hud.toast(`Seed ${text} copied`);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }

  // ------------------------------------------------------------------ interaction

  currentTarget() {
    const origin = this.player.eye();
    const direction = this.player.direction();
    return this.world.raycast(origin, direction, REACH);
  }

  /** The block under the crosshair: instantly in creative, over time in survival. */
  updateBreaking(dt, target) {
    const breaking = this.controls.isBreaking() || this.hud.pendingBreak;
    if (!target || !breaking) {
      this.breakProgress = 0;
      this.breakTargetKey = null;
      return;
    }
    const key = `${target.x},${target.y},${target.z}`;
    if (key !== this.breakTargetKey) {
      this.breakTargetKey = key;
      this.breakProgress = 0;
    }
    const hardness = this.settings.creative ? 0.18 : Math.max(0.12, this.world.hardnessOf(target.block));
    this.breakProgress += dt / hardness;
    if (this.breakProgress >= 1) {
      this.breakBlock(target);
      this.breakProgress = 0;
      this.breakTargetKey = null;
    }
  }

  breakBlock(target) {
    const block = BLOCKS[target.block];
    if (!this.world.setBlock(target.x, target.y, target.z, 0)) return;
    this.renderer.markBlockDirty(target.x, target.z);
    this.renderer.spawnBreakParticles(target.x, target.y, target.z, target.block);
    this.audio.dig(block?.material);
    this.player.swinging = 1;
    this.scheduleSave();
  }

  placeBlockAt(target) {
    if (!target) return;
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;
    if (y < 0 || y >= 96) return;
    const blockId = this.hud.selectedBlockId();
    if (!BLOCKS[blockId]) return;
    const existing = this.world.getBlock(x, y, z);
    if (existing !== 0 && !BLOCKS[existing].liquid) return;
    // Never seal the player inside a block.
    const half = this.player.width / 2 + 0.02;
    const overlaps = this.player.position.x + half > x && this.player.position.x - half < x + 1
      && this.player.position.z + half > z && this.player.position.z - half < z + 1
      && this.player.position.y + this.player.height > y && this.player.position.y < y + 1;
    if (overlaps && BLOCKS[blockId].solid) {
      this.hud.toast('Make a little room first');
      this.audio.error();
      return;
    }
    if (!this.world.setBlock(x, y, z, blockId)) return;
    this.renderer.markBlockDirty(x, z);
    this.blocksPlaced++;
    this.audio.place(BLOCKS[blockId].material);
    this.player.swinging = 1;
    this.scheduleSave();
    void BLOCKS_PLACED_EVERY;
  }

  pickBlock(target) {
    if (!target) return;
    const pages = HOTBAR_PAGES;
    for (let page = 0; page < pages.length; page++) {
      const slot = pages[page].indexOf(target.block);
      if (slot >= 0) {
        if (page !== this.hud.page) this.hud.setPage(page);
        this.hud.setSelected(slot);
        this.hud.toast(BLOCKS[target.block].name);
        return;
      }
    }
    this.hud.toast('That block is not in your hotbar');
  }

  handleActions(target) {
    for (const action of this.controls.drainActions()) {
      if (action.type === 'jump') {
        if (this.player.jump()) this.audio.jump();
      } else if (action.type === 'place' && action.down) {
        this.placeBlockAt(this.currentTarget());
      } else if (action.type === 'place-now') {
        this.placeBlockAt(this.currentTarget());
      } else if (action.type === 'break-now') {
        const hit = this.currentTarget();
        if (hit) this.breakBlock(hit);
      } else if (action.type === 'tap') {
        const hit = this.currentTarget();
        if (hit) this.breakBlock(hit);
      } else if (action.type === 'pick') {
        this.pickBlock(this.currentTarget());
      }
    }
    const wheel = this.controls.takeWheel();
    if (wheel) this.hud.cycleSelection(wheel > 0 ? 1 : -1);

    // Held mouse buttons: placing repeats, breaking is handled by progress.
    this.placeCooldown -= 1 / 60;
    if (this.controls.mouse.right && target && this.placeCooldown <= 0) {
      this.placeBlockAt(target);
      this.placeCooldown = 0.22;
    }
  }

  toggleFly() {
    if (!this.settings.creative) {
      this.hud.toast('Flying needs creative mode');
      return;
    }
    const flying = this.player.toggleFly(true);
    this.hud.toast(flying ? 'Flying — space up, shift down' : 'Back on your feet');
  }

  toggleCamera() {
    this.thirdPerson = !this.thirdPerson;
    this.hud.toast(this.thirdPerson ? 'Third person' : 'First person');
  }

  // ------------------------------------------------------------------ frame

  frame(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    if (!this.paused) {
      const look = this.controls.takeLook();
      if (look.dx || look.dy) this.player.look(look.dx, look.dy);
      const input = this.controls.moveInput();
      const wasOnGround = this.player.onGround;
      const wasInWater = this.player.inWater;
      this.player.update(dt, input);

      // Footsteps and the splash when you land in water.
      if (this.player.onGround && this.player.walkSpeed > 1.2 && !this.player.flying) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.audio.step(input.sprint);
          this.stepTimer = input.sprint ? 0.26 : 0.36;
        }
      } else this.stepTimer = 0;
      if (!wasOnGround && this.player.onGround && this.player.velocity.y < -6) this.audio.step(true);
      if (!wasInWater && this.player.inWater) this.audio.splash();

      const target = this.currentTarget();
      this.lastHit = target;
      this.handleActions(target);
      this.updateBreaking(dt, target);
      this.renderer.setHighlight(target, this.breakProgress);

      const targetName = target ? BLOCKS[target.block]?.name ?? '' : '';
      this.hud.update({
        fps: this.renderer.fps,
        biome: this.biomeName(),
        position: this.player.position,
        clock: this.renderer.sky.clockText(),
        phase: this.renderer.sky.phase,
        target: targetName,
        blocksPlaced: this.blocksPlaced,
        chunks: this.renderer.chunksRendered,
        breakProgress: this.breakProgress,
        seed: this.world.seed,
        flying: this.player.flying,
        onGround: this.player.onGround,
        inWater: this.player.inWater,
      });

      this.minutesPlayed += dt / 60;
      this.saveTimer += dt;
      if (this.saveTimer > AUTOSAVE_SECONDS) {
        this.saveTimer = 0;
        this.save();
      }
    }

    this.renderer.render(this.player, dt, { thirdPerson: this.thirdPerson, mining: this.controls.mouse.left, paused: this.paused });
    // Keep the settings panel's clock in step with the sky while the day goes by.
    this.statusTimer += dt;
    if (this.statusTimer > 1) {
      this.statusTimer = 0;
      this.settings.timeOfDay = this.renderer.sky.time;
      this.hud.syncTimeSlider?.();
    }
    this.frameHandle = requestAnimationFrame(next => this.frame(next));
  }

  biomeName() {
    const x = Math.floor(this.player.position.x);
    const z = Math.floor(this.player.position.z);
    return this.world.generator.biomeAt(x, z);
  }

  // ------------------------------------------------------------------ saving

  scheduleSave() { this.saveTimer = AUTOSAVE_SECONDS - 3; }

  save() {
    const ok = this.storage.saveWorld({
      seed: this.world.seed,
      time: this.renderer.sky?.time ?? this.settings.timeOfDay,
      player: this.player.serialize(),
      edits: this.world.edits,
      blocksPlaced: this.blocksPlaced,
      minutesPlayed: this.minutesPlayed,
    });
    if (!ok) this.hud.toast('Could not save — browser storage is unavailable');
    this.storage.saveSettings(this.settings);
  }
}

/* ------------------------------------------------------------------ boot */

export function boot() {
  if (typeof document === 'undefined') return null;
  const game = new PixeledGame();
  window.pixeled = game;
  // A tiny helper so the console (and curious players) can jump to a seed.
  window.goto = (x, y, z) => { game.player.position = { x, y, z }; game.player.velocity = { x: 0, y: 0, z: 0 }; };
  window.teleportToSurface = () => { const spawn = game.world.findSpawn(Math.floor(game.player.position.x), Math.floor(game.player.position.z)); game.player.position = { x: spawn.x, y: spawn.y + 2, z: spawn.z }; };
  return game;
}

if (typeof document === 'undefined') {
  // Imported outside a browser (tests, tooling): nothing to boot.
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot());
} else {
  boot();
}

export { THREE, CHUNK_SIZE, SEA_LEVEL, drawBlockIcon };
