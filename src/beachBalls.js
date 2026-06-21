import * as THREE from 'three';

const BALL_COUNT = 4;
const BALL_RADIUS = 4.4;
const PLAYER_RADIUS = 3.2;
const PLACEMENT_RANGE = 58;
const BALL_DRAG = 1.35;
const WALL_BOUNCE = 0.72;
const BALL_BOUNCE = 0.62;
const BALL_GRAVITY = 34;
const FLOOR_BOUNCE = 0.36;
const MIN_KILL_SPEED = 7.5;
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;

function makeBeachBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const colors = [
    '#9da3aa',
    '#a92834',
    '#aa8428',
    '#2558a8',
    '#9da3aa',
    '#23844f',
  ];

  const stripeW = canvas.width / colors.length;
  for (let i = 0; i < colors.length; i += 1) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i * stripeW, 0, stripeW + 1, canvas.height);
  }

  // Soft polar caps and seam lines make it read like a stitched beach ball while
  // keeping stripe borders texture-clean instead of triangle-jagged.
  ctx.fillStyle = '#8f969e';
  ctx.fillRect(0, 0, canvas.width, 34);
  ctx.fillRect(0, canvas.height - 34, canvas.width, 34);
  ctx.strokeStyle = 'rgba(35, 38, 45, 0.32)';
  ctx.lineWidth = 4;
  for (let i = 1; i < colors.length; i += 1) {
    const x = i * stripeW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

function makeBallMaterial(map) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.86,
    envMapIntensity: 0,
  });
}

function randomBallPosition(existing) {
  for (let tries = 0; tries < 60; tries += 1) {
    const x = (Math.random() * 2 - 1) * PLACEMENT_RANGE;
    const z = (Math.random() * 2 - 1) * PLACEMENT_RANGE;
    if (Math.hypot(x, z) < 18) continue;
    if (existing.every((p) => Math.hypot(p.x - x, p.z - z) > BALL_RADIUS * 3.2)) {
      return new THREE.Vector3(x, BALL_RADIUS, z);
    }
  }
  return new THREE.Vector3(
    (Math.random() * 2 - 1) * PLACEMENT_RANGE,
    BALL_RADIUS,
    (Math.random() * 2 - 1) * PLACEMENT_RANGE
  );
}

export class BeachBallManager {
  constructor(scene, arenaHalf) {
    this.scene = scene;
    this.arenaHalf = arenaHalf;
    this.geometry = new THREE.SphereGeometry(BALL_RADIUS, 72, 36);
    this.material = makeBallMaterial(makeBeachBallTexture());
    this.balls = [];

    for (let i = 0; i < BALL_COUNT; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.balls.push({
        mesh,
        velocity: new THREE.Vector3(),
      });
    }

    this.reset();
  }

  reset() {
    const placed = [];
    for (const ball of this.balls) {
      const p = randomBallPosition(placed);
      placed.push(p);
      ball.mesh.position.copy(p);
      ball.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      ball.velocity.set(0, 0, 0);
    }
  }

  getObstacles() {
    return this.balls.map((ball) => ({
      position: ball.mesh.position,
      radius: BALL_RADIUS,
    }));
  }

  getImpactors() {
    return this.balls.map((ball) => ({
      position: ball.mesh.position,
      radius: BALL_RADIUS,
      velocity: ball.velocity,
    }));
  }

