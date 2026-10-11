/**
 * A small software renderer used by the preview tool and the render tests.
 *
 * It is deliberately dependency-free: it projects, clips, rasterises with a depth buffer, samples
 * the procedural atlas and writes PNG files itself. That gives us a way to look at the voxel world
 * — geometry, UVs, ambient occlusion, fog — from a plain Node process, with no browser involved.
 */

import zlib from 'node:zlib';

/* ------------------------------------------------------------------ PNG output */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGB byte array (`width * height * 3`) as a PNG buffer. */
export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgb[y * stride + x];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ camera */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = v => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Build a camera looking from `eye` towards `target`. */
export function makeCamera({ eye, target, width = 640, height = 360, fov = 70 }) {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, forward, right, up, width, height, focal: (height / 2) / Math.tan((fov * Math.PI / 180) / 2) };
}

function toCameraSpace(camera, point) {
  const relative = sub(point, camera.eye);
  return [dot(relative, camera.right), dot(relative, camera.up), dot(relative, camera.forward)];
}

function project(camera, view) {
  return [camera.width / 2 + (view[0] / view[2]) * camera.focal, camera.height / 2 - (view[1] / view[2]) * camera.focal];
}

/* ------------------------------------------------------------------ renderer */

const NEAR = 0.08;

/**
 * Render triangle lists into an RGB buffer.
 *
 * `meshes` is a list of `{ positions, uvs, colors, indices }` groups in world space, exactly as
 * the chunk mesher produces them. Vertex colours already carry face shading, ambient occlusion and
 * skylight, so the renderer only has to sample the atlas, apply fog and write pixels.
 */
export function renderMeshes({
  meshes,
  camera,
  atlas,
  atlasPixels,
  background = [150, 190, 220],
  fogColor = background,
  fogNear = 60,
  fogFar = 190,
  sun = null,
  ambient = 0.55,
}) {
  const { width, height } = camera;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = background[0];
    rgb[i * 3 + 1] = background[1];
    rgb[i * 3 + 2] = background[2];
  }
  const depth = new Float32Array(width * height).fill(Infinity);

  const vertex = [0, 0, 0];
  for (const mesh of meshes) {
    const { positions, uvs, colors, indices } = mesh;
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [];
      let skip = false;
      for (let k = 0; k < 3; k++) {
        const index = indices[i + k];
        const view = toCameraSpace(camera, [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
        if (view[2] < NEAR) { skip = true; break; }
        triangle.push({
          view,
          screen: project(camera, view),
          uv: [uvs[index * 2], uvs[index * 2 + 1]],
          shade: colors[index * 3],
          normal: [mesh.normals ? mesh.normals[index * 3] : 0, mesh.normals ? mesh.normals[index * 3 + 1] : 1, mesh.normals ? mesh.normals[index * 3 + 2] : 0],
        });
      }
      if (skip) continue;
      rasterize({ rgb, depth, width, height, triangle, atlas, atlasPixels, fogColor, fogNear, fogFar, camera, sun, ambient, vertex });
    }
  }
  return rgb;
}

function rasterize({ rgb, depth, width, height, triangle, atlas, atlasPixels, fogColor, fogNear, fogFar, camera, sun, ambient }) {
  const [a, b, c] = triangle;
  const minX = Math.max(0, Math.floor(Math.min(a.screen[0], b.screen[0], c.screen[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.screen[0], b.screen[0], c.screen[0])));
  const minY = Math.max(0, Math.floor(Math.min(a.screen[1], b.screen[1], c.screen[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.screen[1], b.screen[1], c.screen[1])));
  if (minX > maxX || minY > maxY) return;

  const area = (b.screen[0] - a.screen[0]) * (c.screen[1] - a.screen[1]) - (c.screen[0] - a.screen[0]) * (b.screen[1] - a.screen[1]);
  if (Math.abs(area) < 1e-9) return;
  const sign = area < 0 ? -1 : 1;

  // Flat face light, matching how the browser renderer lights a face.
  let lighting = 1;
  if (sun) {
    const facing = a.normal[0] * sun.direction[0] + a.normal[1] * sun.direction[1] + a.normal[2] * sun.direction[2];
    lighting = ambient + Math.max(0, facing) * (1 - ambient);
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b.screen[0] - a.screen[0]) * (py - a.screen[1]) - (px - a.screen[0]) * (b.screen[1] - a.screen[1])) * sign;
      const w1 = ((c.screen[0] - b.screen[0]) * (py - b.screen[1]) - (px - b.screen[0]) * (c.screen[1] - b.screen[1])) * sign;
      const w2 = ((a.screen[0] - c.screen[0]) * (py - c.screen[1]) - (px - c.screen[0]) * (a.screen[1] - c.screen[1])) * sign;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const total = w0 + w1 + w2 || 1;
      const l0 = w0 / total, l1 = w1 / total, l2 = w2 / total;
      const inverseZ = l0 / a.view[2] + l1 / b.view[2] + l2 / c.view[2];
      const z = 1 / inverseZ;
      const index = y * width + x;
      if (z >= depth[index]) continue;

      const u = l0 * a.uv[0] + l1 * b.uv[0] + l2 * c.uv[0];
      const v = l0 * a.uv[1] + l1 * b.uv[1] + l2 * c.uv[1];
      const tx = Math.min(atlasPixels - 1, Math.max(0, Math.floor(u * atlasPixels)));
      const ty = Math.min(atlasPixels - 1, Math.max(0, Math.floor(v * atlasPixels)));
      const texel = (ty * atlasPixels + tx) * 4;
      if (atlas[texel + 3] < 128) continue; // cutout (leaves, grass, flowers, glass)

      const shade = (l0 * a.shade + l1 * b.shade + l2 * c.shade) * lighting;
      const fog = Math.min(1, Math.max(0, (z - fogNear) / (fogFar - fogNear)));
      depth[index] = z;
      for (let channel = 0; channel < 3; channel++) {
        const lit = Math.min(255, atlas[texel + channel] * shade);
        rgb[index * 3 + channel] = Math.round(lit * (1 - fog) + fogColor[channel] * fog);
      }
    }
  }
}
