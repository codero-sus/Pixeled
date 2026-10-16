/**
 * Small WebGL helper layer: matrix maths, program compilation, mesh upload and frustum culling.
 *
 * Everything is WebGL 1 so the game runs on old phones and integrated GPUs; there is no dependency
 * on three.js or any CDN, which keeps the whole edition installable as plain files.
 */

export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  const attributes = {};
  const uniforms = {};
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributeCount; i++) {
    const name = gl.getActiveAttrib(program, i).name;
    attributes[name] = gl.getAttribLocation(program, name);
  }
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, attributes, uniforms };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}\n${source}`);
  }
  return shader;
}

/**
 * Uploads a chunk mesh. Vertices live in four buffers; indices are split into as many index buffers
 * as needed so the game also runs on drivers without 32-bit index support.
 */
export function uploadMesh(gl, mesh, indexSize) {
  if (!mesh) return null;
  const buffers = {
    position: createBuffer(gl, mesh.positions),
    normal: createBuffer(gl, mesh.normals),
    color: createBuffer(gl, mesh.colors),
    indices: [],
    indexSize,
    vertexCount: mesh.vertexCount,
  };
  const quadsPerGroup = Math.floor(65535 / 4);
  for (let start = 0; start < mesh.indices.length; start += quadsPerGroup * 6) {
    const slice = mesh.indices.slice(start, start + quadsPerGroup * 6);
    const array = indexSize === 4 ? new Uint32Array(slice) : new Uint16Array(slice);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, array, gl.STATIC_DRAW);
    buffers.indices.push({ buffer, count: slice.length });
  }
  return buffers;
}

function createBuffer(gl, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

export function deleteMesh(gl, buffers) {
  if (!buffers) return;
  gl.deleteBuffer(buffers.position);
  gl.deleteBuffer(buffers.normal);
  gl.deleteBuffer(buffers.color);
  for (const group of buffers.indices) gl.deleteBuffer(group.buffer);
}

export function drawMesh(gl, program, buffers, chunkOffset) {
  const { attributes } = program;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(attributes.aPosition);
  gl.vertexAttribPointer(attributes.aPosition, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
  gl.enableVertexAttribArray(attributes.aNormal);
  gl.vertexAttribPointer(attributes.aNormal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  gl.enableVertexAttribArray(attributes.aColor);
  gl.vertexAttribPointer(attributes.aColor, 3, gl.FLOAT, false, 0, 0);

  gl.uniform3f(program.uniforms.uChunkOffset, chunkOffset[0], chunkOffset[1], chunkOffset[2]);
  const type = buffers.indexSize === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  for (const group of buffers.indices) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, group.buffer);
    gl.drawElements(gl.TRIANGLES, group.count, type, 0);
  }
}

// -------------------------------------------------------------------- matrix maths

export function multiply(out, a, b) {
  for (let column = 0; column < 4; column++) {
    const b0 = b[column * 4], b1 = b[column * 4 + 1], b2 = b[column * 4 + 2], b3 = b[column * 4 + 3];
    out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/**
 * View matrix from a yaw/pitch camera, the same convention the rest of the game uses.
 * `roll` is the small camera tilt used for the walking sway.
 */
export function view(out, eye, yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  let rx = cy, ry = 0, rz = -sy;
  if (roll) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ux0 = ry * fz - rz * fy, uy0 = rz * fx - rx * fz, uz0 = rx * fy - ry * fx;
    rx = rx * cr + ux0 * sr; ry = ry * cr + uy0 * sr; rz = rz * cr + uz0 * sr;
  }
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

export function translation(out, x, y, z) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function scaling(out, s) {
  out.fill(0);
  out[0] = out[5] = out[10] = s;
  out[15] = 1;
  return out;
}

/** Six planes (a, b, c, d) extracted from a view-projection matrix, for chunk culling. */
export function extractPlanes(m, planes = new Float32Array(24)) {
  const rows = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const set = (index, row, sign) => {
    for (let i = 0; i < 4; i++) planes[index * 4 + i] = row[i] + sign * rows[3][i];
    const length = Math.hypot(planes[index * 4], planes[index * 4 + 1], planes[index * 4 + 2]) || 1;
    for (let i = 0; i < 4; i++) planes[index * 4 + i] /= length;
  };
  set(0, rows[0], 1);  // left
  set(1, rows[0], -1); // right
  set(2, rows[1], 1);  // bottom
  set(3, rows[1], -1); // top
  set(4, rows[2], 1);  // near
  set(5, rows[2], -1); // far
  return planes;
}

export function boxVisible(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4], b = planes[i * 4 + 1], c = planes[i * 4 + 2], d = planes[i * 4 + 3];
    const x = a >= 0 ? maxX : minX;
    const y = b >= 0 ? maxY : minY;
    const z = c >= 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}
