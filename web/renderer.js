/**
 * The three.js renderer: chunk meshes, materials, sky, block highlight, break particles and the
 * streaming of chunks in and out as the player walks.
 *
 * Three.js is vendored in `web/vendor/three.module.js`, so the game still runs with no build step
 * and no network access.
 */

import { ATLAS_PIXELS, BLOCKS, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './constants.js';
import { createAtlasCanvas, tilePalette } from './atlas.js';
import { meshChunk } from './mesher.js';
import { Sky } from './sky.js';
import { PlayerVisual } from './player.js';

/** Max chunk meshes (re)built per frame — keeps hitch-free streaming at any render distance. */
const MESH_BUDGET = 2;
const UNLOAD_MARGIN = 3;
const PARTICLE_COUNT = 260;

export class VoxelRenderer {
  constructor(THREE, canvas, world, settings) {
    this.THREE = THREE;
    this.canvas = canvas;
    this.world = world;
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setClearColor('#8fb6d8');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#c3dbec', 40, settings.renderDistance * CHUNK_SIZE - 8);

    this.camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.08, 1000);
    this.camera.rotation.order = 'YXZ';

    this.atlasPixels = null;
    this.buildMaterials();
    this.buildLights();
    this.sky = new Sky(THREE, this.scene, settings);
    this.avatar = new PlayerVisual(THREE, this.camera);
    this.scene.add(this.avatar.group);

    this.chunkMeshes = new Map();
    this.buildQueue = [];
    this.urgentChunks = new Set();
    this.highlight = this.buildHighlight();
    this.particles = this.buildParticles();
    this.waterOverlay = { active: false };
    this.elapsed = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsTimer = 0;
    this.chunksRendered = 0;
  }

  // ------------------------------------------------------------------ setup

  buildMaterials() {
    const THREE = this.THREE;
    const canvas = createAtlasCanvas();
    const context = canvas.getContext('2d');
    this.atlasPixels = context.getImageData(0, 0, ATLAS_PIXELS, ATLAS_PIXELS).data;
    this.palette = tilePalette(this.atlasPixels);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.texture = texture;

    // Vertex colours carry the baked ambient occlusion and skylight, so a simple unlit material
    // gives the classic crisp voxel look and costs almost nothing to draw.
    this.opaqueMaterial = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
    this.cutoutMaterial = new THREE.MeshBasicMaterial({
      map: texture, vertexColors: true, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
    });
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: texture, vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    });
  }

  buildLights() {
    const THREE = this.THREE;
    this.ambient = new THREE.AmbientLight('#ffffff', 0.8);
    this.scene.add(this.ambient);
  }

  buildHighlight() {
    const THREE = this.THREE;
    const geometry = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({ color: '#101418', transparent: true, opacity: 0.5 });
    const box = new THREE.LineSegments(edges, material);
    box.visible = false;
    this.scene.add(box);
    return box;
  }

  buildParticles() {
    const THREE = this.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3));
    const material = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    this.scene.add(points);
    this.particleState = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particleState.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.particleCursor = 0;
    return points;
  }

  /** Swap in a different world (new seed) without rebuilding the renderer. */
  setWorld(world) {
    for (const entry of this.chunkMeshes.values()) this.disposeChunk(entry);
    this.chunkMeshes.clear();
    this.buildQueue = [];
    this.world = world;
    this.scene.fog.far = this.settings.renderDistance * CHUNK_SIZE - 8;
  }

  // ------------------------------------------------------------------ chunk streaming

  /**
   * Load the chunks around the player, drop the ones left behind, and rebuild the work queue.
   *
   * The queue is rebuilt from scratch every frame (it is derived from chunk state, so it can never
   * grow stale or duplicate), with chunks the player just edited pulled to the front.
   */
  streamChunks(player) {
    const radius = this.settings.renderDistance;
    const centerX = Math.floor(player.position.x / CHUNK_SIZE);
    const centerZ = Math.floor(player.position.z / CHUNK_SIZE);
    const wanted = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius + radius) continue;
        const cx = centerX + dx, cz = centerZ + dz;
        wanted.push({ cx, cz, distance: dx * dx + dz * dz });
        if (!this.world.hasChunk(cx, cz)) {
          this.world.ensureChunk(cx, cz);
          // Fresh terrain changes the borders of its neighbours.
          for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) this.world.markDirty(nx, nz);
        }
      }
    }
    wanted.sort((a, b) => a.distance - b.distance);
    this.wanted = wanted;

    for (const [key, entry] of this.chunkMeshes) {
      const dx = entry.cx - centerX, dz = entry.cz - centerZ;
      if (dx * dx + dz * dz > (radius + UNLOAD_MARGIN) * (radius + UNLOAD_MARGIN)) {
        this.disposeChunk(entry);
        this.chunkMeshes.delete(key);
      }
    }

    const queue = [];
    for (const { cx, cz, distance } of wanted) {
      const key = `${cx},${cz}`;
      const chunk = this.world.chunk(cx, cz);
      if (!chunk) continue;
      if (!this.chunkMeshes.has(key) || chunk.dirty) queue.push({ cx, cz, priority: distance });
    }
    // Blocks the player just broke or placed must show up at once, not at the end of the queue.
    for (const key of this.urgentChunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (queue.some(job => job.cx === cx && job.cz === cz)) continue;
      if (!this.world.hasChunk(cx, cz)) continue;
      queue.push({ cx, cz, priority: -1 });
    }
    queue.sort((a, b) => a.priority - b.priority);
    this.buildQueue = queue;
    this.urgentChunks.clear();
  }

  /** Build up to MESH_BUDGET chunk meshes, nearest first. */
  processQueue() {
    let built = 0;
    while (built < MESH_BUDGET && this.buildQueue.length) {
      const job = this.buildQueue.shift();
      const chunk = this.world.chunk(job.cx, job.cz);
      if (!chunk) continue;
      this.buildChunkMesh(chunk);
      chunk.dirty = false;
      built++;
      this.world.stats.meshed++;
    }
    return built;
  }

  buildChunkMesh(chunk) {
    const THREE = this.THREE;
    const key = `${chunk.cx},${chunk.cz}`;
    chunk.dirty = false;
    let entry = this.chunkMeshes.get(key);
    const mesh = meshChunk(this.world, chunk);
    if (!entry) {
      entry = { cx: chunk.cx, cz: chunk.cz, opaque: null, water: null, plants: null };
      this.chunkMeshes.set(key, entry);
    }
    entry.opaque = this.updateMesh(entry.opaque, mesh.opaque, this.opaqueMaterial, THREE);
    entry.water = this.updateMesh(entry.water, mesh.water, this.waterMaterial, THREE);
    entry.plants = this.updateMesh(entry.plants, mesh.plants, this.cutoutMaterial, THREE);
    // Water and foliage should not write depth in front of each other, but solids must.
    if (entry.water) entry.water.renderOrder = 1;
    if (entry.plants) entry.plants.renderOrder = 2;
  }

  updateMesh(existing, group, material, THREE) {
    if (!group.indices.length) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
      }
      return null;
    }
    let mesh = existing;
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    const geometry = mesh.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(group.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(group.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(group.uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(group.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(group.indices, 1));
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    // Instanced-style culling: keep the bounding sphere in world space.
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(sphere.center.x, sphere.center.y, sphere.center.z), sphere.radius,
    );
    mesh.visible = true;
    return mesh;
  }

  disposeChunk(entry) {
    for (const mesh of [entry.opaque, entry.water, entry.plants]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  /** Rebuild the chunks touching a block that just changed, before anything else. */
  markBlockDirty(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        if (!this.chunkMeshes.has(key)) continue;
        this.urgentChunks.add(key);
        this.world.markDirty(cx + dx, cz + dz);
        // Rebuild straight away as well, so the edit is visible on the very next frame.
        if (!this.buildQueue.some(job => job.cx === cx + dx && job.cz === cz + dz)) {
          this.buildQueue.unshift({ cx: cx + dx, cz: cz + dz, priority: -1 });
        }
      }
    }
  }

  // ------------------------------------------------------------------ interaction feedback

  setHighlight(hit, progress = 0) {
    if (!hit) { this.highlight.visible = false; return; }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    const strength = Math.min(1, progress);
    this.highlight.material.opacity = 0.35 + strength * 0.5;
    this.highlight.material.color.setRGB(0.05 + strength * 0.9, 0.05 + strength * 0.35, 0.07);
  }

  /** Spray particles from a broken block, coloured by its texture. */
  spawnBreakParticles(x, y, z, blockId, count = 18) {
    const colors = this.palette;
    const tile = this.blockTile(blockId);
    const base = colors[tile] ?? [0.5, 0.5, 0.5];
    const positionAttribute = this.particles.geometry.getAttribute('position');
    const colorAttribute = this.particles.geometry.getAttribute('color');
    for (let i = 0; i < count; i++) {
      const index = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_COUNT;
      const state = this.particleState[index];
      state.life = 0.6 + Math.random() * 0.4;
      state.x = x + 0.2 + Math.random() * 0.6;
      state.y = y + 0.2 + Math.random() * 0.6;
      state.z = z + 0.2 + Math.random() * 0.6;
      state.vx = (Math.random() - 0.5) * 3.2;
      state.vy = 1.4 + Math.random() * 3.4;
      state.vz = (Math.random() - 0.5) * 3.2;
      const tint = 0.75 + Math.random() * 0.45;
      positionAttribute.setXYZ(index, state.x, state.y, state.z);
      colorAttribute.setXYZ(index, base[0] * tint, base[1] * tint, base[2] * tint);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    this.particles.visible = true;
  }

  blockTile(blockId) {
    const block = BLOCKS[blockId];
    return block ? block.tiles.top : 0;
  }

  updateParticles(dt) {
    if (!this.particles.visible) return;
    const positionAttribute = this.particles.geometry.getAttribute('position');
    let alive = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const state = this.particleState[i];
      if (state.life <= 0) {
        positionAttribute.setXYZ(i, 0, -1000, 0);
        continue;
      }
      state.life -= dt;
      state.vy -= 18 * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;
      if (this.world.isSolid(Math.floor(state.x), Math.floor(state.y), Math.floor(state.z))) {
        state.vy = Math.abs(state.vy) * 0.25;
        state.vx *= 0.6;
        state.vz *= 0.6;
        state.y += 0.02;
      }
      positionAttribute.setXYZ(i, state.x, state.y, state.z);
      alive++;
    }
    positionAttribute.needsUpdate = true;
    this.particles.visible = alive > 0;
  }

  // ------------------------------------------------------------------ frame

  updateCamera(player, thirdPerson = false) {
    const eye = thirdPerson ? this.thirdPersonOffset(player) : player.eye();
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);

    // Swimming tint: when the camera is inside water, tighten the fog and turn it blue.
    const insideWater = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) === 10;
    if (insideWater !== this.waterOverlay.active) {
      this.waterOverlay.active = insideWater;
      if (insideWater) {
        this.scene.fog.color.setRGB(0.12, 0.3, 0.55);
        this.scene.fog.near = 0.1;
        this.scene.fog.far = 22;
      } else {
        this.scene.fog.color.copy(this.sky.colors.fog);
        this.scene.fog.near = 40;
        this.scene.fog.far = this.settings.renderDistance * CHUNK_SIZE - 8;
      }
    }
  }

  render(player, dt, { thirdPerson = false, mining = false, paused = false } = {}) {
    this.elapsed += dt;
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }

    this.streamChunks(player);
    this.processQueue();

    this.sky.update(paused ? 0 : dt);
    this.sky.follow(player, this.elapsed);
    this.updateCamera(player, thirdPerson);
    this.updateParticles(dt);

    // Daylight tint on every surface, and a slightly warmer light at dusk.
    const light = this.sky.light;
    this.opaqueMaterial.color.setRGB(light, light, light * 0.98 + 0.02);
    this.cutoutMaterial.color.copy(this.opaqueMaterial.color);
    this.waterMaterial.color.setRGB(light * 0.92, light * 0.95, light);
    this.ambient.intensity = 0.75 + light * 0.25;
    this.scene.background = this.sky.colors.fog.clone();
    if (!this.waterOverlay.active) this.scene.fog.color.copy(this.sky.colors.fog);

    // Keep the avatar drawn from the camera's point of view.
    const cameraYaw = player.yaw;
    this.avatar.setVisible(thirdPerson);
    if (thirdPerson) this.avatar.update(player, dt, cameraYaw, mining);

    this.renderer.render(this.scene, this.camera);
    this.chunksRendered = this.chunkMeshes.size;
  }

  resize(width, height) {
    this.camera.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  applySettings(settings) {
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.scene.fog.far = settings.renderDistance * CHUNK_SIZE - 8;
  }

  /** Third-person camera offset, used when the player toggles the camera. */
  thirdPersonOffset(player) {
    const distance = 4.2;
    const direction = player.direction();
    return {
      x: player.position.x - direction.x * distance,
      y: player.position.y + 1.1 - direction.y * distance,
      z: player.position.z - direction.z * distance,
    };
  }
}

export { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT };
