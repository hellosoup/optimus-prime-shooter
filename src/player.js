import * as THREE from 'three';

export const MODE = { ROBOT: 'robot', VEHICLE: 'vehicle' };

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
const DUST_STEP_DISTANCE = 2.2;   // distance between robot dust footstep bursts
const SMOKE_RATE = 40;           // particles per second at truck top speed, per stack
const BOOST_DURATION = 0.9;
const BOOST_COOLDOWN = 2.4;
const BOOST_SPEED_MULT = 1.85;
const BOOST_TURN_MULT = 0.22;
const BOOST_FIRE_RATE = 95;

// shortest signed angle from a to b
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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
    clips.forEach((c) => { this.clipByName[shortClip(c.name)] = c; });

    this.actions = {};
    this.current = null;
    this.currentName = null;

    this.mode = MODE.ROBOT;
    this.transforming = false;
    this.transformTimer = 0;
    this.onTransformDone = null;
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

    // wheel bones (spun manually in vehicle mode for a rolling effect)
    this.wheelBones = [];
    this.object.traverse((b) => { if (b.isBone && /wheel/i.test(b.name)) this.wheelBones.push(b); });
    this.wheelData = [];
    this.wheelDetected = false;
    this.wheelSpin = 0;

    this.dustTrail = scene ? makeTrail(120, 0xa68f6f, 34, 0.45, false) : null;
    this.smokeTrail = scene ? makeTrail(140, 0x87909a, 24) : null;
    this.fireTrail = scene ? makeTrail(120, 0xff6a1a, 30, 0.9) : null;
    this.dustEmit = 0;
    this.dustStepSide = 1;
    this.smokeEmit = 0;
    if (scene) {
      this.dustTrail.points.renderOrder = 20;
      this.fireTrail.points.material.blending = THREE.AdditiveBlending;
      scene.add(this.dustTrail.points);
      scene.add(this.smokeTrail.points);
      scene.add(this.fireTrail.points);
    }

    this.play('idle02');
  }

  get speed() { return this.mode === MODE.VEHICLE ? SPEED_VEHICLE : SPEED_ROBOT; }
  get canShoot() { return this.mode === MODE.ROBOT && !this.transforming; }
  get boosting() { return this.mode === MODE.VEHICLE && this.boostTimer > 0; }

  tryBoost() {
    if (this.mode !== MODE.VEHICLE || this.transforming || this.boostCooldown > 0) return;
    this.boostTimer = BOOST_DURATION;
    this.boostCooldown = BOOST_COOLDOWN;
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
    if (this.transforming) return;
    if (this.mode === MODE.ROBOT) {
      this.transforming = true;
      const clip = this.clipByName['transform_v'];
      this.transformTimer = clip ? clip.duration : 1.0;
      this.play('transform_v', { loop: false, fade: 0.1, clamp: true });
      this.onTransformDone = () => {
        this.mode = MODE.VEHICLE;
        this.wheelDetected = false;
        this.play('vehicle_idle01', { loop: true, fade: 0.15 });
      };
    } else {
      this.transforming = true;
      this.boostTimer = 0;
      this.boostFireEmit = 0;
      this._clearTrail(this.smokeTrail);
      this._clearTrail(this.fireTrail);
      this.smokeEmit = 0;
      const clip = this.clipByName['transform_r'];
      const dur = clip ? clip.duration : 1.3;
      this.transformTimer = TRANSFORM_TO_ROBOT_TIME;
      // speed the long unfold clip up to finish within TRANSFORM_TO_ROBOT_TIME
      this.play('transform_r', { loop: false, fade: 0.1, clamp: true, timeScale: dur / TRANSFORM_TO_ROBOT_TIME });
      this.onTransformDone = () => {
        this.mode = MODE.ROBOT;
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
    }

    trail.points.geometry.attributes.position.needsUpdate = true;
    trail.points.geometry.attributes.alpha.needsUpdate = true;
    trail.points.geometry.attributes.size.needsUpdate = true;
    trail.points.geometry.attributes.rotation.needsUpdate = true;
  }

  _updateTrails(dt) {
    this._stepTrail(this.dustTrail, dt, 0.92, 0.38, 0.45, 2.3);
    this._stepTrail(this.smokeTrail, dt, 0.96);
    this._stepTrail(this.fireTrail, dt, 0.84);

    const speed = this.velocity.length();
    if (speed < 1) return;

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const backDrift = this._tmp.copy(this.velocity).multiplyScalar(-1 / Math.max(speed, 1));
    const base = this.object.position;

    if (this.mode === MODE.ROBOT && !this.transforming) {
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
        this.boostFireEmit += dt * BOOST_FIRE_RATE;
        while (this.boostFireEmit >= 1) {
          this.boostFireEmit -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          const p = base.clone()
            .addScaledVector(right, side * (0.35 + Math.random() * 0.45))
            .addScaledVector(forward, -2.25 + Math.random() * 0.45);
          p.y = 0.65 + Math.random() * 0.35;

          const v = backDrift.clone().multiplyScalar(6 + Math.random() * 5);
          v.addScaledVector(right, (Math.random() - 0.5) * 2.2);
          v.y = 0.35 + Math.random() * 1.1;
          this._spawnParticle(
            this.fireTrail,
            p,
            v,
            0.18 + Math.random() * 0.16,
            0.45 + Math.random() * 0.9,
            0.15 + Math.random() * 0.45,
            (Math.random() - 0.5) * 10
          );
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

    // resolve an in-progress transform (input is locked meanwhile)
    if (this.transforming) {
      this._coastToStop(dt);
      this.transformTimer -= dt;
      if (this.transformTimer <= 0) {
        this.transforming = false;
        const done = this.onTransformDone;
        this.onTransformDone = null;
        if (done) done();
      }
      this.mixer.update(dt);
      this._updateTrails(dt);
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
