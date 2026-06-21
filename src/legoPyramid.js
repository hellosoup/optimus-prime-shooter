import * as THREE from 'three';
import { CANNON, toCannonVec3 } from './physicsWorld.js';

const BLOCK_W = 4.2;
const BLOCK_H = 1.15;
const BLOCK_D = 2.55;
const BLOCK_RADIUS = 2.55;
const PLAYER_RADIUS = 3.2;
const PYRAMID_CENTER = new THREE.Vector3(48, 0, 34);
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;

const LEGO_COLORS = [0x7f1f29, 0x224985, 0x8a6b22, 0x1f6b3d, 0x8b3c1f, 0x5c367f];

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.74,
    envMapIntensity: 0,
  });
}

export class LegoPyramidManager {
  constructor(scene, arenaHalf, physics) {
    this.scene = scene;
    this.arenaHalf = arenaHalf;
    this.physics = physics;
    this.blocks = [];

    this.blockGeo = new THREE.BoxGeometry(BLOCK_W, BLOCK_H, BLOCK_D);
    this.studGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16);
    this.materials = LEGO_COLORS.map(makeMaterial);
    this.shape = new CANNON.Box(new CANNON.Vec3(BLOCK_W / 2, BLOCK_H / 2, BLOCK_D / 2));

    this._buildBlock();
  }

  _buildBlock() {
    const zSpacing = BLOCK_D * 1.08;
    const xSpacing = BLOCK_W * 1.08;
    const tiers = [
      { layers: 2, rows: 5, cols: 5 },
      { layers: 2, rows: 4, cols: 4 },
      { layers: 2, rows: 3, cols: 3 },
      { layers: 2, rows: 2, cols: 2 },
      { layers: 1, rows: 1, cols: 1 },
    ];

    let layer = 0;
    for (const tier of tiers) {
      for (let y = 0; y < tier.layers; y += 1) {
        for (let row = 0; row < tier.rows; row += 1) {
          const rowOffset = (layer + row) % 2 === 0 ? 0 : xSpacing * 0.5;
          for (let col = 0; col < tier.cols; col += 1) {
            const pos = new CANNON.Vec3(
              PYRAMID_CENTER.x + (col - (tier.cols - 1) / 2) * xSpacing + rowOffset,
              BLOCK_H / 2 + layer * BLOCK_H,
              PYRAMID_CENTER.z + (row - (tier.rows - 1) / 2) * zSpacing
            );
            this._addBlock(pos, (row + col + layer) % this.materials.length);
          }
        }
        layer += 1;
      }
    }
  }

  _addBlock(position, materialIndex) {
    const group = new THREE.Group();
    const material = this.materials[materialIndex];
    const bodyMesh = new THREE.Mesh(this.blockGeo, material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    for (const x of [-BLOCK_W * 0.25, BLOCK_W * 0.25]) {
      for (const z of [-BLOCK_D * 0.25, BLOCK_D * 0.25]) {
        const stud = new THREE.Mesh(this.studGeo, material);
        stud.position.set(x, BLOCK_H / 2 + 0.11, z);
        stud.castShadow = true;
        stud.receiveShadow = true;
        group.add(stud);
      }
    }
    this.scene.add(group);

    const body = new CANNON.Body({
      mass: 6.5,
      shape: this.shape,
      material: this.physics.defaultMaterial,
      linearDamping: 0.42,
      angularDamping: 0.5,
    });
    body.position.copy(position);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.22;
    body.sleepTimeLimit = 0.45;
    this.physics.addBody(body);
    this.physics.sync(group, body);

    this.blocks.push({
      group,
      body,
      basePosition: position.clone(),
      baseQuaternion: body.quaternion.clone(),
      radius: BLOCK_RADIUS,
    });
  }

  reset() {
    for (const block of this.blocks) {
      this.physics.resetBody(block.body, block.basePosition, block.baseQuaternion);
      block.body.sleep();
      this.physics.sync(block.group, block.body);
    }
  }

  getObstacles() {
    return this.blocks
      .filter((block) => block.body.sleepState !== CANNON.Body.AWAKE || block.body.position.y < BLOCK_H * 1.8)
      .map((block) => ({ position: block.group.position, radius: block.radius }));
  }

  update(dt, player, ballImpactors = []) {
    this._collidePlayer(player);
    for (const body of ballImpactors) this._collideBody(body.position, body.radius, body.velocity, 1.25, body.body);
  }

  sync() {
    for (const block of this.blocks) this.physics.sync(block.group, block.body);
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const power = type === 'smash' ? 30 : 16;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let hit = 0;

    for (const block of this.blocks) {
      const dx = block.body.position.x - pos.x;
      const dz = block.body.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + block.radius) continue;
      if (type !== 'smash') {
        const inv = 1 / (dist || 1);
        if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) continue;
      }

      const nx = dist > 0.001 ? dx / dist : fx;
      const nz = dist > 0.001 ? dz / dist : fz;
      block.body.applyImpulse(new CANNON.Vec3(nx * power, type === 'smash' ? 9 : 3, nz * power), block.body.position);
      block.body.angularVelocity.vadd(new CANNON.Vec3(
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 3
      ), block.body.angularVelocity);
      block.body.wakeUp();
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(player) {
    const speed = player.velocity.length();
    if (speed < 0.35) return;
    const power = player.boosting ? 2.5 : player.mode === 'vehicle' ? 1.45 : 1;
    this._collideBody(player.object.position, PLAYER_RADIUS, player.velocity, power, null);
  }

  _collideBody(position, radius, velocity, powerScale, sourceBody) {
    const speed = velocity.length ? velocity.length() : velocity.length;
    if (speed < 0.35) return;

    for (const block of this.blocks) {
      const dx = block.body.position.x - position.x;
      const dz = block.body.position.z - position.z;
      const minDist = radius + block.radius;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.001 || dist > minDist) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const impulse = Math.max(4, Math.abs(velocity.x * nx + velocity.z * nz) * 0.75 + speed * 0.18) * powerScale;
      block.body.applyImpulse(new CANNON.Vec3(nx * impulse, Math.min(8, 1 + speed * 0.04 * powerScale), nz * impulse), block.body.position);
      block.body.angularVelocity.vadd(new CANNON.Vec3(nz * impulse * 0.05, (Math.random() - 0.5) * impulse * 0.07, -nx * impulse * 0.05), block.body.angularVelocity);
      block.body.wakeUp();

      if (sourceBody) sourceBody.applyImpulse(new CANNON.Vec3(-nx * impulse * 0.14, 0, -nz * impulse * 0.14), toCannonVec3(position));
    }
  }
}
