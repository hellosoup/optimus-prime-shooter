import * as THREE from 'three';

const CUBE_CENTER = new THREE.Vector3(-44, 0, 34);
const CUBIE_SIZE = 1.55;
const GAP = 0.08;
const STICKER_OFFSET = CUBIE_SIZE / 2 + 0.012;
const RUBIKS_RADIUS = 4.2;

const STICKER_COLORS = {
  right: 0xc42b2b,
  left: 0xee7f22,
  top: 0xe6d447,
  bottom: 0xf2f2f2,
  front: 0x2c64d8,
  back: 0x2aa356,
};

function addSticker(parent, side, color) {
  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(CUBIE_SIZE * 0.72, CUBIE_SIZE * 0.72),
    new THREE.MeshStandardMaterial({
      color,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0,
      roughness: 0.68,
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
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.set(CUBE_CENTER.x, CUBIE_SIZE * 1.65, CUBE_CENTER.z);
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
  }

  getObstacles() {
    return [{ position: this.group.position, radius: RUBIKS_RADIUS }];
  }
}
