import * as THREE from 'three';
import { CANNON, toCannonVec3 } from './physicsWorld.js';

const BALL_COUNT = 4;
const BALL_RADIUS = 4.4;
const PLAYER_RADIUS = 3.2;
const PLACEMENT_RANGE = 58;
const MIN_KILL_SPEED = 7.5;
const ATTACK01_RANGE = 8;
const ATTACK01_DOT = Math.cos(THREE.MathUtils.degToRad(75));
const SMASH_RANGE = 12;

function makeBeachBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const colors = ['#9da3aa', '#a92834', '#aa8428', '#2558a8', '#9da3aa', '#23844f'];
  const stripeW = canvas.width / colors.length;
  for (let i = 0; i < colors.length; i += 1) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i * stripeW, 0, stripeW + 1, canvas.height);
  }
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
      return new CANNON.Vec3(x, BALL_RADIUS, z);
    }
  }
  return new CANNON.Vec3(
    (Math.random() * 2 - 1) * PLACEMENT_RANGE,
    BALL_RADIUS,
    (Math.random() * 2 - 1) * PLACEMENT_RANGE
  );
}

export class BeachBallManager {
  constructor(scene, arenaHalf, physics) {
    this.scene = scene;
    this.arenaHalf = arenaHalf;
    this.physics = physics;
    this.geometry = new THREE.SphereGeometry(BALL_RADIUS, 72, 36);
    this.material = makeBallMaterial(makeBeachBallTexture());
    this.balls = [];

    for (let i = 0; i < BALL_COUNT; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 3.2,
        shape: new CANNON.Sphere(BALL_RADIUS),
        material: physics.bouncyMaterial,
        linearDamping: 0.34,
        angularDamping: 0.42,
      });
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.25;
      body.sleepTimeLimit = 0.5;
      physics.addBody(body);

      this.balls.push({ mesh, body });
    }

    this.reset();
  }

  reset() {
    const placed = [];
    for (const ball of this.balls) {
      const p = randomBallPosition(placed);
      placed.push(p);
      this.physics.resetBody(ball.body, p);
      ball.body.angularVelocity.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4);
      this.physics.sync(ball.mesh, ball.body);
    }
  }

  getObstacles() {
    return this.balls.map((ball) => ({ position: ball.mesh.position, radius: BALL_RADIUS }));
  }

  getImpactors() {
    return this.balls.map((ball) => ({
      position: ball.mesh.position,
      radius: BALL_RADIUS,
      velocity: ball.body.velocity,
      body: ball.body,
    }));
  }

  update(dt, player) {
    for (const ball of this.balls) this._collidePlayer(ball, player);
  }

  sync(enemyManager) {
    for (const ball of this.balls) {
      this.physics.sync(ball.mesh, ball.body);
      const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.z);
      if (speed >= MIN_KILL_SPEED) {
        enemyManager.handleBeachBallCollision(ball.mesh.position, BALL_RADIUS, speed);
      }
    }
  }

  handleAttack(type, pos, heading) {
    const range = type === 'smash' ? SMASH_RANGE : ATTACK01_RANGE;
    const power = type === 'smash' ? 38 : 24;
    const lift = type === 'smash' ? 12 : 6;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let hit = 0;

    for (const ball of this.balls) {
      const b = ball.body.position;
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
      ball.body.applyImpulse(new CANNON.Vec3(nx * power, lift, nz * power), ball.body.position);
      ball.body.wakeUp();
      hit += 1;
    }

    return hit;
  }

  _collidePlayer(ball, player) {
    const b = ball.body.position;
    const p = player.object.position;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const minDist = BALL_RADIUS + PLAYER_RADIUS;
    const distSq = dx * dx + dz * dz;
    if (distSq <= 0.0001 || distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;
    const playerSpeed = player.velocity.length();
    if (playerSpeed < 0.4) return;

    const alongNormal = Math.max(0, player.velocity.x * nx + player.velocity.z * nz);
    const modePower = player.mode === 'vehicle' ? playerSpeed * 0.55 : playerSpeed * 0.22;
    const boostPower = player.boosting ? 28 + playerSpeed * 0.38 : 0;
    const impulse = Math.max(7, alongNormal * 1.25 + modePower) + boostPower;
    const lift = player.boosting ? 10 : 4 + playerSpeed * 0.08;
    ball.body.applyImpulse(new CANNON.Vec3(nx * impulse, lift, nz * impulse), toCannonVec3(p));
    ball.body.wakeUp();
  }
}
