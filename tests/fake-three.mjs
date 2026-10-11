/**
 * A tiny stand-in for three.js.
 *
 * The renderer, the sky and the sprite avatar are written against a small slice of the three.js
 * API. This fake implements exactly that slice — no WebGL, no canvas — so those modules can be run
 * and checked in Node, where a real browser is not available.
 */

export const NearestFilter = 1003;
export const NearestMipmapNearestFilter = 1004;
export const LinearFilter = 1006;
export const SRGBColorSpace = 'srgb';
export const DoubleSide = 2;
export const BackSide = 1;
export const FrontSide = 0;
export const DynamicDrawUsage = 35048;

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  normalize() {
    const length = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

export class Color {
  constructor(value = '#ffffff') { this.value = value; this.r = 1; this.g = 1; this.b = 1; }
  set(value) { this.value = value; return this; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  copy(other) { this.r = other.r; this.g = other.g; this.b = other.b; this.value = other.value; return this; }
  clone() { const color = new Color(this.value); color.r = this.r; color.g = this.g; color.b = this.b; return color; }
  getHexString() { return String(this.value); }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

export class Quaternion {
  setFromEuler() { return this; }
}

export class Matrix4 {
  compose() { return this; }
}

export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.needsUpdate = false;
  }
  setXY(index, x, y) { this.array[index * 2] = x; this.array[index * 2 + 1] = y; }
  setXYZ(index, x, y, z) {
    this.array[index * 3] = x; this.array[index * 3 + 1] = y; this.array[index * 3 + 2] = z;
  }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1]; }
  getZ(index) { return this.array[index * this.itemSize + 2]; }
}

export class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.boundingSphere = null;
    this.disposed = false;
  }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(attribute) { this.index = attribute; return this; }
  computeBoundingSphere() {
    const position = this.attributes.position;
    if (!position) { this.boundingSphere = new Sphere(new Vector3(), 0); return; }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < position.array.length; i += 3) {
      minX = Math.min(minX, position.array[i]); maxX = Math.max(maxX, position.array[i]);
      minY = Math.min(minY, position.array[i + 1]); maxY = Math.max(maxY, position.array[i + 1]);
      minZ = Math.min(minZ, position.array[i + 2]); maxZ = Math.max(maxZ, position.array[i + 2]);
    }
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    this.boundingSphere = new Sphere(center, radius);
  }
  dispose() { this.disposed = true; }
}

export class Sphere {
  constructor(center = new Vector3(), radius = 0) { this.center = center; this.radius = radius; }
}

class SimpleGeometry extends BufferGeometry {
  constructor(vertexCount = 4, positions = null, uvs = null) {
    super();
    this.setAttribute('position', new BufferAttribute(positions ?? new Float32Array(vertexCount * 3), 3));
    this.setAttribute('uv', new BufferAttribute(uvs ?? new Float32Array(vertexCount * 2), 2));
  }
}

export class PlaneGeometry extends SimpleGeometry {
  constructor(width = 1, height = 1) {
    super(4, new Float32Array([-width / 2, height / 2, 0, width / 2, height / 2, 0, -width / 2, -height / 2, 0, width / 2, -height / 2, 0]),
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]));
    this.parameters = { width, height };
  }
}

export class BoxGeometry extends SimpleGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super(24, new Float32Array(24 * 3), new Float32Array(24 * 2));
    this.parameters = { width, height, depth };
  }
}

export class SphereGeometry extends SimpleGeometry {
  constructor(radius = 1, widthSegments = 8, heightSegments = 6) {
    super(24, new Float32Array(24 * 3), new Float32Array(24 * 2));
    this.parameters = { radius, widthSegments, heightSegments };
  }
}

export class EdgesGeometry extends SimpleGeometry {
  constructor(geometry) {
    super(24, new Float32Array(24 * 3), new Float32Array(24 * 2));
    this.source = geometry;
  }
}

