/** Tiny synthesised sound effects — no audio files, nothing to download. */

export class Audio {
  constructor() {
    this.enabled = true;
    this.context = null;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.blip(660, 0.05);
    return this.enabled;
  }

  resume() {
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') this.context.resume();
    } catch (_) { /* audio is a bonus, never a blocker */ }
  }

  blip(frequency, duration = 0.07, type = 'square', volume = 0.03) {
    if (!this.enabled) return;
    try {
      this.resume();
      const context = this.context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch (_) { /* ignore */ }
  }

  dig(blockId) { this.blip(180 + (blockId % 5) * 40, 0.06, 'square', 0.025); }

  place(blockId) { this.blip(300 + (blockId % 5) * 55, 0.08, 'triangle', 0.03); }

  jump() { this.blip(520, 0.05, 'sine', 0.02); }

  select() { this.blip(720, 0.045, 'sine', 0.02); }
}
