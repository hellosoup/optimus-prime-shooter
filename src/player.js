import * as THREE from 'three';
import { playMovementSfx, playSegment, updateMovementSfx } from './sfx.js';

export const MODE = { ROBOT: 'robot', VEHICLE: 'vehicle' };

// Transform SFX segments within Tf_sound.ogg (2.506s clip): robot->truck plays
// the first second (short fade so the 1.0s cut doesn't click); truck->robot
// plays from 1.5s to the natural end of the clip.
const SFX_TO_VEHICLE = { start: 0, end: 1.0, fadeOut: 0.07 };
const SFX_TO_ROBOT = { start: 1.5, end: null };

// --- tunables -------------------------------------------------------------
// If Optimus faces the wrong way relative to movement, adjust MODEL_YAW_OFFSET
// by +/- Math.PI/2 until "forward" looks right.
const MODEL_YAW_OFFSET = 0;
const TRANSFORM_TO_ROBOT_TIME = 1.3; // seconds (transform_r clip is 4.3s, sped up)
const WHEEL_SPIN_RATE = 0.9;    // radians of wheel spin per unit moved (visual only)
const WHEEL_SPIN_DIR = 1;       // flip to -1 if the wheels appear to roll backward

// Both modes share the same omni-directional movement; the truck has a higher
// top speed and heavier easing so it feels more vehicle-like.
const SPEED_ROBOT = 20;
const SPEED_VEHICLE = 48;
const ROBOT_ACCEL_SMOOTH = 16;  // higher = snappier ramp-up
const ROBOT_STOP_SMOOTH = 18;   // higher = quicker stop
const VEHICLE_ACCEL_SMOOTH = 4.5;
const VEHICLE_STOP_SMOOTH = 5.5;
const TRANSFORM_STOP_SMOOTH = 1.2; // lower = more momentum carried through transforms
const ROBOT_TURN_RATE = 14;     // how fast facing catches up (higher = snappier)
const VEHICLE_TURN_RATE = 3.2;  // truck steering/heading, lower = wider turning circle
const VEHICLE_NOSE_PIVOT_OFFSET = 2.4; // truck turns around a point near the nose
const STOP_SPEED = 0.05;         // snap tiny eased velocity to a true stop
const KNOCKBACK_DRAG = 9.5;
const DUST_STEP_DISTANCE = 2.2;   // distance between robot dust footstep bursts
const FOOTSTEP_SFX_DISTANCE = 8;
const SMOKE_RATE = 40;           // particles per second at truck top speed, per stack
const BOOST_DURATION = 0.9;
const BOOST_COOLDOWN = 2.4;
const BOOST_SPEED_MULT = 1.85;
const BOOST_TURN_MULT = 0.22;
const BOOST_FIRE_RATE = 145;
const SKID_MARK_COUNT = 90;
const SKID_MARK_DISTANCE = 2.4;
const SKID_MARK_LIFETIME = 5.2;
const TRANSFORM_SPARK_COUNT = 90;
const DAMAGE_FLASH_DURATION = 0.45;
const DEATH_GIBLET_COUNT = 34;

// --- attacks --------------------------------------------------------------
// Robot-mode melee. Each entry maps an input to a one-shot clip; `weapon` is
// shown for the swing then hidden when it ends. Frame windows are authored at
// ATTACK_ANIM_FPS so animation trims can be tuned in frame numbers.
const ATTACK_ANIM_FPS = 30;
const ATTACKS = {
  attack01: { clip: 'attack01', weapon: null, startFrame: 15, hitFrame: 20, endFrame: 30, fade: 0.08 },
  smash:    { clip: 'smash',    weapon: 'axe', hit: 0.5,  fade: 0.08 },
};

// shortest signed angle from a to b
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function sampleColorStops(stops, t, out) {
  if (!stops || stops.length === 0) return out;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t > b.at) continue;
    const localT = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at || 1)));
    return out.copy(a.color).lerp(b.color, localT);
  }
  return out.copy(stops[stops.length - 1].color);
}

