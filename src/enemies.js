// Enemy waves: Decepticon-like robot drones that spawn off-screen, seek Optimus,
// and die in one hit. Difficulty ramps each wave (more enemies, faster). One-hit
// kills come from: melee attacks (via handleAttack, called from player.onHit),
// or ramming/boosting in truck mode (detected on contact in update).

import * as THREE from 'three';
import { MODE } from './player.js';

const ENEMY_RADIUS = 2.2;
const PLAYER_RADIUS = 3.2;
const SPAWN_RADIUS = 48;          // off-screen ring distance from the player
const RAM_KILL_SPEED = 24;        // truck speed above which contact destroys enemies
const CONTACT_DAMAGE = 12;        // damage an enemy deals to Optimus on touch
const SPAWN_INTERVAL = 0.35;      // stagger between spawns within a wave
const FIRST_WAVE_DELAY = 2.0;     // let the opening wave banner breathe
const WAVE_BREAK = 3.0;           // seconds between clearing a wave and the next
const ENEMY_KNOCKBACK_DRAG = 8.5;
const ENEMY_SEPARATION = ENEMY_RADIUS * 2.1;

const ATTACK01_RANGE = 8;         // left-click: short forward hit
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(70)); // forward cone half-angle
const SMASH_RANGE = 12;           // right-click: radial AoE
const BURST_LIFETIME = 0.42;
const BURST_SPARKS = 18;
const GIBLET_COUNT = 10;

