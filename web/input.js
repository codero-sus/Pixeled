/**
 * Input for desktop and touch: mouse look, WASD movement, hotbar keys and wheel on desktop; a
 * thumb-stick, drag-to-look and action buttons on phones and tablets.
 *
 * Mouse look has two modes, and the game is fully playable in both:
 *
 *   * **captured** — the pointer is locked, the crosshair follows the mouse directly, and holding a
 *     button digs or builds repeatedly.
 *   * **drag** — the browser refused to capture the pointer (this happens inside an iframe that was
 *     not given the pointer-lock permission, which is how the game is embedded in some previews).
 *     Then dragging moves the view, a quick left click digs, a quick right click builds, and a
 *     middle click picks — the same as captured mode, minus the invisible cursor.
 *
 * `enabled` gates gameplay input while the start/pause menu is up.
 */

const DRAG_THRESHOLD = 5;        // pixels of movement before a click counts as a drag
const CLICK_MILLISECONDS = 400;  // a press shorter than this with no drag is a click

export class Input {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.mining = false;
    this.placing = false;
    this.jumpQueued = false;
    this.pointerLocked = false;
    this.dragLook = false;         // pointer capture unavailable: dragging looks around
    this.enabled = true;
    this.press = null;             // { button, x, y, moved, time } while a button is held
    this.touch = { active: false, moveId: null, lookId: null, originX: 0, originY: 0, x: 0, y: 0, radius: 62 };
    this.move = { x: 0, y: 0 };

    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();
  }

  get isTouch() { return this.touch.active; }

  // ------------------------------------------------------------------ keyboard

  bindKeyboard() {
    window.addEventListener('keydown', event => {
      const code = event.code;
      if (code === 'Escape') { this.callbacks.onEscape?.(); return; }
      if (this.callbacks.onKey?.(code)) return;      // the start screen owns Enter and friends
      // Help toggles work even while the controls are parked, so H can close the sheet it opened.
      if (code === 'KeyH') { this.callbacks.toggleHelp?.(); return; }
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) event.preventDefault();
      if (this.keys.has(code)) return;
      this.keys.add(code);
      if (code === 'Space') this.jumpQueued = true;
      if (code === 'KeyF') this.callbacks.toggleFly?.();
      if (code.startsWith('Digit')) {
        const index = Number(code.slice(5));
        if (index >= 1 && index <= 9) this.callbacks.selectHotbar?.(index - 1);
      }
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mining = this.placing = false; this.press = null; });
  }

  // ------------------------------------------------------------------ mouse

  bindMouse() {
    const canvas = this.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    canvas.addEventListener('mousedown', event => {
      if (!this.enabled) return;
      if (event.button > 2) return;
      if (event.button === 1) event.preventDefault();
      this.press = { button: event.button, x: event.clientX ?? 0, y: event.clientY ?? 0, moved: false, time: Date.now() };

      if (!this.pointerLocked) {
        // Ask for capture; if the browser refuses we simply fall back to dragging. The click is
        // interpreted on mouseup, once we know whether it was a click or the start of a drag.
        this.requestLock();
        return;
      }
      this.act(event.button);
    });

    document.addEventListener('mousemove', event => {
      const movementX = event.movementX || 0;
      const movementY = event.movementY || 0;
      if (this.pointerLocked) {
        this.lookX += movementX;
        this.lookY += movementY;
        return;
      }
      if (!this.press || !this.enabled) return;
      // Drag-to-look: browsers report movementX/Y on ordinary moves too, so use it when it is
      // there and fall back to the cursor moving across the canvas.
      let dx = movementX, dy = movementY;
      if (!dx && !dy && this.press.x) {
        dx = (event.clientX ?? this.press.x) - this.press.x;
        dy = (event.clientY ?? this.press.y) - this.press.y;
        this.press.x = event.clientX ?? this.press.x;
        this.press.y = event.clientY ?? this.press.y;
      }
      if (!this.press.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD && !this.press.dragged) return;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD && !this.press.moved) return;
      this.press.moved = true;
      this.lookX += dx;
      this.lookY += dy;
    });

    document.addEventListener('mouseup', event => {
      const press = this.press;
      this.press = null;
      if (event.button === 0) this.mining = false;
      if (event.button === 2) this.placing = false;
      if (!this.enabled || !press || press.button !== event.button) return;
      if (this.pointerLocked) return;
      if (press.moved) return;                                  // that was a look, not a click
      if (Date.now() - press.time > CLICK_MILLISECONDS) return;  // a slow press is not a click
      this.act(event.button);
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) this.dragLook = false;
      this.callbacks.onLockChange?.(this.pointerLocked);
    });
    document.addEventListener('pointerlockerror', () => this.enableDragLook());

    canvas.addEventListener('wheel', event => {
      if (!this.enabled) return;
      event.preventDefault();
      this.callbacks.scrollHotbar?.(Math.sign(event.deltaY));
    }, { passive: false });
  }

  /** Dig, build or pick with the given mouse button. */
  act(button) {
    if (button === 0) { this.mining = true; this.callbacks.onDig?.(); }
    else if (button === 2) { this.placing = true; this.callbacks.onPlace?.(); }
    else if (button === 1) this.callbacks.onPick?.();
  }

  /**
   * Ask the browser to capture the pointer. Chrome returns a promise that rejects when an embedded
   * frame is not allowed to capture; Safari throws instead; some browsers just do nothing. All
   * three end up in the same place: drag-to-look.
   */
  requestLock() {
    if (this.pointerLocked || this.dragLook) return this.pointerLocked;
    try {
      const result = this.canvas.requestPointerLock?.();
      if (result && typeof result.catch === 'function') result.catch(() => this.enableDragLook());
    } catch (_) {
      this.enableDragLook();
    }
    // Verification: if nothing happened shortly afterwards, capture is blocked here.
    setTimeout(() => {
      if (!this.pointerLocked && document.pointerLockElement !== this.canvas) this.enableDragLook();
    }, 350);
    return true;
  }

  enableDragLook() {
    if (this.dragLook) return;
    this.dragLook = true;
    this.callbacks.onLookFallback?.();
  }

  /** Leave captured mode (the menu needs the cursor back). */
  release() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  // ------------------------------------------------------------------ touch

  bindTouch() {
    const canvas = this.canvas;
    const start = event => {
      if (event.pointerType === 'mouse' || !this.enabled) return;
      this.touch.active = true;
      for (const touch of event.changedTouches ?? [event]) this.beginTouch(touch, event.target === canvas);
      event.preventDefault?.();
    };
    canvas.addEventListener('touchstart', start, { passive: false });
    document.querySelectorAll('[data-touch-action]').forEach(button => {
      const action = button.dataset.touchAction;
      button.addEventListener('touchstart', event => {
        event.preventDefault();
        if (!this.enabled) return;
        this.touch.active = true;
        if (action === 'jump') this.jumpQueued = true;
        if (action === 'mine') { this.mining = true; this.callbacks.onDig?.(); }
        if (action === 'place') { this.placing = true; this.callbacks.onPlace?.(); }
        if (action === 'fly') this.callbacks.toggleFly?.();
        button.classList.add('pressed');
      }, { passive: false });
      ['touchend', 'touchcancel'].forEach(type => button.addEventListener(type, event => {
        event.preventDefault();
        if (action === 'mine') this.mining = false;
        if (action === 'place') this.placing = false;
        button.classList.remove('pressed');
      }, { passive: false }));
    });

    const move = event => {
      for (const touch of event.changedTouches ?? [event]) this.moveTouch(touch);
      event.preventDefault?.();
    };
    canvas.addEventListener('touchmove', move, { passive: false });
    const end = event => {
      for (const touch of event.changedTouches ?? [event]) this.endTouch(touch);
      event.preventDefault?.();
    };
    ['touchend', 'touchcancel'].forEach(type => canvas.addEventListener(type, end, { passive: false }));
  }

  beginTouch(touch, onCanvas) {
    const isJoystickZone = touch.clientX < window.innerWidth * 0.45 && touch.clientY > window.innerHeight * 0.45;
    if (onCanvas && isJoystickZone && this.touch.moveId === null) {
      this.touch.moveId = touch.identifier;
      this.touch.originX = touch.clientX;
      this.touch.originY = touch.clientY;
      this.showJoystick(true, touch.clientX, touch.clientY);
    } else if (this.touch.lookId === null) {
      this.touch.lookId = touch.identifier;
      this.touch.lastX = touch.clientX;
      this.touch.lastY = touch.clientY;
    }
  }

  moveTouch(touch) {
    if (touch.identifier === this.touch.moveId) {
      const dx = touch.clientX - this.touch.originX;
      const dy = touch.clientY - this.touch.originY;
      const radius = this.touch.radius;
      const length = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(1, length / radius);
      this.move.x = (dx / length) * clamped;
      this.move.y = (dy / length) * clamped;
      this.showJoystick(true, this.touch.originX + (dx / length) * clamped * radius, this.touch.originY + (dy / length) * clamped * radius);
    } else if (touch.identifier === this.touch.lookId) {
      this.lookX += (touch.clientX - this.touch.lastX) * 1.6;
      this.lookY += (touch.clientY - this.touch.lastY) * 1.6;
      this.touch.lastX = touch.clientX;
      this.touch.lastY = touch.clientY;
    }
  }

  endTouch(touch) {
    if (touch.identifier === this.touch.moveId) {
      this.touch.moveId = null;
      this.move.x = this.move.y = 0;
      this.showJoystick(false);
    } else if (touch.identifier === this.touch.lookId) {
      this.touch.lookId = null;
    }
  }

  showJoystick(visible, x = 0, y = 0) {
    const stick = document.getElementById('joystick');
    if (!stick) return;
    stick.classList.toggle('visible', visible);
    const knob = document.getElementById('joystick-knob');
    if (knob && visible) knob.style.transform = `translate(${x}px, ${y}px)`;
    if (stick && visible && !this.touch.baseSet) {
      this.touch.baseSet = true;
      stick.style.left = `${this.touch.originX}px`;
      stick.style.top = `${this.touch.originY}px`;
    }
    if (!visible) this.touch.baseSet = false;
  }

  /** Movement intent in the -1..1 range, merged from keys and the thumb-stick. */
  axes() {
    if (!this.enabled) return { forward: 0, right: 0 };
    const keyboardForward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const keyboardStrafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    return {
      forward: Math.max(-1, Math.min(1, keyboardForward - this.move.y)),
      right: Math.max(-1, Math.min(1, keyboardStrafe + this.move.x)),
    };
  }

  takeLook() {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return look;
  }

  takeJump() {
    const jump = this.enabled && (this.jumpQueued || this.keys.has('Space'));
    this.jumpQueued = false;
    return jump;
  }

  /**
   * Sprint is Shift in the air-craft sense, crouch is Ctrl (or C, or a short joystick throw).
   * They were once both bound to Shift, which quietly made sprinting impossible.
   */
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.move.x, this.move.y) > 0.85; }

  get crouch() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'); }

  /** Hold Z to zoom in — useful for scouting a coastline before you commit to a walk. */
  get zoom() { return this.keys.has('KeyZ'); }
}
