/**
 * The explorer: physics and looks, split so either half can be tested alone.
 *
 * `PlayerModel` is pure maths — an axis-aligned box that walks, jumps and collides with the voxel
 * world (swept per axis, with sub-stepping so fast falls cannot tunnel through the ground).
 *
 * `PlayerVisual` (three.js) dresses the model in the pixel-art sprite sheet: billboarded quads for
 * head, body, arms and legs, with a walk cycle, sprint lean, jump pose and a mining swing.
 */

import { IS_PLANT, IS_SOLID, WORLD_HEIGHT } from './constants.js';
import { CHARACTER, WALK_FRAMES, createCharacterCanvas, frameUV } from './sprites.js';

const EPSILON = 0.0005;

export class PlayerModel {
  static WIDTH = 0.6;
  static HEIGHT = 1.7;
  static EYE_HEIGHT = 1.55;
  static WALK_SPEED = 4.6;
  static SPRINT_SPEED = 6.4;
  static FLY_SPEED = 11;
  static GRAVITY = 30;
  static JUMP_SPEED = 9.1;
  static TERMINAL_VELOCITY = 52;

  constructor(world, spawn = { x: 0.5, y: 60, z: 0.5 }) {
    this.world = world;
    this.width = PlayerModel.WIDTH;
    this.height = PlayerModel.HEIGHT;
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.inWater = false;
    this.flying = false;
    this.sprinting = false;
    this.yaw = 0;
    this.pitch = 0;
    this.walkPhase = 0;
    this.walkSpeed = 0;
    this.swinging = 0;
    this.lastWalkDirection = { x: 0, z: 0 };
  }

  get eyeY() { return this.position.y + PlayerModel.EYE_HEIGHT; }

  eye() { return { x: this.position.x, y: this.eyeY, z: this.position.z }; }

