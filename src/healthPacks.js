import * as THREE from 'three';

const DROP_CHANCE = 0.05;
const HEAL_AMOUNT = 25;
const GRAVITY = 30;
const LANDED_Y = 1.25;
const PICKUP_RADIUS = 4.2;

function makePlus(material) {
  const group = new THREE.Group();
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.5, 0.45), material);
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.7, 0.45), material);
  vertical.castShadow = true;
  vertical.receiveShadow = true;
  horizontal.castShadow = true;
  horizontal.receiveShadow = true;
  group.add(vertical, horizontal);
  return group;
}

export class HealthPackManager {
  constructor(scene) {
    this.scene = scene;
    this.packs = [];
    this.material = new THREE.MeshStandardMaterial({
      color: 0x2fcf5b,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0.05,
      roughness: 0.46,
      envMapIntensity: 0.25,
    });
  }

  reset() {
    for (const pack of this.packs) this.scene.remove(pack.object);
    this.packs.length = 0;
  }

  maybeDrop(position) {
    if (Math.random() > DROP_CHANCE) return false;
    this.spawn(position);
    return true;
  }

  spawn(position) {
    const object = makePlus(this.material);
    object.position.set(position.x, 4.2, position.z);
    object.rotation.set(
      (Math.random() - 0.5) * 0.8,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.8
    );
    this.scene.add(object);

    const angle = Math.random() * Math.PI * 2;
    const out = 4 + Math.random() * 8;
    this.packs.push({
      object,
      landed: false,
      velocity: new THREE.Vector3(Math.cos(angle) * out, 9 + Math.random() * 7, Math.sin(angle) * out),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 8
      ),
    });
  }

  update(dt, player, onPickup) {
    for (let i = this.packs.length - 1; i >= 0; i -= 1) {
      const pack = this.packs[i];
      if (pack.landed) {
        pack.object.rotation.y += dt * 3.2;
      } else {
        pack.velocity.y -= GRAVITY * dt;
        pack.object.position.addScaledVector(pack.velocity, dt);
        pack.object.rotation.x += pack.spin.x * dt;
        pack.object.rotation.y += pack.spin.y * dt;
        pack.object.rotation.z += pack.spin.z * dt;

        if (pack.object.position.y <= LANDED_Y) {
          pack.object.position.y = LANDED_Y;
          pack.velocity.set(0, 0, 0);
          pack.spin.set(0, 0, 0);
          pack.object.rotation.x = 0;
          pack.object.rotation.z = 0;
          pack.landed = true;
        }
      }

      const dx = pack.object.position.x - player.object.position.x;
      const dz = pack.object.position.z - player.object.position.z;
      if (Math.hypot(dx, dz) <= PICKUP_RADIUS && onPickup(HEAL_AMOUNT)) {
        this.scene.remove(pack.object);
        this.packs.splice(i, 1);
      }
    }
  }
}
