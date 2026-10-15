/**
 * WebGL renderer: procedural sky with sun, clouds and stars, ambient-occluded terrain chunks,
 * animated translucent water, and the wireframe highlight around the aimed block.
 */

import { CHUNK, CHUNKS_X, CHUNKS_Z, WORLD_Y } from './constants.js';
import { buildChunkMesh } from './mesher.js';
import { boxVisible, createProgram, deleteMesh, drawMesh, extractPlanes, multiply, perspective, translation, uploadMesh, view } from './gl.js';

const SKY_VERTEX = `
attribute vec2 aPosition;
uniform vec3 uForward, uRight, uUp;
uniform float uTanHalfFov, uAspect;
varying vec3 vDirection;
void main() {
  vDirection = uForward + uRight * (aPosition.x * uTanHalfFov * uAspect) + uUp * (aPosition.y * uTanHalfFov);
  gl_Position = vec4(aPosition, 1.0, 1.0);
}`;

const SKY_FRAGMENT = `
precision highp float;
varying vec3 vDirection;
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDirection, uCamera;
uniform float uNight, uTime, uCloud, uStorm;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 direction = normalize(vDirection);
  float height = clamp(direction.y, -1.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(clamp(height, 0.0, 1.0), 0.55));
  color = mix(uGround, color, smoothstep(-0.06, 0.05, height));
  // Weather greys the sky out and thickens the clouds.
  color = mix(color, vec3(dot(color, vec3(0.33))) * 0.72, uStorm * 0.75);
  float sun = max(dot(direction, uSunDirection), 0.0);
  color += uSunColor * pow(sun, 260.0) * 1.7;
  color += uSunColor * pow(sun, 9.0) * 0.22;
  if (direction.y > 0.015 && uCloud > 0.01) {
    float plane = 132.0;
    vec2 point = uCamera.xz + direction.xz * (plane - uCamera.y) / max(direction.y, 0.02);
    vec2 uv = point * 0.0055 + vec2(uTime * 0.004, uTime * 0.0016);
    float n = valueNoise(uv * 2.0) * 0.55 + valueNoise(uv * 4.7) * 0.3 + valueNoise(uv * 12.0) * 0.15;
    float clouds = smoothstep(0.5, 0.78, n) * smoothstep(0.015, 0.16, direction.y);
    vec3 tint = mix(vec3(1.0, 0.99, 0.96), uSunColor, 0.3) * (0.95 - 0.45 * uNight);
    color = mix(color, tint, clouds * uCloud * 0.9);
  }
  if (uNight > 0.03 && direction.y > 0.02) {
    vec2 cell = floor(direction.xz / max(direction.y, 0.18) * 110.0);
    float star = hash21(cell);
    float twinkle = 0.6 + 0.4 * hash21(cell + floor(uTime * 1.5));
    color += vec3(0.95, 0.96, 1.0) * step(0.9972, star) * uNight * twinkle * smoothstep(0.02, 0.3, direction.y);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const TERRAIN_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uViewProjection;
uniform vec3 uChunkOffset, uCamera;
uniform float uWater, uTime, uWaving;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDistance;
void main() {
  vec3 world = aPosition + uChunkOffset;
  if (uWater > 0.5) {
    // Water: two offset waves and a half-block drop so the surface reads as liquid.
    world.y += sin(uTime * 1.4 + world.x * 0.55 + world.z * 0.7) * 0.05
             + sin(uTime * 1.9 + world.z * 0.9 - world.x * 0.4) * 0.03 - 0.04;
  } else if (uWaving > 0.5) {
    // Plants: crossed quads whose vertices all carry an up-facing normal, so they sway together.
    float phase = uTime * 1.6 + world.x * 0.7 + world.z * 0.5;
    world.x += sin(phase) * 0.055;
    world.z += cos(phase * 0.8) * 0.04;
    world.y += sin(phase * 1.7) * 0.012;
  }
  gl_Position = uViewProjection * vec4(world, 1.0);
  vColor = aColor;
  vNormal = aNormal;
  vWorld = world;
  vDistance = distance(world, uCamera);
}`;

