/**
 * The user interface: hotbar, crosshair, status readouts, toasts, the pause menu with settings,
 * the seed box, the debug overlay and the touch controls.
 *
 * Everything here is plain DOM on top of the canvas — no framework — but the markup is built once
 * and then only updated, so the interface stays smooth while the world streams in behind it.
 */

import { ATLAS_COLUMNS, ATLAS_PIXELS, BLOCKS, HOTBAR_PAGES, TILE_PIXELS } from './constants.js';

const BLOCKS_PLACED_EVERY = 1;

export class Hud {
  constructor(atlasCanvas, settings, handlers = {}) {
    this.atlas = atlasCanvas;
    this.settings = settings;
    this.handlers = handlers;
    this.pages = HOTBAR_PAGES;
    this.page = 0;
    this.iconCache = new Map();
    this.element = id => document.getElementById(id);
    this.toastTimer = 0;
    this.buildHotbar();
    this.buildIcons();
    this.bindSettings();
    this.bindButtons();
    this.setDebugVisible(false);
  }

  // ------------------------------------------------------------------ hotbar

  get slots() { return this.pages[this.page]; }

  buildHotbar() {
    const hotbar = this.element('hotbar');
    if (!hotbar) return;
    hotbar.replaceChildren();
    this.slotElements = [];
    for (let i = 0; i < 9; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.innerHTML = `<span class="slot-key">${i + 1}</span><canvas class="slot-icon" width="44" height="44"></canvas><span class="slot-name"></span>`;
      button.addEventListener('click', () => this.handlers.onSelectSlot?.(i));
      hotbar.append(button);
      this.slotElements.push(button);
    }
    this.refreshHotbar();
  }

  setPage(page) {
    this.page = (page + this.pages.length) % this.pages.length;
    this.refreshHotbar();
    this.toast(`Block page ${this.page + 1} of ${this.pages.length}`);
  }

  refreshHotbar() {
    if (!this.slotElements) return;
    const slots = this.slots;
    for (let i = 0; i < 9; i++) {
      const button = this.slotElements[i];
      const blockId = slots[i];
      const block = BLOCKS[blockId];
      button.querySelector('.slot-name').textContent = block ? block.name : '';
      button.dataset.block = String(blockId ?? '');
      const icon = button.querySelector('.slot-icon');
      const cacheKey = `${blockId}:${this.selected === i}`;
      if (button.dataset.iconKey !== cacheKey) {
        button.dataset.iconKey = cacheKey;
        const context = icon.getContext('2d');
        context.clearRect(0, 0, icon.width, icon.height);
        drawBlockIcon(context, this.atlas, block, icon.width, this.iconCache);
      }
    }
    this.updateSelection();
  }

  updateSelection() {
    if (!this.slotElements) return;
    for (let i = 0; i < 9; i++) this.slotElements[i].classList.toggle('active', i === this.selected);
    const block = BLOCKS[this.slots[this.selected] ?? 1];
    const label = this.element('hotbar-name');
    if (label && block) label.textContent = block.name;
  }

  setSelected(slot) {
    this.selected = ((slot % 9) + 9) % 9;
    for (const cache of [this.slotElements]) void cache;
    if (this.slotElements) {
      for (const button of this.slotElements) button.dataset.iconKey = '';
    }
    this.refreshHotbar();
  }

  /** The block the player would place right now. */
  selectedBlockId() {
    return this.slots[this.selected] ?? 1;
  }

  cycleSelection(delta) {
    const next = this.selected + delta;
    if (next < 0) this.setPage(this.page - 1);
    if (next > 8) this.setPage(this.page + 1);
    this.setSelected(((next % 9) + 9) % 9);
  }

  buildIcons() {
    // Icons are drawn on the fly in refreshHotbar; nothing to precompute.
  }

  // ------------------------------------------------------------------ status

