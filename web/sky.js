/**
 * Sky, sun, moon, clouds and the day/night cycle.
 *
 * The sky is a shader-painted dome, the sun and moon are billboards, and the clouds are a handful
 * of instanced quads drifting forever in one direction like the ones in the original game.
 */

export const DAY_PHASES = [
  { name: 'Dawn', start: 0.22 },
  { name: 'Daytime', start: 0.28 },
  { name: 'Dusk', start: 0.68 },
  { name: 'Night', start: 0.76 },
];

export class Sky {
  constructor(THREE, scene, settings) {
    this.THREE = THREE;
    this.scene = scene;
    this.settings = settings;
    this.time = settings.timeOfDay ?? 0.3;
    this.dayLength = settings.dayLength ?? 900;

    this.sunDirection = new THREE.Vector3(0.4, 0.85, 0.3).normalize();
    this.colors = {
      top: new THREE.Color('#68a5e8'),
      horizon: new THREE.Color('#cfe4f5'),
      fog: new THREE.Color('#c3dbec'),
      sun: new THREE.Color('#fff4cf'),
    };

    const skyGeometry = new THREE.SphereGeometry(320, 24, 16);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: this.colors.top.clone() },
        horizonColor: { value: this.colors.horizon.clone() },
        sunDirection: { value: this.sunDirection.clone() },
        sunColor: { value: this.colors.sun.clone() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vWorldPosition;
        void main() {
          vec3 direction = normalize(vWorldPosition);
          float height = clamp(direction.y * 1.4 + 0.12, 0.0, 1.0);
          vec3 base = mix(horizonColor, topColor, pow(height, 0.7));
          float glow = pow(max(dot(direction, normalize(sunDirection)), 0.0), 8.0);
          vec3 color = base + sunColor * glow * 0.55;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeometry, this.skyMaterial);
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    this.sunSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 38),
      new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.95, fog: false, depthWrite: false }),
    );
    this.moonSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshBasicMaterial({ color: '#dfe8f2', transparent: true, opacity: 0.9, fog: false, depthWrite: false }),
    );
    this.sunSprite.frustumCulled = false;
    this.moonSprite.frustumCulled = false;
    scene.add(this.sunSprite, this.moonSprite);

    this.buildClouds();
    this.update(0);
  }

  /** A wide, thin band of drifting cloud quads high above the world. */
  buildClouds() {
    const THREE = this.THREE;
    const geometry = new THREE.PlaneGeometry(24, 24);
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.clouds = new THREE.InstancedMesh(geometry, material, 90);
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloudOffsets = [];
    for (let i = 0; i < 90; i++) {
      this.cloudOffsets.push({
        x: (Math.random() - 0.5) * 900,
        z: (Math.random() - 0.5) * 900,
        y: 132 + Math.random() * 16,
        scale: 0.7 + Math.random() * 1.9,
        rotation: Math.random() * Math.PI,
      });
    }
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);
  }

  /** Advance the clock and move the sun and moon. */
  update(dt) {
    if (this.settings.dayCycle !== false) {
      this.time = (this.time + dt / this.dayLength) % 1;
    }
    const angle = (this.time - 0.25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(angle) * 0.45, Math.sin(angle), Math.cos(angle) * 0.85).normalize();

    const daylight = Math.max(0, Math.min(1, this.sunDirection.y * 1.6 + 0.28));
    const dusk = Math.max(0, 1 - Math.abs(this.sunDirection.y) * 4) * (this.sunDirection.x > 0 ? 1 : 0.6);

    // Palettes: bright day, warm dusk, deep blue night.
    const dayTop = this.THREE.Color ? [0.35, 0.58, 0.9] : [0.35, 0.58, 0.9];
    const dayHorizon = [0.78, 0.87, 0.95];
    const nightTop = [0.03, 0.05, 0.14];
    const nightHorizon = [0.08, 0.11, 0.24];
    const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);
    const top = mix(nightTop, dayTop, daylight);
    const horizon = mix(nightHorizon, dayHorizon, daylight);
    const duskWarm = [0.95, 0.62, 0.42];
    for (let i = 0; i < 3; i++) {
      horizon[i] = horizon[i] * (1 - dusk * 0.55) + duskWarm[i] * dusk * 0.55;
      top[i] = top[i] * (1 - dusk * 0.25) + duskWarm[i] * dusk * 0.12;
    }
    this.skyMaterial.uniforms.topColor.value.setRGB(top[0], top[1], top[2]);
    this.skyMaterial.uniforms.horizonColor.value.setRGB(horizon[0], horizon[1], horizon[2]);
    this.skyMaterial.uniforms.sunDirection.value.copy(this.sunDirection);

    this.colors.fog.setRGB(horizon[0] * 0.98, horizon[1] * 0.98, horizon[2] * 0.98);
    this.light = 0.32 + daylight * 0.68;
    this.daylight = daylight;
    this.isNight = daylight < 0.35;
    this.phase = this.phaseName(this.time);
  }

  phaseName(time) {
    if (time < 0.22) return 'Night';
    if (time < 0.3) return 'Dawn';
    if (time < 0.66) return 'Daytime';
    if (time < 0.78) return 'Dusk';
    return 'Night';
  }

  /** A readable clock such as "07:12". */
  clockText() {
    const totalMinutes = Math.floor(this.time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  setTime(time) {
    this.time = ((time % 1) + 1) % 1;
    this.update(0);
  }

  /** Follow the player so the dome, sun, moon and clouds stay centred on them. */
  follow(player, elapsed) {
    const { x, y, z } = player.position;
    this.skyMesh.position.set(x, y, z);
    this.sunSprite.position.set(x + this.sunDirection.x * 220, y + this.sunDirection.y * 220, z + this.sunDirection.z * 220);
    this.moonSprite.position.set(x - this.sunDirection.x * 220, y - this.sunDirection.y * 220, z - this.sunDirection.z * 220);
    this.sunSprite.lookAt(x, y, z);
    this.moonSprite.lookAt(x, y, z);
    this.sunSprite.visible = this.sunDirection.y > -0.2;
    this.moonSprite.visible = -this.sunDirection.y > -0.2;
    this.skyMaterial.uniforms.sunColor.value.setRGB(
      0.7 + 0.3 * this.daylight, 0.66 + 0.3 * this.daylight, 0.5 + 0.25 * this.daylight,
    );

    const drift = elapsed * 0.6;
    const matrix = new this.THREE.Matrix4();
    const quaternion = new this.THREE.Quaternion();
    const position = new this.THREE.Vector3();
    const scale = new this.THREE.Vector3();
    for (let i = 0; i < this.cloudOffsets.length; i++) {
      const cloud = this.cloudOffsets[i];
      const span = 900;
      let cloudX = cloud.x + drift;
      cloudX = ((cloudX + span / 2) % span + span) % span - span / 2;
      position.set(x + cloudX, cloud.y, z + cloud.z);
      quaternion.setFromEuler(new this.THREE.Euler(-Math.PI / 2, 0, cloud.rotation));
      scale.set(cloud.scale, cloud.scale, cloud.scale);
      matrix.compose(position, quaternion, scale);
      this.clouds.setMatrixAt(i, matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.clouds.material.opacity = 0.25 + 0.5 * this.daylight;
  }
}