const TERRAIN_FRAGMENT = `
precision highp float;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDistance;
uniform vec3 uFogColor, uSunDirection;
uniform float uFogNear, uFogFar, uAlpha;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = abs(vNormal.y) > 0.5 ? vWorld.xz : abs(vNormal.x) > 0.5 ? vWorld.zy : vWorld.xy;
  vec2 scaled = uv * 6.0;
  float grain = hash21(floor(scaled) + vNormal.xy * 17.0);
  vec3 color = vColor * (0.93 + 0.14 * grain);
  vec2 cell = fract(scaled);
  float edge = smoothstep(0.0, 0.05, min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y)));
  color *= mix(0.91, 1.0, edge);
  color *= 0.87 + 0.13 * max(dot(vNormal, uSunDirection), 0.0);
  float fog = smoothstep(uFogNear, uFogFar, vDistance);
  color = mix(color, uFogColor, fog);
  gl_FragColor = vec4(color, uAlpha);
}`;

const HAND_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform float uSwing;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vNormal = aNormal;
  vLocal = aPosition;
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}
`;

const HAND_FRAGMENT = `
precision mediump float;
uniform vec3 uColor, uLight;
uniform float uBright, uUnderwater;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  // Cheap directional shading so the held cube reads as a block, not a flat sticker.
  float top = max(vNormal.y, 0.0);
  float side = abs(vNormal.x) * 0.72 + abs(vNormal.z) * 0.86;
  float light = mix(0.42, 1.0, max(top, side));
  vec3 color = uColor * light * uBright * mix(vec3(1.0), uLight, 0.35);
  gl_FragColor = vec4(color, 1.0);
}
`;

const PARTICLE_VERTEX = `
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uViewProjection;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

const PARTICLE_FRAGMENT = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }
`;

/** Full-screen overlay for underwater tint, weather and damage flashes. */
const TINT_VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const TINT_FRAGMENT = `
precision mediump float;
uniform vec4 uTint;
uniform float uMode, uTime, uAmount, uRatio;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (uMode < 0.5) {
    gl_FragColor = uTint;                       // plain coloured wash (underwater, damage)
    return;
  }
  // Rain (uMode 1) or snow (uMode 2): streaks and flakes that fall across the screen.
  float alpha = 0.0;
  if (uMode < 1.5) {
    vec2 p = vec2(vUv.x * 60.0 + vUv.y * 14.0, vUv.y * 26.0 - uTime * 2.6);
    float streak = step(0.965, hash(floor(p)));  // sparse columns of drops
    alpha = streak * uAmount * 0.45;
  } else {
    vec2 p = vec2(vUv.x * 42.0, vUv.y * 22.0 - uTime * 0.7);
    vec2 cell = floor(p);
    float flake = step(0.93, hash(cell));
    vec2 offset = vec2(hash(cell + 3.1), fract(-uTime * 0.18 + hash(cell + 7.7))) * 0.5;
    float near = 1.0 - smoothstep(0.0, 0.35, distance(fract(p) - 0.5, offset - 0.25));
    alpha = flake * near * uAmount * 0.85;
  }
  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}
