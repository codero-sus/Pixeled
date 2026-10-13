/** All the HTML around the canvas: hotbar, HUD, loading screen, toasts and the help sheet. */

import { BLOCKS, HOTBAR, blockById } from './constants.js';
import { sunHeight } from './renderer.js';

export class Ui {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.hotbar = document.getElementById('hotbar');
    this.toastTimer = 0;
    this.selected = 0;
    this.buildHotbar();
    document.getElementById('new-world')?.addEventListener('click', () => callbacks.newWorld?.());
    document.getElementById('open-help')?.addEventListener('click', () => this.setHelp(true));
    document.getElementById('open-menu')?.addEventListener('click', () => callbacks.openMenu?.());
    document.getElementById('close-help')?.addEventListener('click', () => this.setHelp(false));
    document.getElementById('got-it')?.addEventListener('click', () => this.setHelp(false));
    document.getElementById('help-modal')?.addEventListener('click', event => {
      if (event.target.id === 'help-modal') this.setHelp(false);
    });
    document.getElementById('toggle-fly')?.addEventListener('click', () => callbacks.toggleFly?.());
    document.getElementById('toggle-sound')?.addEventListener('click', () => this.setSound(callbacks.toggleSound?.()));
    document.getElementById('toggle-fullscreen')?.addEventListener('click', () => callbacks.fullscreen?.());
    document.getElementById('copy-seed')?.addEventListener('click', () => this.copyLink());
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
    const block = blockById(HOTBAR[index]);
    const label = document.getElementById('selected-block');
    if (label) label.textContent = block.name;
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

  setStatus({ fps, position, biome, seed, clock, flying, blocksPlaced }) {
    const fpsElement = document.getElementById('hud-fps');
    if (fpsElement) fpsElement.textContent = `${fps} FPS`;
    const positionElement = document.getElementById('hud-position');
    if (positionElement) positionElement.textContent = `${position.x} ${position.y} ${position.z}`;
    const biomeElement = document.getElementById('hud-biome');
    if (biomeElement) biomeElement.textContent = biome;
    const seedElement = document.getElementById('hud-seed');
    if (seedElement) seedElement.textContent = String(seed);
    const clockElement = document.getElementById('hud-clock');
    if (clockElement) clockElement.textContent = formatClock(clock);
    const modeElement = document.getElementById('hud-mode');
    if (modeElement) modeElement.textContent = flying ? 'FLYING' : 'WALKING';
    const placedElement = document.getElementById('hud-edits');
    if (placedElement) placedElement.textContent = String(blocksPlaced);
  }

  toast(message, milliseconds = 1600) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => element.classList.remove('visible'), milliseconds);
  }

  setHelp(open) {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    modal.hidden = !open;
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
