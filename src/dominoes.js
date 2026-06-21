import * as THREE from 'three';

const DOMINO_COUNT = 31;
const DOMINO_HEIGHT = 8.8;
const DOMINO_WIDTH = 4.2;
const DOMINO_THICKNESS = 0.55;
const DOMINO_RADIUS = 2.55;
const PLAYER_RADIUS = 3.2;
const GRAVITY = 28;
const BODY_DRAG = 1.4;
const GROUND_BOUNCE = 0.18;
const SLEEP_SPEED = 0.18;
const SLEEP_SPIN = 0.2;
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;
const DOMINO_LINE_Z_OFFSET = -70;

function sPoint(t) {
  return new THREE.Vector3(
    Math.sin((t - 0.08) * Math.PI * 2) * 19,
    0,
    (t - 0.5) * 76 + DOMINO_LINE_Z_OFFSET
  );
}

function sTangent(t) {
  return new THREE.Vector3(
    Math.cos((t - 0.08) * Math.PI * 2) * Math.PI * 2 * 19,
    0,
    76
  ).normalize();
}

export class DominoManager {
  constructor(scene) {
    this.scene = scene;
    this.dominoes = [];
    this._worldBox = new THREE.Box3();

    this.geometry = new THREE.BoxGeometry(DOMINO_WIDTH, DOMINO_HEIGHT, DOMINO_THICKNESS);
    this.faceMat = new THREE.MeshStandardMaterial({
      color: 0x8f887d,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0,
      roughness: 0.9,
      envMapIntensity: 0,
    });

    for (let i = 0; i < DOMINO_COUNT; i += 1) {
      const t = DOMINO_COUNT === 1 ? 0.5 : i / (DOMINO_COUNT - 1);
      const pos = sPoint(t);
      const tangent = sTangent(t);
      const yaw = Math.atan2(tangent.x, tangent.z);

      const body = new THREE.Group();
      body.position.set(pos.x, DOMINO_HEIGHT / 2, pos.z);
      body.rotation.y = yaw;

      const mesh = new THREE.Mesh(this.geometry, this.faceMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);

      scene.add(body);
      this.dominoes.push({
        body,
        base: body.position.clone(),
        baseQuaternion: body.quaternion.clone(),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        sleeping: true,
        radius: DOMINO_RADIUS,
      });
    }
  }

  reset() {
    for (const d of this.dominoes) {
      d.body.position.copy(d.base);
      d.body.quaternion.copy(d.baseQuaternion);
      d.velocity.set(0, 0, 0);
      d.angularVelocity.set(0, 0, 0);
      d.sleeping = true;
    }
  }

  getObstacles() {
    return this.dominoes.map((d) => ({ position: d.body.position, radius: d.radius }));
  }

  update(dt, player, ballImpactors = []) {
    this._collidePlayer(player);
    for (const body of ballImpactors) this._collideBody(body.position, body.radius, body.velocity, 1, true);
    this._collideDominoes();
    this._integrate(dt);
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const impulse = type === 'smash' ? 24 : 13;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let hit = 0;

    for (const d of this.dominoes) {
      const dx = d.body.position.x - pos.x;
      const dz = d.body.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + DOMINO_RADIUS) continue;
      if (type !== 'smash') {
        const inv = 1 / (dist || 1);
        if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) continue;
      }

      const nx = dist > 0.001 ? dx / dist : fx;
      const nz = dist > 0.001 ? dz / dist : fz;
      this._wake(d);
      d.velocity.x += nx * impulse;
      d.velocity.y += type === 'smash' ? 8 : 3;
      d.velocity.z += nz * impulse;
      d.angularVelocity.x += nz * impulse * 0.35;
      d.angularVelocity.y += (Math.random() - 0.5) * impulse * 0.45;
      d.angularVelocity.z -= nx * impulse * 0.35;
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(player) {
    const speed = player.velocity.length();
    if (speed < 0.35) return;
    const power = player.boosting ? 2.4 : player.mode === 'vehicle' ? 1.5 : 1;
    this._collideBody(player.object.position, PLAYER_RADIUS, player.velocity, power, false);
  }

  _collideBody(position, radius, velocity, powerScale, bounceBody) {
    const speed = velocity.length();
    if (speed < 0.35) return;

    for (const d of this.dominoes) {
      const dx = d.body.position.x - position.x;
      const dz = d.body.position.z - position.z;
      const minDist = radius + d.radius;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.001 || dist > minDist) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const impulse = Math.min(18, 4 + speed * 0.28 * powerScale);
      this._wake(d);
      d.velocity.x += nx * impulse;
      d.velocity.y += Math.min(10, 2 + speed * 0.05 * powerScale);
      d.velocity.z += nz * impulse;
      d.angularVelocity.x += nz * impulse * 0.32;
      d.angularVelocity.y += (Math.random() - 0.5) * impulse * 0.4;
      d.angularVelocity.z -= nx * impulse * 0.32;

      if (bounceBody && radius > PLAYER_RADIUS) {
        const bounceX = -nx;
        const bounceZ = -nz;
        const along = velocity.x * bounceX + velocity.z * bounceZ;
        if (along < 0) {
          velocity.x -= bounceX * along * 1.35;
          velocity.z -= bounceZ * along * 1.35;
        }
      }
    }
  }

  _collideDominoes() {
    const minDist = DOMINO_RADIUS * 1.45;
    for (let i = 0; i < this.dominoes.length; i += 1) {
      for (let j = i + 1; j < this.dominoes.length; j += 1) {
        const a = this.dominoes[i];
        const b = this.dominoes[j];
        if (a.sleeping && b.sleeping) continue;
        const dx = b.body.position.x - a.body.position.x;
        const dz = b.body.position.z - a.body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.001 || dist > minDist) continue;

        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        if (!a.sleeping) {
          a.body.position.x -= nx * push;
          a.body.position.z -= nz * push;
        }
        if (!b.sleeping) {
          b.body.position.x += nx * push;
          b.body.position.z += nz * push;
        }

        const rel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
        if (rel > 0) continue;
        const impulse = -rel * 0.35;
        this._wake(a);
        this._wake(b);
        a.velocity.x -= nx * impulse;
        a.velocity.z -= nz * impulse;
        b.velocity.x += nx * impulse;
        b.velocity.z += nz * impulse;
      }
    }
  }

  _integrate(dt) {
    for (const d of this.dominoes) {
      if (d.sleeping) continue;

      d.velocity.y -= GRAVITY * dt;
      d.body.position.addScaledVector(d.velocity, dt);
      d.body.rotation.x += d.angularVelocity.x * dt;
      d.body.rotation.y += d.angularVelocity.y * dt;
      d.body.rotation.z += d.angularVelocity.z * dt;

      this._worldBox.setFromObject(d.body);
      if (this._worldBox.min.y < 0) {
        d.body.position.y -= this._worldBox.min.y;
        d.velocity.y = Math.abs(d.velocity.y) * GROUND_BOUNCE;
        d.velocity.x *= Math.exp(-BODY_DRAG * dt);
        d.velocity.z *= Math.exp(-BODY_DRAG * dt);
        d.angularVelocity.multiplyScalar(Math.exp(-BODY_DRAG * dt));
      }

      if (d.velocity.length() < SLEEP_SPEED && d.angularVelocity.length() < SLEEP_SPIN && this._worldBox.min.y <= 0.01) {
        d.velocity.set(0, 0, 0);
        d.angularVelocity.set(0, 0, 0);
        d.sleeping = true;
      }
    }
  }

  _wake(d) {
    d.sleeping = false;
  }
}
