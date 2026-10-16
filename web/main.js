/**
 * The 3D web edition of Pixeled: a first-person voxel sandbox rendered with WebGL.
 *
 * This module wires the pieces together — world generator, player physics, mesher, renderer,
 * input, HUD — and owns the frame loop, mining/placing rules and autosave.
 */

import {
  AIR, BED, BIRCH_LOG, CHEST, DIAMOND_ORE, DOOR, HOTBAR, LADDER, LOG, PALETTE, REACH, RECIPES,
  SAPLING, SPRUCE_LOG, TORCH, WATER, blockById,
} from './constants.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Particles } from './particles.js';
import { Player } from './player.js';
import { Renderer } from './renderer.js';
import { Settings } from './settings.js';
import { BrowserSave, randomSeed, seedFromLocation } from './storage.js';
import { Ui } from './ui.js';
import { Weather } from './weather.js';
import { OptionsPanel } from './options.js';
import { VoxelWorld } from './world.js';
import { DayCycle, Footsteps, Mining, describeTarget, isNight } from './gameplay.js';
import { placementCell, raycast } from './raycast.js';
import { addTo, canCraft, countOf, craft, craftable, missingFor, spend } from './crafting.js';
import { DEATH_MESSAGES, Health, fallDamage } from './health.js';
import { DEFAULT_MODE, MODES, formatTime, modeById, modeChip, randomModeId } from './modes.js';
import { StartMenu, buildDailyTeaser, buildModeRow, buildRecentRow } from './menu.js';
import { challengeSummary, completeGoal, dailyGoals, dailySeed, loadDaily, saveDaily, todayKey } from './challenges.js';

const AUTOSAVE_SECONDS = 5;
const ACTION_REPEAT = 0.22;    // seconds between placed blocks while the button is held
const HURT_FLASH = 0.42;       // how red the screen goes when breath runs out

