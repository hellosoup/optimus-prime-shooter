import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export { CANNON };

export class PhysicsWorld {
  constructor(arenaHalf) {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -34, 0),
    });
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    this.defaultMaterial = new CANNON.Material('default');
    this.groundMaterial = new CANNON.Material('ground');
    this.bouncyMaterial = new CANNON.Material('bouncy');
    this.world.defaultContactMaterial.friction = 0.72;
    this.world.defaultContactMaterial.restitution = 0.08;
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.bouncyMaterial,
      this.groundMaterial,
      { friction: 0.58, restitution: 0.22 }
    ));
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.groundMaterial,
      { friction: 0.88, restitution: 0.05 }
    ));

    const ground = new CANNON.Body({ mass: 0, material: this.groundMaterial });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);

    const wallT = 2;
    const wallH = 18;
    const wallOffset = arenaHalf + wallT / 2;
    const wallShapeX = new CANNON.Box(new CANNON.Vec3(arenaHalf, wallH / 2, wallT / 2));
    const wallShapeZ = new CANNON.Box(new CANNON.Vec3(wallT / 2, wallH / 2, arenaHalf));
    for (const z of [-wallOffset, wallOffset]) {
      const wall = new CANNON.Body({ mass: 0, material: this.groundMaterial });
      wall.addShape(wallShapeX);
      wall.position.set(0, wallH / 2, z);
      this.world.addBody(wall);
    }
    for (const x of [-wallOffset, wallOffset]) {
      const wall = new CANNON.Body({ mass: 0, material: this.groundMaterial });
      wall.addShape(wallShapeZ);
      wall.position.set(x, wallH / 2, 0);
      this.world.addBody(wall);
    }
  }

  addBody(body) {
    this.world.addBody(body);
    return body;
  }

  step(dt) {
    this.world.step(1 / 60, dt, 4);
  }

  sync(mesh, body) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  resetBody(body, position, quaternion = null) {
    body.position.copy(position);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    if (quaternion) body.quaternion.copy(quaternion);
    else body.quaternion.set(0, 0, 0, 1);
    body.wakeUp();
  }
}

export function toCannonVec3(v) {
  return new CANNON.Vec3(v.x, v.y, v.z);
}

export function toThreeVector(v) {
  return new THREE.Vector3(v.x, v.y, v.z);
}
