import * as THREE from 'three';
import { CANNON, toCannonVec3 } from './physicsWorld.js';

const CUBE_CENTER = new THREE.Vector3(-44, 0, 34);
const CUBIE_SIZE = 3.0;
const GAP = 0.08;
const STICKER_OFFSET = CUBIE_SIZE / 2 + 0.012;
const RUBIKS_RADIUS = CUBIE_SIZE * 1.5 + GAP;
const PLAYER_RADIUS = 3.2;
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;

const STICKER_COLORS = {
  right: 0x8f2424,
  left: 0x9f551b,
  top: 0x9b8d2c,
  bottom: 0xb8b8ac,
  front: 0x244b99,
  back: 0x237542,
};

function addSticker(parent, side, color) {
  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(CUBIE_SIZE * 0.72, CUBIE_SIZE * 0.72),
    new THREE.MeshStandardMaterial({
      color,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0,
      roughness: 0.88,
      envMapIntensity: 0,
    })
  );

  if (side === 'right') {
    sticker.position.x = STICKER_OFFSET;
    sticker.rotation.y = Math.PI / 2;
  } else if (side === 'left') {
    sticker.position.x = -STICKER_OFFSET;
    sticker.rotation.y = -Math.PI / 2;
  } else if (side === 'top') {
    sticker.position.y = STICKER_OFFSET;
    sticker.rotation.x = -Math.PI / 2;
  } else if (side === 'bottom') {
    sticker.position.y = -STICKER_OFFSET;
    sticker.rotation.x = Math.PI / 2;
  } else if (side === 'front') {
    sticker.position.z = STICKER_OFFSET;
  } else if (side === 'back') {
    sticker.position.z = -STICKER_OFFSET;
    sticker.rotation.y = Math.PI;
  }

  parent.add(sticker);
}

export class RubiksCubeManager {
  constructor(scene, physics) {
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.position.set(CUBE_CENTER.x, RUBIKS_RADIUS, CUBE_CENTER.z);
    this.group.rotation.y = -0.35;

    this.cubieGeo = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
    this.cubieMat = new THREE.MeshStandardMaterial({
      color: 0x08090c,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0.2,
      roughness: 0.72,
      envMapIntensity: 0,
    });

    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          const cubie = new THREE.Mesh(this.cubieGeo, this.cubieMat);
          cubie.position.set(
            x * (CUBIE_SIZE + GAP),
            y * (CUBIE_SIZE + GAP),
            z * (CUBIE_SIZE + GAP)
          );
          cubie.castShadow = true;
          cubie.receiveShadow = true;

          if (x === 1) addSticker(cubie, 'right', STICKER_COLORS.right);
          if (x === -1) addSticker(cubie, 'left', STICKER_COLORS.left);
          if (y === 1) addSticker(cubie, 'top', STICKER_COLORS.top);
          if (y === -1) addSticker(cubie, 'bottom', STICKER_COLORS.bottom);
          if (z === 1) addSticker(cubie, 'front', STICKER_COLORS.front);
          if (z === -1) addSticker(cubie, 'back', STICKER_COLORS.back);

          this.group.add(cubie);
        }
      }
    }

    scene.add(this.group);

    this.body = new CANNON.Body({
      mass: 20,
      material: physics.defaultMaterial,
      linearDamping: 0.42,
      angularDamping: 0.5,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(RUBIKS_RADIUS, RUBIKS_RADIUS, RUBIKS_RADIUS)));
    this.body.position.copy(this.group.position);
    this.body.quaternion.copy(this.group.quaternion);
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.08;
    this.body.sleepTimeLimit = 0.5;
    physics.addBody(this.body);
  }

  reset() {
    this.physics.resetBody(this.body, new CANNON.Vec3(CUBE_CENTER.x, RUBIKS_RADIUS, CUBE_CENTER.z));
    this.body.quaternion.setFromEuler(0, -0.35, 0);
    this.body.sleep();
    this.sync();
  }

  getObstacles() {
    return [{ position: this.group.position, radius: RUBIKS_RADIUS }];
  }

  update(dt, player, ballImpactors = []) {
    this._collidePlayer(player);
    for (const body of ballImpactors) this._collideBody(body.position, body.radius, body.velocity, 0.55, body.body);
  }

  sync() {
    this.physics.sync(this.group, this.body);
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const power = type === 'smash' ? 28 : 12;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const dx = this.body.position.x - pos.x;
    const dz = this.body.position.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range + RUBIKS_RADIUS) return 0;
    if (type !== 'smash') {
      const inv = 1 / (dist || 1);
      if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) return 0;
    }

    const nx = dist > 0.001 ? dx / dist : fx;
    const nz = dist > 0.001 ? dz / dist : fz;
    this.body.applyImpulse(new CANNON.Vec3(nx * power, type === 'smash' ? 4 : 1, nz * power), this.body.position);
    this.body.angularVelocity.vadd(new CANNON.Vec3(nz * 0.5, 0.18, -nx * 0.5), this.body.angularVelocity);
    this.body.wakeUp();
    return 1;
  }

  _collidePlayer(player) {
    const speed = player.velocity.length();
    if (speed < 0.35) return;
    const power = player.boosting ? 1.45 : player.mode === 'vehicle' ? 0.85 : 0.38;
    this._collideBody(player.object.position, PLAYER_RADIUS, player.velocity, power, null);
  }

  _collideBody(position, radius, velocity, powerScale, sourceBody) {
    const speed = velocity.length ? velocity.length() : velocity.length;
    if (speed < 0.35) return;

    const dx = this.body.position.x - position.x;
    const dz = this.body.position.z - position.z;
    const minDist = radius + RUBIKS_RADIUS;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.001 || dist > minDist) return;

    const nx = dx / dist;
    const nz = dz / dist;
    const impulse = Math.min(28, (4 + speed * 0.42) * powerScale);
    this.body.applyImpulse(new CANNON.Vec3(nx * impulse, 0.25, nz * impulse), this.body.position);
    this.body.angularVelocity.vadd(new CANNON.Vec3(nz * impulse * 0.03, 0, -nx * impulse * 0.03), this.body.angularVelocity);
    this.body.wakeUp();

    if (sourceBody) {
      sourceBody.applyImpulse(new CANNON.Vec3(-nx * impulse * 0.28, 0, -nz * impulse * 0.28), toCannonVec3(position));
    } else {
      const overlap = minDist - dist;
      position.x -= nx * overlap;
      position.z -= nz * overlap;
      const intoCube = velocity.x * nx + velocity.z * nz;
      if (intoCube > 0) {
        velocity.x -= nx * intoCube;
        velocity.z -= nz * intoCube;
      }
    }
  }
}