export class PixeledGame {
  constructor(canvas = document.getElementById('game')) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.storage = new BrowserSave();
    this.settings = new Settings(this.storage);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.get('volume'));
    this.particles = new Particles(420);
    this.footsteps = new Footsteps();
    this.mining = new Mining();
    this.day = new DayCycle(this.settings.get('dayLength'), 0.36);
    this.weather = new Weather(1, { enabled: this.settings.get('weather') });
    this.fov = this.settings.fovRadians;
    this.viewDistance = this.settings.get('renderDistance');
    this.swing = 0;              // 0..1 through the current swing animation
    this.swinging = false;
    this.bob = 0;                // camera roll, smoothed
    this.flash = 0;              // red damage flash, 0..1
    this.tally = { broken: 0, placed: 0, steps: 0, distance: 0 };
    this.milestones = new Set();
    this.inventory = new Map();          // block id -> how many you have dug up
    this.openChest = null;               // the chest whose contents are on screen, if any
    this.craftOpen = false;
    this.sleeping = 0;                   // seconds of the fade to morning left to run
    this.health = new Health();
    this.dead = false;                   // the death screen is up and the controls are parked
    this.mode = modeById(DEFAULT_MODE);  // survival until a mode card says otherwise
    this.runTime = 0;                    // the speedrun clock
    this.runDone = null;                 // the finishing time, once the goal is met
    this.dayKey = todayKey();
    this.dailyGoals = dailyGoals(this.dayKey);
    this.dailyState = { day: this.dayKey, done: [], streak: 0, best: 0, total: 0 };
    this.challengeStats = { broken: 0, placed: 0, distance: 0, torches: 0, logs: 0, crafted: 0, diamonds: 0, lowestY: null, dawns: 0, swum: 0 };
    this.challengeOpen = false;
    this.slotBlocks = [...HOTBAR];       // the palette can swap what each hotbar key holds
    this.worldTimer = 0;                 // seconds until the next world simulation tick
    this.damage = 0;                     // lava hurts over time, not instantly
    this.heat = 0;                       // orange haze while standing in lava
    this.thirdPerson = false;
    this.debug = false;
    this.mapTimer = 0;
    this.ambientTimer = 3;
    this.sprintFov = this.fovSmooth ?? 0;
    this.lastFrame = performance.now();
    this.lastSave = 0;
    this.lastDig = 0;
    this.lastPlace = 0;
    this.lastWeatherSound = -1;
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
      closePalette: () => this.togglePalette(false),
      closeCraft: () => this.toggleCraft(false),
      closeStorage: () => this.closeStorage(),
      closeChallenges: () => this.toggleChallenges(false),
      shareSeed: () => this.shareSeed(),
      craft: recipe => this.doCraft(recipe),
      takeFromStorage: id => this.takeFromStorage(id),
      storeHeld: () => this.storeHeld(),
      fullscreen: () => this.toggleFullscreen(),
      toggleSound: () => { const enabled = this.audio.toggle(); this.ui.setSound(enabled); this.menu?.setSound(enabled); return enabled; },
      selectHotbar: index => this.selectHotbar(index),
      respawn: () => this.respawn(),
    });

    this.input = new Input(canvas, {
      onDig: () => this.mine(),
      onPlace: () => this.build(),
      onPick: () => this.pickBlock(),
      toggleFly: () => this.toggleFly(),
      toggleHelp: () => (document.getElementById('help-modal')?.hidden ? this.openHelp() : this.closeHelp()),
      togglePalette: () => this.togglePalette(),
      toggleCraft: () => this.toggleCraft(),
      toggleChallenges: () => this.toggleChallenges(),
      toggleDebug: () => this.toggleDebug(),
      toggleCamera: () => this.toggleCamera(),
      interact: () => this.interact(),
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
    if (this.saved?.mode) this.mode = modeById(this.saved.mode);
    if (this.saved?.daily) this.dailyState = loadDaily(this.storage, todayKey());
    const seed = seedFromLocation() ?? (this.saved ? this.saved.seed : randomSeed());
    this.createWorld(seed, this.saved && this.saved.seed === seed);
    this.ui.setSound(this.audio.enabled);

    this.menu = new StartMenu({
      surprise: () => this.surprise(),
      daily: () => this.startWorld(this.dailySeedToday(), this.mode.id),
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

    // Settings live in the pause menu; changing one applies immediately.
    this.panel = new OptionsPanel(this.settings, {
      onChange: (key, value) => this.onSettingChanged(key, value),
    });
    document.getElementById('menu-settings')?.addEventListener('click', () => {
      const open = this.panel.toggle();
      document.getElementById('menu-settings')?.classList.toggle('active', open);
      this.audio.blip(open ? 640 : 480, 0.05, 'triangle', 0.02);
    });
    this.setMode(this.mode.id, { silent: true });
    this.readRecentWorlds();
    this.refreshChallenges();
    // The start-screen shelves: today's goals and the worlds you played last. (The mode cards are
    // rebuilt by setMode, which has already run above.)
    this.refreshRecentRow();
    this.ui.setBiomeReadout(this.settings.get('minimap'));
    this.ui.setPaletteOpener(() => this.togglePalette());
    this.ui.setMinimapVisible(this.settings.get('minimap'));
    this.ui.setScale(this.settings.get('uiScale'));
    this.fovSmooth = this.fov;

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => this.save());
    canvas.addEventListener('click', () => this.audio.resume());
    requestAnimationFrame(now => this.frame(now));
  }

  // ------------------------------------------------------------------ world

  createWorld(seed, restore, { flat = null } = {}) {
    const flatWorld = flat ?? Boolean(this.mode?.rules?.flat);
    this.world = new VoxelWorld(seed, { flat: flatWorld });
    if (restore && this.saved?.edits) {
      this.world.applyEdits(this.saved.edits, this.saved.metaEdits, this.saved.chests);
    }
    this.player = new Player(this.world);
    if (restore && this.saved?.player) {
      const saved = this.saved.player;
      this.player.x = saved.x; this.player.y = saved.y; this.player.z = saved.z;
      this.player.yaw = saved.yaw; this.player.pitch = saved.pitch;
      this.player.velocityX = this.player.velocityY = this.player.velocityZ = 0;
    }
    // Your backpack comes back too: a save without one (an older save) starts you empty.
    this.inventory = new Map();
    if (restore && this.saved?.inventory) {
      for (const [id, count] of Object.entries(this.saved.inventory)) {
        const blockId = Number(id);
        if (Number.isFinite(blockId) && blockId > 0 && count > 0) this.inventory.set(blockId, count);
      }
    }
    this.selected = restore && Number.isInteger(this.saved?.selected) ? Math.max(0, Math.min(HOTBAR.length - 1, this.saved.selected)) : 0;
    this.clock = restore && typeof this.saved?.clock === 'number' ? this.saved.clock : 0.36;
    this.day = new DayCycle(this.settings.effectiveDayLength, this.clock);
    this.weather = new Weather(this.world.seed ^ 0x9e37, { enabled: this.settings.get('weather') });
    if (restore && this.saved?.weather) this.weather.load(this.saved.weather);
    this.particles.clear();
    this.mining.reset();
    this.ui.setSelected(this.selected);
    this.renderer.meshes.clear();
    this.total = this.renderer.requestAllChunks();
    this.remaining = this.total;
    this.loaded = false;
    this.ui.loading({
      show: !this.paused,
      progress: 0,
      message: flatWorld ? 'Laying out a flat world…' : 'Carving hills, caves and trees…',
    });
    this.menu?.setWorld({
      seed: this.world.seed,
      mode: this.mode?.name ?? 'Survival',
      flat: flatWorld,
      hasSave: Boolean(this.saved),
      edits: this.world.edits.size,
    });
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
    this.ui.setPalette(false);
    this.ui.loading({ show: false });
    this.menu.show(paused);
    document.getElementById('start-hint')?.classList.add('hidden');
  }

  /** One setting changed in the panel: apply it right away and tell the player. */
  onSettingChanged(key, value) {
    switch (key) {
      case 'fov': this.fov = this.settings.fovRadians; this.fovSmooth = this.fov; break;
      case 'renderDistance': this.viewDistance = value; this.pendingDistance = undefined; break;
      case 'volume': this.audio.setVolume(value); this.audio.blip(700, 0.06, 'sine', 0.03); break;
      case 'dayLength': this.day.seconds = this.settings.effectiveDayLength; break;
      case 'weather': this.weather.enabled = Boolean(value); if (!value) this.audio.stopRain(); break;
      case 'particles': this.particles.clear(); break;
      case 'minimap':
        this.ui.setBiomeReadout(Boolean(value));
        this.ui.setMinimapVisible(Boolean(value));
        break;
      case 'uiScale': this.ui.setScale(value); break;
      case 'reducedMotion':
        if (value) this.particles.clear();
        this.audio.blip(value ? 420 : 620, 0.06, 'triangle', 0.02);
        break;
      default: break;
    }
    this.applySettings();
    return value;
  }

  /** Push the current settings into the systems that care about them. */
  applySettings() {
    this.fov = this.settings.fovRadians;
    this.viewDistance = this.settings.get('renderDistance');
    this.audio.setVolume(this.settings.get('volume'));
    this.weather.enabled = this.settings.get('weather');
    if (!this.settings.get('weather')) this.audio.stopRain();
    this.day.seconds = this.settings.effectiveDayLength;
    if (this.settings.get('reducedMotion')) { this.particles.clear(); this.flash = 0; }
    this.ui.setScale?.(this.settings.get('uiScale'));
    return this.settings.values;
  }

  /** Leave the menu and take control of the player again. */
  resume() {
    if (!this.paused) return;
    this.applySettings();
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

  /** B opens the block palette; picking a block fills the selected hotbar slot. */
  togglePalette(force) {
    const open = this.ui.setPalette(force);
    if (open) {
      this.input.enabled = false;
      this.input.release();
      this.ui.drawHotbarIcons(this.ui.hotbar, this.slotBlocks);
      this.ui.buildPalette(PALETTE, {
        counts: this.inventory,
        onPick: id => { this.chooseBlock(id); this.ui.setPalette(false); this.input.enabled = true; },
        onCraft: () => { this.togglePalette(false); this.toggleCraft(true); },
      });
    } else {
      this.input.enabled = true;
    }
    return open;
  }

  /**
   * Switch mode. The rules are applied to the live player at once, so a card on the start screen is
   * an immediate change rather than a restart.
   */
  setMode(id, { silent = false } = {}) {
    const mode = modeById(id);
    this.mode = mode;
    const rules = mode.rules;
    this.creativeMode = rules.infiniteBlocks;
    this.instantMine = rules.instantMine;
    this.invulnerable = !rules.health;
    if (rules.fly) this.player.flying = true;
    this.ui.setMode(modeChip(mode));
    this.ui.setRunTimer(rules.timer);
    // The shelf highlights whichever card is live, wherever the switch came from.
    buildModeRow(this.menu?.modeRow, MODES, { active: mode.id, onPick: id => this.pickMode(id) });
    if (rules.timer) { this.runTime = 0; this.runDone = null; }
    if (!silent) this.ui.toast(`${mode.name}: ${mode.hook}`, 3600);
    return mode;
  }

  get running() { return this.mode.rules.timer && this.runDone === null && !this.paused; }

  /**
   * Take damage from whatever just happened. The health model decides whether it counts (a mercy
   * window after each hit), and the screen flashes so you can feel it.
   */
  hurt(amount, cause = 'hurt') {
    if (this.invulnerable) return 0;                 // creative and sandbox worlds cannot hurt you
    const lost = this.health.hurt(amount, cause);
    if (!lost) return 0;
    this.flash = Math.min(1, HURT_FLASH + lost * 0.05);
    this.audio.hurt();
    if (this.health.isDead) this.die(cause);
    return lost;
  }

  /** Down to zero hearts: the world stays, you get a screen and a button. */
  die(cause = 'hurt') {
    if (this.dead) return false;
    this.dead = true;
    this.input.enabled = false;
    this.input.mining = false;
    this.ui.setDeath(true, DEATH_MESSAGES[cause] ?? DEATH_MESSAGES.hurt);
    this.audio.die();
    this.dirty = true;
    return true;
  }

  /** Back on your feet where you started, at full health, keeping everything you were carrying. */
  respawn() {
    if (!this.dead) return false;
    this.dead = false;
    this.health.respawn();
    this.player.spawnAt(this.world);
    this.player.flying = false;
    this.player.fallDistance = 0;
    this.flash = 0;
    this.ui.setDeath(false);
    this.input.enabled = true;
    this.ui.toast('Back at your spawn point. Your blocks are still in the bag', 3200);
    this.audio.heal();
    return true;
  }

  /**
   * E (or a tap on an interactive block): doors swing, chests open their contents, beds let you
   * sleep through the night.
   */
  interact() {
    const hit = this.target();
    if (!hit) { this.ui.toast('Nothing in reach — aim at a door or a chest'); return null; }
    const block = blockById(this.world.get(hit.x, hit.y, hit.z));
    switch (block.interactive) {
      case 'door': {
        const open = this.world.toggleDoor(hit.x, hit.y, hit.z);
        this.audio.blip(open ? 520 : 400, 0.09, 'square', 0.03);
        this.renderer.invalidate(this.world, hit.x, hit.z);
        this.ui.toast(open ? 'The door swings open' : 'The door shuts');
        this.dirty = true;
        return 'door';
      }
      case 'chest': {
        return this.openStorage(hit.x, hit.y, hit.z) ? 'chest' : null;
      }
      case 'bed': {
        // A refused nap (it is daytime) is not an interaction.
        return this.sleep(hit.x, hit.y, hit.z) ? 'bed' : null;
      }
      default:
        this.ui.toast(`${block.name} is not something you can use`);
        return null;
    }
  }

  openStorage(x, y, z) {
    this.openChest = { x, y, z, contents: this.world.chestAt(x, y, z, true) };
    this.thirdPerson = false;
    this.ui.buildStorage(this.openChest.contents, countOf(this.inventory, this.slotBlock()));
    this.ui.setStorage(true);
    this.input.enabled = false;
    this.input.release();
    this.audio.blip(620, 0.07, 'sine', 0.02);
    return true;
  }

  closeStorage() {
    if (!this.openChest) return false;
    const chest = this.world.chestAt(this.openChest.x, this.openChest.y, this.openChest.z);
    this.openChest = null;
    this.ui.setStorage(false);
    this.input.enabled = true;
    this.dirty = true;                       // the chest contents are part of the save
    return Boolean(chest);
  }

  /** Move one of a stack out of the open chest into the inventory. */
  takeFromStorage(id) {
    if (!this.openChest) return false;
    const count = this.openChest.contents.get(id) ?? 0;
    if (count <= 0) return false;
    if (count > 1) this.openChest.contents.set(id, count - 1);
    else this.openChest.contents.delete(id);
    addTo(this.inventory, id, 1);
    this.audio.select();
    this.ui.buildStorage(this.openChest.contents, countOf(this.inventory, this.slotBlock()));
    this.dirty = true;
    return true;
  }

  /** Put one of the held block into the open chest. */
  storeHeld() {
    if (!this.openChest) return false;
    const id = this.slotBlock();
    if (!spend(this.inventory, id, 1)) { this.ui.toast(`No ${blockById(id).name.toLowerCase()} left to store`); return false; }
    this.openChest.contents.set(id, (this.openChest.contents.get(id) ?? 0) + 1);
    this.audio.blip(440, 0.05, 'square', 0.02);
    this.ui.buildStorage(this.openChest.contents, countOf(this.inventory, this.slotBlock()));
    this.dirty = true;
    return true;
  }

  /** Sleep the night away on a bed. Daytime naps are refused, exactly like the real thing. */
  sleep(x, y, z) {
    if (!isNight(this.day.clock)) { this.ui.toast('You can only sleep at night'); return false; }
    this.player.x = x + 0.5;
    this.player.z = z + 0.5;
    this.player.y = Math.max(this.player.y, this.world.blockTop(x, y, z) ?? this.player.y);
    this.sleeping = 1.6;
    this.ui.setSleep(true);
    this.audio.sleep();
    return true;
  }

  finishSleep() {
    this.sleeping = 0;
    this.day.clock = 0.28;                    // a little after dawn
    // A new morning comes with new weather: the front that was overhead has moved on.
    this.weather.reset();
    this.ui.setSleep(false);
    this.ui.toast('Good morning', 2600);
    this.dirty = true;
  }

  /** C: the crafting panel, listing every recipe and what it is missing. */
  toggleCraft(force) {
    const open = force === undefined ? !this.craftOpen : Boolean(force);
    this.craftOpen = open;
    this.ui.setCraft(open);
    this.input.enabled = !open;
    if (open) {
      this.input.release();
      this.refreshCraft();
    }
    return open;
  }

  refreshCraft() {
    this.ui.buildCraft(RECIPES, {
      canCraft: recipe => canCraft(this.inventory, recipe),
      missing: recipe => missingFor(this.inventory, recipe),
      onCraft: recipe => this.doCraft(recipe),
    });
    this.ui.setCraftInventory(this.inventory);
    return this.ui.lastCraftable ?? 0;
  }

  doCraft(recipe) {
    const result = craft(this.inventory, recipe);
    if (!result) {
      this.ui.toast(`Not enough for ${recipe.label.toLowerCase()}`);
      this.audio.blip(180, 0.12, 'sawtooth', 0.03);
      this.refreshCraft();
      return 0;
    }
    this.audio.craftSound?.() ?? this.audio.select();
    this.ui.toast(`Crafted ${recipe.count > 1 ? recipe.count + ' ' : ''}${blockById(recipe.out).name.toLowerCase()}`);
    this.milestone('first-craft', 'Crafting! Ingredients go in, building blocks come out');
    this.refreshCraft();
    this.ui.setSlotBlock(this.selected, this.slotBlock());
    return result;
  }

  /**
   * Keep the daily-challenge stats in step and tick a goal off the moment it lands. Cheap: it reads
   * the tally the game already keeps and only writes when something actually completes.
   */
  updateChallenges(dt = 0) {
    const stats = this.challengeStats;
    stats.broken = this.tally.broken;
    stats.placed = this.tally.placed + (stats.placedExtra ?? 0);
    stats.distance = this.tally.distance;
    const y = Math.floor(this.player.y);
    if (stats.lowestY === null || y < stats.lowestY) stats.lowestY = y;
    if (this.player.headUnder) stats.swum += (this.player.speedNow ?? 0) * dt;

    let changed = false;
    for (const goal of this.dailyGoals) {
      if (this.dailyState.done.includes(goal.id)) continue;
      const complete = goal.of(stats) >= goal.value;
      if (!complete) continue;
      const { state, streak } = completeGoal(this.storage, goal.id, this.dayKey);
      this.dailyState = state;
      changed = true;
      const left = this.dailyGoals.length - state.done.length;
      this.ui.toast(`Daily goal: ${goal.label} ✓${left > 0 ? ` — ${left} to go` : ''}`, 4200);
      this.audio.chime?.([660, 880]);
      if (left === 0) {
        this.ui.toast(`Daily challenge complete — ${streak} day streak!`, 5200);
        this.audio.chime?.([523, 659, 784, 1046]);
      }
    }
    if (changed) this.refreshChallenges();
    return changed;
  }

  dailySeedToday() { return dailySeed(this.dayKey); }

  /** Picking a mode card: remember it, and offer to switch the live world if it needs a new kind. */
  pickMode(id) {
    this.setMode(id);
    // A flat sandbox needs a flat world: rebuild it now, keeping the seed the player was given.
    const needsFlatWorld = this.mode.rules.flat !== Boolean(this.world?.flat);
    if (needsFlatWorld) {
      this.startWorld(this.world.seed, id);
      return id;
    }
    this.save();
    return id;
  }

  refreshChallenges() {
    const summary = challengeSummary(this.dailyGoals, this.challengeStats, this.dailyState);
    this.ui.buildChallenges(summary, {
      day: this.dayKey,
      streak: this.dailyState.streak,
      best: this.dailyState.best,
      seed: dailySeed(this.dayKey),
    });
    buildDailyTeaser(this.menu?.dailyGoals, summary);
    return summary;
  }

  /** J: the daily challenge panel with its progress bars. */
  toggleChallenges(force) {
    const open = force === undefined ? !this.challengeOpen : Boolean(force);
    this.challengeOpen = open;
    this.ui.setChallenges(open);
    if (open) this.refreshChallenges();
    return open;
  }

  /** The "surprise me" button: a random mode and a random world, playing straight away. */
  surprise() {
    const mode = randomModeId();
    const seed = Math.floor(Math.random() * 899999) + 100000;
    this.setMode(mode, { silent: true });
    this.startWorld(seed, mode);
    this.ui.toast(`Surprise: ${this.mode.name} on seed ${seed}`, 4200);
    return { seed, mode };                       // the id, since that is what callers switch on
  }

  /**
   * Start a specific world in a specific mode: the shared path for the seed box, the daily
   * challenge, "surprise me" and the recent-worlds row.
   */
  startWorld(seed, modeId = this.mode.id) {
    const value = Number(seed) || 1;
    this.setMode(modeId, { silent: true });
    this.createWorld(value, false);           // a fresh world, a fresh backpack
    this.player.spawnAt(this.world);
    this.health.respawn();
    this.dead = false;
    this.ui.setDeath(false);
    this.menu.setWorld({ seed: value, mode: this.mode.name, hasSave: false, edits: 0 });
    this.rememberWorld(value, modeId);
    this.save();
    this.resume();
    this.ui.toast(`${this.mode.name} · seed ${value}`, 3600);
    return value;
  }

  /** The last few worlds played: a "recent" row on the start screen, like a games shelf. */
  rememberWorld(seed, modeId) {
    try {
      const raw = this.storage.get?.('pixeled-recent-v1');
      const list = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]');
      const next = [{ seed, mode: modeId, at: Date.now() }, ...list.filter(entry => entry.seed !== seed)].slice(0, 4);
      this.storage.set?.('pixeled-recent-v1', JSON.stringify(next));
      this.recent = next;
      this.refreshRecentRow();
      return next;
    } catch (_) {
      this.recent = [];
      return [];
    }
  }

  /** Redraw the recent-worlds shelf. Called at boot and every time a world is started. */
  refreshRecentRow() {
    return buildRecentRow(this.menu?.recentRow, this.menu?.recentTitle, this.recent ?? [], entry => {
      this.startWorld(entry.seed, entry.mode ?? this.mode.id);
    });
  }

  readRecentWorlds() {
    try {
      const raw = this.storage.get?.('pixeled-recent-v1');
      const list = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]');
      this.recent = Array.isArray(list) ? list.slice(0, 4) : [];
    } catch (_) {
      this.recent = [];
    }
    return this.recent;
  }

  /** Copy a link that opens this exact world: the seed travels in the query string. */
  async shareSeed() {
    const link = `${location.origin}${location.pathname}?seed=${this.world.seed}`;
    try {
      await navigator.clipboard?.writeText(link);
      this.ui.toast(`Link copied — seed ${this.world.seed}`, 3600);
    } catch (_) {
      this.ui.toast(`Seed ${this.world.seed} — add ?seed=${this.world.seed} to the address`, 5200);
    }
    return link;
  }

  /** F3: the debug panel with coordinates, chunk, light levels and draw counts. */
  toggleDebug(force) {
    this.debug = force === undefined ? !this.debug : Boolean(force);
    this.ui.setDebug(this.debug);
    return this.debug;
  }

  /** F5: swap between the eyes and a camera behind the player. */
  toggleCamera() {
    this.thirdPerson = !this.thirdPerson;
    this.ui.toast(this.thirdPerson ? 'Third person — F5 to go back to your eyes' : 'First person');
    return this.thirdPerson;
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

  /** Choose what block a hotbar slot holds: that is what the palette grid is for. */
  chooseBlock(id) {
    if (!PALETTE.includes(id)) return false;
    this.slotBlocks[this.selected] = id;
    this.ui.setSlotBlock(this.selected, id);
    this.ui.drawHotbarIcons(this.ui.hotbar, this.slotBlocks);
    this.audio.select();
    return true;
  }

  /** The block id a hotbar slot will place. */
  slotBlock(index = this.selected) { return this.slotBlocks[index] ?? HOTBAR[index]; }

  selectHotbar(index) {
    this.selected = Math.max(0, Math.min(HOTBAR.length - 1, index));
    this.ui.setSelected(this.selected);
    this.ui.highlightPalette(this.slotBlock(this.selected));
    this.audio.select();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ interaction

  target() {
    return raycast(this.world, { x: this.player.x, y: this.player.eyeY, z: this.player.z }, this.player.direction(), REACH);
  }

  /**
   * One-off congratulation toasts. Each key fires at most once per session, so the game can cheer
   * when something new happens without ever nagging.
   */
  milestone(key, message) {
    if (this.milestones.has(key)) return false;
    this.milestones.add(key);
    this.ui.toast(message, 4200);
    return true;
  }

  checkMilestones() {
    const { broken, placed, distance } = this.tally;
    if (broken >= 1) this.milestone('first-break', 'First block broken — hold the button for stone');
    if (broken >= 25) this.milestone('break-25', '25 blocks broken');
    if (broken >= 100) this.milestone('break-100', '100 blocks broken — that is a proper mine');
    if (broken >= 500) this.milestone('break-500', '500 blocks broken. You are a machine');
    if (placed >= 1) this.milestone('first-place', 'Nice build. Right click again to keep going');
    if (placed >= 64) this.milestone('place-64', '64 blocks placed — a stack');
    if (distance >= 200) this.milestone('walk-200', '200 blocks walked — press F to fly and cover more ground');
    if (distance >= 1000) this.milestone('walk-1000', 'A kilometre on foot');
  }

  /** The colour a block throws off when it breaks: its own top-face tint. */
  particleColour(blockId) {
    return blockById(blockId).top;
  }

  /**
   * Left button pressed: start the swing and take the first bite out of the block.
   *
   * A single tap finishes soft blocks — grass, sand, leaves, plants — while stone and ores need the
   * button held, which is the Minecraft rhythm compressed for a browser game.
   */
  mine() {
    this.swinging = true;
    this.swing = 0;
    const first = this.excavate(0.14);
    if (!first.broken && Number.isFinite(this.mining.total) && this.mining.total <= 0.78) {
      this.excavate(this.mining.total);
    }
    return first;
  }

  /**
   * Hold mining for `dt` seconds against whatever the crosshair is on, and apply the result:
   * a tick sound part-way through, then the break itself with particles and the dig noise.
   */
  excavate(dt) {
    const hit = this.target();
    // Creative mining is instant, so the swing never has to wait for hardness.
    const result = this.instantMine && hit && this.world.get(hit.x, hit.y, hit.z) !== AIR
      ? { progress: 1, digging: true, broken: true, tick: false, blockId: this.world.get(hit.x, hit.y, hit.z) }
      : this.mining.hold(dt, hit, this.world);
    if (result.tick) this.audio.digTick(result.blockId);
    if (!result.broken) return result;

    const blockId = result.blockId;
    // A broken chest gives up its contents rather than taking them with it.
    const wasChest = blockById(blockId).interactive === 'chest';
    const spill = wasChest ? [...(this.world.chestAt(hit.x, hit.y, hit.z) ?? [])] : [];
    this.world.set(hit.x, hit.y, hit.z, AIR);
    this.renderer.invalidate(this.world, hit.x, hit.z);
    this.audio.dig(blockId);
    this.tally.broken++;
    this.dirty = true;
    addTo(this.inventory, blockId, 1);
    if (spill.length) {
      for (const [id, count] of spill) addTo(this.inventory, id, count);
      this.ui.toast(`The chest spilled ${spill.length === 1 ? 'its stack' : `all ${spill.length} stacks`} into your backpack`);
    }
    // Breaking a wall next to water lets it in, one tick at a time.
    this.world.wakeWater(hit.x, hit.y, hit.z);
    // Leaves sometimes drop a sapling, which the palette can plant back into the ground.
    const block = blockById(blockId);
    if (block.id === SAPLING) addTo(this.inventory, SAPLING, 1);
    else if (block.tint === 'foliage' || blockId === SAPLING) {
      if (hash01(hit.x * 3 + hit.y, hit.z * 5 + hit.y, this.world.seed) < 0.22) {
        addTo(this.inventory, SAPLING, 1);
        this.ui.toast('A sapling! Plant it with the palette (B) and it will grow');
      }
    }
    // A chopped trunk takes its leaves with it.
    if ([LOG, BIRCH_LOG, SPRUCE_LOG].includes(blockId)) {
      const cleared = this.world.decayLeaves(hit.x, hit.y, hit.z);
      for (const cell of cleared) {
        this.renderer.invalidate(this.world, cell.x, cell.z);
        if (this.settings.get('particles') && this.particles) this.particles.leaves(cell.x, cell.y, cell.z, this.particleColour(blockId), 2);
      }
      if (cleared.length) this.renderer.invalidate(this.world, hit.x, hit.z);
    }
    this.checkMilestones();
    if (blockId === DIAMOND_ORE) {
      this.challengeStats.diamonds++;
      this.milestone('diamond', 'Diamond! They only sit below y=14, so dig deep');
      if (this.mode.rules.timer && this.runDone === null) {
        this.runDone = this.runTime;
        this.ui.setRunTime(this.runTime, this.runDone);
        this.ui.toast(`Speedrun done in ${formatTime(this.runDone)}!`, 6000);
        this.audio.chime?.([523, 659, 784, 1046]);
      }
    }
    else if ([LOG, BIRCH_LOG, SPRUCE_LOG].includes(blockId)) this.milestone('first-log', 'Timber! Logs make planks, planks make a house');
    if (this.settings.get('particles')) {
      const colour = this.particleColour(blockId);
      const block = blockById(blockId);
      if (block?.plant) this.particles.leaves(hit.x, hit.y, hit.z, colour, 8);
      else this.particles.burst(hit.x, hit.y, hit.z, colour, 14);
      if (block?.tint === 'foliage') this.particles.leaves(hit.x, hit.y, hit.z, colour, 6);
    }
    return result;
  }

  build() {
    this.swinging = true;
    this.swing = 0;
    const hit = this.target();
    if (!hit) { this.ui.toast('Aim at a block first'); return false; }
    const cell = placementCell(hit);
    if (!this.world.inside(cell.x, cell.y, cell.z)) { this.ui.toast('That is outside the world'); return false; }
    // Water and plants give way to a block placed against them; anything solid refuses.
    const there = this.world.get(cell.x, cell.y, cell.z);
    const replace = there === WATER || blockById(there).plant;
    if (there !== AIR && !replace) return false;
    const id = this.slotBlock();
    if (this.playerOccupies(cell)) { this.ui.toast('Make a little room first'); return false; }
    const placed = this.world.placeBlock(cell.x, cell.y, cell.z, id, {
      yaw: this.player.yaw,
      face: hit.normal ?? null,
      replace,
    });
    if (!placed) { this.ui.toast(`${blockById(id).name} will not go there`); return false; }
    this.renderer.invalidate(this.world, cell.x, cell.z);
    this.audio.place(id);
    this.tally.placed++;
    this.dirty = true;
    this.checkMilestones();
    if (this.settings.get('particles')) this.particles.burst(cell.x, cell.y, cell.z, this.particleColour(id), 8, 0.3, 2.2);
    if (id === SAPLING) this.world.plantSapling(cell.x, cell.y, cell.z);
    // Remember which way the block went down, so the one in your hand mirrors it.
    this.lastPlacedMeta = this.world.metaAt?.(cell.x, cell.y, cell.z) ?? 0;
    // Infinite blocks in creative and sandbox: placing never spends anything.
    if (!this.creativeMode) spend(this.inventory, id, 1);
    this.challengeStats.placed++;
    if (id === TORCH) this.challengeStats.torches++;
    return true;
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
      const drift = this.settings.get('reducedMotion') ? 0.008 : 0.045;
      this.player.yaw = this.viewYaw + this.panorama * drift;
      this.player.pitch = -0.16 + Math.sin(this.panorama * 0.25) * (this.settings.get('reducedMotion') ? 0.01 : 0.05);
      this.day.update(dt * 6);
      this.clock = this.day.clock;
      this.particles.update(dt, this.world);
      this.input.takeLook();
      this.renderer.render({
        world: this.world, player: this.player, target: null,
        time: now / 1000, clock: this.clock, fov: this.fov,
        viewDistance: this.viewDistance,
      });
      requestAnimationFrame(next => this.frame(next));
      return;
    }

    // ---- look -----------------------------------------------------------------
    const look = this.input.takeLook();
    const sensitivity = this.settings.mouseSensitivity;
    if (look.x || look.y) this.player.look(look.x * sensitivity, look.y * sensitivity);

    // ---- move -----------------------------------------------------------------
    const axes = this.input.axes();
    const previousX = this.player.x, previousZ = this.player.z;
    this.player.update(dt, {
      forward: axes.forward > 0.15, back: axes.forward < -0.15,
      right: axes.right > 0.15, left: axes.right < -0.15,
      jump: this.input.takeJump(),
      crouch: this.input.crouch,
      sprint: this.input.sprint,
    }, this.world);

    const moved = Math.hypot(this.player.x - previousX, this.player.z - previousZ);
    this.tally.distance += moved;

    // ---- feet: footsteps, dust and water entries -------------------------------
    const underfoot = this.world.get(Math.floor(this.player.x), Math.floor(this.player.y - 0.4), Math.floor(this.player.z));
    if (this.footsteps.update(moved, {
      sprinting: this.player.sprinting, crouching: this.player.crouching,
      inWater: this.player.inWater, onGround: this.player.onGround && !this.player.flying,
    })) {
      this.audio.step(underfoot);
      this.tally.steps++;
      if (this.settings.get('particles')) this.particles.dust(this.player.x, this.player.y - 0.05, this.player.z, this.particleColour(underfoot));
    }
    if (this.player.splash) {
      this.audio.splash();
      if (this.settings.get('particles')) this.particles.splash(this.player.splash.x, this.player.splash.y, this.player.splash.z, this.player.splash.kind === 'enter' ? 18 : 10);
      if (this.player.splash.kind === 'enter') this.milestone('swim', 'Swimming — hold Space to rise, and watch the air bar');
    }

    // ---- the world tick: falling sand, growing saplings, withering leaves ---------
    this.worldTimer -= dt;
    if (this.worldTimer <= 0) {
      this.worldTimer = 0.25;
      const events = this.world.worldTick();
      for (const event of events) {
        this.renderer.invalidate(this.world, event.x, event.z);
        if (event.id === 'grown') {
          this.audio.whoosh();
          this.milestone('sapling-grown', 'Your sapling grew into a tree');
        } else {
          this.audio.digTick(event.id);
          if (this.settings.get('particles')) this.particles.dust(event.x + 0.5, event.to, event.z + 0.5, this.particleColour(event.id));
        }
      }
    }

    // ---- lava hurts, slowly and visibly ----------------------------------------
    this.heat += ((this.player.inLava ? 1 : 0) - this.heat) * Math.min(1, dt * 3);
    if (this.player.inLava) {
      this.damage += dt;
      if (Math.random() < dt * 2.2) this.audio.bubble();
      if (this.damage > 0.55) {
        this.damage = 0;
        this.hurt(2, 'lava');
        this.milestone('lava', 'Lava burns — build across it, or fly over it');
      }
    } else {
      this.damage = Math.max(0, this.damage - dt * 2);
    }

    // ---- breath ----------------------------------------------------------------
    if (this.player.headUnder) {
      if (Math.random() < dt * 0.5) this.audio.bubble();
      if (this.player.breath <= 0) {
        this.hurt(2, 'drown');
        this.player.breath = 4;                 // one gulp of air, then the bar drains again
        this.player.velocityY = Math.max(this.player.velocityY, 3.4);
      }
    }

    // ---- falling hurts, and the void kills --------------------------------------
    if (this.player.landedHard > 0) {
      const damage = fallDamage(this.player.landedHard);
      if (damage > 0) {
        this.hurt(damage, 'fall');
        this.audio.land(Math.min(2.4, 0.6 + this.player.landedHard / 8));
        this.milestone('first-fall', 'That hurt. Water and hay break a fall — so does flying');
      }
    }
    if (this.player.y < 1) this.hurt(20, 'void');
    this.health.update(dt);
    if (this.health.healed > 0 && this.lastHeal !== this.health.healed) {
      this.lastHeal = this.health.healed;
      this.audio.heal();
    }
    // Three hearts or fewer: the edges of the screen pulse red with your heartbeat.
    if (this.health.ratio <= 0.35 && !this.health.isDead) {
      const beat = 0.5 + 0.5 * Math.sin((this.day?.elapsed ?? 0) * 6);
      this.flash = Math.max(this.flash, 0.1 + 0.16 * beat);
      this.pulse = beat;
    }
    this.flash = Math.max(0, this.flash - dt * 0.9);

    // ---- digging and building --------------------------------------------------
    const dig = this.target();
    if (this.input.mining) {
      this.excavate(dt);
      this.swinging = true;
      this.swing += dt * (3.1 + (this.mining.swingRate ?? 0) * 0.25);
      if (this.swing >= 1) this.swing -= 1;
    } else if (this.swinging) {
      this.swing += dt * 6;
      if (this.swing >= 1) { this.swing = 0; this.swinging = false; }
    }
    this.lastPlace += dt;
    if (this.input.placing && this.lastPlace > ACTION_REPEAT) { this.lastPlace = 0; this.build(); }

    // ---- sleeping through the night ---------------------------------------------
    if (this.sleeping > 0) {
      this.sleeping = Math.max(0, this.sleeping - dt);
      this.ui.setSleepProgress(this.sleeping / 1.6);
      if (this.sleeping === 0) this.finishSleep();
    }

    // ---- rain splashes on the ground --------------------------------------------
    this.splashTimer = (this.splashTimer ?? 0) - dt;
    if (this.splashTimer <= 0 && this.weather?.intensity > 0.15 && !this.player.headUnder && !this.player.inWater) {
      this.splashTimer = 0.06 + Math.random() * 0.08;
      if (this.settings.get('particles')) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2 + Math.random() * 6;
        const x = Math.floor(this.player.x + Math.cos(angle) * radius);
        const z = Math.floor(this.player.z + Math.sin(angle) * radius);
        const top = this.world.surfaceHeight(x, z);
        // Only nearby ground: a splash you cannot see is a wasted particle.
        if (Math.abs(top + 1 - this.player.y) < 5 && this.world.get(x, top, z) !== WATER) {
          this.particles.rainSplash(x + 0.5, top + 1, z + 0.5, this.weather.intensity);
        }
      }
    }

    // ---- clock and weather ------------------------------------------------------
    this.day.update(dt);

    // ---- the speedrun clock and the daily goals ---------------------------------
    if (this.running) this.runTime += dt;
    this.ui.setRunTime(this.runTime, this.runDone);
    this.updateChallenges(dt);
    this.clock = this.day.clock;
    const biome = this.world.biomeNameAt(this.player.x, this.player.z);
    this.weather.update(dt, { snowBiome: biome === 'snow' || biome === 'mountains' && this.player.y > 34 });
    const weather = this.weather.state;
    const rainStep = Math.round(weather.intensity * 10);
    if (rainStep !== this.lastWeatherSound) {
      this.lastWeatherSound = rainStep;
      this.audio.setRain(weather.raining && !this.player.headUnder ? weather.intensity : 0);
    }
    if (this.weather.thundering) this.audio.thunder();

    // ---- camera feel: bob, sprint stretch, held block ---------------------------
    const bobOn = this.settings.get('bob') && !this.settings.get('reducedMotion');
    const targetBob = bobOn ? this.player.bobRoll() : 0;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 8);
    this.player.cameraRoll = this.bob;
    this.player.eyeOffset = bobOn ? this.player.bobOffset() : 0;
    const stretch = this.input.zoom ? 0.42 : bobOn && this.player.sprinting ? 1.05 : 1;
    this.fovSmooth += (this.fov * stretch - this.fovSmooth) * Math.min(1, dt * 4);

    this.particles.update(dt, this.world);
    const heldBlock = blockById(this.slotBlock());
    // A partial block in hand keeps its shape, and its facing comes from the last one placed.
    const held = this.settings.get('viewmodel')
      ? { block: heldBlock, swing: this.swing, meta: this.lastPlacedMeta ?? 0,
          bright: weather.intensity > 0.35 ? 0.78 : 1 }
      : null;

    const stats = this.renderer.render({
      world: this.world, player: this.player, target: dig,
      time: now / 1000, clock: this.clock, fov: this.fovSmooth || this.fov,
      mineProgress: this.input.mining ? this.mining.progress : 0,
      held, weather, submerged: this.player.headUnder ? 1 : 0, flash: this.flash,
      aurora: this.biome === 'snow' || this.biome === 'mountains' ? 1 : 0,
      particles: this.settings.get('particles') ? this.particles.visible() : null,
      viewDistance: this.viewDistance,
      wind: 1 + weather.intensity * 1.6,          // storms shake the grass harder
      cameraDistance: this.thirdPerson ? 4.6 : 0,
      thirdPerson: this.thirdPerson,
      heat: this.heat,
    });

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer > 0.4) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0; this.fpsTimer = 0;
      // Adaptive distance: pull the fog in when the frame rate sags, and let it back out.
      if (this.settings.get('adaptiveDistance')) {
        const wanted = this.fps < 34 ? Math.max(48, this.roundDistance(this.viewDistance - 8))
          : this.fps > 55 ? Math.min(this.settings.get('renderDistance'), this.roundDistance(this.viewDistance + 4)) : this.viewDistance;
        if (wanted !== this.viewDistance) { this.viewDistance = wanted; this.pendingDistance = wanted; }
      } else if (this.pendingDistance !== undefined) {
        this.viewDistance = this.settings.get('renderDistance');
        this.pendingDistance = undefined;
      }
    }
    this.updateStatus(dt, dig, stats, biome, weather);
    this.updateAmbient(dt, biome, weather);

    if (now - this.lastSave > AUTOSAVE_SECONDS * 1000 && this.dirty) this.save();
    requestAnimationFrame(next => this.frame(next));
  }

  roundDistance(value) { return Math.round(value / 8) * 8; }

  /** Ambient soundscape: birds by day, crickets at night, drips underground, lava nearby. */
  updateAmbient(dt, biome, weather) {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 6 + Math.random() * 9;
    const feet = Math.floor(this.player.y);
    const underground = feet < this.world.surfaceHeight(Math.floor(this.player.x), Math.floor(this.player.z)) - 6;
    const nearLava = this.world.isLava(Math.floor(this.player.x), feet - 1, Math.floor(this.player.z))
      || this.world.isLava(Math.floor(this.player.x), feet - 2, Math.floor(this.player.z));
    if (nearLava) { this.audio.lavaPop(); return; }
    if (underground) { this.audio.caveDrip(); return; }
    if (weather.intensity > 0.3) return;                       // rain drowns the wildlife out
    if (this.day.night) this.audio.crickets();
    else this.audio.birds(biome);
  }

  /** The block under the crosshair, plus a line of context for the HUD. */
  targetNote(hit) {
    if (!hit) return '';
    const id = this.world.get(hit.x, hit.y, hit.z);
    const block = blockById(id);
    const light = this.world.lightAt(hit.x, hit.y + 1, hit.z);
    return `${block.name} · light ${light}`;
  }

  updateStatus(dt, hit, stats, biome, weather) {
    this.statusTimer += dt;
    if (this.statusTimer < 0.2) return;
    this.statusTimer = 0;
    const position = { x: Math.floor(this.player.x), y: Math.floor(this.player.y), z: Math.floor(this.player.z) };
    // The minimap is redrawn a few times a second, not every frame.
    this.mapTimer += 0.2;
    if (this.mapTimer > 1.2 && this.settings.get('minimap')) {
      this.mapTimer = 0;
      this.ui.drawMinimap(this.world, position.x, position.z, this.player.yaw);
    }
    this.ui.drawHealth(this.ui.hearts ?? document.getElementById('hearts'), this.health);
    this.ui.setStatus({
      fps: this.fps,
      position,
      biome,
      seed: this.world.seed,
      clock: this.clock,
      flying: this.player.flying,
      blocksPlaced: this.world.edits.size,
      broken: this.tally.broken,
      walked: this.tally.distance,
      tally: this.tally,
      light: this.world.lightAt(this.player.x, this.player.y + 1, this.player.z),
      torchLight: this.world.torchLightAt(Math.floor(this.player.x), Math.floor(this.player.y + 1), Math.floor(this.player.z)),
      chunk: `${Math.floor(this.player.x / 16)},${Math.floor(this.player.z / 16)}`,
      sources: this.world.lightSourceCount,
      held: this.slotBlock(),
      inventory: this.inventory,
      weather: weather.label,
      facing: compassName(this.player.yaw),
      underfoot: this.targetNote(hit),
      breath: this.player.breathRatio,
      underwater: this.player.headUnder,
      crouching: this.player.crouching,
      sprinting: this.player.sprinting,
      chunks: stats?.chunks ?? 0,
      draws: stats?.draws ?? 0,
    });
  }

  save() {
    const ok = this.storage.write({
      seed: this.world.seed,
      edits: this.world.edits,
      player: this.player,
      selected: this.selected,
      clock: this.clock,
      weather: this.weather.serialize(),
      distance: this.viewDistance,
      broken: this.tally.broken,
      placed: this.tally.placed,
      steps: this.tally.steps,
      mode: this.mode.id,
      daily: this.dailyState,
      metaEdits: this.world.metaEdits,
      chests: Object.fromEntries([...this.world.chests].map(([key, contents]) => [key, Object.fromEntries(contents)])),
      inventory: this.inventory,
    });
    if (!ok) this.ui.toast('This browser blocked saving');
    this.dirty = false;
    this.lastSave = performance.now();
  }
}

/** Deterministic 0-1 hash, so a leaf drop is reproducible for a given world and cell. */
export function hash01(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The compass point the player is facing, for the HUD. */
export function compassName(yaw) {
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const turn = ((yaw / (Math.PI * 2)) % 1 + 1) % 1;
  return points[Math.round(turn * 8) % 8];
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
