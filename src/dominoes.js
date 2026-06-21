import * as THREE from 'three';
import { CANNON, toCannonVec3 } from './physicsWorld.js';

const DOMINO_COUNT = 31;
const DOMINO_HEIGHT = 8.8;
const DOMINO_WIDTH = 4.2;
const DOMINO_THICKNESS = 0.55;
const DOMINO_RADIUS = 2.55;
const PLAYER_RADIUS = 3.2;
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
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.dominoes = [];

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

      const mesh = new THREE.Mesh(this.geometry, this.faceMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 16,
        shape: new CANNON.Box(new CANNON.Vec3(DOMINO_WIDTH / 2, DOMINO_HEIGHT / 2, DOMINO_THICKNESS / 2)),
        material: physics.defaultMaterial,
        linearDamping: 0.5,
        angularDamping: 0.58,
      });
      body.position.set(pos.x, DOMINO_HEIGHT / 2, pos.z);
      body.quaternion.setFromEuler(0, yaw, 0);
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.18;
      body.sleepTimeLimit = 0.5;
      physics.addBody(body);
      physics.sync(mesh, body);

      this.dominoes.push({
        mesh,
        body,
        base: body.position.clone(),
        baseQuaternion: body.quaternion.clone(),
        radius: DOMINO_RADIUS,
      });
    }
  }

  reset() {
    for (const d of this.dominoes) {
      this.physics.resetBody(d.body, d.base, d.baseQuaternion);
      d.body.sleep();
      this.physics.sync(d.mesh, d.body);
    }
  }

  getObstacles() {
    return this.dominoes.map((d) => ({ position: d.mesh.position, radius: d.radius }));
  }

  update(dt, player, ballImpactors = []) {
    this._collidePlayer(player);
    for (const body of ballImpactors) this._collideBody(body.position, body.radius, body.velocity, 1, body.body);
  }

  sync() {
    for (const d of this.dominoes) this.physics.sync(d.mesh, d.body);
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const impulse = type === 'smash' ? 14 : 7;
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
      d.body.applyImpulse(new CANNON.Vec3(nx * impulse, type === 'smash' ? 4 : 1, nz * impulse), d.body.position);
      d.body.angularVelocity.vadd(new CANNON.Vec3(nz * 1.2, (Math.random() - 0.5) * 1.4, -nx * 1.2), d.body.angularVelocity);
      d.body.wakeUp();
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(player) {
    const speed = player.velocity.length();
    if (speed < 0.35) return;
    const power = player.boosting ? 2.4 : player.mode === 'vehicle' ? 1.5 : 1;
    this._collideBody(player.object.position, PLAYER_RADIUS, player.velocity, power, null);
  }

  _collideBody(position, radius, velocity, powerScale, sourceBody) {
    const speed = velocity.length ? velocity.length() : velocity.length;
    if (speed < 0.35) return;

    for (const d of this.dominoes) {
      const dx = d.body.position.x - position.x;
      const dz = d.body.position.z - position.z;
      const minDist = radius + d.radius;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.001 || dist > minDist) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const impulse = Math.min(13, (1.8 + speed * 0.18) * powerScale);
      d.body.applyImpulse(new CANNON.Vec3(nx * impulse, Math.min(2.5, 0.5 + speed * 0.02), nz * impulse), d.body.position);
      d.body.angularVelocity.vadd(new CANNON.Vec3(nz * impulse * 0.028, (Math.random() - 0.5) * impulse * 0.018, -nx * impulse * 0.028), d.body.angularVelocity);
      d.body.wakeUp();

      if (sourceBody) sourceBody.applyImpulse(new CANNON.Vec3(-nx * impulse * 0.1, 0, -nz * impulse * 0.1), toCannonVec3(position));
    }
  }
}
