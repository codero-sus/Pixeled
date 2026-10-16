/** All the HTML around the canvas: hotbar, HUD, loading screen, toasts and the help sheet. */

import { BLOCKS, HOTBAR, blockById } from './constants.js';
export { HOTBAR };
import { sunHeight } from './renderer.js';

export class Ui {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.hotbar = document.getElementById('hotbar');
    this.toastTimer = 0;
    this.selected = 0;
    this.showBiome = true;
    this.scale = 100;
    this.slotBlocks = [...HOTBAR];
    this.buildHotbar();
    document.getElementById('new-world')?.addEventListener('click', () => callbacks.newWorld?.());
    document.getElementById('open-help')?.addEventListener('click', () => this.requestHelp());
    document.getElementById('open-menu')?.addEventListener('click', () => callbacks.openMenu?.());
    document.getElementById('close-help')?.addEventListener('click', () => this.requestCloseHelp());
    document.getElementById('got-it')?.addEventListener('click', () => this.requestCloseHelp());
    document.getElementById('help-modal')?.addEventListener('click', event => {
      if (event.target.id === 'help-modal') this.requestCloseHelp();   // clicking the backdrop closes it
    });
    document.getElementById('toggle-fly')?.addEventListener('click', () => callbacks.toggleFly?.());
    document.getElementById('toggle-sound')?.addEventListener('click', () => this.setSound(callbacks.toggleSound?.()));
    document.getElementById('toggle-fullscreen')?.addEventListener('click', () => callbacks.fullscreen?.());
    document.getElementById('copy-seed')?.addEventListener('click', () => this.copyLink());
    document.getElementById('open-palette')?.addEventListener('click', () => this.paletteOpener?.());
    document.getElementById('close-palette')?.addEventListener('click', () => this.requestClosePalette());
  }

  buildHotbar() {
    this.hotbar.replaceChildren();
    HOTBAR.forEach((id, index) => {
      const block = blockById(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.dataset.block = String(id);
      button.setAttribute('aria-label', `${block.name}, key ${index + 1}`);
      button.innerHTML = `<span class="slot-key">${index + 1}</span><span class="slot-block" style="--block-top:${block.top ? rgb(block.top) : block.hex};--block-side:${rgb(block.side)}"></span><span class="slot-name">${block.name}</span>`;
      button.addEventListener('click', () => this.callbacks.selectHotbar?.(index));
      button.addEventListener('pointerdown', event => event.preventDefault());
      this.hotbar.append(button);
    });
    this.setSelected(0);
  }

  setSelected(index) {
    this.selected = index;
    [...this.hotbar.children].forEach((button, i) => button.classList.toggle('active', i === index));
    const block = blockById(this.slotBlocks?.[index] ?? HOTBAR[index]);
    const label = document.getElementById('selected-block');
    if (label) label.textContent = block.name;
  }

  /** Swap the block a hotbar slot holds (the palette does this), and repaint its swatch. */
  setSlotBlock(index, id) {
    this.slotBlocks ??= [...HOTBAR];
    this.slotBlocks[index] = id;
    const button = this.hotbar.children[index];
    if (!button) return false;
    const block = blockById(id);
    button.dataset.block = String(id);
    const swatch = button.querySelector?.('.slot-block');
    if (swatch) swatch.style.cssText = `--block-top:${rgb(block.top)};--block-side:${rgb(block.side)}`;
    const name = button.querySelector?.('.slot-name');
    if (name) name.textContent = block.name;
    if (index === this.selected) this.setSelected(index);
    return true;
  }

  setPaletteOpener(fn) { this.paletteOpener = fn; }

  /** The palette overlay: every placeable block, with how many you have dug up. */
  buildPalette(ids, { counts = new Map(), onPick = () => {} } = {}) {
    const grid = document.getElementById('palette-grid');
    if (!grid) return 0;
    grid.replaceChildren();
    this.paletteButtons = new Map();
    for (const id of ids) {
      const block = blockById(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-slot';
      button.dataset.block = String(id);
      button.setAttribute('aria-label', block.name);
      const count = counts.get(id) ?? 0;
      button.innerHTML = `<span class="slot-block" style="--block-top:${rgb(block.top)};--block-side:${rgb(block.side)}"></span>`
        + `<span class="palette-name">${block.name}</span>`
        + `<span class="palette-count">${count > 0 ? count : ''}</span>`;
      button.addEventListener('click', () => onPick(id));
      grid.append(button);
      this.paletteButtons.set(id, button);
    }
    return ids.length;
  }

  highlightPalette(id) {
    if (!this.paletteButtons) return false;
    for (const [key, button] of this.paletteButtons) button.classList.toggle('active', key === id);
    return true;
  }

  setPalette(open) {
    const overlay = document.getElementById('palette');
    if (!overlay) return false;
    // No argument means "toggle", which is what the HUD button and the B key both want.
    const show = open === undefined ? Boolean(overlay.hidden) : Boolean(open);
    overlay.hidden = !show;
    overlay.classList.toggle('hidden', !show);
    if (show) this.highlightPalette(this.slotBlocks?.[this.selected]);
    return show;
  }

  requestClosePalette() { this.callbacks.closePalette?.(); }

  /** The debug panel (F3): coordinates, chunk, light and how the renderer is doing. */
  setDebug(on, text = '') {
    const panel = document.getElementById('debug');
    if (!panel) return false;
    panel.hidden = !on;
    panel.classList.toggle('hidden', !on);
    if (on && text) panel.textContent = text;
    return Boolean(on);
  }

  setDebugText(lines) {
    const panel = document.getElementById('debug');
    if (panel && !panel.hidden) panel.textContent = lines;
  }

  setMinimapVisible(visible) {
    const map = document.getElementById('minimap');
    if (!map) return false;
    map.hidden = !visible;
    map.classList.toggle('hidden', !visible);
    return Boolean(visible);
  }

  /**
   * Draw the top-down map: one pixel per block column around the player, coloured by the block at
   * the surface, with a wedge for the facing direction. Pure geometry — no WebGL involved.
   */
  drawMinimap(world, centreX, centreZ, yaw = 0, radius = 48) {
    const canvas = document.getElementById('minimap');
    if (!canvas || !canvas.getContext) return 0;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const size = canvas.width;
    const step = (radius * 2) / size;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = Math.floor(centreX + (px - size / 2) * step);
        const z = Math.floor(centreZ + (py - size / 2) * step);
        if (x < 0 || z < 0 || x >= 128 || z >= 128) continue;
        const height = world.surfaceHeight(x, z);
        const id = world.get(x, height, z);
        const block = blockById(id);
        context.fillStyle = block.hex ?? '#000';
        context.fillRect(px, py, 1, 1);
        // Shade by height so hills and valleys read at a glance.
        const shade = Math.max(-0.35, Math.min(0.35, (height - 22) / 40));
        if (shade !== 0) {
          context.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
          context.fillRect(px, py, 1, 1);
        }
      }
    }
    // A cross-hair dot and a facing wedge for the player.
    context.fillStyle = '#ffffff';
    context.fillRect(size / 2 - 1, size / 2 - 1, 2, 2);
    context.strokeStyle = '#ffd479';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(size / 2, size / 2);
    context.lineTo(size / 2 - Math.sin(yaw) * 7, size / 2 - Math.cos(yaw) * 7);
    context.stroke();
    return size;
  }

  setFly(flying) {
    document.getElementById('toggle-fly')?.classList.toggle('active', flying);
  }

  setSound(enabled) {
    const button = document.getElementById('toggle-sound');
    if (button) {
      button.classList.toggle('active', enabled);
      button.textContent = enabled ? '♪' : '♪̸';
    }
  }

  setStatus({ fps, position, biome, seed, clock, flying, blocksPlaced, broken, walked, weather,
              facing, underfoot, breath, underwater, crouching, sprinting, chunks, draws,
              light, torchLight, chunk, sources, tally, inventory }) {
    const write = (id, text) => {
      const element = document.getElementById(id);
      if (element && element.textContent !== text) element.textContent = text;
    };
    write('hud-fps', `${fps} FPS`);
    write('hud-position', `${position.x} ${position.y} ${position.z}`);
    write('hud-biome', this.showBiome ? biome : '—');
    write('hud-seed', String(seed));
    write('hud-clock', formatClock(clock));
    write('hud-mode', flying ? 'FLYING' : crouching ? 'CROUCHING' : sprinting ? 'SPRINTING' : 'WALKING');
    write('hud-weather', weather ?? 'clear');
    if (typeof this.lastLight === 'number') write('hud-light', String(this.lastLight));
    write('hud-facing', facing ?? 'north');
    write('hud-mined', String(broken ?? 0));
    write('hud-walked', `${Math.round(walked ?? 0)} m`);
    write('hud-edits', String(blocksPlaced));
    write('target-label', underfoot ?? '');
    if (typeof draws === 'number' && chunks) this.lastStats = { draws, chunks };
    if (typeof light === 'number') {
      this.lastLight = light;
      write('hud-light', String(light));
      this.setDebugText([
        `pixeled 3d — debug`,
        `xyz        ${position.x} ${position.y} ${position.z}`,
        `chunk      ${chunk ?? '-'}   biome ${biome}`,
        `light      ${light}/15   (torches ${torchLight ?? 0}/15)`,
        `sky        ${weather ?? 'clear'}   clock ${formatClock(clock)}`,
        `frame      ${fps} fps   ${draws ?? 0} draws   ${chunks ?? 0} chunks`,
        `world      ${sources ?? 0} light sources   ${tally?.broken ?? 0} broken   ${Math.round(tally?.distance ?? 0)} m walked`,
        `carrying   ${(inventory instanceof Map ? [...inventory.entries()].length : 0)} block types`,
      ].join('\n'));
    }

    // The breath bar only exists while the head is under water.
    const breathBar = document.getElementById('breath');
    if (breathBar) {
      const show = Boolean(underwater);
      breathBar.hidden = !show;
      breathBar.classList.toggle('hidden', !show);
      const fill = document.getElementById('breath-fill');
      if (fill) {
        fill.style.width = `${Math.round((breath ?? 1) * 100)}%`;
        fill.classList.toggle('low', (breath ?? 1) < 0.3);
      }
    }
  }

  /** HUD scale, so the interface is readable on a phone and compact on a desktop. */
  setScale(percent = 100) {
    this.scale = percent;
    document.documentElement?.style?.setProperty('--ui-scale', String(Math.max(0.8, Math.min(1.5, percent / 100))));
    return this.scale;
  }

  setBiomeReadout(show) {
    this.showBiome = Boolean(show);
    return this.showBiome;
  }

  toast(message, milliseconds = 1600) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => element.classList.remove('visible'), milliseconds);
  }

  /** Open and close the help sheet through the game, which also parks the controls. */
  requestHelp() {
    if (this.callbacks.help) this.callbacks.help();
    else this.setHelp(true);
  }

  requestCloseHelp() {
    if (this.callbacks.closeHelp) this.callbacks.closeHelp();
    else this.setHelp(false);
  }

  setHelp(open) {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    // Both the attribute and the class, so no stylesheet rule can leave the sheet stuck open.
    modal.hidden = !open;
    modal.classList.toggle('hidden', !open);
    if (open) document.getElementById('got-it')?.focus();
  }

  /** Loading overlay with a progress bar while the world generates and meshes. */
  loading({ show, progress = 0, message = '' }) {
    const overlay = document.getElementById('loading');
    if (!overlay) return;
    overlay.classList.toggle('hidden', !show);
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    const text = document.getElementById('loading-text');
    if (text && message) text.textContent = message;
  }

  /** The line under "Click to play" — also used to explain drag-to-look. */
  setHint(text) {
    const hint = document.getElementById('start-hint');
    if (!hint) return;
    const detail = hint.querySelector?.('span') ?? null;
    if (detail) detail.textContent = text;
    else hint.innerHTML = `<b>Click to play</b><span>${text}</span>`;
    hint.classList.remove('hidden');
  }

  fadeHint() {
    const hint = document.getElementById('start-hint');
    if (hint) hint.classList.add('hidden');
  }

  async copyLink() {
    const url = `${location.origin}${location.pathname}?seed=${document.getElementById('hud-seed')?.textContent ?? ''}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('Seed link copied — paste it to share this world');
    } catch (_) {
      this.toast('Copy this link to share: ' + url, 4000);
    }
  }
}

function rgb(color) {
  const toByte = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  return `#${toByte(color[0])}${toByte(color[1])}${toByte(color[2])}`;
}

/** In-game clock: the day runs from 06:00 at the start of the cycle. */
export function formatClock(clock) {
  const hours = (clock * 24 + 6) % 24;
  const hh = String(Math.floor(hours)).padStart(2, '0');
  const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function timeOfDayLabel(clock) {
  const height = sunHeight(clock);
  if (height > 0.35) return 'day';
  if (height > 0.02) return 'golden hour';
  if (height > -0.08) return 'sunset';
  return 'night';
}

export { BLOCKS };