function addPart(parent, geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export class EnemyManager {
  constructor(scene, arenaHalf) {
    this.scene = scene;
    this.arenaHalf = arenaHalf;
    this.enemies = [];

    this.geo = {
      torso: new THREE.BoxGeometry(2.0, 2.25, 1.05),
      head: new THREE.BoxGeometry(1.25, 0.95, 0.95),
      eye: new THREE.BoxGeometry(0.85, 0.16, 0.08),
      shoulder: new THREE.BoxGeometry(0.65, 0.65, 0.8),
      shoulderFin: new THREE.BoxGeometry(0.22, 1.35, 0.72),
      arm: new THREE.BoxGeometry(0.42, 1.05, 0.42),
      claw: new THREE.BoxGeometry(0.72, 0.3, 0.72),
      hip: new THREE.BoxGeometry(1.55, 0.55, 0.85),
      leg: new THREE.BoxGeometry(0.5, 1.05, 0.5),
      foot: new THREE.BoxGeometry(0.78, 0.35, 1.15),
      horn: new THREE.ConeGeometry(0.16, 0.95, 4),
      crest: new THREE.BoxGeometry(0.28, 0.72, 0.12),
      spark: new THREE.BoxGeometry(0.2, 0.2, 0.75),
      giblet: new THREE.BoxGeometry(0.55, 0.38, 0.75),
      ring: new THREE.TorusGeometry(1, 0.04, 8, 36),
      explosion: new THREE.SphereGeometry(1, 18, 10),
    };
    this.mat = {
      armor: new THREE.MeshStandardMaterial({
        color: 0x1d1230, emissive: 0x4d1686, emissiveIntensity: 0.8,
        metalness: 0.75, roughness: 0.35,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: 0x090912, emissive: 0x1f0a35, emissiveIntensity: 0.45,
        metalness: 0.85, roughness: 0.42,
      }),
      glow: new THREE.MeshStandardMaterial({
        color: 0xb52cff, emissive: 0x9a24ff, emissiveIntensity: 2.6,
        metalness: 0.3, roughness: 0.25,
      }),
      spark: new THREE.MeshBasicMaterial({
        color: 0xd8a3ff, transparent: true, opacity: 1,
      }),
      ring: new THREE.MeshBasicMaterial({
        color: 0x9a24ff, transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      giblet: [
        new THREE.MeshStandardMaterial({ color: 0x12091f, metalness: 0.8, roughness: 0.38 }),
        new THREE.MeshStandardMaterial({ color: 0x301457, metalness: 0.75, roughness: 0.42 }),
        new THREE.MeshStandardMaterial({ color: 0x8a2bd6, metalness: 0.35, roughness: 0.46 }),
      ],
      explosion: new THREE.MeshBasicMaterial({
        color: 0xff8a2a, transparent: true, opacity: 0.9, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      smoke: new THREE.MeshBasicMaterial({
        color: 0x6c5a70, transparent: true, opacity: 0.45, depthWrite: false,
      }),
    };

    this.effects = [];
    this.onKill = null; // ({ position, reason }) => {}
    this.onWaveStart = null; // (waveNumber) => {}
    this.wave = 0;
    this.kills = 0;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this.enemySpeed = 0;
    this.waveBreak = 0;
    this._tmp = new THREE.Vector3();
  }

  reset() {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    for (const fx of this.effects) {
      this.scene.remove(fx.group);
      fx.sparkMat.dispose();
      fx.ringMat.dispose();
    }
    this.enemies.length = 0;
    this.effects.length = 0;
    this.wave = 0;
    this.kills = 0;
    this.waveBreak = 0;
    this.startWave(1);
  }

  startWave(n) {
    this.wave = n;
    this.spawnQueue = 4 + n * 3;                  // count grows each wave
    this.enemySpeed = Math.min(6 + n * 1.1, 26);  // speed grows, capped
    this.spawnTimer = n === 1 ? FIRST_WAVE_DELAY : 0;
    this.waveBreak = 0;
    if (this.onWaveStart) this.onWaveStart(n);
  }

  get alive() { return this.enemies.length; }

  getRadarTargets() {
    return this.enemies.map((e) => e.mesh.position);
  }

  _createRobot() {
    const bot = new THREE.Group();
    bot.name = 'EnemyRobotDrone';
    bot.userData.parts = {};

    addPart(bot, this.geo.hip, this.mat.dark, new THREE.Vector3(0, 2.45, 0));
    addPart(bot, this.geo.torso, this.mat.armor, new THREE.Vector3(0, 3.8, 0));
    addPart(bot, this.geo.head, this.mat.dark, new THREE.Vector3(0, 5.4, 0));
    addPart(bot, this.geo.eye, this.mat.glow, new THREE.Vector3(0, 5.48, 0.52));
    addPart(bot, this.geo.crest, this.mat.glow, new THREE.Vector3(0, 5.86, 0.5));

    const leftHorn = addPart(bot, this.geo.horn, this.mat.glow, new THREE.Vector3(-0.48, 6.02, 0.12));
    leftHorn.rotation.z = -0.52;
    const rightHorn = addPart(bot, this.geo.horn, this.mat.glow, new THREE.Vector3(0.48, 6.02, 0.12));
    rightHorn.rotation.z = 0.52;

    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();
    leftArm.position.set(-1.28, 4.65, 0);
    rightArm.position.set(1.28, 4.65, 0);
    bot.add(leftArm, rightArm);
    bot.userData.parts.leftArm = leftArm;
    bot.userData.parts.rightArm = rightArm;
    addPart(leftArm, this.geo.shoulder, this.mat.dark, new THREE.Vector3(0, 0, 0));
    const leftFin = addPart(leftArm, this.geo.shoulderFin, this.mat.armor, new THREE.Vector3(-0.42, 0.24, -0.06));
    leftFin.rotation.z = -0.62;
    addPart(leftArm, this.geo.arm, this.mat.armor, new THREE.Vector3(0, -0.78, 0));
    addPart(leftArm, this.geo.claw, this.mat.glow, new THREE.Vector3(0, -1.45, 0.18));
    addPart(rightArm, this.geo.shoulder, this.mat.dark, new THREE.Vector3(0, 0, 0));
    const rightFin = addPart(rightArm, this.geo.shoulderFin, this.mat.armor, new THREE.Vector3(0.42, 0.24, -0.06));
    rightFin.rotation.z = 0.62;
    addPart(rightArm, this.geo.arm, this.mat.armor, new THREE.Vector3(0, -0.78, 0));
    addPart(rightArm, this.geo.claw, this.mat.glow, new THREE.Vector3(0, -1.45, 0.18));

    const leftLeg = new THREE.Group();
    const rightLeg = new THREE.Group();
    leftLeg.position.set(-0.48, 2.35, 0);
    rightLeg.position.set(0.48, 2.35, 0);
    bot.add(leftLeg, rightLeg);
    bot.userData.parts.leftLeg = leftLeg;
    bot.userData.parts.rightLeg = rightLeg;
    addPart(leftLeg, this.geo.leg, this.mat.armor, new THREE.Vector3(0, -0.55, 0));
    addPart(leftLeg, this.geo.leg, this.mat.dark, new THREE.Vector3(0, -1.45, 0));
    addPart(leftLeg, this.geo.foot, this.mat.armor, new THREE.Vector3(0, -2.1, 0.26));
    addPart(rightLeg, this.geo.leg, this.mat.armor, new THREE.Vector3(0, -0.55, 0));
    addPart(rightLeg, this.geo.leg, this.mat.dark, new THREE.Vector3(0, -1.45, 0));
    addPart(rightLeg, this.geo.foot, this.mat.armor, new THREE.Vector3(0, -2.1, 0.26));

    bot.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return bot;
  }

  _spawnKillBurst(position, reason) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = 0;

    const ringMat = this.mat.ring.clone();
    const ring = new THREE.Mesh(this.geo.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.16;
    ring.scale.setScalar(reason === 'smash' ? 1.8 : 1.25);
    group.add(ring);

    const explosionMat = this.mat.explosion.clone();
    const explosion = new THREE.Mesh(this.geo.explosion, explosionMat);
    explosion.position.y = 3.3;
    explosion.scale.setScalar(reason === 'ram' ? 2.0 : 1.45);
    group.add(explosion);

    const smokeMat = this.mat.smoke.clone();
    const smoke = new THREE.Mesh(this.geo.explosion, smokeMat);
    smoke.position.y = 2.4;
    smoke.scale.set(1.2, 0.6, 1.2);
    group.add(smoke);

    const sparkMat = this.mat.spark.clone();
    const sparks = [];
    const giblets = [];
    const burstPower = reason === 'ram' ? 1.45 : reason === 'smash' ? 1.25 : 1;
    for (let i = 0; i < BURST_SPARKS; i += 1) {
      const spark = new THREE.Mesh(this.geo.spark, sparkMat);
      const angle = Math.random() * Math.PI * 2;
      const out = 5 + Math.random() * 8;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * out * burstPower,
        6 + Math.random() * 8,
        Math.sin(angle) * out * burstPower
      );
      spark.position.set((Math.random() - 0.5) * 1.1, 2.6 + Math.random() * 2.1, (Math.random() - 0.5) * 1.1);
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(spark);
      sparks.push({
        mesh: spark,
        velocity,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18
        ),
      });
    }

    for (let i = 0; i < GIBLET_COUNT; i += 1) {
      const giblet = new THREE.Mesh(this.geo.giblet, this.mat.giblet[i % this.mat.giblet.length]);
      const angle = Math.random() * Math.PI * 2;
      const out = (3.5 + Math.random() * 7.5) * burstPower;
      giblet.position.set((Math.random() - 0.5) * 1.4, 2.8 + Math.random() * 2.8, (Math.random() - 0.5) * 1.4);
      giblet.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      giblet.scale.set(0.7 + Math.random() * 0.8, 0.55 + Math.random() * 0.75, 0.7 + Math.random() * 0.9);
      giblet.castShadow = true;
      giblet.receiveShadow = true;
      group.add(giblet);
      giblets.push({
        mesh: giblet,
        velocity: new THREE.Vector3(Math.cos(angle) * out, 5 + Math.random() * 8, Math.sin(angle) * out),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        ),
      });
    }

    this.scene.add(group);
    this.effects.push({ group, ring, explosion, smoke, sparks, giblets, age: 0, sparkMat, ringMat, explosionMat, smokeMat });
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const fx = this.effects[i];
      fx.age += dt;
      const t = fx.age / BURST_LIFETIME;
      if (t >= 1) {
        this.scene.remove(fx.group);
        fx.sparkMat.dispose();
        fx.ringMat.dispose();
        fx.explosionMat.dispose();
        fx.smokeMat.dispose();
        this.effects.splice(i, 1);
        continue;
      }

      const fade = (1 - t) * (1 - t);
      fx.ring.scale.setScalar(1.2 + t * 5.4);
      fx.ringMat.opacity = 0.85 * fade;
      fx.explosion.scale.setScalar(1.4 + t * 5.8);
      fx.explosionMat.opacity = Math.max(0, 0.9 * (1 - t * 2.6));
      fx.smoke.scale.setScalar(1.2 + t * 6.5);
      fx.smoke.position.y = 2.4 + t * 2.2;
      fx.smokeMat.opacity = 0.45 * fade;
      fx.sparkMat.opacity = fade;
      for (const spark of fx.sparks) {
        spark.velocity.y -= 24 * dt;
        spark.mesh.position.addScaledVector(spark.velocity, dt);
        spark.mesh.rotation.x += spark.spin.x * dt;
        spark.mesh.rotation.y += spark.spin.y * dt;
        spark.mesh.rotation.z += spark.spin.z * dt;
        spark.mesh.scale.setScalar(1 - t * 0.45);
      }
      for (const giblet of fx.giblets) {
        giblet.velocity.y -= 20 * dt;
        giblet.mesh.position.addScaledVector(giblet.velocity, dt);
        giblet.mesh.rotation.x += giblet.spin.x * dt;
        giblet.mesh.rotation.y += giblet.spin.y * dt;
        giblet.mesh.rotation.z += giblet.spin.z * dt;
        if (giblet.mesh.position.y < 0.25) {
          giblet.mesh.position.y = 0.25;
          giblet.velocity.y = Math.abs(giblet.velocity.y) * 0.18;
          giblet.velocity.x *= 0.7;
          giblet.velocity.z *= 0.7;
          giblet.spin.multiplyScalar(0.78);
        }
        giblet.mesh.scale.multiplyScalar(1 - dt * 1.6);
      }
    }
  }

  _spawnOne(playerPos) {
    const lim = this.arenaHalf - 3;
    let x = 0, z = 0;
    // pick an off-screen ring point that isn't on top of the player after clamping
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2;
      x = Math.max(-lim, Math.min(lim, playerPos.x + Math.cos(a) * SPAWN_RADIUS));
      z = Math.max(-lim, Math.min(lim, playerPos.z + Math.sin(a) * SPAWN_RADIUS));
      if (Math.hypot(x - playerPos.x, z - playerPos.z) > 30) break;
    }
    const mesh = this._createRobot();
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.enemies.push({
      mesh,
      speed: this.enemySpeed * (0.85 + Math.random() * 0.3),
      hitCD: 0,
      step: Math.random() * Math.PI * 2,
      knockback: new THREE.Vector3(),
    });
  }

  update(dt, player, onPlayerHit, obstacles = [], { freezeMovement = false } = {}) {
    this._updateEffects(dt);

    const ppos = player.object.position;

    // wave flow: when everything is dead and nothing left to spawn, take a break
    if (this.waveBreak > 0) {
      this.waveBreak -= dt;
      if (this.waveBreak <= 0) this.startWave(this.wave + 1);
    } else if (this.spawnQueue === 0 && this.enemies.length === 0) {
      this.waveBreak = WAVE_BREAK;
    }

    // staggered spawning
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnOne(ppos);
        this.spawnQueue -= 1;
        this.spawnTimer = SPAWN_INTERVAL;
      }
    }

    const speedNow = player.velocity.length();
    const ramKill = player.mode === MODE.VEHICLE && (player.boosting || speedNow > RAM_KILL_SPEED);
    const contactDist = ENEMY_RADIUS + PLAYER_RADIUS;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.hitCD = Math.max(0, e.hitCD - dt);
      if (freezeMovement) continue;

      // seek the player, steering around solid obstacles like beach balls
      this._tmp.set(ppos.x - e.mesh.position.x, 0, ppos.z - e.mesh.position.z);
      const d = this._tmp.length();
      if (d > 0.001) {
        this._tmp.multiplyScalar(1 / d);
        let steerX = this._tmp.x;
        let steerZ = this._tmp.z;

        for (const obstacle of obstacles) {
          const ox = obstacle.position.x - e.mesh.position.x;
          const oz = obstacle.position.z - e.mesh.position.z;
          const dist = Math.hypot(ox, oz);
          if (dist <= 0.001) continue;

          const avoidRadius = obstacle.radius + ENEMY_RADIUS + 1.1;
          const lookAhead = avoidRadius + 10;
          const ahead = ox * this._tmp.x + oz * this._tmp.z;
          const side = ox * this._tmp.z - oz * this._tmp.x;

          if (ahead > -avoidRadius && ahead < lookAhead && Math.abs(side) < avoidRadius) {
            const sideSign = side >= 0 ? -1 : 1;
            const sideStrength = (1 - Math.abs(side) / avoidRadius) * (1 - Math.max(0, ahead) / lookAhead);
            steerX += this._tmp.z * sideSign * sideStrength * 2.4;
            steerZ += -this._tmp.x * sideSign * sideStrength * 2.4;
          }

          if (dist < avoidRadius) {
            const push = (avoidRadius - dist) / avoidRadius;
            steerX -= (ox / dist) * push * 3.0;
            steerZ -= (oz / dist) * push * 3.0;
          }
        }

        const steerLen = Math.hypot(steerX, steerZ) || 1;
        steerX /= steerLen;
        steerZ /= steerLen;
        e.mesh.position.x += steerX * e.speed * dt;
        e.mesh.position.z += steerZ * e.speed * dt;
        if (e.knockback.lengthSq() > 0.001) {
          e.mesh.position.x += e.knockback.x * dt;
          e.mesh.position.z += e.knockback.z * dt;
          e.knockback.multiplyScalar(Math.exp(-ENEMY_KNOCKBACK_DRAG * dt));
        } else {
          e.knockback.set(0, 0, 0);
        }

        for (const obstacle of obstacles) {
          const ox = e.mesh.position.x - obstacle.position.x;
          const oz = e.mesh.position.z - obstacle.position.z;
          const minDist = obstacle.radius + ENEMY_RADIUS;
          const dist = Math.hypot(ox, oz);
          if (dist <= 0.001 || dist >= minDist) continue;
          e.mesh.position.x = obstacle.position.x + (ox / dist) * minDist;
          e.mesh.position.z = obstacle.position.z + (oz / dist) * minDist;
        }

        e.mesh.rotation.y = Math.atan2(steerX, steerZ);

        e.step += dt * (3.5 + e.speed * 0.35);
        const gait = Math.sin(e.step) * 0.42;
        const parts = e.mesh.userData.parts;
        parts.leftArm.rotation.x = gait;
        parts.rightArm.rotation.x = -gait;
        parts.leftLeg.rotation.x = -gait * 0.55;
        parts.rightLeg.rotation.x = gait * 0.55;
        e.mesh.position.y = Math.abs(Math.sin(e.step * 2)) * 0.08;
      }
      for (let j = i - 1; j >= 0; j -= 1) {
        const other = this.enemies[j];
        const ox = e.mesh.position.x - other.mesh.position.x;
        const oz = e.mesh.position.z - other.mesh.position.z;
        const dist = Math.hypot(ox, oz);
        if (dist <= 0.001 || dist >= ENEMY_SEPARATION) continue;
        const push = (ENEMY_SEPARATION - dist) * 0.5;
        const nx = ox / dist;
        const nz = oz / dist;
        e.mesh.position.x += nx * push;
        e.mesh.position.z += nz * push;
        other.mesh.position.x -= nx * push;
        other.mesh.position.z -= nz * push;
      }

      if (d < contactDist) {
        if (ramKill) {
          this._kill(i, 'ram', ppos);
        } else if (e.hitCD <= 0) {
          e.hitCD = 0.5; // an enemy can only land a touch every 0.5s
          e.knockback.x -= this._tmp.x * 13;
          e.knockback.z -= this._tmp.z * 13;
          onPlayerHit(CONTACT_DAMAGE, e.mesh.position);
        }
      }
    }
  }

  _kill(index, reason = 'hit', source = null) {
    const enemy = this.enemies[index];
    if (source) {
      const dx = enemy.mesh.position.x - source.x;
      const dz = enemy.mesh.position.z - source.z;
      const len = Math.hypot(dx, dz) || 1;
      const push = reason === 'ball' ? 3.2 : reason === 'ram' ? 4.2 : 2.2;
      enemy.mesh.position.x += (dx / len) * push;
      enemy.mesh.position.z += (dz / len) * push;
    }
    const position = enemy.mesh.position.clone();
    this._spawnKillBurst(position, reason);
    this.scene.remove(enemy.mesh);
    this.enemies.splice(index, 1);
    this.kills += 1;
    if (this.onKill) this.onKill({ position, reason });
  }

  handleBeachBallCollision(pos, radius, speed) {
    if (speed <= 0) return 0;
    let killed = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      const dx = e.mesh.position.x - pos.x;
      const dz = e.mesh.position.z - pos.z;
      if (Math.hypot(dx, dz) > radius + ENEMY_RADIUS) continue;
      this._kill(i, 'ball', pos);
      killed += 1;
    }
    return killed;
  }

  // Called from player.onHit when an attack's hit window opens.
  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const fx = Math.sin(heading), fz = Math.cos(heading); // player forward
    let killed = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.mesh.position.x - pos.x, dz = e.mesh.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      if (type !== 'smash') {
        const inv = 1 / (dist || 1);
        if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) continue; // outside forward cone
      }
      this._kill(i, type, pos);
      killed += 1;
    }
    return killed;
  }
}