  /** Returns the block ids outlining the player box, used when placing blocks. */
  overlappingBlocks() {
    const minX = Math.floor(this.position.x - this.width / 2);
    const maxX = Math.floor(this.position.x + this.width / 2);
    const minY = Math.floor(this.position.y);
    const maxY = Math.floor(this.position.y + this.height);
    const minZ = Math.floor(this.position.z - this.width / 2);
    const maxZ = Math.floor(this.position.z + this.width / 2);
    const blocks = [];
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.overlapsBlock(x, y, z)) blocks.push({ x, y, z });
        }
      }
    }
    return blocks;
  }

  overlapsBlock(x, y, z) {
    const half = this.width / 2;
    return this.position.x - half < x + 1 && this.position.x + half > x
      && this.position.z - half < z + 1 && this.position.z + half > z
      && this.position.y < y + 1 && this.position.y + this.height > y;
  }

  isSolidAt(x, y, z) {
    const block = this.world.getBlock(x, y, z);
    if (!IS_SOLID[block]) return false;
    // Plants are decorative: you walk straight through them.
    return !IS_PLANT[block];
  }

  /** Look direction as a unit vector. */
  direction() {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  look(deltaYaw, deltaPitch, limit = Math.PI / 2 - 0.001) {
    this.yaw -= deltaYaw;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch - deltaPitch));
  }

  toggleFly(creative) {
    if (!creative) return false;
    this.flying = !this.flying;
    if (this.flying) this.velocity.y = 0;
    return this.flying;
  }

  jump() {
    if (this.inWater) { this.velocity.y = 3.4; return true; }
    if (!this.onGround) return false;
    this.velocity.y = PlayerModel.JUMP_SPEED;
    this.onGround = false;
    return true;
  }

  /**
   * Advance the player.
   * `input` carries the movement axes: forward/back/left/right in [-1, 1], jump, sneak, sprint.
   */
  update(dt, input) {
    const half = this.width / 2;
    const feetBlock = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.2), Math.floor(this.position.z));
    const headBlock = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 1.2), Math.floor(this.position.z));
    this.inWater = feetBlock === 10 || headBlock === 10;

    const speed = this.flying ? PlayerModel.FLY_SPEED : this.inWater ? PlayerModel.WALK_SPEED * 0.65
      : input.sprint ? PlayerModel.SPRINT_SPEED : PlayerModel.WALK_SPEED;
    const wish = this.wishDirection(input);
    const target = { x: wish.x * speed, z: wish.z * speed };

    const acceleration = this.onGround || this.flying ? 16 : 6;
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, acceleration * dt);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, acceleration * dt);

    if (this.flying) {
      const vertical = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.velocity.y += (vertical * PlayerModel.FLY_SPEED - this.velocity.y) * Math.min(1, 12 * dt);
      this.onGround = false;
    } else if (this.inWater) {
      this.velocity.y += (input.jump ? 2.6 : -1.4 - this.velocity.y * 0.35) * dt * 6;
      this.velocity.y = Math.max(-6, Math.min(4.5, this.velocity.y));
    } else {
      this.velocity.y = Math.max(-PlayerModel.TERMINAL_VELOCITY, this.velocity.y - PlayerModel.GRAVITY * dt);
    }

    this.moveAxis('x', this.velocity.x * dt, half, 'x');
    this.moveAxis('z', this.velocity.z * dt, half, 'z');
    this.moveAxis('y', this.velocity.y * dt, half, 'y');

    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkSpeed = horizontal;
    if (horizontal > 0.4) {
      this.lastWalkDirection = { x: this.velocity.x / horizontal, z: this.velocity.z / horizontal };
    }
    this.walkPhase += horizontal * dt * 2.1;
    if (this.swinging > 0) this.swinging = Math.max(0, this.swinging - dt * 3.4);

    if (this.position.y < -8) this.respawn();
  }

  /** Movement input turned into a world-space direction, relative to where the player looks. */
  wishDirection(input) {
    const forward = input.forward - input.back;
    const strafe = input.right - input.left;
    if (!forward && !strafe) return { x: 0, z: 0 };
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let x = -sin * forward + cos * strafe;
    let z = -cos * forward - sin * strafe;
    const length = Math.hypot(x, z) || 1;
    return { x: x / length, z: z / length };
  }

  /**
   * Move along one axis and resolve collisions per axis, in small steps so a long fall cannot pass
   * through a one-block floor.
   */
  moveAxis(axis, amount, half, kind) {
    if (amount === 0) return;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.4));
    const step = amount / steps;
    for (let i = 0; i < steps; i++) {
      this.position[axis] += step;
      if (this.collides(half, kind)) {
        this.position[axis] -= step;
        if (kind === 'y') {
          if (step < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity[axis] = 0;
        }
        return;
      }
    }
    if (kind === 'y' && step < 0) this.onGround = false;
  }

  collides(half, kind) {
    const minX = Math.floor(this.position.x - half + EPSILON);
    const maxX = Math.floor(this.position.x + half - EPSILON);
    const minY = Math.floor(this.position.y + EPSILON);
    const maxY = Math.floor(this.position.y + this.height - EPSILON);
    const minZ = Math.floor(this.position.z - half + EPSILON);
    const maxZ = Math.floor(this.position.z + half - EPSILON);
    if (this.position.y < -4) return false;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.isSolidAt(x, y, z)) return true;
        }
      }
    }
    void kind;
    return false;
  }

  respawn() {
    const spawn = this.world.findSpawn(Math.floor(this.position.x), Math.floor(this.position.z));
    this.position = { x: spawn.x, y: spawn.y + 0.2, z: spawn.z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
  }

  /** Serialisable state for the save file. */
  serialize() {
    return {
      x: round(this.position.x), y: round(this.position.y), z: round(this.position.z),
      yaw: round(this.yaw), pitch: round(this.pitch), flying: this.flying, creative: false,
    };
  }

  restore(state) {
    if (!state) return;
    if (Number.isFinite(state.x)) this.position.x = state.x;
    if (Number.isFinite(state.y)) this.position.y = state.y;
    if (Number.isFinite(state.z)) this.position.z = state.z;
    if (Number.isFinite(state.yaw)) this.yaw = state.yaw;
    if (Number.isFinite(state.pitch)) this.pitch = state.pitch;
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

const round = value => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ visuals */

/**
 * The billboarded sprite character. Each body part is a quad that always faces the camera, with
 * arms and legs pivoting on the screen plane so the walk cycle reads from any angle.
 */
export class PlayerVisual {
  constructor(THREE, camera) {
    this.THREE = THREE;
    this.camera = camera;
    this.scale = CHARACTER.blockHeight / CHARACTER.frameHeight;
    this.group = new THREE.Group();

    const texture = new THREE.CanvasTexture(createCharacterCanvas());
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.texture = texture;

    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    this.material = material;

    const part = (width, height) => {
      const geometry = new THREE.PlaneGeometry(width * this.scale, height * this.scale);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    };

    // Body parts, positioned to match the sprite layout (32x48 frame, feet at the bottom).
    this.head = part(13, 13);
    this.head.position.set(0, 0.5, 0);
    this.body = part(12, 14);
    this.armLeft = part(4, 14);
    this.armRight = part(4, 14);
    this.legLeft = part(6, 16);
    this.legRight = part(6, 16);

    this.armLeftPivot = new THREE.Group();
    this.armRightPivot = new THREE.Group();
    this.legLeftPivot = new THREE.Group();
    this.legRightPivot = new THREE.Group();
    this.armLeft.position.set(0, -7 * this.scale, 0);
    this.armRight.position.set(0, -7 * this.scale, 0);
    this.legLeft.position.set(0, -8 * this.scale, 0);
    this.legRight.position.set(0, -8 * this.scale, 0);
    this.armLeftPivot.add(this.armLeft);
    this.armRightPivot.add(this.armRight);
    this.legLeftPivot.add(this.legLeft);
    this.legRightPivot.add(this.legRight);
    this.armLeftPivot.position.set(-6 * this.scale, 27 * this.scale, 0);
    this.armRightPivot.position.set(6 * this.scale, 27 * this.scale, 0);
    this.legLeftPivot.position.set(-3 * this.scale, 16 * this.scale, 0);
    this.legRightPivot.position.set(3 * this.scale, 16 * this.scale, 0);

    this.torso = new THREE.Group();
    this.torso.add(this.head, this.body, this.armLeftPivot, this.armRightPivot, this.legLeftPivot, this.legRightPivot);
    this.torso.position.y = 16 * this.scale; // hips at 16 sprite pixels above the feet
    this.body.position.set(0, 7.5 * this.scale, 0);
    this.head.position.set(0, 21 * this.scale, 0);

    this.group.add(this.torso);
    this.flipped = false;
    this.setFrame('idleSide');
    this.group.renderOrder = 2;
    material.depthWrite = false;
  }

  /** Swap in a named frame, mirroring it when the player walks the other way. */
  setFrame(name, flip = false) {
    if (this.currentFrame === name && this.flipped === flip) return;
    this.currentFrame = name;
    this.flipped = flip;
    const uv = frameUV(name);
    const flipU = (u0, u1) => (flip ? [u1, u0] : [u0, u1]);
    const [bl, br] = flipU(uv.u0, uv.u1);
    const apply = mesh => {
      const attribute = mesh.geometry.getAttribute('uv');
      // PlaneGeometry UV order: (0,1) (1,1) (0,0) (1,0)
      attribute.setXY(0, bl, uv.v0);
      attribute.setXY(1, br, uv.v0);
      attribute.setXY(2, bl, uv.v1);
      attribute.setXY(3, br, uv.v1);
      attribute.needsUpdate = true;
    };
    for (const mesh of [this.head, this.body, this.armLeft, this.armRight, this.legLeft, this.legRight]) apply(mesh);
  }

  update(model, dt, cameraYaw, mining = false) {
    const THREE = this.THREE;
    this.group.position.set(model.position.x, model.position.y, model.position.z);
    // Face the camera: the sprite is flat, so it is always turned towards the viewer.
    this.group.rotation.y = cameraYaw;

    const walking = model.walkSpeed > 0.5;
    const moving = Math.hypot(model.lastWalkDirection.x, model.lastWalkDirection.z) > 0;
    // Mirror the sprite when the player walks to the camera's left.
    const toCameraRight = moving
      ? model.lastWalkDirection.x * Math.cos(cameraYaw) - model.lastWalkDirection.z * Math.sin(cameraYaw)
      : 0;
    const flip = toCameraRight < -0.05;

    if (mining) this.setFrame('mine', flip);
    else if (!model.onGround && !model.flying) this.setFrame('jump', flip);
    else if (walking) {
      const frame = WALK_FRAMES[Math.floor(model.walkPhase * 2) % WALK_FRAMES.length];
      this.setFrame(frame, flip);
    } else if (model.flying) this.setFrame('jump', flip);
    else this.setFrame('idleSide', flip);

    // Limbs swing in the screen plane, which is where the billboard is facing.
    const swing = walking ? Math.sin(model.walkPhase * Math.PI * 2) * 0.55 : 0;
    const swingAmount = Math.min(1, model.walkSpeed / PlayerModel.WALK_SPEED);
    this.legLeftPivot.rotation.z = swing * swingAmount;
    this.legRightPivot.rotation.z = -swing * swingAmount;
    const mineSwing = mining || model.swinging > 0 ? Math.sin((1 - Math.min(1, model.swinging)) * Math.PI) * 1.5 : 0;
    this.armLeftPivot.rotation.z = -swing * swingAmount * 0.7;
    this.armRightPivot.rotation.z = swing * swingAmount * 0.7 - mineSwing;

    // A gentle bob and lean while running.
    const bob = walking ? Math.abs(Math.sin(model.walkPhase * Math.PI * 2)) * 0.045 * swingAmount : 0;
    this.torso.position.y = 16 * this.scale + bob;
    this.torso.rotation.z = walking ? Math.sin(model.walkPhase * Math.PI * 2) * 0.05 : 0;
    this.group.visible = true;
    void dt;
  }

  /** Hide the sprite in first person, and mark the frame dirty next time it shows. */
  setVisible(visible) {
    this.group.visible = visible;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
    for (const mesh of [this.head, this.body, this.armLeft, this.armRight, this.legLeft, this.legRight]) mesh.geometry.dispose();
  }
}

export { CHARACTER, frameUV, WORLD_HEIGHT };
