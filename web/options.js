/**
 * The settings panel on the pause menu: sliders for the numbers, switches for the toggles.
 *
 * It only talks to `Settings` and to the game through one `onChange(key, value)` callback, so the
 * panel can be built from the same descriptions the defaults are declared with.
 */

import { DEFAULTS } from './settings.js';

const SLIDERS = [
  { key: 'fov', label: 'Field of view', min: 50, max: 110, step: 1, suffix: '°' },
  { key: 'sensitivity', label: 'Mouse sensitivity', min: 0.5, max: 8, step: 0.1, suffix: '×', scale: 0.1 },
  { key: 'renderDistance', label: 'View distance', min: 48, max: 160, step: 4, suffix: ' blocks' },
  { key: 'volume', label: 'Volume', min: 0, max: 100, step: 5, suffix: '%' },
  { key: 'dayLength', label: 'Day length', min: 120, max: 2400, step: 60, suffix: 's', label2: seconds => `${Math.round(seconds / 60)} min` },
  { key: 'uiScale', label: 'HUD scale', min: 80, max: 150, step: 5, suffix: '%' },
];

const SWITCHES = [
  { key: 'bob', label: 'View bob', hint: 'Camera sways as you walk' },
  { key: 'viewmodel', label: 'Held block', hint: 'Show the block in your hand' },
  { key: 'particles', label: 'Particles', hint: 'Break, dust and splash effects' },
  { key: 'weather', label: 'Weather', hint: 'Rain, snow and thunder' },
  { key: 'minimap', label: 'Biome readout', hint: 'Biome and time in the HUD' },
  { key: 'adaptiveDistance', label: 'Adaptive distance', hint: 'Shorten fog if the frame rate drops' },
  { key: 'reducedMotion', label: 'Reduced motion', hint: 'No bob, no flash, slower panorama' },
];

export class OptionsPanel {
  constructor(settings, { onChange = () => {}, root = null } = {}) {
    this.settings = settings;
    this.onChange = onChange;
    this.root = root ?? document.getElementById('settings-panel');
    this.controls = new Map();
    this.built = false;
  }

  /** Build the rows the first time the panel is opened. */
  build() {
    if (this.built || !this.root) return this;
    this.root.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'settings-grid';

    for (const description of SLIDERS) {
      const row = document.createElement('label');
      row.className = 'settings-row';
      const value = document.createElement('output');
      value.className = 'settings-value';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(description.min);
      input.max = String(description.max);
      input.step = String(description.step);
      input.value = String(this.settings.get(description.key));
      input.id = `setting-${description.key}`;
      const text = document.createElement('span');
      text.className = 'settings-label';
      text.textContent = description.label;
      const show = () => {
        const raw = Number(input.value);
        const scaled = description.scale ? raw * description.scale : raw;
        value.textContent = description.label2 ? description.label2(raw) : `${scaled}${description.suffix ?? ''}`;
      };
      input.addEventListener('input', () => {
        show();
        const scaled = description.scale ? Number(input.value) * description.scale : Number(input.value);
        this.commit(description.key, scaled);
      });
      row.append(text, input, value);
      grid.append(row);
      this.controls.set(description.key, input);
      show();
    }

    for (const description of SWITCHES) {
      const row = document.createElement('label');
      row.className = 'settings-row switch';
      const text = document.createElement('span');
      text.className = 'settings-label';
      text.innerHTML = `${description.label}<small>${description.hint}</small>`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `setting-${description.key}`;
      input.checked = Boolean(this.settings.get(description.key));
      input.addEventListener('change', () => this.commit(description.key, input.checked));
      row.append(text, input);
      grid.append(row);
      this.controls.set(description.key, input);
    }

    const footer = document.createElement('div');
    footer.className = 'settings-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'settings-reset';
    reset.className = 'menu-chip';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      this.settings.reset();
      this.sync();
      for (const { key } of [...SLIDERS, ...SWITCHES]) this.onChange(key, this.settings.get(key));
    });
    const note = document.createElement('span');
    note.className = 'settings-note';
    note.textContent = 'Saved in this browser for every world.';
    footer.append(reset, note);

    this.root.append(grid, footer);
    this.built = true;
    return this;
  }

  commit(key, value) {
    const stored = this.settings.set(key, value);
    this.onChange(key, stored);
    return stored;
  }

  /** Pull every control back in line with the stored settings. */
  sync() {
    if (!this.built) return this;
    for (const description of SLIDERS) {
      const input = this.controls.get(description.key);
      if (input) input.value = String(this.settings.get(description.key));
    }
    for (const description of SWITCHES) {
      const input = this.controls.get(description.key);
      if (input) input.checked = Boolean(this.settings.get(description.key));
    }
    return this;
  }

  toggle(force) {
    if (!this.root) return false;
    this.build();
    const open = force === undefined ? this.root.hidden : Boolean(force);
    this.root.hidden = !open;
    this.root.classList.toggle('hidden', !open);
    if (open) this.sync();
    return open;
  }

  get open() { return Boolean(this.root && !this.root.hidden); }
}

export { SLIDERS, SWITCHES, DEFAULTS };
