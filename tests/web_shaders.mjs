/**
 * Shader lint for the web edition.
 *
 * The headless suites run against a stub WebGL context, so a shader that would fail to compile in a
 * browser passes there silently. This file reads the GLSL straight out of renderer.js and checks the
 * things a driver would: declarations for every uniform and attribute the renderer binds, a
 * precision qualifier in every fragment shader, matching varyings, a written gl_Position and
 * balanced braces.
 *
 *   node tests/web_shaders.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../web/renderer.js', import.meta.url), 'utf8');
const gl = readFileSync(new URL('../web/gl.js', import.meta.url), 'utf8');
const source = renderer;
const javascript = `${renderer}\n${gl}`;

// --- pull every `const NAME = \`...\`;` shader out of the renderer
const shaders = new Map();
for (const match of source.matchAll(/const ([A-Z_]+_(?:VERTEX|FRAGMENT)) = `([\s\S]*?)`;/g)) {
  shaders.set(match[1], match[2]);
}
assert.ok(shaders.size >= 10, `every shader is a named constant (${shaders.size} found)`);

const vertexShaders = [...shaders.entries()].filter(([name]) => name.endsWith('VERTEX'));
const fragmentShaders = [...shaders.entries()].filter(([name]) => name.endsWith('FRAGMENT'));
assert.equal(vertexShaders.length, fragmentShaders.length, 'every program has both a vertex and a fragment shader');

/**
 * Declarations, including the comma-separated kind: `uniform float uMode, uTime, uAmount;` is one
 * statement and three uniforms.
 */
