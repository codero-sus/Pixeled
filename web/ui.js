/** All the HTML around the canvas: hotbar, HUD, loading screen, toasts and the help sheet. */

import { BLOCKS, HOTBAR, blockById } from './constants.js';
export { HOTBAR };
import { sunHeight } from './renderer.js';
import { formatTime } from './modes.js';

/** How many of an ingredient the inventory holds, read back out of `missingFor`'s report. */
function missingForCheck(recipe, id, missing) {
  const report = missing(recipe) ?? [];
  const entry = report.find(item => item.id === id);
  if (entry) return entry.have;
  // Not in the missing list means there is enough of it: the recipe's own requirement is the floor.
  const need = recipe.needs.find(([needId]) => needId === id)?.[1] ?? 0;
  return need;
}

/** One heart, drawn inside a square of this size at this position. */
function heartPath(context, x, y, size) {
  const half = size / 2;
  const top = y + size * 0.32;
  context.beginPath();
  context.moveTo(x + half, y + size * 0.98);
  context.bezierCurveTo(x + size * 0.02, top + size * 0.18, x + size * 0.16, y + size * 0.04, x + half, top);
  context.bezierCurveTo(x + size * 0.84, y + size * 0.04, x + size * 0.98, top + size * 0.18, x + half, y + size * 0.98);
  context.closePath();
  return context;
}

/** A 34px isometric cube: top face lighter, left face the block colour, right face shaded. */
export function drawCube(context, size, block) {
  const half = size / 2;
  const top = rgb(block.top), side = rgb(block.side), bottom = rgb(block.bottom ?? block.side);
  const height = size * 0.28;
  context.beginPath();                        // top diamond
  context.moveTo(half, 2);
  context.lineTo(size - 2, 2 + height);
  context.lineTo(half, 2 + height * 2);
  context.lineTo(2, 2 + height);
  context.closePath();
  context.fillStyle = top;
  context.fill();
  context.beginPath();                        // left face
  context.moveTo(2, 2 + height);
  context.lineTo(half, 2 + height * 2);
  context.lineTo(half, size - 2);
  context.lineTo(2, size - 2 - height);
  context.closePath();
  context.fillStyle = side;
  context.fill();
  context.beginPath();                        // right face, in shade
  context.moveTo(size - 2, 2 + height);
  context.lineTo(half, 2 + height * 2);
  context.lineTo(half, size - 2);
  context.lineTo(size - 2, size - 2 - height);
  context.closePath();
  context.fillStyle = shadeColour(bottom, 0.76);
  context.fill();
  return true;
}