function makeTrail(count, color, baseSize, opacity = 1, depthTest = true) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const sizes = new Float32Array(count);
  const rotations = new Float32Array(count);
  const seeds = new Float32Array(count);
  const colorObj = new THREE.Color(color);

  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + 1] = -1000;
    colorObj.toArray(colors, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('rotation', new THREE.BufferAttribute(rotations, 1));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      baseSize: { value: baseSize },
      opacityScale: { value: opacity },
    },
    vertexShader: `
      attribute float alpha;
      attribute float size;
      attribute float rotation;
      attribute float seed;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRotation;
      varying float vSeed;
      uniform float baseSize;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vRotation = rotation;
        vSeed = seed;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = baseSize * size;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRotation;
      varying float vSeed;
      uniform float opacityScale;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float c = cos(vRotation);
        float s = sin(vRotation);
        p = mat2(c, -s, s, c) * p;
        float angle = atan(p.y, p.x);
        float wobble =
          sin(angle * 3.0 + vSeed) * 0.055 +
          sin(angle * 5.0 + vSeed * 1.7) * 0.04 +
          sin(angle * 9.0 + vSeed * 0.4) * 0.025;
        float radius = 0.39 + wobble;
        float softPuff = smoothstep(radius, radius - 0.16, length(p));
        gl_FragColor = vec4(vColor, vAlpha * opacityScale * softPuff);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    positions,
    alphas,
    sizes,
    rotations,
    seeds,
    velocities: Array.from({ length: count }, () => new THREE.Vector3()),
    ages: new Float32Array(count),
    lifetimes: new Float32Array(count),
    baseSizes: new Float32Array(count),
    growths: new Float32Array(count),
    angularSpeeds: new Float32Array(count),
    colorStops: null,
    _colorTmp: new THREE.Color(),
    cursor: 0,
    count,
  };
}

export class Player {
  constructor({ object, mixer, clips, shortClip, scene }) {
    this.object = object;      // scaled GLB scene; we move/rotate this directly
    this.mixer = mixer;
    this.scene = scene;

    this.clipByName = {};
    this.clipNames = [];
    clips.forEach((c) => {
      const name = shortClip(c.name);
      this.clipByName[name] = c;
      if (!this.clipNames.includes(name)) this.clipNames.push(name);
    });

    this.actions = {};
    this.current = null;
    this.currentName = null;
    this.debugAnimationPreview = false;

    this.mode = MODE.ROBOT;
    this.transforming = false;
    this.transformTimer = 0;
    this.transformDuration = 0;
    this.transformRingFired = false;
    this.onTransformDone = null;

    // attack state (robot-mode melee); locks locomotion until the swing ends
    this.attacking = false;
    this.attackCfg = null;
    this.attackName = null;
    this.attackElapsed = 0;
    this.attackDuration = 0;
    this.attackHitTime = 0;
    this.hitFired = false;
    this.onHit = null; // (attackName, cfg) => {}  -- wired to enemies later
    this.damageFlashTimer = 0;
    this.damageFlashMaterials = [];
    this.object.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const mat of mats) {
        if (!mat || this.damageFlashMaterials.some((entry) => entry.mat === mat)) continue;
        this.damageFlashMaterials.push({
          mat,
          color: mat.color ? mat.color.clone() : null,
          emissive: mat.emissive ? mat.emissive.clone() : null,
          emissiveIntensity: mat.emissiveIntensity ?? 0,
        });
      }
    });

    // axe mesh(es) shown only during the smash; hidden at load by main.js.
    // The glTF export flattened the axe->bone parenting, so the mesh is stuck at
    // the rig origin (on the floor) instead of in the hand. Re-attach it to
    // Bone_axe, which rides the right hand in every clip, so it sits in-hand and
    // follows the swing.
    //
    // Sizing is the tricky part: the model is tiny in the GLB and gets its size
    // from a ~290x scale on the rig root, but Bone_axe's world scale is small AND
    // animated by the clips. So a fixed local scale would be wrong and would
    // pulse during the swing. Instead we record the root's world scale as the
    // target and counter the bone's live world scale every visible frame
    // (_syncAxeScale) to hold the axe at the body's on-screen size.
    this.axeMeshes = [];
    this.object.traverse((c) => { if (c.isMesh && /axe/i.test(c.name)) this.axeMeshes.push(c); });
    this.axeBone = this.object.getObjectByName('Bone_axe');
    this._axeWorldScaleTarget = this.object.getWorldScale(new THREE.Vector3()).x;
    this._tmpScale = new THREE.Vector3();
    if (this.axeBone) {
      for (const m of this.axeMeshes) {
        this.axeBone.add(m);       // ride the right hand
        m.position.set(0, 0, 0);   // Bone_axe origin = the grip point
        m.quaternion.set(0, 0, 0, 1);
        m.visible = false;
      }
    }
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.boostFireEmit = 0;

    this.heading = MODEL_YAW_OFFSET;
    this.moving = false;

    // iso movement basis: screen-up = world (-1,0,-1), screen-right = (1,0,-1)
    this.fwd = new THREE.Vector3(-1, 0, -1).normalize();
    this.right = new THREE.Vector3(1, 0, -1).normalize();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this.velocity = new THREE.Vector3(); // omni velocity (XZ), shared by both modes
    this.knockbackVelocity = new THREE.Vector3();

    // wheel bones (spun manually in vehicle mode for a rolling effect)
    this.wheelBones = [];
    this.object.traverse((b) => { if (b.isBone && /wheel/i.test(b.name)) this.wheelBones.push(b); });
    this.wheelData = [];
    this.wheelDetected = false;
    this.wheelSpin = 0;

    this.dustTrail = scene ? makeTrail(120, 0xa68f6f, 34, 0.45, false) : null;
    this.smokeTrail = scene ? makeTrail(140, 0x87909a, 24) : null;
    this.fireTrail = scene ? makeTrail(120, 0xff6a1a, 30, 0.9) : null;
    this.transformSparkTrail = scene ? makeTrail(TRANSFORM_SPARK_COUNT, 0xa9fbff, 24, 0.95, false) : null;
    this.dustEmit = 0;
    this.dustStepSide = 1;
    this.footstepSfxEmit = 0;
    this.smokeEmit = 0;
    this.skidEmit = 0;
    this.skidMarks = [];
    if (scene) {
      const skidGeo = new THREE.BoxGeometry(0.28, 0.018, 7.2);
      this.dustTrail.points.renderOrder = 20;
      this.fireTrail.points.material.blending = THREE.AdditiveBlending;
      this.fireTrail.colorStops = [
        { at: 0, color: new THREE.Color(0xffff75) },
        { at: 0.18, color: new THREE.Color(0xffb000) },
        { at: 0.58, color: new THREE.Color(0xff5a00) },
        { at: 1, color: new THREE.Color(0x5c1700) },
      ];
      scene.add(this.dustTrail.points);
      scene.add(this.smokeTrail.points);
      scene.add(this.fireTrail.points);
      this.transformSparkTrail.points.material.blending = THREE.AdditiveBlending;
      this.transformSparkTrail.colorStops = [
        { at: 0, color: new THREE.Color(0xeaffff) },
        { at: 0.35, color: new THREE.Color(0x54d8ff) },
        { at: 1, color: new THREE.Color(0x1760ff) },
      ];
      scene.add(this.transformSparkTrail.points);

      for (let i = 0; i < SKID_MARK_COUNT; i += 1) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x050505,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(skidGeo, mat);
        mesh.position.y = 0.035;
        mesh.renderOrder = 8;
        scene.add(mesh);
        this.skidMarks.push({ mesh, age: SKID_MARK_LIFETIME, active: false });
      }
    }

    this.dead = false;
    this.deathGiblets = [];
    this.deathGibletGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.deathGibletMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xb31d24, metalness: 0.75, roughness: 0.42 }),
      new THREE.MeshStandardMaterial({ color: 0x1c4faf, metalness: 0.75, roughness: 0.42 }),
      new THREE.MeshStandardMaterial({ color: 0xb8c5cf, metalness: 0.9, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x171b22, metalness: 0.85, roughness: 0.38 }),
      new THREE.MeshStandardMaterial({ color: 0x39d8ff, emissive: 0x1aa6ff, emissiveIntensity: 1.2, metalness: 0.35, roughness: 0.3 }),
    ];

    this.play('idle02');
  }

  get speed() { return this.mode === MODE.VEHICLE ? SPEED_VEHICLE : SPEED_ROBOT; }
  get canShoot() { return this.mode === MODE.ROBOT && !this.transforming; }
  get canAttack() { return this.mode === MODE.ROBOT && !this.transforming && !this.attacking; }
  get boosting() { return this.mode === MODE.VEHICLE && this.boostTimer > 0; }
  get boostReady() { return this.mode === MODE.VEHICLE && !this.transforming && this.boostCooldown <= 0; }
  get boostCooldownRatio() { return Math.max(0, Math.min(1, this.boostCooldown / BOOST_COOLDOWN)); }

  // Restore to a fresh robot-at-origin state (used on game restart).
  reset() {
    this._clearDeathGiblets();
    this.dead = false;
    this.object.visible = true;
    this.object.position.set(0, 0, 0);
    this.heading = MODEL_YAW_OFFSET;
    this.object.rotation.y = this.heading;
    this.velocity.set(0, 0, 0);
    this.knockbackVelocity.set(0, 0, 0);
    this.mode = MODE.ROBOT;
    this.transforming = false;
    this.onTransformDone = null;
    this.transformTimer = 0;
    this.transformDuration = 0;
    this.transformRingFired = false;
    this.attacking = false;
    this.attackCfg = null;
    this.attackName = null;
    this.attackHitTime = 0;
    this.damageFlashTimer = 0;
    this._setDamageFlash(0);
    this.debugAnimationPreview = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.footstepSfxEmit = 0;
    this.skidEmit = 0;
    this._clearSkidMarks();
    this._setAxeVisible(false);
    this.play('idle02', { fade: 0.1 });
  }

  _setAxeVisible(v) { for (const m of this.axeMeshes) m.visible = v; }

  getAnimationNames() {
    return [...this.clipNames];
  }

  previewAnimation(name) {
    if (!this.clipByName[name]) return false;
    this.debugAnimationPreview = true;
    this.attacking = false;
    this.transforming = false;
    this.onTransformDone = null;
    this.transformTimer = 0;
    this.transformDuration = 0;
    this._setAxeVisible(false);
    this.velocity.set(0, 0, 0);
    this.knockbackVelocity.set(0, 0, 0);
    this.play(name, { loop: true, fade: 0.12 });
    return true;
  }

  clearAnimationPreview() {
    if (!this.debugAnimationPreview) return;
    this.debugAnimationPreview = false;
    this.play(this.mode === MODE.VEHICLE ? 'vehicle_idle01' : 'idle02', { fade: 0.12 });
  }

  _spawnTransformRing(color = 0x39d8ff) {
    if (!this.scene) return;
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 80), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(this.object.position.x, 0.08, this.object.position.z);
    ring.renderOrder = 12;
    this.scene.add(ring);

    const start = performance.now();
    const animateRing = () => {
      const t = Math.min(1, (performance.now() - start) / 520);
      ring.scale.setScalar(1 + t * 9);
      ring.material.opacity = 0.8 * (1 - t) * (1 - t);
      if (t < 1) requestAnimationFrame(animateRing);
      else {
        this.scene.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
      }
    };
    animateRing();
  }

  _burstTransformSparks(mult = 1) {
    if (!this.transformSparkTrail) return;
    const base = this.object.position;
    for (let i = 0; i < 34 * mult; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * 3.6;
      const p = new THREE.Vector3(
        base.x + Math.cos(a) * r,
        1.2 + Math.random() * 7.2,
        base.z + Math.sin(a) * r
      );
      const v = new THREE.Vector3(
        Math.cos(a) * (4 + Math.random() * 9),
        1.5 + Math.random() * 6,
        Math.sin(a) * (4 + Math.random() * 9)
      );
      this._spawnParticle(
        this.transformSparkTrail,
        p,
        v,
        0.18 + Math.random() * 0.32,
        0.35 + Math.random() * 0.9,
        0.2 + Math.random() * 0.9,
        (Math.random() - 0.5) * 14
      );
    }
  }

  _burstTransformDust() {
    if (!this.dustTrail) return;
    const base = this.object.position;
    for (let i = 0; i < 28; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(base.x + Math.cos(a) * 1.2, 0.45, base.z + Math.sin(a) * 1.2);
      const v = new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 7), 0.4 + Math.random() * 1.6, Math.sin(a) * (2 + Math.random() * 7));
      this._spawnParticle(this.dustTrail, p, v, 0.28 + Math.random() * 0.35, 0.6 + Math.random() * 1.4, 1.1, (Math.random() - 0.5) * 8);
    }
  }

  applyKnockback(fromPosition, strength = 16) {
    const dx = this.object.position.x - fromPosition.x;
    const dz = this.object.position.z - fromPosition.z;
    const len = Math.hypot(dx, dz) || 1;
    this.knockbackVelocity.x += (dx / len) * strength;
    this.knockbackVelocity.z += (dz / len) * strength;
  }

  _applyKnockback(dt) {
    if (this.knockbackVelocity.lengthSq() < 0.001) {
      this.knockbackVelocity.set(0, 0, 0);
      return;
    }
    this.object.position.x += this.knockbackVelocity.x * dt;
    this.object.position.z += this.knockbackVelocity.z * dt;
    this.knockbackVelocity.multiplyScalar(Math.exp(-KNOCKBACK_DRAG * dt));
  }

  _clearDeathGiblets() {
    if (!this.scene) return;
    for (const g of this.deathGiblets) this.scene.remove(g.mesh);
    this.deathGiblets.length = 0;
  }

  // Optimus is destroyed: hide the model and blow a fiery debris cloud out of
  // his position. The trails keep animating afterward via stepDeathFx().
  explode() {
    if (this.dead) return;
    this.dead = true;
    this.velocity.set(0, 0, 0);
    this._setAxeVisible(false);
    this._setDamageFlash(0);
    this.object.visible = false;
    this._clearDeathGiblets();

    const base = this.object.position;
    const center = this._tmp.set(base.x, 4.5, base.z); // mid-body height
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();

    // fiery core blast (additive fire trail blooms)
    for (let i = 0; i < 80; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const horiz = 6 + Math.random() * 26;
      v.set(Math.cos(a) * horiz, 4 + Math.random() * 18, Math.sin(a) * horiz);
      p.copy(center).set(center.x + (Math.random() - 0.5) * 3, center.y + (Math.random() - 0.5) * 4, center.z + (Math.random() - 0.5) * 3);
      this._spawnParticle(this.fireTrail, p, v, 0.35 + Math.random() * 0.6,
        1.2 + Math.random() * 3.2, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 12);
    }
    // billowing smoke
    for (let i = 0; i < 55; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const horiz = 2 + Math.random() * 10;
      v.set(Math.cos(a) * horiz, 3 + Math.random() * 7, Math.sin(a) * horiz);
      p.set(center.x + (Math.random() - 0.5) * 4, center.y + Math.random() * 3, center.z + (Math.random() - 0.5) * 4);
      this._spawnParticle(this.smokeTrail, p, v, 0.7 + Math.random() * 0.8,
        2.0 + Math.random() * 3.5, 1.6 + Math.random() * 2.0, (Math.random() - 0.5) * 4);
    }
    // low-arc sparks/debris kicked off the ground
    for (let i = 0; i < 30; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const horiz = 10 + Math.random() * 24;
      v.set(Math.cos(a) * horiz, 6 + Math.random() * 12, Math.sin(a) * horiz);
      p.set(base.x, 1.5, base.z);
      this._spawnParticle(this.fireTrail, p, v, 0.4 + Math.random() * 0.5,
        0.5 + Math.random() * 1.0, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 16);
    }

    for (let i = 0; i < DEATH_GIBLET_COUNT; i += 1) {
      const mesh = new THREE.Mesh(
        this.deathGibletGeometry,
        this.deathGibletMaterials[i % this.deathGibletMaterials.length]
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        center.x + (Math.random() - 0.5) * 3.2,
        center.y + (Math.random() - 0.5) * 4.2,
        center.z + (Math.random() - 0.5) * 3.2
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.scale.set(
        0.35 + Math.random() * 0.95,
        0.25 + Math.random() * 0.75,
        0.35 + Math.random() * 1.1
      );
      const a = Math.random() * Math.PI * 2;
      const horiz = 9 + Math.random() * 22;
      this.scene.add(mesh);
      this.deathGiblets.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(a) * horiz, 8 + Math.random() * 18, Math.sin(a) * horiz),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16
        ),
        floorY: mesh.scale.y * 0.5,
      });
    }
  }

  _updateDeathGiblets(dt) {
    for (const g of this.deathGiblets) {
      g.velocity.y -= 26 * dt;
      g.mesh.position.addScaledVector(g.velocity, dt);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.y += g.spin.y * dt;
      g.mesh.rotation.z += g.spin.z * dt;
      if (g.mesh.position.y < g.floorY) {
        g.mesh.position.y = g.floorY;
        g.velocity.y = Math.abs(g.velocity.y) * 0.32;
        g.velocity.x *= 0.72;
        g.velocity.z *= 0.72;
        g.spin.multiplyScalar(0.82);
      }
    }
  }

  // Keep the death flash/explosion animating while gameplay is paused.
  stepDeathFx(dt) {
    this._updateDamageFlash(dt);
    this._updateTrails(dt);
    this._updateDeathGiblets(dt);
    if (this.object.visible) this.mixer.update(dt);
  }

  flashDamage() {
    this.damageFlashTimer = DAMAGE_FLASH_DURATION;
    this._setDamageFlash(1);
  }

  _setDamageFlash(amount) {
    const red = new THREE.Color(0xff1f1f);
    for (const entry of this.damageFlashMaterials) {
      const { mat } = entry;
      if (mat.color && entry.color) mat.color.copy(entry.color).lerp(red, amount * 0.72);
      if (mat.emissive) {
        if (entry.emissive) mat.emissive.copy(entry.emissive).lerp(red, amount);
        else mat.emissive.copy(red);
        mat.emissiveIntensity = entry.emissiveIntensity + amount * 3.2;
      }
    }
  }

  _updateDamageFlash(dt) {
    if (this.damageFlashTimer <= 0) return;
    this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
    const t = this.damageFlashTimer / DAMAGE_FLASH_DURATION;
    const flicker = 0.45 + Math.abs(Math.sin(this.damageFlashTimer * 55)) * 0.55;
    this._setDamageFlash(t * flicker);
    if (this.damageFlashTimer <= 0) this._setDamageFlash(0);
  }

  // Hold the axe at a constant on-screen size by dividing out Bone_axe's live
  // (small, animated) world scale. Only matters while the axe is shown.
  _syncAxeScale() {
    if (!this.axeBone) return;
    const boneScale = this.axeBone.getWorldScale(this._tmpScale).x || 1;
    const s = this._axeWorldScaleTarget / boneScale;
    for (const m of this.axeMeshes) { if (m.visible) m.scale.setScalar(s); }
  }

  // Start a one-shot melee attack. Plants the player, plays the clip to
  // completion (input locked), reveals the weapon for the swing, and fires the
  // hit window once. Ignored unless in robot mode and not already busy.
  attack(type) {
    if (this.debugAnimationPreview) return;
    if (!this.canAttack) return;
    const cfg = ATTACKS[type];
    if (!cfg) { console.warn('unknown attack', type); return; }
    const clip = this.clipByName[cfg.clip];
    if (!clip) { console.warn('missing attack clip', cfg.clip); return; }

    this.attacking = true;
    this.attackCfg = cfg;
    this.attackName = type;
    this.attackElapsed = 0;
    const startTime = cfg.startFrame ? cfg.startFrame / ATTACK_ANIM_FPS : 0;
    const endTime = cfg.endFrame ? cfg.endFrame / ATTACK_ANIM_FPS : clip.duration;
    this.attackDuration = Math.max(0, Math.min(clip.duration, endTime) - startTime);
    this.attackHitTime = cfg.hitFrame
      ? Math.max(0, cfg.hitFrame / ATTACK_ANIM_FPS - startTime)
      : clip.duration * cfg.hit;
    this.hitFired = false;
    this.velocity.set(0, 0, 0); // plant in place; keep current heading
    if (cfg.weapon === 'axe') { this._setAxeVisible(true); this._syncAxeScale(); }
    const action = this.play(cfg.clip, { loop: false, fade: cfg.fade, clamp: true });
    if (action && startTime > 0) action.time = startTime;
  }

  tryBoost() {
    if (this.debugAnimationPreview) return;
    if (this.mode !== MODE.VEHICLE || this.transforming || this.boostCooldown > 0) return;
    this.boostTimer = BOOST_DURATION;
    this.boostCooldown = BOOST_COOLDOWN;
    this.skidEmit = SKID_MARK_DISTANCE;
  }

  silenceMovementSfx() {
    updateMovementSfx({ active: false });
  }

  action(name) {
    if (!this.actions[name]) {
      const c = this.clipByName[name];
      if (!c) { console.warn('missing clip', name); return null; }
      this.actions[name] = this.mixer.clipAction(c);
    }
    return this.actions[name];
  }

  play(name, { loop = true, fade = 0.2, timeScale = 1, clamp = false } = {}) {
    if (this.currentName === name) return this.current;
    const a = this.action(name);
    if (!a) return null;
    a.enabled = true;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = clamp;
    a.setEffectiveTimeScale(timeScale);
    a.setEffectiveWeight(1);
    a.reset().fadeIn(fade).play();
    if (this.current && this.current !== a) this.current.fadeOut(fade);
    this.current = a;
    this.currentName = name;
    return a;
  }

  toggleTransform() {
    if (this.debugAnimationPreview) return;
    if (this.transforming || this.attacking) return;
    if (this.mode === MODE.ROBOT) {
      this.transforming = true;
      playSegment(SFX_TO_VEHICLE.start, SFX_TO_VEHICLE.end, { fadeOut: SFX_TO_VEHICLE.fadeOut });
      const clip = this.clipByName['transform_v'];
      this.transformTimer = clip ? clip.duration : 1.0;
      this.transformDuration = this.transformTimer;
      this.transformRingFired = false;
      this.play('transform_v', { loop: false, fade: 0.1, clamp: true });
      this.onTransformDone = () => {
        this.mode = MODE.VEHICLE;
        this.wheelDetected = false;
        this._burstTransformDust();
        this.play('vehicle_idle01', { loop: true, fade: 0.15 });
      };
    } else {
      this.transforming = true;
      playSegment(SFX_TO_ROBOT.start, SFX_TO_ROBOT.end);
      this.boostTimer = 0;
      this.boostFireEmit = 0;
      this.skidEmit = 0;
      this._clearTrail(this.smokeTrail);
      this._clearTrail(this.fireTrail);
      this.smokeEmit = 0;
      const clip = this.clipByName['transform_r'];
      const dur = clip ? clip.duration : 1.3;
      this.transformTimer = TRANSFORM_TO_ROBOT_TIME;
      this.transformDuration = this.transformTimer;
      this.transformRingFired = false;
      // speed the long unfold clip up to finish within TRANSFORM_TO_ROBOT_TIME
      this.play('transform_r', { loop: false, fade: 0.1, clamp: true, timeScale: dur / TRANSFORM_TO_ROBOT_TIME });
      this.onTransformDone = () => {
        this.mode = MODE.ROBOT;
        this._burstTransformDust();
        this.play('idle02', { loop: true, fade: 0.2 });
      };
    }
  }

  // Find each wheel bone's local axle axis = the local axis whose world
  // direction best matches the truck's lateral (right) axis. This is invariant
  // to the truck's facing, so we only need to detect it once.
  _detectWheelAxes() {
    this.object.updateMatrixWorld(true);
    const rightWorld = new THREE.Vector3(1, 0, 0).transformDirection(this.object.matrixWorld).normalize();
    const candidates = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    this.wheelData = this.wheelBones.map((bone) => {
      let best = candidates[0], bestDot = 0;
      for (const a of candidates) {
        const d = a.clone().transformDirection(bone.matrixWorld).normalize().dot(rightWorld);
        if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; best = a; }
      }
      return {
        bone,
        axis: best.clone(),
        sign: Math.sign(bestDot) || 1,
        baseQuaternion: bone.quaternion.clone(),
      };
    });
    this.wheelDetected = true;
  }

  // Re-apply absolute spin on top of the static vehicle pose each frame.
  // Must run AFTER mixer.update so it isn't overwritten by the clip.
  _updateWheels(dt) {
    if (this.mode !== MODE.VEHICLE || !this.wheelBones.length) return;
    if (!this.wheelDetected) this._detectWheelAxes();
    const speed = this.velocity.length();
    if (speed > STOP_SPEED) this.wheelSpin += speed * dt * WHEEL_SPIN_RATE;
    for (const w of this.wheelData) {
      w.bone.quaternion.copy(w.baseQuaternion);
      w.bone.rotateOnAxis(w.axis, WHEEL_SPIN_DIR * w.sign * this.wheelSpin);
    }
  }

  _spawnParticle(trail, position, velocity, lifetime, size, growth = 1.8, angularSpeed = 0) {
    if (!trail) return;
    const i = trail.cursor;
    trail.cursor = (trail.cursor + 1) % trail.count;
    trail.positions[i * 3] = position.x;
    trail.positions[i * 3 + 1] = position.y;
    trail.positions[i * 3 + 2] = position.z;
    trail.velocities[i].copy(velocity);
    trail.ages[i] = 0;
    trail.lifetimes[i] = lifetime;
    trail.alphas[i] = 1;
    trail.sizes[i] = size;
    trail.baseSizes[i] = size;
    trail.growths[i] = growth;
    trail.rotations[i] = Math.random() * Math.PI * 2;
    trail.angularSpeeds[i] = angularSpeed;
    trail.seeds[i] = Math.random() * 20;
    if (trail.colorStops) {
      sampleColorStops(trail.colorStops, 0, trail._colorTmp).toArray(trail.colors, i * 3);
      trail.points.geometry.attributes.color.needsUpdate = true;
    }
    trail.points.geometry.attributes.seed.needsUpdate = true;
  }

  _clearTrail(trail) {
    if (!trail) return;
    for (let i = 0; i < trail.count; i += 1) {
      trail.lifetimes[i] = 0;
      trail.alphas[i] = 0;
      trail.sizes[i] = 0;
      trail.positions[i * 3 + 1] = -1000;
    }
    trail.points.geometry.attributes.position.needsUpdate = true;
    trail.points.geometry.attributes.alpha.needsUpdate = true;
    trail.points.geometry.attributes.size.needsUpdate = true;
  }

  _clearSkidMarks() {
    for (const mark of this.skidMarks) {
      mark.active = false;
      mark.age = SKID_MARK_LIFETIME;
      mark.mesh.material.opacity = 0;
      mark.mesh.position.y = -1000;
    }
  }

  _spawnSkidMark(position, heading, opacity) {
    if (!this.skidMarks.length) return;
    const mark = this.skidMarks.reduce((oldest, candidate) =>
      candidate.age > oldest.age ? candidate : oldest
    );
    mark.active = true;
    mark.age = 0;
    mark.mesh.position.set(position.x, 0.035, position.z);
    mark.mesh.rotation.set(0, heading, 0);
    mark.mesh.material.opacity = opacity;
  }

  _stampBoostSkids() {
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const base = this.object.position;
    for (const side of [-1, 1]) {
      const p = base.clone()
        .addScaledVector(right, side * 0.72)
        .addScaledVector(forward, -2.0);
      this._spawnSkidMark(p, this.heading, 0.46);
    }
  }

  _updateSkidMarks(dt) {
    for (const mark of this.skidMarks) {
      if (!mark.active) continue;
      mark.age += dt;
      const t = mark.age / SKID_MARK_LIFETIME;
      if (t >= 1) {
        mark.active = false;
        mark.mesh.material.opacity = 0;
        mark.mesh.position.y = -1000;
      } else {
        mark.mesh.material.opacity = 0.42 * (1 - t) * (1 - t);
      }
    }
  }

  _stepTrail(trail, dt, riseDrag = 0.98, minY = -Infinity, rise = 0, growth = 1.8) {
    if (!trail) return;
    for (let i = 0; i < trail.count; i += 1) {
      const lifetime = trail.lifetimes[i];
      if (lifetime <= 0) continue;

      trail.ages[i] += dt;
      const t = trail.ages[i] / lifetime;
      if (t >= 1) {
        trail.lifetimes[i] = 0;
        trail.alphas[i] = 0;
        trail.positions[i * 3 + 1] = -1000;
        continue;
      }

      const v = trail.velocities[i];
      v.y += rise * dt;
      trail.positions[i * 3] += v.x * dt;
      trail.positions[i * 3 + 1] += v.y * dt;
      trail.positions[i * 3 + 2] += v.z * dt;
      if (trail.positions[i * 3 + 1] < minY) {
        trail.positions[i * 3 + 1] = minY;
        v.y = Math.max(v.y, 0);
      }
      v.multiplyScalar(riseDrag);
      trail.alphas[i] = (1 - t) * (1 - t);
      trail.rotations[i] += trail.angularSpeeds[i] * dt;
      trail.sizes[i] = trail.baseSizes[i] * (1 + t * (trail.growths[i] || growth));
      if (trail.colorStops) sampleColorStops(trail.colorStops, t, trail._colorTmp).toArray(trail.colors, i * 3);
    }

    trail.points.geometry.attributes.position.needsUpdate = true;
    trail.points.geometry.attributes.alpha.needsUpdate = true;
    trail.points.geometry.attributes.size.needsUpdate = true;
    trail.points.geometry.attributes.rotation.needsUpdate = true;
    if (trail.colorStops) trail.points.geometry.attributes.color.needsUpdate = true;
  }

  _updateTrails(dt) {
    updateMovementSfx({
      mode: this.mode,
      speed: this.velocity.length(),
      boosting: this.boosting,
      active: !this.transforming && !this.dead,
    });
    this._updateSkidMarks(dt);
    this._stepTrail(this.dustTrail, dt, 0.92, 0.38, 0.45, 2.3);
    this._stepTrail(this.smokeTrail, dt, 0.96);
    this._stepTrail(this.fireTrail, dt, 0.84);
    this._stepTrail(this.transformSparkTrail, dt, 0.82);

    const speed = this.velocity.length();
    if (speed < 1) return;

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const backDrift = this._tmp.copy(this.velocity).multiplyScalar(-1 / Math.max(speed, 1));
    const base = this.object.position;

    if (this.mode === MODE.ROBOT && !this.transforming) {
      this.footstepSfxEmit += speed * dt;
      while (this.footstepSfxEmit >= FOOTSTEP_SFX_DISTANCE) {
        this.footstepSfxEmit -= FOOTSTEP_SFX_DISTANCE;
        playMovementSfx('footstep');
      }

      this.dustEmit += speed * dt;
      while (this.dustEmit >= DUST_STEP_DISTANCE) {
        this.dustEmit -= DUST_STEP_DISTANCE;
        this.dustStepSide *= -1;
        const side = this.dustStepSide;
        const burstCount = 1 + Math.floor(Math.random() * 5);

        for (let n = 0; n < burstCount; n += 1) {
          const lateralScatter = (Math.random() - 0.5) * 1.25;
          const p = base.clone()
            .addScaledVector(right, side * (0.65 + Math.random() * 0.45) + lateralScatter)
            .addScaledVector(forward, -1.15 + Math.random() * 0.9);
          p.y = 0.44 + Math.random() * 0.22;

          const v = backDrift.clone().multiplyScalar(0.35 + Math.random() * 3.2);
          v.addScaledVector(right, side * (0.4 + Math.random() * 2.2) + lateralScatter * (1.6 + Math.random() * 2.2));
          v.addScaledVector(forward, (Math.random() - 0.5) * 1.6);
          v.x += (Math.random() - 0.5) * 1.8;
          v.y = 0.18 + Math.random() * 1.05;
          v.z += (Math.random() - 0.5) * 1.8;

          this._spawnParticle(
            this.dustTrail,
            p,
            v,
            0.16 + Math.random() * 0.38,
            0.35 + Math.random() * 1.25,
            0.45 + Math.random() * 1.6,
            (Math.random() - 0.5) * 6
          );
        }
      }
    } else if (this.mode === MODE.VEHICLE && !this.transforming) {
      this.smokeEmit += dt * SMOKE_RATE * Math.min(1, speed / SPEED_VEHICLE);
      while (this.smokeEmit >= 1) {
        this.smokeEmit -= 1;
        for (const side of [-1, 1]) {
          const p = base.clone()
            .addScaledVector(right, side * 0.7)
            .addScaledVector(forward, 0.15 + Math.random() * 0.18);
          p.y = 4.05 + Math.random() * 0.25;
          const v = backDrift.clone().multiplyScalar(2.4 + Math.random() * 1.2);
          v.x += (Math.random() - 0.5) * 0.7;
          v.y = 2.0 + Math.random() * 0.8;
          v.z += (Math.random() - 0.5) * 0.7;
          this._spawnParticle(this.smokeTrail, p, v, 0.16875 + Math.random() * 0.084375, 0.22 + Math.random() * 0.58);
        }
      }

      if (this.boosting) {
        this.skidEmit += speed * dt;
        while (this.skidEmit >= SKID_MARK_DISTANCE) {
          this.skidEmit -= SKID_MARK_DISTANCE;
          this._stampBoostSkids();
        }

        this.boostFireEmit += dt * BOOST_FIRE_RATE;
        while (this.boostFireEmit >= 1) {
          this.boostFireEmit -= 1;
          for (const side of [-1, 1]) {
            const nozzle = base.clone()
              .addScaledVector(right, side * 0.52)
              .addScaledVector(forward, -2.35);
            nozzle.y = 0.72 + Math.random() * 0.16;

            const coreP = nozzle.clone().addScaledVector(forward, -0.25 - Math.random() * 0.35);
            const coreV = backDrift.clone().multiplyScalar(14 + Math.random() * 6);
            coreV.addScaledVector(right, side * (Math.random() - 0.5) * 0.55);
            coreV.y = 0.12 + Math.random() * 0.28;
            this._spawnParticle(
              this.fireTrail,
              coreP,
              coreV,
              0.12 + Math.random() * 0.08,
              0.22 + Math.random() * 0.34,
              2.4 + Math.random() * 1.2,
              (Math.random() - 0.5) * 7
            );

            if (Math.random() < 0.55) {
              const plumeP = nozzle.clone()
                .addScaledVector(forward, -0.95 - Math.random() * 0.75)
                .addScaledVector(right, side * (Math.random() - 0.5) * 0.42);
              plumeP.y = 0.58 + Math.random() * 0.22;
              const plumeV = backDrift.clone().multiplyScalar(8 + Math.random() * 5);
              plumeV.addScaledVector(right, side * (0.35 + Math.random() * 0.65));
              plumeV.y = 0.18 + Math.random() * 0.45;
              this._spawnParticle(
                this.fireTrail,
                plumeP,
                plumeV,
                0.2 + Math.random() * 0.16,
                0.65 + Math.random() * 1.05,
                1.1 + Math.random() * 1.0,
                (Math.random() - 0.5) * 11
              );
            }
          }
        }
      }
    }
  }

  _coastToStop(dt, stopSmooth = TRANSFORM_STOP_SMOOTH) {
    const k = 1 - Math.exp(-stopSmooth * dt);
    this.velocity.lerp(this._tmp.set(0, 0, 0), k);
    if (this.velocity.lengthSq() < STOP_SPEED * STOP_SPEED) this.velocity.set(0, 0, 0);

    this.object.position.x += this.velocity.x * dt;
    this.object.position.z += this.velocity.z * dt;

    const speed = this.velocity.length();
    if (speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z) + MODEL_YAW_OFFSET;
      const turnRate = this.mode === MODE.VEHICLE ? VEHICLE_TURN_RATE : ROBOT_TURN_RATE;
      this.heading = angleLerp(this.heading, target, Math.min(1, turnRate * dt));
      this.object.rotation.y = this.heading;
    }
  }

  update(dt, axis) {
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    this._updateDamageFlash(dt);
    this._applyKnockback(dt);

    if (this.debugAnimationPreview) {
      this.velocity.set(0, 0, 0);
      this.knockbackVelocity.set(0, 0, 0);
      this.mixer.update(dt);
      this._updateTrails(dt);
      return;
    }

    // resolve an in-progress transform (input is locked meanwhile)
    if (this.transforming) {
      this._coastToStop(dt);
      this.transformTimer -= dt;
      if (!this.transformRingFired && this.transformTimer <= this.transformDuration * 0.5) {
        this.transformRingFired = true;
        this._spawnTransformRing(this.mode === MODE.ROBOT ? 0x39d8ff : 0x8ff5ff);
      }
      if (this.transformTimer <= 0) {
        this.transforming = false;
        this.transformDuration = 0;
        this.transformRingFired = false;
        const done = this.onTransformDone;
        this.onTransformDone = null;
        if (done) done();
      }
      this.mixer.update(dt);
      this._updateTrails(dt);
      return;
    }

    // resolve an in-progress attack (input locked, player planted in place)
    if (this.attacking) {
      this.attackElapsed += dt;
      if (!this.hitFired && this.attackElapsed >= this.attackHitTime) {
        this.hitFired = true;
        if (this.onHit) this.onHit(this.attackName, this.attackCfg);
      }
      this.object.rotation.y = this.heading;
      this.mixer.update(dt);
      this._syncAxeScale();
      this._updateTrails(dt);
      if (this.attackElapsed >= this.attackDuration) {
        if (this.attackCfg.weapon === 'axe') this._setAxeVisible(false);
        this.attacking = false;
        this.attackCfg = null;
        this.attackName = null;
        this.attackHitTime = 0;
      }
      return;
    }

    this._move(dt, axis);

    this.object.rotation.y = this.heading;
    this.mixer.update(dt);
    this._updateWheels(dt);
    this._updateTrails(dt);
  }

  // Shared omni-directional movement for both modes: eased acceleration toward
  // the input direction, facing smoothly turns to match velocity.
  _move(dt, axis) {
    const isVehicle = this.mode === MODE.VEHICLE;
    const maxSpeed = (isVehicle ? SPEED_VEHICLE : SPEED_ROBOT) * (this.boosting ? BOOST_SPEED_MULT : 1);
    const accelSmooth = isVehicle ? VEHICLE_ACCEL_SMOOTH : ROBOT_ACCEL_SMOOTH;
    const stopSmooth = isVehicle ? VEHICLE_STOP_SMOOTH : ROBOT_STOP_SMOOTH;
    const turnRate = (isVehicle ? VEHICLE_TURN_RATE : ROBOT_TURN_RATE) * (this.boosting ? BOOST_TURN_MULT : 1);

    this._dir.set(0, 0, 0)
      .addScaledVector(this.fwd, -axis.z)
      .addScaledVector(this.right, axis.x);
    let hasInput = this._dir.lengthSq() > 0.0001;
    if (hasInput) this._dir.normalize();
    if (isVehicle && this.boosting) {
      this._dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      hasInput = true;
    }

    if (isVehicle && this.boosting) {
      const speed = this.velocity.length();
      const targetSpeed = speed + (maxSpeed - speed) * (1 - Math.exp(-accelSmooth * dt));
      this.velocity.copy(this._dir).multiplyScalar(targetSpeed);
    } else if (isVehicle && hasInput && this.velocity.lengthSq() > STOP_SPEED * STOP_SPEED) {
      const speed = this.velocity.length();
      const targetSpeed = speed + (maxSpeed - speed) * (1 - Math.exp(-accelSmooth * dt));
      const currentAngle = Math.atan2(this.velocity.x, this.velocity.z);
      const targetAngle = Math.atan2(this._dir.x, this._dir.z);
      const steeredAngle = angleLerp(currentAngle, targetAngle, Math.min(1, turnRate * dt));
      this.velocity.set(
        Math.sin(steeredAngle) * targetSpeed,
        0,
        Math.cos(steeredAngle) * targetSpeed
      );
    } else {
      // Robot mode remains responsive; truck braking keeps its heavier easing.
      const targetVel = this._tmp.copy(this._dir).multiplyScalar(hasInput ? maxSpeed : 0);
      const k = 1 - Math.exp(-(hasInput ? accelSmooth : stopSmooth) * dt);
      this.velocity.lerp(targetVel, k);
      if (!hasInput && this.velocity.lengthSq() < STOP_SPEED * STOP_SPEED) this.velocity.set(0, 0, 0);
    }

    this.object.position.x += this.velocity.x * dt;
    this.object.position.z += this.velocity.z * dt;

    const speed = this.velocity.length();
    this.moving = speed > 0.4;
    if (speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z) + MODEL_YAW_OFFSET;
      const previousHeading = this.heading;
      this.heading = angleLerp(this.heading, target, Math.min(1, turnRate * dt));
      if (isVehicle) {
        const oldForward = new THREE.Vector3(Math.sin(previousHeading), 0, Math.cos(previousHeading));
        const newForward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
        this.object.position.addScaledVector(oldForward, VEHICLE_NOSE_PIVOT_OFFSET);
        this.object.position.addScaledVector(newForward, -VEHICLE_NOSE_PIVOT_OFFSET);
      }
    }

    if (this.mode === MODE.VEHICLE) this.play('vehicle_idle01');
    else this.play(this.moving ? 'dash' : 'idle02');
  }
}