  update(state) {
    const {
      fps, biome, position, clock, phase, target, blocksPlaced, chunks, breakProgress, seed, flying, onGround, inWater,
    } = state;
    const set = (id, value) => { const element = this.element(id); if (element && element.textContent !== value) element.textContent = value; };
    set('stat-fps', `${fps} fps`);
    set('stat-biome', biome);
    set('stat-coords', `${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}`);
    set('stat-clock', clock);
    set('stat-phase', phase);
    set('stat-seed', `seed ${seed}`);
    set('stat-chunks', `${chunks} chunks`);
    set('stat-mode', flying ? 'flying' : inWater ? 'swimming' : !onGround ? 'airborne' : 'walking');
    set('debug-pos', `x ${position.x.toFixed(2)}  y ${position.y.toFixed(2)}  z ${position.z.toFixed(2)}`);
    set('debug-chunks', String(chunks));
    set('debug-placed', String(blocksPlaced));
    const targetLabel = this.element('stat-target');
    if (targetLabel) targetLabel.textContent = target ? target : '—';
    const progress = this.element('break-progress');
    if (progress) {
      progress.style.width = `${Math.round(breakProgress * 100)}%`;
      progress.classList.toggle('visible', breakProgress > 0);
    }
  }

  toast(message) {
    const toast = this.element('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
  }

  // ------------------------------------------------------------------ overlays

  showPause(visible) {
    const menu = this.element('pause-menu');
    if (menu) menu.hidden = !visible;
  }

  showPlayPrompt(visible) {
    const prompt = this.element('play-prompt');
    if (prompt) prompt.hidden = !visible;
  }

  setDebugVisible(visible) {
    this.debugVisible = visible;
    const debug = this.element('debug');
    if (debug) debug.hidden = !visible;
  }

  toggleDebug() {
    this.setDebugVisible(!this.debugVisible);
  }

  showHelp(visible) {
    const help = this.element('help-panel');
    if (help) help.hidden = !visible;
  }

  /** Refresh the pause menu controls from the current settings. */
  syncSettings() {
    const set = (id, value) => { const element = this.element(id); if (element) element.value = String(value); };
    const label = (id, text) => { const element = this.element(id); if (element) element.textContent = text; };
    set('setting-distance', this.settings.renderDistance);
    set('setting-fov', this.settings.fov);
    set('setting-sensitivity', this.settings.sensitivity);
    set('setting-time', this.settings.timeOfDay ?? 0.3);
    label('setting-distance-value', `${this.settings.renderDistance} chunks`);
    label('setting-fov-value', `${this.settings.fov}°`);
    label('setting-sensitivity-value', this.settings.sensitivity.toFixed(4));
    label('setting-time-value', clockLabel(this.settings.timeOfDay ?? 0.3));
    const sound = this.element('setting-sound');
    if (sound) sound.checked = this.settings.sound !== false;
    const cycle = this.element('setting-cycle');
    if (cycle) cycle.checked = this.settings.dayCycle !== false;
  }

  /** Follow the sky clock while the day cycle is on (called about once a second). */
  syncTimeSlider() {
    const slider = this.element('setting-time');
    if (!slider || document.activeElement === slider) return;
    const time = this.settings.timeOfDay ?? 0.3;
    slider.value = String(time);
    const label = this.element('setting-time-value');
    if (label) label.textContent = clockLabel(time);
  }

  bindSettings() {
    const slider = (id, key, transform, format) => {
      const element = this.element(id);
      if (!element) return;
      element.addEventListener('input', () => {
        const value = transform ? transform(Number(element.value)) : Number(element.value);
        this.settings[key] = value;
        const label = this.element(`${id}-value`);
        if (label) label.textContent = format(value);
        this.handlers.onSettings?.(this.settings);
      });
    };
    slider('setting-distance', 'renderDistance', value => Math.round(value), value => `${value} chunks`);
    slider('setting-fov', 'fov', value => Math.round(value), value => `${value}°`);
    slider('setting-sensitivity', 'sensitivity', value => value / 1000, value => value.toFixed(4));
    slider('setting-time', 'timeOfDay', value => value, value => clockLabel(value));
    const sound = this.element('setting-sound');
    if (sound) sound.addEventListener('change', () => {
      this.settings.sound = sound.checked;
      this.handlers.onSettings?.(this.settings);
      this.handlers.onSoundToggle?.(sound.checked);
    });
    const cycle = this.element('setting-cycle');
    if (cycle) cycle.addEventListener('change', () => {
      this.settings.dayCycle = cycle.checked;
      this.handlers.onSettings?.(this.settings);
    });
    const creative = this.element('setting-creative');
    if (creative) creative.addEventListener('change', () => {
      this.settings.creative = creative.checked;
      this.handlers.onSettings?.(this.settings);
    });
  }

  bindButtons() {
    const click = (id, handler) => {
      const element = this.element(id);
      if (element) element.addEventListener('click', event => { event.stopPropagation(); handler(); });
    };
    click('play-button', () => this.handlers.onPlay?.());
    click('resume-button', () => this.handlers.onResume?.());
    click('help-button', () => this.showHelp(true));
    click('help-close', () => this.showHelp(false));
    click('new-world-button', () => this.handlers.onNewWorld?.());
    click('copy-seed-button', () => this.handlers.onCopySeed?.());
    click('page-button', () => this.setPage(this.page + 1));
    click('camera-button', () => this.handlers.onToggleCamera?.());
    click('fly-button', () => this.handlers.onToggleFly?.());
    const seedInput = this.element('seed-input');
    if (seedInput) {
      seedInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') this.handlers.onNewWorld?.(seedInput.value);
        event.stopPropagation();
      });
    }
    this.syncSettings();
  }

  setSeedText(seed, extra = '') {
    const element = this.element('seed-text');
    if (element) element.textContent = `${seed}${extra ? ` · ${extra}` : ''}`;
    const input = this.element('seed-input');
    if (input) input.placeholder = String(seed);
  }

  setLoading(visible, text = '') {
    const loading = this.element('loading');
    if (!loading) return;
    loading.hidden = !visible;
    const label = this.element('loading-text');
    if (label && text) label.textContent = text;
  }
}