export class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.rotation.order = 'XYZ';
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.renderOrder = 0;
    this.frustumCulled = true;
    this.matrixAutoUpdate = true;
  }
  add(...objects) { for (const object of objects) { object.parent = this; this.children.push(object); } return this; }
  remove(object) {
    const index = this.children.indexOf(object);
    if (index >= 0) { this.children.splice(index, 1); object.parent = null; }
    return this;
  }
  lookAt() {}
  traverse(callback) { callback(this); for (const child of this.children) child.traverse(callback); }
}

export class Group extends Object3D {}

class MeshBase extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}

export class Mesh extends MeshBase {}
export class LineSegments extends MeshBase {}
export class Points extends MeshBase {}

export class InstancedMesh extends MeshBase {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.count = count;
    this.instanceMatrix = { setUsage() {}, needsUpdate: false };
    this.matrices = [];
  }
  setMatrixAt(index, matrix) { this.matrices[index] = matrix; }
}

export class Material {
  constructor(parameters = {}) {
    Object.assign(this, parameters);
    this.color = this.color instanceof Color ? this.color : new Color(this.color ?? '#ffffff');
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

export class MeshBasicMaterial extends Material {}
export class LineBasicMaterial extends Material {}
export class PointsMaterial extends Material {}
export class ShaderMaterial extends Material { constructor(parameters = {}) { super(parameters); this.uniforms = parameters.uniforms ?? {}; } }

export class CanvasTexture {
  constructor(canvas) { this.image = canvas; this.disposed = false; }
  dispose() { this.disposed = true; }
}

export class AmbientLight extends Object3D {
  constructor(color = '#ffffff', intensity = 1) { super(); this.color = new Color(color); this.intensity = intensity; }
}

export class Scene extends Object3D {
  constructor() { super(); this.background = null; this.fog = null; }
}

export class PerspectiveCamera extends Object3D {
  constructor(fov = 75, aspect = 1, near = 0.1, far = 1000) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.projectionUpdates = 0;
  }
  updateProjectionMatrix() { this.projectionUpdates++; }
}

export class Fog {
  constructor(color = '#ffffff', near = 1, far = 100) {
    this.color = new Color(color);
    this.near = near;
    this.far = far;
  }
}

export class WebGLRenderer {
  constructor({ canvas } = {}) {
    this.canvas = canvas;
    this.capabilities = { getMaxAnisotropy: () => 8 };
    this.info = { render: { calls: 0, triangles: 0 } };
    this.renders = 0;
    this.lastScene = null;
    this.lastCamera = null;
    this.sizes = [];
    this.pixelRatio = 1;
  }
  setPixelRatio(value) { this.pixelRatio = value; }
  setClearColor() {}
  setSize(width, height) { this.sizes.push({ width, height }); }
  render(scene, camera) {
    this.renders++;
    this.lastScene = scene;
    this.lastCamera = camera;
  }
}

/** Count the triangles currently held by a scene, for sanity checks. */
export function countSceneTriangles(scene) {
  let triangles = 0;
  scene.traverse(object => {
    if (object.geometry?.index) triangles += object.geometry.index.count / 3;
  });
  return triangles;
}

/** Count the meshes currently in a scene. */
export function countSceneMeshes(scene) {
  let meshes = 0;
  scene.traverse(object => { if (object.geometry) meshes++; });
  return meshes;
}

export const THREE = {
  NearestFilter, NearestMipmapNearestFilter, LinearFilter, SRGBColorSpace, DoubleSide, BackSide, FrontSide, DynamicDrawUsage,
  Vector3, Color, Euler, Quaternion, Matrix4, BufferAttribute, BufferGeometry, PlaneGeometry, BoxGeometry, SphereGeometry,
  EdgesGeometry, Object3D, Group, Mesh, LineSegments, Points, InstancedMesh, Material, MeshBasicMaterial, LineBasicMaterial,
  PointsMaterial, ShaderMaterial, CanvasTexture, AmbientLight, Scene, PerspectiveCamera, Fog, WebGLRenderer, Sphere,
};