function declarations(text, keyword) {
  const out = [];
  const pattern = new RegExp(`\\b${keyword}\\s+(\\w+)\\s+([^;]+);`, 'g');
  for (const match of text.matchAll(pattern)) {
    for (const part of match[2].split(',')) {
      const id = part.trim().split(/[\s=\[]/)[0];
      if (id) out.push([match[1], id]);
    }
  }
  return out;
}
const blocks = text => declarations(text, 'uniform');
const attributes = text => declarations(text, 'attribute');
const varyings = text => declarations(text, 'varying');

for (const [name, text] of shaders) {
  assert.ok(text.trim().length > 40, `${name} is not empty`);
  const opens = (text.match(/\{/g) ?? []).length;
  const closes = (text.match(/\}/g) ?? []).length;
  assert.equal(opens, closes, `${name} has balanced braces`);
  assert.ok(text.includes('void main()'), `${name} has a main function`);
  assert.ok(!/\t/.test(text), `${name} is indented with spaces only`);

  if (name.endsWith('FRAGMENT')) {
    assert.match(text, /precision\s+(low|medium|high)p\s+float/, `${name} declares float precision`);
  } else {
    assert.match(text, /gl_Position\s*=/, `${name} writes gl_Position`);
    assert.ok(!/precision\s+\w+p\s+float/.test(text.split('\n')[0]), `${name} does not need a precision header`);
  }

  // A declared uniform that nothing binds is usually dead weight; flag it only as information.
  void blocks(text);
}

// --- the direction that catches real bugs: every uniform the JavaScript binds by name must exist in
// some shader, or the driver returns null and the effect silently does nothing.
const declaredUniforms = new Set();
const declaredAttributes = new Set();
for (const [, text] of shaders) {
  for (const [, id] of blocks(text)) declaredUniforms.add(id);
  for (const [, id] of attributes(text)) declaredAttributes.add(id);
}
const boundUniforms = new Set([...javascript.matchAll(/uniforms\.(\w+)/g)].map(m => m[1]));
const boundAttributes = new Set([...javascript.matchAll(/attributes\.(\w+)/g)].map(m => m[1]));
assert.ok(boundUniforms.size >= 15, `the renderer binds plenty of uniforms (${boundUniforms.size})`);
for (const name of boundUniforms) {
  assert.ok(declaredUniforms.has(name), `uniform ${name} is declared in a shader`);
}
for (const name of boundAttributes) {
  assert.ok(declaredAttributes.has(name), `attribute ${name} is declared in a vertex shader`);
}

// --- pair vertex and fragment shaders by their shared prefix
for (const [vertexName, vertexText] of vertexShaders) {
  const prefix = vertexName.replace('_VERTEX', '');
  const fragmentText = shaders.get(`${prefix}_FRAGMENT`);
  assert.ok(fragmentText, `${prefix} has a fragment shader beside it`);

  const vertexVaryings = new Map(varyings(vertexText).map(([type, id]) => [id, type]));
  const fragmentVaryings = new Map(varyings(fragmentText).map(([type, id]) => [id, type]));
  for (const [id, type] of vertexVaryings) {
    assert.ok(fragmentVaryings.has(id), `${prefix}: varying ${id} is declared in the fragment shader too`);
    assert.equal(fragmentVaryings.get(id), type, `${prefix}: varying ${id} keeps its type (${type})`);
  }
  for (const [id] of fragmentVaryings) {
    assert.ok(vertexVaryings.has(id), `${prefix}: varying ${id} also exists in the vertex shader`);
  }

  // Every program needs at least one uniform to be worth drawing with.
  const pairUniforms = new Set([...blocks(vertexText), ...blocks(fragmentText)].map(([, id]) => id));
  assert.ok(pairUniforms.size > 0, `${prefix} declares uniforms`);
}

// --- the terrain shader specifically: the effects the look depends on
const terrainVertex = shaders.get('TERRAIN_VERTEX');
const terrainFragment = shaders.get('TERRAIN_FRAGMENT');
assert.match(terrainVertex, /attribute\s+vec3\s+aPosition/, 'terrain takes positions');
assert.match(terrainVertex, /attribute\s+vec3\s+aNormal/, 'terrain takes normals');
assert.match(terrainVertex, /attribute\s+vec3\s+aColor/, 'terrain takes baked vertex colours');
assert.match(terrainFragment, /uFogNear/, 'terrain fades into the fog');
assert.match(terrainFragment, /uFogFar/, 'the fog has a far plane, so the view distance setting works');
assert.match(terrainFragment, /uFogColor/, 'and a colour that follows the sky');
assert.match(terrainVertex, /uWaving/, 'foliage can wave');
assert.match(terrainVertex, /uTime/, 'and the wave is animated');
assert.match(terrainVertex, /uWater > 0\.5/, 'water gets its own wave shape');
assert.match(terrainVertex, /uWaving > 0\.5/, 'plants sway only when the plant pass asks them to');

// --- water: waves in the vertex stage, fresnel and glitter in the fragment stage
const seaFragment = shaders.get('TERRAIN_FRAGMENT');
assert.match(terrainVertex, /varying\s+float\s+vWater/, 'the water flag crosses to the fragment stage');
assert.match(seaFragment, /varying\s+float\s+vWater/, 'and is read there');
assert.match(terrainVertex, /world\.y\s*\+=\s*sin\(uTime/, 'waves move the water surface over time');
assert.match(seaFragment, /vWater > 0\.5 && vNormal\.y > 0\.5/, 'only the top of the water catches the light');
assert.match(seaFragment, /fresnel/, 'the surface has a fresnel rim');
assert.match(seaFragment, /glitter/, 'and a sun glitter');
assert.match(seaFragment, /crest/, 'and a foam crest');
assert.match(seaFragment, /uniform\s+vec3\s+uFogColor,\s*uSunDirection,\s*uCamera/, 'the fragment stage can see the eye');
assert.match(seaFragment, /uniform[^;]*uTime/, 'and the clock, so the ripples move');

// --- the sky shader keeps the sun, moon and clouds the renderer draws
const skyFragment = shaders.get('SKY_FRAGMENT');
assert.match(skyFragment, /uZenith/, 'the sky has a zenith colour');
assert.match(skyFragment, /uHorizon/, 'and a horizon colour');
assert.match(skyFragment, /uSunDir/, 'the sun and moon are placed from a direction');
assert.match(skyFragment, /uStorm/, 'storms grey the sky out');
assert.match(skyFragment, /cloud/i, 'clouds are part of the sky shader');

// --- the new programs the polish batch added
assert.ok(shaders.has('HAND_VERTEX') && shaders.has('HAND_FRAGMENT'), 'the held block has its own program');
assert.ok(shaders.has('PARTICLE_VERTEX') && shaders.has('PARTICLE_FRAGMENT'), 'particles have their own program');
assert.ok(shaders.has('TINT_VERTEX') && shaders.has('TINT_FRAGMENT'), 'the full-screen tint has its own program');
assert.match(shaders.get('PARTICLE_VERTEX'), /attribute\s+vec3\s+aPosition/, 'particles carry positions');
assert.match(shaders.get('PARTICLE_VERTEX'), /attribute\s+vec4\s+aColor/, 'and per-particle RGBA');
assert.match(shaders.get('PARTICLE_VERTEX'), /uViewProjection/, 'particles are placed by the same matrix as the world');
assert.match(shaders.get('TINT_FRAGMENT'), /uTint/, 'the tint program takes a colour');

// --- the vertex layout the renderer uploads must match the shader's attribute types
const attributeSizes = { vec2: 2, vec3: 3, vec4: 4 };
for (const [name, text] of shaders) {
  if (!name.endsWith('VERTEX')) continue;
  for (const [type, id] of declarations(text, 'attribute')) {
    const size = attributeSizes[type];
    assert.ok(size, `${name}: ${id} has a drawable attribute type (${type})`);
    assert.match(javascript, new RegExp(`vertexAttribPointer\\([^;]*attributes\\.${id}\\s*,\\s*${size}\\b`, 's'),
      `${name}: ${id} is uploaded as ${size} floats per vertex`);
  }
}

// --- the matrices the shaders expect are the ones gl.js builds
assert.match(shaders.get('SKY_VERTEX'), /uForward/, 'the sky is drawn from the camera basis');
assert.match(shaders.get('SKY_VERTEX'), /uRight/, 'including the right vector');
assert.match(shaders.get('SKY_VERTEX'), /uUp/, 'and the up vector');
assert.match(shaders.get('SKY_VERTEX'), /uTanHalfFov/, 'with the field of view, so zooming changes the sky');
assert.match(javascript, /export function perspective/, 'there is a projection matrix helper');
assert.match(javascript, /export function view\(out, eye, yaw, pitch, roll = 0\)/, 'the view matrix takes the camera roll');

console.log(`web shader lint passed — ${shaders.size} shaders, ${vertexShaders.length} programs checked`);