  update(dt, player, enemyManager) {
    for (const ball of this.balls) this._collidePlayer(ball, player);
    this._collideBalls();

    for (const ball of this.balls) {
      this._integrate(ball, dt);
      const speed = ball.velocity.length();
      if (speed >= MIN_KILL_SPEED) {
        enemyManager.handleBeachBallCollision(ball.mesh.position, BALL_RADIUS, speed);
      }
    }
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const power = type === 'smash' ? 42 : 28;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let hit = 0;

    for (const ball of this.balls) {
      const b = ball.mesh.position;
      const dx = b.x - pos.x;
      const dz = b.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + BALL_RADIUS) continue;
      if (type !== 'smash') {
        const inv = 1 / (dist || 1);
        if (dx * inv * fx + dz * inv * fz < ATTACK01_DOT) continue;
      }

      const nx = dist > 0.001 ? dx / dist : fx;
      const nz = dist > 0.001 ? dz / dist : fz;
      ball.velocity.x += nx * power;
      ball.velocity.y = Math.max(ball.velocity.y, type === 'smash' ? 15 : 9);
      ball.velocity.z += nz * power;
      b.x += nx * Math.max(0, range + BALL_RADIUS - dist) * 0.18;
      b.z += nz * Math.max(0, range + BALL_RADIUS - dist) * 0.18;
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(ball, player) {
    const b = ball.mesh.position;
    const p = player.object.position;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const minDist = BALL_RADIUS + PLAYER_RADIUS;
    const distSq = dx * dx + dz * dz;
    if (distSq <= 0.0001 || distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = minDist - dist;
    b.x += nx * overlap;
    b.z += nz * overlap;

    const playerSpeed = player.velocity.length();
    if (playerSpeed < 0.4) return;

    const alongNormal = Math.max(0, player.velocity.x * nx + player.velocity.z * nz);
    const modePower = player.mode === 'vehicle' ? playerSpeed * 0.25 : playerSpeed * 0.1;
    const boostPower = player.boosting ? 24 + playerSpeed * 0.35 : 0;
    const impulse = Math.max(7, alongNormal * 1.05 + modePower) + boostPower;
    ball.velocity.x += nx * impulse;
    ball.velocity.y = Math.max(ball.velocity.y, player.boosting ? 16 : 7 + playerSpeed * 0.12);
    ball.velocity.z += nz * impulse;
  }

  _collideBalls() {
    const minDist = BALL_RADIUS * 2;
    for (let i = 0; i < this.balls.length; i += 1) {
      for (let j = i + 1; j < this.balls.length; j += 1) {
        const a = this.balls[i];
        const b = this.balls[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq <= 0.0001 || distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        a.mesh.position.x -= nx * push;
        a.mesh.position.z -= nz * push;
        b.mesh.position.x += nx * push;
        b.mesh.position.z += nz * push;

        const rel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
        if (rel > 0) continue;
        const impulse = -rel * BALL_BOUNCE;
        a.velocity.x -= nx * impulse;
        a.velocity.z -= nz * impulse;
        b.velocity.x += nx * impulse;
        b.velocity.z += nz * impulse;
      }
    }
  }

  _integrate(ball, dt) {
    const p = ball.mesh.position;
    ball.velocity.y -= BALL_GRAVITY * dt;
    p.x += ball.velocity.x * dt;
    p.y += ball.velocity.y * dt;
    p.z += ball.velocity.z * dt;
    if (p.y < BALL_RADIUS) {
      p.y = BALL_RADIUS;
      ball.velocity.y = Math.abs(ball.velocity.y) > 3 ? Math.abs(ball.velocity.y) * FLOOR_BOUNCE : 0;
    }

    const lim = this.arenaHalf - BALL_RADIUS;
    if (p.x > lim) {
      p.x = lim;
      ball.velocity.x = -Math.abs(ball.velocity.x) * WALL_BOUNCE;
    } else if (p.x < -lim) {
      p.x = -lim;
      ball.velocity.x = Math.abs(ball.velocity.x) * WALL_BOUNCE;
    }
    if (p.z > lim) {
      p.z = lim;
      ball.velocity.z = -Math.abs(ball.velocity.z) * WALL_BOUNCE;
    } else if (p.z < -lim) {
      p.z = -lim;
      ball.velocity.z = Math.abs(ball.velocity.z) * WALL_BOUNCE;
    }

    const speed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (speed > 0.02) {
      ball.mesh.rotation.x += (ball.velocity.z * dt) / BALL_RADIUS;
      ball.mesh.rotation.z -= (ball.velocity.x * dt) / BALL_RADIUS;
    } else {
      ball.velocity.set(0, 0, 0);
    }

    ball.velocity.multiplyScalar(Math.exp(-BALL_DRAG * dt));
  }
}