const clockLabel = time => {
  const totalMinutes = Math.floor(((time % 1) + 1) % 1 * 24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
};

/**
 * Draw an inventory-style block icon: a little isometric cube using the block's own tiles, or a
 * flat tile for plants and water.
 */
export function drawBlockIcon(context, atlasCanvas, block, size, cache = new Map()) {
  if (!block || block.id === 0) return;
  const { width } = context.canvas;
  const scale = size / 44;
  const half = size / 2;
  const tileTop = block.tiles.top;
  const tileSide = block.tiles.side;
  const source = (tile, x, y, w, h, transform) => {
    const sx = (tile % ATLAS_COLUMNS) * TILE_PIXELS;
    const sy = Math.floor(tile / ATLAS_COLUMNS) * TILE_PIXELS;
    if (transform) context.setTransform(...transform);
    else context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(atlasCanvas, sx, sy, TILE_PIXELS, TILE_PIXELS, x, y, w, h);
    context.setTransform(1, 0, 0, 1, 0, 0);
  };
  void cache;
  const flat = block.plant || block.liquid;
  context.save();
  if (flat) {
    source(tileSide, half - 15 * scale, half - 15 * scale, 30 * scale, 30 * scale);
  } else {
    // Top face: a rhombus made with an affine transform.
    source(tileTop, 0, 0, 1, 1, [0.62 * size, 0.30 * size, -0.62 * size, 0.30 * size, half, 2 * scale]);
    // Left face, then right face, each a skewed square.
    source(tileSide, 0, 0, 1, 1, [0.62 * size, -0.30 * size, 0, 0.44 * size, half - 0.62 * size, 0.30 * size + 2 * scale]);
    context.globalAlpha = 0.82;
    source(tileSide, 0, 0, 1, 1, [0.62 * size, 0.30 * size, 0, 0.44 * size, half, 0.30 * size + 2 * scale]);
    context.globalAlpha = 1;
  }
  context.restore();
  void width;
}

export { ATLAS_PIXELS, BLOCKS_PLACED_EVERY };