function shadeColour(colour, factor) {
  const parts = String(colour).replace('#', '').match(/../g) ?? ['88', '88', '88'];
  const scaled = parts.map(part => Math.max(0, Math.min(255, Math.round(parseInt(part, 16) * factor))));
  return `rgb(${scaled.join(',')})`;
}

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
    document.getElementById('close-craft')?.addEventListener('click', () => this.callbacks.closeCraft?.());
    document.getElementById('respawn')?.addEventListener('click', () => this.callbacks.respawn?.());
    document.getElementById('close-challenges')?.addEventListener('click', () => this.callbacks.closeChallenges?.());
    document.getElementById('challenge-share')?.addEventListener('click', () => this.callbacks.shareSeed?.());
    document.getElementById('close-storage')?.addEventListener('click', () => this.callbacks.closeStorage?.());
    document.getElementById('store-held')?.addEventListener('click', () => this.callbacks.storeHeld?.());
    document.getElementById('open-craft')?.addEventListener('click', () => this.callbacks.openCraft?.());
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
  buildPalette(ids, { counts = new Map(), onPick = () => {}, onCraft = null } = {}) {
    const craftButton = document.getElementById('palette-craft');
    if (craftButton) {
      craftButton.hidden = !onCraft;
      craftButton.onclick = onCraft ? () => onCraft() : null;
    }
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

  /** Refresh just the counts on the palette buttons, without rebuilding the grid. */
  refreshPaletteCounts(counts = new Map()) {
    if (!this.paletteButtons) return 0;
    let updated = 0;
    for (const [id, button] of this.paletteButtons) {
      const label = button.querySelector('.palette-count');
      if (!label) continue;
      const count = counts.get(id) ?? 0;
      const text = count > 0 ? String(count) : '';
      if (label.textContent !== text) { label.textContent = text; updated++; }
    }
    return updated;
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

  // ------------------------------------------------------------------ crafting

  /**
   * The recipe book: every recipe with its ingredients, the ones you can afford highlighted.
   * Ingredient rows show how many you have, so the panel doubles as a shopping list.
   */
  buildCraft(recipes, { canCraft = () => false, missing = () => [], onCraft = () => {} } = {}) {
    const list = document.getElementById('craft-list');
    if (!list) return 0;
    list.replaceChildren();
    this.craftButtons = new Map();
    let affordable = 0;
    for (const recipe of recipes) {
      const out = blockById(recipe.out);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'craft-row';
      row.dataset.out = String(recipe.out);
      const ok = canCraft(recipe);
      if (ok) affordable++;
      row.classList.toggle('affordable', ok);
      const needs = recipe.needs
        .map(([id, need]) => {
          const have = missingForCheck(recipe, id, missing);
          const short = have < need;
          return `<span class="craft-need${short ? ' short' : ''}"><i style="background:${rgb(blockById(id).side)}"></i>`
            + `${blockById(id).name} <b>${have}</b>/${need}</span>`;
        })
        .join('');
      row.innerHTML = `<span class="slot-block" style="--block-top:${rgb(out.top)};--block-side:${rgb(out.side)}"></span>`
        + `<span class="craft-text"><b>${recipe.label}</b><small>${recipe.count > 1 ? `makes ${recipe.count}` : 'makes one'}</small></span>`
        + `<span class="craft-needs">${needs}</span>`;
      row.addEventListener('click', () => onCraft(recipe));
      list.append(row);
      this.craftButtons.set(recipe.out, row);
    }
    this.lastCraftable = affordable;
    return recipes.length;
  }

  setCraft(open) {
    const overlay = document.getElementById('craft');
    if (!overlay) return false;
    const show = open === undefined ? Boolean(overlay.hidden) : Boolean(open);
    overlay.hidden = !show;
    overlay.classList.toggle('hidden', !show);
    return show;
  }

  /** A one-line summary of the backpack, listed at the top of the crafting panel. */
  setCraftInventory(inventory = new Map(), limit = 14) {
    const element = document.getElementById('craft-inventory');
    if (!element) return 0;
    const entries = [...inventory.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { element.textContent = 'Your backpack is empty — go and dig something'; return 0; }
    element.replaceChildren();
    for (const [id, count] of entries.slice(0, limit)) {
      const chip = document.createElement('span');
      chip.className = 'inv-chip';
      chip.innerHTML = `<i style="background:${rgb(blockById(id).side)}"></i>${blockById(id).name} <b>${count}</b>`;
      element.append(chip);
    }
    return Math.min(entries.length, limit);
  }

  // ------------------------------------------------------------------ storage

  /** The contents of an open chest, with a take-one button per stack. */
  buildStorage(contents, heldCount = 0, { onTake = null } = {}) {
    onTake ??= id => this.callbacks.takeFromStorage?.(id);
    const grid = document.getElementById('storage-grid');
    if (!grid) return 0;
    grid.replaceChildren();
    this.storageButtons = new Map();
    const entries = contents instanceof Map ? [...contents.entries()].filter(([, count]) => count > 0) : [];
    for (const [id, count] of entries) {
      const block = blockById(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-slot';
      button.dataset.block = String(id);
      button.setAttribute('aria-label', `${block.name} (${count})`);
      button.innerHTML = `<span class="slot-block" style="--block-top:${rgb(block.top)};--block-side:${rgb(block.side)}"></span>`
        + `<span class="palette-name">${block.name}</span><span class="palette-count">${count}</span>`;
      button.addEventListener('click', () => onTake(id));
      grid.append(button);
      this.storageButtons.set(id, button);
    }
    const held = document.getElementById('storage-held');
    if (held) held.textContent = heldCount > 1 ? `${heldCount} in the stack` : heldCount === 1 ? 'one in the stack' : 'nothing in the selected slot';
    const empty = document.getElementById('storage-empty');
    if (empty) empty.hidden = entries.length > 0;
    return entries.length;
  }

  setStorage(open) {
    const overlay = document.getElementById('storage');
    if (!overlay) return false;
    const show = Boolean(open);
    overlay.hidden = !show;
    overlay.classList.toggle('hidden', !show);
    return show;
  }

  // ------------------------------------------------------------------ sleeping

  /** The black fade that swallows the screen while the night passes. */
  setSleep(active) {
    const overlay = document.getElementById('sleep');
    if (!overlay) return false;
    overlay.hidden = !active;
    overlay.classList.toggle('hidden', !active);
    overlay.style.opacity = active ? '1' : '0';
    return Boolean(active);
  }

  setSleepProgress(remaining) {
    const overlay = document.getElementById('sleep');
    if (!overlay) return 0;
    const progress = Math.max(0, Math.min(1, 1 - remaining));
    overlay.style.opacity = String(Math.min(1, progress * 3));
    return progress;
  }

  // ------------------------------------------------------------------ modes

  /** The mode chip in the corner: icon, name and the badge the card carried. */
  setMode(chip) {
    const element = document.getElementById('hud-mode-chip');
    if (!element || !chip) return false;
    element.textContent = `${chip.icon} ${chip.name}`;
    element.title = chip.badge;
    element.style.setProperty('--mode-colour', chip.colour);
    element.hidden = false;
    return true;
  }

  /** The speedrun clock, hidden for every other mode. */
  setRunTimer(visible) {
    const element = document.getElementById('run-timer');
    if (!element) return false;
    element.hidden = !visible;
    return Boolean(visible);
  }

  setRunTime(seconds, done = null) {
    const element = document.getElementById('run-timer');
    if (!element) return 0;
    element.textContent = done === null ? formatTime(seconds) : `★ ${formatTime(done)}`;
    element.classList.toggle('finished', done !== null);
    return seconds;
  }

  // ------------------------------------------------------------------ daily challenge

  /**
   * Fill the daily panel and the start screen card from one summary: a bar per goal, ticked when it
   * is done, plus the streak line.
   */
  buildChallenges(summary, { day = '', streak = 0, best = 0, seed = 0 } = {}) {
    const list = document.getElementById('challenge-list');
    if (list) {
      list.replaceChildren();
      for (const goal of summary) {
        const row = document.createElement('div');
        row.className = `challenge-row${goal.complete ? ' complete' : ''}`;
        row.dataset.goal = goal.id;
        const percent = Math.round(goal.progress * 100);
        row.innerHTML = `<span class="challenge-icon">${goal.icon}</span>`
          + `<span class="challenge-text"><b>${goal.label}</b>`
          + `<span class="challenge-bar"><i style="width:${percent}%"></i></span></span>`
          + `<span class="challenge-count">${goal.complete ? '✓' : `${Math.min(goal.have, goal.value)}/${goal.value}`}</span>`;
        list.append(row);
      }
    }
    const streakText = streak > 0
      ? `${streak} day streak · best ${best}`
      : 'Finish all three today to start a streak';
    // The same line appears on the start-screen card and in the panel, so both get written.
    for (const id of ['challenge-streak', 'challenge-streak-panel']) {
      const line = document.getElementById(id);
      if (line) line.textContent = streakText;
    }
    const dayLabel = document.getElementById('challenge-day');
    if (dayLabel) dayLabel.textContent = day ? `DAILY · ${day}` : 'DAILY CHALLENGE';
    const seedLine = document.getElementById('challenge-seed');
    if (seedLine) seedLine.textContent = String(seed);
    this.lastChallengeSummary = summary;
    return summary.length;
  }

  setChallenges(open) {
    const overlay = document.getElementById('challenges');
    if (!overlay) return false;
    const show = Boolean(open);
    overlay.hidden = !show;
    overlay.classList.toggle('hidden', !show);
    return show;
  }

  /** How many goals are ticked, for the HUD chip. */
  challengeProgress() {
    const summary = this.lastChallengeSummary ?? [];
    return { done: summary.filter(goal => goal.complete).length, total: summary.length };
  }

  // ------------------------------------------------------------------ health

  /**
   * Draw the health bar: ten hearts, whole, half or empty, on the canvas in the HUD. A heart is two
   * lobes and a point, and a half heart is the same shape clipped down the middle.
   */
  drawHealth(canvas = document.getElementById('hearts'), health = null) {
    if (!canvas || !canvas.getContext) return 0;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const points = health?.points ?? 20;
    const size = canvas.width / 10;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 10; index++) {
      const fill = Math.max(0, Math.min(1, (points - index * 2) / 2));      // 0, 0.5 or 1
      heartPath(context, index * size, 0, size);
      context.fillStyle = 'rgba(20, 14, 16, 0.55)';
      context.fill();
      if (fill > 0) {
        context.save();
        context.beginPath();
        context.rect(index * size, 0, size * fill, size);                    // clip to the fill
        context.clip();
        heartPath(context, index * size, 0, size);
        context.fillStyle = points <= 6 ? '#e05a4a' : points <= 12 ? '#e0a03a' : '#e0405c';
        context.fill();
        context.restore();
      }
      heartPath(context, index * size, 0, size);
      context.strokeStyle = 'rgba(12, 8, 9, 0.8)';
      context.lineWidth = 1;
      context.stroke();
    }
    return 10;
  }

  setDeath(open, cause = '') {
    const overlay = document.getElementById('death');
    if (!overlay) return false;
    const show = Boolean(open);
    overlay.hidden = !show;
    overlay.classList.toggle('hidden', !show);
    const message = document.getElementById('death-cause');
    if (message && cause) message.textContent = cause;
    return show;
  }

  // ------------------------------------------------------------------ hotbar

  /**
   * Draw a little isometric cube for each hotbar slot on its own canvas, so the HUD shows the
   * actual blocks instead of a colour chip. Three faces, two shades, no images.
   */
  drawHotbarIcons(container = document.getElementById('hotbar'), slotBlocks = []) {
    if (!container) return 0;
    const slots = [...container.children];
    let drawn = 0;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      const id = slotBlocks[index];
      const block = id === undefined ? null : blockById(id);
      let canvas = slot.querySelector('canvas.slot-cube');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'slot-cube';
        canvas.width = 34;
        canvas.height = 34;
        slot.prepend(canvas);
      }
      const context = canvas.getContext?.('2d');
      if (!context) continue;
      context.clearRect(0, 0, 34, 34);
      if (!block) continue;
      drawCube(context, 34, block);
      drawn++;
    }
    return drawn;
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
