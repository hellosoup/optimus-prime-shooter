// Optimus Prime: Cybertron Survivor - playable core (move + transform).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { input } from './input.js';
import { Player, MODE } from './player.js';

// glTF clip names arrive as "OptimusPrime_G1|idle02|Base Layer"; shorten them.
const shortClip = (name) => {
  const parts = name.split('|');
  return parts.length >= 2 ? parts[1] : name;
};

const overlay = document.getElementById('overlay');
const app = document.getElementById('app');

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

// ---- scene + fog ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080f);
scene.fog = new THREE.Fog(0x05080f, 50, 160);

// Image-based environment so metallic PBR surfaces have something to reflect.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ---- iso orthographic camera (follows the player) ----
const FRUSTUM = 18;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect, FRUSTUM * aspect, FRUSTUM, -FRUSTUM, 0.1, 500
);
const CAM_OFFSET = new THREE.Vector3(40, 40, 40);
const CAM_SMOOTH = 6;            // camera follow damping (higher = tighter)
const camFocus = new THREE.Vector3(0, 0, 0); // smoothed ground point the camera tracks
const CAM_LOOK = new THREE.Vector3(0, 4, 0);
camera.position.copy(CAM_OFFSET);
camera.lookAt(CAM_LOOK);

// ---- post-processing: bloom for the energon glow ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55,  // strength
  0.5,   // radius
  0.8    // threshold (only brighter-than-this pixels bloom)
);
composer.addPass(bloom);
const motionBlur = new AfterimagePass();
motionBlur.uniforms.damp.value = 0;
composer.addPass(motionBlur);
const boostBlur = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    direction: { value: new THREE.Vector2(1, 0) },
    strength: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 direction;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 d = direction * strength;
      vec4 color = texture2D(tDiffuse, vUv) * 0.28;
      color += texture2D(tDiffuse, vUv - d * 0.35) * 0.18;
      color += texture2D(tDiffuse, vUv + d * 0.35) * 0.18;
      color += texture2D(tDiffuse, vUv - d * 0.75) * 0.13;
      color += texture2D(tDiffuse, vUv + d * 0.75) * 0.13;
      color += texture2D(tDiffuse, vUv - d * 1.2) * 0.05;
      color += texture2D(tDiffuse, vUv + d * 1.2) * 0.05;
      gl_FragColor = color;
    }
  `,
});
composer.addPass(boostBlur);
composer.addPass(new OutputPass());

// ---- lights ----
// Ambient + hemisphere keep Optimus readable; the directional sun adds form and
// casts the shadows. The sun follows the player each frame (see loop).
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x10131a, 0.45));

const sun = new THREE.DirectionalLight(0xfff1d6, 4.5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
const SH = 26; // shadow frustum half-size around the player
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
const SUN_OFFSET = new THREE.Vector3(18, 40, 22); // direction/height of the sun
scene.add(sun);
scene.add(sun.target);

// ---- ground (placeholder Cybertron plate) ----
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshStandardMaterial({ color: 0x111722, metalness: 0.35, roughness: 0.85 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Transparent real-shadow receiver makes Optimus's cast shadow readable on the
// dark Cybertron floor without faking a blob under him.
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.012;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// Glowing energon grid. Bright cyan so it crosses the bloom threshold.
const grid = new THREE.GridHelper(1000, 100, 0x9fffff, 0x2f8394);
grid.material.transparent = true;
grid.material.opacity = 0.72;
grid.position.y = 0.025;
scene.add(grid);

// ---- HUD ----
function setHud(player) {
  const mode = !player ? 'loading...' : player.transforming ? 'TRANSFORMING'
    : player.mode === MODE.VEHICLE ? `VEHICLE  (boost: ${player.boostCooldown > 0 ? 'cooling' : 'ready'})` : 'ROBOT  (combat)';
  overlay.innerHTML =
    `<div style="font-weight:bold;letter-spacing:1px">OPTIMUS PRIME</div>` +
    `<div style="opacity:.8">mode: <b>${mode}</b></div>` +
    `<div style="opacity:.55;margin-top:6px">WASD / arrows: move\nSPACE: transform\nRIGHT CLICK: truck boost</div>`;
  overlay.style.whiteSpace = 'pre';
}
setHud(null);

// ---- load Optimus, then build the player ----
let player = null;

const loader = new GLTFLoader();
loader.load(
  '/models/optimus/OptimusPrime_G1.glb',
  (gltf) => {
    const obj = gltf.scene;

    const texLoader = new THREE.TextureLoader();
    texLoader.setPath('/models/optimus/textures/');
    const tex = (file, srgb) => {
      const t = texLoader.load(file);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = false; // match glTF UV convention (opposite of FBX)
      t.anisotropy = 8;
      return t;
    };
    const TEX = {
      body:   { map: 'M_OptimusPrime_G1_baseColor2.png',       normal: 'Tx_OptimusPrime_G1_N.png' },
      rifle:  { map: 'M_OptimusPrime_G1_Rifle_baseColor2.png', normal: 'Tx_OptimusPrime_Rifle_N.png' },
      axe:    { map: 'M_OptimusPrime_G1_Axe_baseColor2.png',   normal: 'Tx_OptimusPrime_Axe_N.png' },
      matrix: { map: 'M_Matrix_OP_baseColor2.png',             normal: 'Tx_Matrix_N.png' },
    };
    const kindOf = (name) =>
      /rifle/i.test(name) ? 'rifle' : /axe/i.test(name) ? 'axe' : /matrix/i.test(name) ? 'matrix' : 'body';

    obj.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;

      // Decepticon emblem hidden (Optimus is an Autobot).
      if (/Symbol_DC/i.test(c.name)) { c.visible = false; return; }
      // Autobot emblem uses flat baked material colors, not a texture: keep them.
      if (/Symbol/i.test(c.name)) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => { if (m) { m.metalness = 0.4; m.roughness = 0.55; m.envMapIntensity = 1.2; } });
        return;
      }
      // Weapons stowed off-model in non-combat clips; hidden until shooting exists.
      if (/rifle|axe/i.test(c.name)) { c.visible = false; }

      const t = TEX[kindOf(c.name)];
      const mat = new THREE.MeshStandardMaterial({
        map: tex(t.map, true),
        normalMap: tex(t.normal, false),
        metalness: 0.85,
        roughness: 0.5,
        envMapIntensity: 1.2,
      });
      // The Matrix of Leadership glows cyan and blooms.
      if (kindOf(c.name) === 'matrix') {
        mat.emissive = new THREE.Color(0x39d8ff);
        mat.emissiveIntensity = 2.2;
      }
      c.material = mat;
    });

    // normalize scale/height from the body mesh (weapons are parked off-model)
    const bodyMesh = obj.getObjectByName('OptimusPrime_G1_NewUV');
    const box = new THREE.Box3().setFromObject(bodyMesh || obj);
    const size = box.getSize(new THREE.Vector3());
    const scale = 9 / size.y;
    obj.scale.setScalar(scale);
    obj.position.y = -box.min.y * scale;

    scene.add(obj);

    const mixer = new THREE.AnimationMixer(obj);
    player = new Player({ object: obj, mixer, clips: gltf.animations || [], shortClip, scene });
    window.__player = player; window.__scene = scene;
  },
  (e) => { setHud(null); overlay.textContent = `loading... ${((e.loaded / (e.total || 1)) * 100).toFixed(0)}%`; },
  (err) => { overlay.textContent = 'GLB load error (see console)'; console.error(err); }
);

// ---- resize ----
window.addEventListener('resize', () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = -FRUSTUM * aspect; camera.right = FRUSTUM * aspect;
  camera.top = FRUSTUM; camera.bottom = -FRUSTUM;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// ---- main loop ----
const clock = new THREE.Clock();
const blurA = new THREE.Vector3();
const blurB = new THREE.Vector3();
const blurDir = new THREE.Vector2(1, 0);
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp to avoid huge steps after a stall

  if (player) {
    if (input.wasPressed('Space')) player.toggleTransform();
    if (input.wasPressed('MouseRight')) player.tryBoost();
    player.update(dt, input.moveAxis());

    // camera eases toward the player (damped follow) instead of locking rigidly
    const p = player.object.position;
    const k = 1 - Math.exp(-CAM_SMOOTH * dt);
    camFocus.x += (p.x - camFocus.x) * k;
    camFocus.z += (p.z - camFocus.z) * k;
    camera.position.set(camFocus.x + CAM_OFFSET.x, CAM_OFFSET.y, camFocus.z + CAM_OFFSET.z);
    CAM_LOOK.set(camFocus.x, 4, camFocus.z);
    camera.lookAt(CAM_LOOK);

    // sun follows the player so the shadow stays crisp around him
    sun.position.set(p.x + SUN_OFFSET.x, SUN_OFFSET.y, p.z + SUN_OFFSET.z);
    sun.target.position.set(p.x, 0, p.z);
    sun.target.updateMatrixWorld();

    if (player.velocity.lengthSq() > 0.01) {
      blurA.copy(p).project(camera);
      blurB.copy(p).add(player.velocity).project(camera);
      blurDir.set(blurB.x - blurA.x, blurB.y - blurA.y);
      if (blurDir.lengthSq() > 0.000001) {
        blurDir.normalize();
        boostBlur.uniforms.direction.value.copy(blurDir);
      }
    }

    const targetAfterimage = 0;
    const targetDirectionalBlur = 0;
    motionBlur.uniforms.damp.value += (targetAfterimage - motionBlur.uniforms.damp.value) * (1 - Math.exp(-10 * dt));
    boostBlur.uniforms.strength.value += (targetDirectionalBlur - boostBlur.uniforms.strength.value) * (1 - Math.exp(-14 * dt));

    setHud(player);
  }

  input.endFrame();
  composer.render();
}
animate();
