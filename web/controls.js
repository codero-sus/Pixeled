/**
 * Input: keyboard, mouse (pointer lock), wheel and touch.
 *
 * The controls own no game state beyond "which keys are down" and "how far the mouse moved": the
 * game loop asks for movement axes and drains the action queue each frame. Touch gets a virtual
 * joystick, a look area, and the dig / place / jump buttons so the game plays on a phone too.
 */

const MOVEMENT_KEYS = ['keyw', 'keya', 'keys', 'keyd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'space', 'shiftleft', 'shiftright', 'controlleft', 'controlright'];

export class Controls {
  constructor(canvas, settings, callbacks = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.callbacks = callbacks;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false };
    this.locked = false;
    this.touch = { moveId: null, lookId: null, moveOrigin: { x: 0, y: 0 }, moveVector: { x: 0, y: 0 }, lookLast: { x: 0, y: 0 }, dig: false, place: false, jump: false };
    this.actions = [];
    this.lastTapTime = 0;
    this.wheelDelta = 0;
    this.doubleTapSpace = 0;
    this.enabled = true;
    this.bind();
  }

  bind() {
    const canvas = this.canvas;
    window.addEventListener('keydown', event => this.onKeyDown(event));
    window.addEventListener('keyup', event => this.onKeyUp(event));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('click', () => this.requestLock());
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('mousedown', event => this.onMouseDown(event));
    window.addEventListener('mouseup', event => this.onMouseUp(event));
    window.addEventListener('mousemove', event => this.onMouseMove(event));
    window.addEventListener('wheel', event => this.onWheel(event), { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.callbacks.onLockChange?.(this.locked);
    });
    this.bindTouch();
  }

  requestLock() {
    if (!this.enabled) return;
    if (this.canvas.requestPointerLock && document.pointerLockElement !== this.canvas) {
      const result = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.catch === 'function') result.catch(() => this.canvas.requestPointerLock());
    }
    this.unlockAudio();
  }

  unlockAudio() { this.callbacks.onFirstInput?.(); }

  // ------------------------------------------------------------------ keyboard

  onKeyDown(event) {
    const code = event.code.toLowerCase();
    if (MOVEMENT_KEYS.includes(code) && this.locked) event.preventDefault();
    if (event.repeat) return;
    this.keys.add(code);
    if (code === 'escape') this.callbacks.onEscape?.();
    if (code === 'keyf') this.callbacks.onToggleFly?.();
    if (code === 'keyv') this.callbacks.onToggleCamera?.();
    if (code === 'f3') { event.preventDefault(); this.callbacks.onToggleDebug?.(); }
    if (code === 'keye') this.callbacks.onToggleInventoryPage?.();
    if (code === 'space') {
      const now = performance.now();
      if (now - this.doubleTapSpace < 320) this.callbacks.onToggleFly?.();
      this.doubleTapSpace = now;
      this.actions.push({ type: 'jump' });
    }
    if (code.startsWith('digit')) {
      const slot = Number(code.slice(5));
      if (slot >= 1 && slot <= 9) this.callbacks.onHotbarSlot?.(slot - 1);
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code.toLowerCase());
  }

  // ------------------------------------------------------------------ mouse

  onMouseDown(event) {
    if (!this.locked) return;
    if (event.button === 0) { this.mouse.left = true; this.actions.push({ type: 'break', down: true }); }
    if (event.button === 1) this.actions.push({ type: 'pick' });
    if (event.button === 2) { this.mouse.right = true; this.actions.push({ type: 'place', down: true }); }
  }

  onMouseUp(event) {
    if (event.button === 0) this.mouse.left = false;
    if (event.button === 2) this.mouse.right = false;
  }

  onMouseMove(event) {
    if (!this.locked) return;
    const sensitivity = this.settings.sensitivity;
    this.mouse.dx += event.movementX * sensitivity;
    this.mouse.dy += event.movementY * sensitivity;
  }

  onWheel(event) {
    if (!this.locked) return;
    event.preventDefault();
    this.wheelDelta += Math.sign(event.deltaY);
  }

  // ------------------------------------------------------------------ touch

  bindTouch() {
    const touch = this.touch;
    const isTouch = event => event.pointerType === 'touch';
    this.canvas.addEventListener('pointerdown', event => {
      if (!isTouch(event)) return;
      this.unlockAudio();
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const joystickZone = x < rect.width * 0.4 && y > rect.height * 0.45;
      if (joystickZone && touch.moveId === null) {
        touch.moveId = event.pointerId;
        touch.moveOrigin = { x, y };
        touch.moveVector = { x: 0, y: 0 };
      } else if (touch.lookId === null) {
        touch.lookId = event.pointerId;
        touch.lookLast = { x, y };
        touch.touchStart = { x, y, time: performance.now() };
      }
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!isTouch(event)) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (event.pointerId === touch.moveId) {
        const dx = x - touch.moveOrigin.x, dy = y - touch.moveOrigin.y;
        const radius = 60;
        touch.moveVector = {
          x: Math.max(-1, Math.min(1, dx / radius)),
          y: Math.max(-1, Math.min(1, dy / radius)),
        };
        this.callbacks.onJoystick?.({ x: touch.moveVector.x, y: touch.moveVector.y, active: true });
      } else if (event.pointerId === touch.lookId) {
        const dx = x - touch.lookLast.x, dy = y - touch.lookLast.y;
        touch.lookLast = { x, y };
        this.mouse.dx += dx * this.settings.sensitivity * 1.6;
        this.mouse.dy += dy * this.settings.sensitivity * 1.6;
        if (touch.touchStart && Math.hypot(x - touch.touchStart.x, y - touch.touchStart.y) > 12) touch.touchStart.moved = true;
      }
    });
    const release = event => {
      if (!isTouch(event)) return;
      if (event.pointerId === touch.moveId) {
        touch.moveId = null;
        touch.moveVector = { x: 0, y: 0 };
        this.callbacks.onJoystick?.({ x: 0, y: 0, active: false });
      }
      if (event.pointerId === touch.lookId) {
        touch.lookId = null;
        const start = touch.touchStart;
        if (start && !start.moved && performance.now() - start.time < 260) {
          // A quick tap on the world digs the aimed block; a long press places one.
          this.actions.push({ type: 'tap' });
        }
        touch.touchStart = null;
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  /** Wire the on-screen buttons (they exist on touch layouts). */
  bindTouchButtons(root = document) {
    root.querySelectorAll('[data-touch-action]').forEach(button => {
      const action = button.dataset.touchAction;
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        this.unlockAudio();
        if (action === 'jump') this.actions.push({ type: 'jump' });
        if (action === 'dig') this.actions.push({ type: 'break-now' });
        if (action === 'place') this.actions.push({ type: 'place-now' });
        this.touch[action] = true;
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => button.addEventListener(type, () => {
        this.touch[action] = false;
      }));
    });
  }

  // ------------------------------------------------------------------ per-frame API

  /** Movement axes in [-1, 1]; the touch joystick can also feed analog values. */
  moveInput() {
    const keys = this.keys;
    const forward = (keys.has('keyw') || keys.has('arrowup') ? 1 : 0) - (keys.has('keys') || keys.has('arrowdown') ? 1 : 0);
    const strafe = (keys.has('keyd') || keys.has('arrowright') ? 1 : 0) - (keys.has('keya') || keys.has('arrowleft') ? 1 : 0);
    const joystick = this.touch.moveVector;
    return {
      forward: clamp(forward - joystick.y),
      back: 0,
      left: clamp(-strafe + joystick.x),
      right: 0,
      jump: keys.has('space') || this.touch.jump,
      sneak: keys.has('shiftleft') || keys.has('shiftright'),
      sprint: keys.has('controlleft') || keys.has('controlright'),
    };
  }

  /** Consume the mouse movement accumulated since the last frame. */
  takeLook() {
    const look = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return look;
  }

  takeWheel() {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  drainActions() {
    const actions = this.actions;
    this.actions = [];
    return actions;
  }

  isBreaking() { return this.mouse.left || this.touch.digHeld === true; }

  isPlacing() { return this.mouse.right || this.touch.placeHeld === true; }
}

const clamp = value => Math.max(-1, Math.min(1, value));
