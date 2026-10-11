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
uniform float uNight, uTime, uCloud;
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
uniform float uWater, uTime;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDistance;
void main() {
  vec3 world = aPosition + uChunkOffset;
  if (uWater > 0.5) {
    world.y += sin(uTime * 1.4 + world.x * 0.55 + world.z * 0.7) * 0.05
             + sin(uTime * 1.9 + world.z * 0.9 - world.x * 0.4) * 0.03 - 0.04;
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
    this.planeBuffer = this.createBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.lineBuffer = this.createBuffer(cubeEdges());

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
    }
    const mesh = buildChunkMesh(world, chunkX, chunkZ);
    this.meshes.set(key, {
      chunkX, chunkZ,
      opaque: uploadMesh(this.gl, mesh.opaque, this.indexSize),
      water: uploadMesh(this.gl, mesh.water, this.indexSize),
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

  render({ world, player, time, clock, target, fov }) {
    const gl = this.gl;
    this.resize();
    const palette = skyPalette(clock);
    const eye = [player.x, player.eyeY, player.z];
    const aspect = this.canvas.width / this.canvas.height;

    perspective(this.projection, fov, aspect, 0.08, 320);
    view(this.viewMatrix, eye, player.yaw, player.pitch);
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

    this.drawSky(palette, eye, aspect, fov, time, forward, right, up);
    this.drawChunks(world, palette, eye, time);
    if (target) this.drawHighlight(target);
  }

  drawSky(palette, eye, aspect, fov, time, forward, right, up) {
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
    gl.uniform1f(program.uniforms.uCloud, 1);
    gl.uniform1f(program.uniforms.uTime, time);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.planeBuffer);
    gl.enableVertexAttribArray(program.attributes.aPosition);
    gl.vertexAttribPointer(program.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  drawChunks(world, palette, eye, time) {
    const gl = this.gl, program = this.terrainProgram;
    extractPlanes(this.viewProjection, this.planes);
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uViewProjection, false, this.viewProjection);
    gl.uniform3fv(program.uniforms.uCamera, eye);
    gl.uniform3fv(program.uniforms.uFogColor, palette.fog);
    gl.uniform3fv(program.uniforms.uSunDirection, palette.sunDirection);
    gl.uniform1f(program.uniforms.uFogNear, 46);
    gl.uniform1f(program.uniforms.uFogFar, 104);
    gl.uniform1f(program.uniforms.uTime, time);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1f(program.uniforms.uWater, 0);
    gl.uniform1f(program.uniforms.uAlpha, 1);
    for (const mesh of this.meshes.values()) {
      if (!mesh.opaque) continue;
      if (!boxVisible(this.planes, mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK,
        mesh.chunkX * CHUNK + CHUNK, WORLD_Y, mesh.chunkZ * CHUNK + CHUNK)) continue;
      drawMesh(gl, program, mesh.opaque, [mesh.chunkX * CHUNK, 0, mesh.chunkZ * CHUNK]);
    }

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

function cubeEdges() {
  const c = [-0.5, 0.5];
  const edges = [];
  for (const y of c) for (const z of c) edges.push(-0.5, y, z, 0.5, y, z);
  for (const x of c) for (const z of c) edges.push(x, -0.5, z, x, 0.5, z);
  for (const x of c) for (const y of c) edges.push(x, y, -0.5, x, y, 0.5);
  return new Float32Array(edges);
}
