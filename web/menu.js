/**
 * The start screen — and, with a different heading, the pause screen.
 *
 * It follows the shape people know from Minecraft (a big blocky logo, a swinging yellow splash,
 * chunky buttons stacked in the middle) with the instant-play feel of bloxd: one obvious Play
 * button, and the world already generating behind the menu as a slowly turning panorama.
 *
 * Everything is looked up by id so the module works with the plain DOM and with the test stub.
 */

const SPLASHES = [
  'A brand new world every time!',
  'Blocky!',
  'Now with flying!',
  'Also playable with a drag!',
  '100% random terrain!',
  'Dig, build, repeat!',
  'Made of blocks!',
  'Seeded and proud!',
  'Try seed 2408!',
  'Watch out for the sea!',
  'Trees included!',
  'Sunset soon!',
];

export class StartMenu {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.isOpen = false;
    this.paused = false;

    this.element = document.getElementById('menu');
    this.title = document.getElementById('menu-title');
    this.splash = document.getElementById('menu-splash');
    this.subtitle = document.getElementById('menu-subtitle');
    this.buttons = {
      play: document.getElementById('menu-play'),
      playLabel: document.getElementById('menu-play-label'),
      playSub: document.getElementById('menu-play-sub'),
      fresh: document.getElementById('menu-fresh'),
      continue: document.getElementById('menu-continue'),
      continueSub: document.getElementById('menu-continue-sub'),
      seed: document.getElementById('menu-seed-toggle'),
      help: document.getElementById('menu-help'),
      sound: document.getElementById('menu-sound'),
    };
    this.seedRow = document.getElementById('menu-seed-row');
    this.seedInput = document.getElementById('menu-seed-input');
    this.seedGo = document.getElementById('menu-seed-go');
    this.worldLine = document.getElementById('menu-world');
    this.controlLine = document.getElementById('menu-controls');

    this.dragLook = false;
    this.splashIndex = Math.floor(Math.random() * SPLASHES.length);
    this.buttons.play?.addEventListener('click', () => this.callbacks.play?.());
    this.buttons.fresh?.addEventListener('click', () => this.callbacks.fresh?.());
    this.buttons.continue?.addEventListener('click', () => this.callbacks.resume?.());
    this.buttons.help?.addEventListener('click', () => this.callbacks.help?.());
    this.buttons.sound?.addEventListener('click', () => this.callbacks.sound?.());
    this.buttons.seed?.addEventListener('click', () => this.toggleSeedRow());
    this.seedGo?.addEventListener('click', () => this.playSeed());
    this.seedInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.playSeed();
      event.stopPropagation?.();
    });
  }

  /** Show the menu. `pause` switches it from "start" wording to "paused" wording. */
  show(pause = false) {
    this.isOpen = true;
    this.paused = pause;
    this.renderControls();
    this.splash.textContent = SPLASHES[this.splashIndex];
    this.splashIndex = (this.splashIndex + 1) % SPLASHES.length;
    if (this.title) this.title.textContent = pause ? 'PAUSED' : 'PIXELED';
    if (this.subtitle) {
      this.subtitle.textContent = pause
        ? 'Take a breath — your world is saved'
        : 'A first-person 3D block sandbox. Every world is rolled fresh from a random seed.';
    }
    if (this.buttons.playLabel) this.buttons.playLabel.textContent = pause ? 'Back to game' : 'Play';
    if (this.buttons.playSub) {
      this.buttons.playSub.textContent = pause ? 'Carry on where you left off' : 'Start building';
    }
    this.buttons.fresh?.removeAttribute('hidden');
    this.element?.classList.remove('hidden');
    this.setSeedRow(false);
    document.body?.classList.add('menu-open');
    // Focus the Play button so Enter starts the game.
    try { this.buttons.play?.focus(); } catch (_) { /* focus is a nicety */ }
  }

  hide() {
    this.isOpen = false;
    this.element?.classList.add('hidden');
    document.body?.classList.remove('menu-open');
    this.setSeedRow(false);
  }

  /** Tell the menu about the world it would resume, so Continue only appears when there is one. */
  setWorld({ seed, hasSave, edits = 0 }) {
    if (this.worldLine) this.worldLine.textContent = `seed ${seed ?? '—'}`;
    if (this.buttons.continue) {
      if (hasSave) this.buttons.continue.removeAttribute('hidden');
      else this.buttons.continue.setAttribute('hidden', '');
    }
    if (this.buttons.continueSub) {
      this.buttons.continueSub.textContent = edits
        ? `Saved world with ${edits} block ${edits === 1 ? 'change' : 'changes'}`
        : 'Saved world';
    }
  }

  setSound(enabled) {
    if (this.buttons.sound) this.buttons.sound.textContent = `Sound: ${enabled ? 'on' : 'off'}`;
  }

  setHint(text) {
    if (this.controlLine) this.controlLine.textContent = text;
  }

  /** Whether the browser refused pointer capture, so the hint can say "drag to look". */
  setLookMode(dragLook) {
    if (this.dragLook === dragLook) return;
    this.dragLook = dragLook;
    this.renderControls();
  }

  renderControls() {
    if (!this.controlLine) return;
    this.controlLine.textContent = this.dragLook
      ? 'Drag to look · WASD walk · Space jump · left click mine · right click build'
      : 'WASD walk · Space jump · left click mine · right click build · F fly';
  }

  toggleSeedRow() {
    this.setSeedRow(this.seedRow?.hasAttribute('hidden') ?? true);
  }

  setSeedRow(open) {
    if (!this.seedRow) return;
    if (open) {
      this.seedRow.removeAttribute('hidden');
      try { this.seedInput?.focus(); } catch (_) { /* focus is a nicety */ }
    } else {
      this.seedRow.setAttribute('hidden', '');
    }
  }

  playSeed() {
    const value = Number(this.seedInput?.value);
    if (!Number.isFinite(value) || value <= 0) {
      this.setHint('That seed does not look like a number — try 2408');
      return;
    }
    this.callbacks.seed?.(Math.floor(value));
  }

  /** Route Enter and Escape to the sensible action for the current state. */
  onKey(code) {
    if (code === 'Escape') {
      if (this.isOpen) this.callbacks.play?.();
      return true;
    }
    if (!this.isOpen) return false;
    if (code === 'Enter' || code === 'NumpadEnter') this.callbacks.play?.();
    if (code === 'KeyH') this.callbacks.help?.();
    return true;
  }
}