`;

const LINE_VERTEX = `
attribute vec3 aPosition;
uniform mat4 uViewProjection;
uniform mat4 uModel;
void main() { gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0); }`;

const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;

const SKY_TOP = [0.23, 0.49, 0.85];
const SKY_HORIZON = [0.73, 0.85, 0.95];
const SKY_GROUND = [0.66, 0.74, 0.72];
const SUN_DAY = [1.0, 0.95, 0.84];
const NIGHT_TOP = [0.04, 0.07, 0.2];
const NIGHT_HORIZON = [0.11, 0.16, 0.3];
const DUSK_HORIZON = [0.98, 0.62, 0.38];
const DUSK_TOP = [0.25, 0.33, 0.6];
const STAR_SUN = [0.8, 0.85, 1.0];

function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
function smoothstep(edge0, edge1, x) { const t = clamp01((x - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); }

/** Sun height for a 0..1 day clock: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
export function sunHeight(clock) { return Math.sin((clock - 0.25) * Math.PI * 2); }

export function skyPalette(clock) {
  const height = sunHeight(clock);
  const day = clamp01((height + 0.08) / 0.5);
  const dusk = clamp01(1 - Math.abs(height) / 0.32);
  let zenith = mix3(NIGHT_TOP, SKY_TOP, day);
  let horizon = mix3(NIGHT_HORIZON, SKY_HORIZON, day);
  zenith = mix3(zenith, DUSK_TOP, dusk * 0.55);
  horizon = mix3(horizon, DUSK_HORIZON, dusk * 0.8);
  let sunColor = mix3(STAR_SUN, SUN_DAY, day);
  sunColor = mix3(sunColor, DUSK_HORIZON, dusk * 0.6);
  const ground = mix3([0.06, 0.09, 0.14], SKY_GROUND, day);
  const sunAngle = (clock - 0.25) * Math.PI * 2;
  const sunDirection = [Math.cos(sunAngle), Math.sin(sunAngle), 0.32];
  const length = Math.hypot(sunDirection[0], sunDirection[1], sunDirection[2]);
  return {
    zenith, horizon, ground, sunColor,
    sunDirection: [sunDirection[0] / length, sunDirection[1] / length, sunDirection[2] / length],
    night: 1 - day,
    fog: mix3(horizon, zenith, 0.25),
  };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' })
      || canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('This browser could not start WebGL. Try a newer browser or enable hardware acceleration.');
    this.gl = gl;
    this.canvas = canvas;
    this.indexSize = gl.getExtension('OES_element_index_uint') ? 4 : 2;

    this.skyProgram = createProgram(gl, SKY_VERTEX, SKY_FRAGMENT);
    this.terrainProgram = createProgram(gl, TERRAIN_VERTEX, TERRAIN_FRAGMENT);
    this.lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.handProgram = createProgram(gl, HAND_VERTEX, HAND_FRAGMENT);
    this.particleProgram = createProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT);
    this.tintProgram = createProgram(gl, TINT_VERTEX, TINT_FRAGMENT);
    this.planeBuffer = this.createBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.lineBuffer = this.createBuffer(cubeEdges());
    this.cubeBuffer = this.createBuffer(cubeTriangles());
    this.cubeIndexCount = 36;
    // One cube's worth of vertices, re-uploaded every frame for the particles and the held block.
    this.handVertices = new Float32Array(cubeTrianglesVertices());
    this.handBuffer = this.createBuffer(this.handVertices);
    this.heldModel = new Float32Array(16);
    this.particleBuffer = gl.createBuffer();
    this.particleData = new Float32Array(0);
    this.stats = { draws: 0, chunks: 0, meshed: 0, vertices: 0 };

    this.meshes = new Map();
    this.pending = [];
    this.projection = new Float32Array(16);
    this.viewMatrix = new Float32Array(16);
    this.viewProjection = new Float32Array(16);
    this.model = new Float32Array(16);
    this.planes = new Float32Array(24);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.6, 0.75, 0.9, 1);
  }

  createBuffer(data) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  resize() {
    const gl = this.gl;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(240, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Queue every chunk in the world for meshing. */
  requestAllChunks() {
    this.pending = [];
    for (let chunkZ = 0; chunkZ < CHUNKS_Z; chunkZ++) {
      for (let chunkX = 0; chunkX < CHUNKS_X; chunkX++) this.pending.push([chunkX, chunkZ]);
    }
    return this.pending.length;
  }

  queueChunk(chunkX, chunkZ) {
    if (chunkX < 0 || chunkZ < 0 || chunkX >= CHUNKS_X || chunkZ >= CHUNKS_Z) return;
    if (!this.pending.some(([x, z]) => x === chunkX && z === chunkZ)) this.pending.push([chunkX, chunkZ]);
  }

  /** Builds a few chunks per frame so the page never freezes. Returns true while work remains. */
  buildPending(world, budget = 3) {
    for (let built = 0; built < budget && this.pending.length; built++) {
      const [chunkX, chunkZ] = this.pending.shift();
      this.rebuildChunk(world, chunkX, chunkZ);
    }
    return this.pending.length > 0;
  }

  rebuildChunk(world, chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    const existing = this.meshes.get(key);
    if (existing) {
      deleteMesh(this.gl, existing.opaque);
      deleteMesh(this.gl, existing.water);
      deleteMesh(this.gl, existing.plants);
    }
    const mesh = buildChunkMesh(world, chunkX, chunkZ);
    this.meshes.set(key, {
      chunkX, chunkZ,
      opaque: uploadMesh(this.gl, mesh.opaque, this.indexSize),
      water: uploadMesh(this.gl, mesh.water, this.indexSize),
      plants: uploadMesh(this.gl, mesh.plants, this.indexSize),
    });
  }

  /** Rebuilds every chunk touching a block that just changed. */
  invalidate(world, x, z) {
    const chunkX = Math.floor(x / CHUNK), chunkZ = Math.floor(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = chunkX + dx, cz = chunkZ + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
        this.queueChunk(cx, cz);
      }
    }
  }

  /**
   * Draw one frame.
   *
   * @param {object} frame
   * @param {number} [frame.mineProgress] 0..1 progress of the block being mined (drives the cracks)
   * @param {object} [frame.held]        the block in hand, e.g. { block, swing, bright }
   * @param {object} [frame.weather]     { intensity, snow, storm }
   * @param {number} [frame.submerged]   1 when the camera is inside water
   * @param {number} [frame.flash]       red damage flash, 0..1
   * @param {Array}  [frame.particles]   particle quads from the particle pool
   */
  render({ world, player, time, clock, target, fov, mineProgress = 0, held = null, weather = null,
           submerged = 0, flash = 0, particles = null, viewDistance = null }) {
    const gl = this.gl;
    this.resize();
    const palette = skyPalette(clock);
    const eye = [player.x, player.eyeY + (player.eyeOffset ?? 0), player.z];
    const aspect = this.canvas.width / this.canvas.height;

    perspective(this.projection, fov, aspect, 0.08, 320);
    view(this.viewMatrix, eye, player.yaw, player.pitch, player.cameraRoll ?? 0);
    multiply(this.viewProjection, this.projection, this.viewMatrix);

    gl.clearColor(palette.fog[0], palette.fog[1], palette.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cosPitch = Math.cos(player.pitch);
    const forward = [-Math.sin(player.yaw) * cosPitch, Math.sin(player.pitch), -Math.cos(player.yaw) * cosPitch];
    const right = [Math.cos(player.yaw), 0, -Math.sin(player.yaw)];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];

    this.stats.draws = 0;
    this.stats.chunks = 0;

    this.drawSky(palette, eye, aspect, fov, time, forward, right, up, weather);
    this.drawChunks(world, palette, eye, time, submerged, viewDistance);
    if (particles && particles.length) this.drawParticles(particles);
    if (target) {
      this.drawHighlight(target);
      if (mineProgress > 0.01) this.drawCracks(target, mineProgress);
    }
    if (held) this.drawHeld(held.block, time, held.swing ?? 0, held.bright ?? 1, palette);
    if (submerged) this.drawTint([0.09, 0.32, 0.52, 0.34 * submerged], 0);
    if (flash > 0.01) this.drawTint([0.75, 0.12, 0.12, Math.min(0.55, flash) * 0.6], 0);
    if (weather && weather.intensity > 0.02) {
      this.drawTint([0, 0, 0, 0], weather.snow ? 2 : 1, weather.intensity, time);
    }
    // Lightning: a short white wash over the whole frame.
    if (weather && weather.flash > 0.01) {
      this.drawTint([0.86, 0.9, 1, Math.min(0.5, weather.flash) * 0.42], 0);
    }
    return this.stats;
  }

  /** Full-screen translucent wash, rain or snow, depending on the mode. */
  drawTint(tint, mode = 0, amount = 1, time = 0) {
    const gl = this.gl, program = this.tintProgram;
    gl.useProgram(program.program);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4fv(program.uniforms.uTint, tint);
    gl.uniform1f(program.uniforms.uMode, mode);
    gl.uniform1f(program.uniforms.uAmount, amount);
    gl.uniform1f(program.uniforms.uTime, time);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.draws++;
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  /** A dark, growing shell over the block being mined — the crack overlay. */
  drawCracks(target, progress) {
    const gl = this.gl, program = this.lineProgram;
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    translation(this.model, target.x + 0.5, target.y + 0.5, target.z + 0.5);
    const scale = 1.0 + 0.006 + progress * 0.02;
    this.model[0] *= scale; this.model[5] *= scale; this.model[10] *= scale;
    gl.uniformMatrix4fv(program.uniforms.uModel, false, this.model);
    const alpha = 0.12 + progress * 0.42;
    gl.uniform4f(program.uniforms.uColor, 0.03, 0.03, 0.05, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, this.cubeIndexCount);
    this.stats.draws++;
    gl.disable(gl.BLEND);
  }

  /** Break, place and splash particles, drawn as camera-facing quads with per-particle colour. */
  drawParticles(particles) {
    const gl = this.gl, program = this.particleProgram;
    const needed = particles.length * 4 * 6;
    if (this.particleData.length < needed) this.particleData = new Float32Array(needed);
    const data = this.particleData;
    let offset = 0;
    const right = [this.viewMatrix[0], this.viewMatrix[4], this.viewMatrix[8]];
    const up = [this.viewMatrix[1], this.viewMatrix[5], this.viewMatrix[9]];
    for (const particle of particles) {
      const size = particle.size ?? 0.07;
      const rx = right[0] * size, ry = right[1] * size, rz = right[2] * size;
      const ux = up[0] * size, uy = up[1] * size, uz = up[2] * size;
      const { x, y, z, r, g, b, a = 1 } = particle;
      const corners = [
        [x - rx - ux, y - ry - uy, z - rz - uz],
        [x + rx - ux, y + ry - uy, z + rz - uz],
        [x + rx + ux, y + ry + uy, z + rz + uz],
        [x - rx + ux, y - ry + uy, z - rz + uz],
      ];
      const order = [0, 1, 2, 0, 2, 3];
      for (const index of order) {
        data[offset++] = corners[index][0];
        data[offset++] = corners[index][1];
        data[offset++] = corners[index][2];
        data[offset++] = r;
        data[offset++] = g;
        data[offset++] = b;
        data[offset++] = a;
      }
    }
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, offset), gl.DYNAMIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(program.attributes.aColor);
    gl.vertexAttribPointer(program.attributes.aColor, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, particles.length * 6);
    this.stats.draws++;
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** The block in the player's hand: a small cube in the lower right, with a swing animation. */
  drawHeld(block, time, swing, bright, palette) {
    const gl = this.gl, program = this.handProgram;
    gl.useProgram(program.program);
    gl.clear(gl.DEPTH_BUFFER_BIT);            // the hand never clips into the world
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    gl.uniform3fv(program.uniforms.uColor, block.top);
    gl.uniform3fv(program.uniforms.uLight, palette?.sunColor ?? [1, 1, 1]);
    gl.uniform1f(program.uniforms.uBright, bright);
    gl.uniform1f(program.uniforms.uUnderwater, 0);
    // A cube held a little to the right and below the eye, tipping as it swings.
    const swingAngle = Math.sin(swing * Math.PI) * 0.9;
    const bob = Math.sin(time * 1.6) * 0.012;
    buildHeldModel(this.heldModel, swingAngle, bob);
    gl.uniformMatrix4fv(program.uniforms.uModel, false, this.heldModel);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.handBuffer);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(program.attributes.aNormal);
    gl.vertexAttribPointer(program.attributes.aNormal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    this.stats.draws++;
    gl.enable(gl.CULL_FACE);
  }

  drawSky(palette, eye, aspect, fov, time, forward, right, up, weather = null) {
    const gl = this.gl, program = this.skyProgram;
    gl.useProgram(program.program);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.uniform3fv(program.uniforms.uForward, forward);
    gl.uniform3fv(program.uniforms.uRight, right);
    gl.uniform3fv(program.uniforms.uUp, up);
    gl.uniform1f(program.uniforms.uTanHalfFov, Math.tan(fov / 2));
    gl.uniform1f(program.uniforms.uAspect, aspect);
    gl.uniform3fv(program.uniforms.uZenith, palette.zenith);
    gl.uniform3fv(program.uniforms.uHorizon, palette.horizon);
    gl.uniform3fv(program.uniforms.uGround, palette.ground);
    gl.uniform3fv(program.uniforms.uSunColor, palette.sunColor);
    gl.uniform3fv(program.uniforms.uSunDirection, palette.sunDirection);
    gl.uniform3fv(program.uniforms.uCamera, eye);
    gl.uniform1f(program.uniforms.uNight, palette.night);
    gl.uniform1f(program.uniforms.uCloud, weather ? 1 + weather.intensity * 2 : 1);
    gl.uniform1f(program.uniforms.uStorm, weather ? Math.min(1, weather.intensity * (weather.storm ? 1.4 : 0.8)) : 0);
    gl.uniform1f(program.uniforms.uTime, time);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  drawChunks(world, palette, eye, time, submerged = 0, viewDistance = null) {
    const gl = this.gl, program = this.terrainProgram;
    // Underwater the fog closes right in, which is what sells being submerged; on land the fog far
    // plane is the player's view distance, so the setting really changes how far you can see.
    this.fogNear = submerged ? 2 : Math.min(46, (viewDistance ?? 104) * 0.44);
    this.fogFar = submerged ? 26 : (viewDistance ?? 104);
    extractPlanes(this.viewProjection, this.planes);
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    gl.uniform3fv(program.uniforms.uCamera, eye);
    gl.uniform3fv(program.uniforms.uFogColor, submerged ? [0.07, 0.26, 0.45] : palette.fog);
    gl.uniform3fv(program.uniforms.uSunDirection, palette.sunDirection);
    gl.uniform1f(program.uniforms.uFogNear, this.fogNear);
    gl.uniform1f(program.uniforms.uFogFar, this.fogFar);
    gl.uniform1f(program.uniforms.uTime, time);
    gl.uniform1f(program.uniforms.uWaving, 0);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1f(program.uniforms.uWater, 0);
    gl.uniform1f(program.uniforms.uAlpha, 1);
    for (const mesh of this.meshes.values()) {
      if (!mesh.opaque) continue;
      if (!boxVisible(this.planes, mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK,
        mesh.chunkX * CHUNK + CHUNK, WORLD_Y, mesh.chunkZ * CHUNK + CHUNK)) continue;
      drawMesh(gl, program, mesh.opaque, [mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK]);
      this.stats.draws++;
      this.stats.chunks++;
    }

    // Plants share the opaque pass; they are double-sided quads so culling can stay on, and they
    // sway in the wind instead of standing rigid.
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(program.uniforms.uWaving, 1);
    for (const mesh of this.meshes.values()) {
      if (!mesh.plants) continue;
      if (!boxVisible(this.planes, mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK,
        mesh.chunkX * CHUNK + CHUNK, WORLD_Y, mesh.chunkZ * CHUNK + CHUNK)) continue;
      drawMesh(gl, program, mesh.plants, [mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK]);
      this.stats.draws++;
    }
    gl.enable(gl.CULL_FACE);
    gl.uniform1f(program.uniforms.uWaving, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(program.uniforms.uWater, 1);
    gl.uniform1f(program.uniforms.uAlpha, 0.74);
    for (const mesh of this.meshes.values()) {
      if (!mesh.water) continue;
      if (!boxVisible(this.planes, mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK,
        mesh.chunkX * CHUNK + CHUNK, WORLD_Y, mesh.chunkZ * CHUNK + CHUNK)) continue;
      drawMesh(gl, program, mesh.water, [mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK]);
      this.stats.draws++;
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  drawHighlight(target) {
    const gl = this.gl, program = this.lineProgram;
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    translation(this.model, target.x + 0.5, target.y + 0.5, target.z + 0.5);
    const scale = 1.004;
    this.model[0] *= scale; this.model[5] *= scale; this.model[10] *= scale;
    gl.uniformMatrix4fv(program.uniforms.uModel, false, this.model);
    gl.uniform4f(program.uniforms.uColor, 0.06, 0.07, 0.09, 0.85);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);
  }
}

/** A unit cube as 36 triangle vertices, in the same [-0.5, 0.5] space as the highlight lines. */
function cubeTriangles() {
  const faces = [
    [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
    [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
    [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
    [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
    [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
    [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
  ];
  const positions = [];
  for (const face of faces) {
    for (const index of [0, 1, 2, 0, 2, 3]) positions.push(...face[index]);
  }
  return new Float32Array(positions);
}

/** The same cube with per-face normals, for the lit held-block shader. */
function cubeTrianglesVertices() {
  const source = cubeTriangles();
  const normals = [];
  const faces = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  ];
  const out = [];
  for (let face = 0; face < 6; face++) {
    for (let vertex = 0; vertex < 6; vertex++) {
      const index = (face * 6 + vertex) * 3;
      out.push(source[index], source[index + 1], source[index + 2], ...faces[face]);
    }
  }
  return out;
}

/** Place the held cube in view space: offset to the right, tilted by the swing, with a gentle bob. */
function buildHeldModel(out, swingAngle, bob) {
  const cos = Math.cos(swingAngle), sin = Math.sin(swingAngle);
  const tilt = 0.35 - swingAngle * 0.35;
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  const x = 0.62, y = -0.46 + bob - Math.sin(swingAngle) * 0.08, z = -0.95;
  // Rotation about Z (tilt) then Y (swing), then translate into view space, scaled down.
  const scale = 0.34;
  out[0] = cosT * cos * scale;  out[1] = sinT * scale;         out[2] = cosT * sin * scale;  out[3] = 0;
  out[4] = -sinT * cos;         out[5] = cosT * scale;         out[6] = -sinT * sin;         out[7] = 0;
  out[8] = -sin * scale;        out[9] = 0;                    out[10] = cos * scale;        out[11] = 0;
  out[12] = x;                  out[13] = y;                   out[14] = z;                  out[15] = 1;
  return out;
}

function cubeEdges() {
  const c = [-0.5, 0.5];
  const edges = [];
  for (const y of c) for (const z of c) edges.push(-0.5, y, z, 0.5, y, z);
  for (const x of c) for (const z of c) edges.push(x, -0.5, z, x, 0.5, z);
  for (const x of c) for (const y of c) edges.push(x, y, -0.5, x, y, 0.5);
  return new Float32Array(edges);
}
