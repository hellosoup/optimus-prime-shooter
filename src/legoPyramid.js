import * as THREE from 'three';

const BLOCK_W = 4.2;
const BLOCK_H = 1.15;
const BLOCK_D = 2.55;
const BLOCK_RADIUS = 2.55;
const PLAYER_RADIUS = 3.2;
const GRAVITY = 28;
const DRAG = 1.65;
const GROUND_BOUNCE = 0.22;
const PYRAMID_CENTER = new THREE.Vector3(48, 0, 34);
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;

const LEGO_COLORS = [
  0x7f1f29, 0x224985, 0x8a6b22, 0x1f6b3d, 0x8b3c1f, 0x5c367f,
];

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
  constructor(scene, arenaHalf) {
    this.scene = scene;
    this.arenaHalf = arenaHalf;
    this.blocks = [];
    this._worldBox = new THREE.Box3();

    this.blockGeo = new THREE.BoxGeometry(BLOCK_W, BLOCK_H, BLOCK_D);
    this.studGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16);
    this.materials = LEGO_COLORS.map(makeMaterial);

    this._buildBlock();
  }

  _buildBlock() {
    const layers = 22;
    const rows = 2;
    const cols = 2;
    const zSpacing = BLOCK_D * 1.08;
    const xSpacing = BLOCK_W * 1.08;

    for (let y = 0; y < layers; y += 1) {
      for (let row = 0; row < rows; row += 1) {
        const rowOffset = (y + row) % 2 === 0 ? 0 : xSpacing * 0.5;
        for (let col = 0; col < cols; col += 1) {
          const pos = new THREE.Vector3(
            PYRAMID_CENTER.x + (col - (cols - 1) / 2) * xSpacing + rowOffset,
            BLOCK_H / 2 + y * BLOCK_H,
            PYRAMID_CENTER.z + (row - (rows - 1) / 2) * zSpacing
          );
          this._addBlock(pos, (row + col + y) % this.materials.length);
        }
      }
    }
  }

  _addBlock(position, materialIndex) {
    const group = new THREE.Group();
    group.position.copy(position);

    const material = this.materials[materialIndex];
    const body = new THREE.Mesh(this.blockGeo, material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

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
    this.blocks.push({
      group,
      basePosition: position.clone(),
      baseQuaternion: group.quaternion.clone(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      sleeping: true,
      radius: BLOCK_RADIUS,
      halfHeight: BLOCK_H / 2,
    });
  }

  reset() {
    for (const block of this.blocks) {
      block.group.position.copy(block.basePosition);
      block.group.quaternion.copy(block.baseQuaternion);
      block.velocity.set(0, 0, 0);
      block.angularVelocity.set(0, 0, 0);
      block.sleeping = true;
    }
  }

  getObstacles() {
    return this.blocks
      .filter((block) => block.sleeping || block.group.position.y < BLOCK_H * 1.8)
      .map((block) => ({ position: block.group.position, radius: block.radius }));
  }

  update(dt, player, ballImpactors = []) {
    this._collidePlayer(player);
    for (const body of ballImpactors) this._collideBody(body.position, body.radius, body.velocity, 1.25, true);
    this._collideBlocks();
    this._integrate(dt);
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const power = type === 'smash' ? 34 : 20;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let hit = 0;

    for (const block of this.blocks) {
      const dx = block.group.position.x - pos.x;
      const dz = block.group.position.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + block.radius) continue;
      if (type !== 'smash') {
        const inv = 1 / (dist || 1);
        if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) continue;
      }

      const nx = dist > 0.001 ? dx / dist : fx;
      const nz = dist > 0.001 ? dz / dist : fz;
      this._wake(block);
      block.velocity.x += nx * power;
      block.velocity.y += type === 'smash' ? 14 : 5;
      block.velocity.z += nz * power;
      block.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10);
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(player) {
    const speed = player.velocity.length();
    if (speed < 0.35) return;
    const power = player.boosting ? 2.5 : player.mode === 'vehicle' ? 1.45 : 1;
    this._collideBody(player.object.position, PLAYER_RADIUS, player.velocity, power, false);
  }

  _collideBody(position, radius, velocity, powerScale, bounceBody) {
    const speed = velocity.length();
    if (speed < 0.35) return;

    for (const block of this.blocks) {
      const dx = block.group.position.x - position.x;
      const dz = block.group.position.z - position.z;
      const minDist = radius + block.radius;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.001 || dist > minDist) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const along = velocity.x * nx + velocity.z * nz;
      const impulse = Math.max(7, Math.abs(along) * 1.05 + speed * 0.18) * powerScale;
      this._wake(block);
      block.velocity.x += nx * impulse;
      block.velocity.y += Math.min(16, 3 + speed * 0.08 * powerScale);
      block.velocity.z += nz * impulse;
      block.angularVelocity.x += nz * impulse * 0.16;
      block.angularVelocity.z -= nx * impulse * 0.16;

      if (bounceBody && along < 0) {
        velocity.x -= nx * along * 1.35;
        velocity.z -= nz * along * 1.35;
      }
    }
  }

  _collideBlocks() {
    for (let i = 0; i < this.blocks.length; i += 1) {
      for (let j = i + 1; j < this.blocks.length; j += 1) {
        const a = this.blocks[i];
        const b = this.blocks[j];
        if (a.sleeping && b.sleeping) continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const minDist = BLOCK_RADIUS * 1.65;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.001 || dist > minDist) continue;

        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        if (!a.sleeping) {
          a.group.position.x -= nx * push;
          a.group.position.z -= nz * push;
        }
        if (!b.sleeping) {
          b.group.position.x += nx * push;
          b.group.position.z += nz * push;
        }

        const rel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
        if (rel > 0) continue;
        const impulse = -rel * 0.42;
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
    const lim = this.arenaHalf - BLOCK_RADIUS;
    for (const block of this.blocks) {
      if (block.sleeping) continue;

      block.velocity.y -= GRAVITY * dt;
      block.group.position.addScaledVector(block.velocity, dt);
      block.group.rotation.x += block.angularVelocity.x * dt;
      block.group.rotation.y += block.angularVelocity.y * dt;
      block.group.rotation.z += block.angularVelocity.z * dt;

      this._worldBox.setFromObject(block.group);
      if (this._worldBox.min.y < 0) {
        block.group.position.y -= this._worldBox.min.y;
        block.velocity.y = Math.abs(block.velocity.y) * GROUND_BOUNCE;
        block.velocity.x *= Math.exp(-DRAG * dt);
        block.velocity.z *= Math.exp(-DRAG * dt);
        block.angularVelocity.multiplyScalar(Math.exp(-DRAG * dt));
      }

      if (block.group.position.x > lim) {
        block.group.position.x = lim;
        block.velocity.x = -Math.abs(block.velocity.x) * 0.45;
      } else if (block.group.position.x < -lim) {
        block.group.position.x = -lim;
        block.velocity.x = Math.abs(block.velocity.x) * 0.45;
      }
      if (block.group.position.z > lim) {
        block.group.position.z = lim;
        block.velocity.z = -Math.abs(block.velocity.z) * 0.45;
      } else if (block.group.position.z < -lim) {
        block.group.position.z = -lim;
        block.velocity.z = Math.abs(block.velocity.z) * 0.45;
      }
    }
  }

  _wake(block) {
    block.sleeping = false;
  }
}
