// Optimus Prime: Cybertron Survivor - playable core (move + transform).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { input } from './input.js';
import { Player, MODE } from './player.js';
import { loadSfx, playCombatSfx } from './sfx.js';
import { setMusicPaused, startMusicPlaylist, toggleMusicMute } from './music.js';
import { EnemyManager } from './enemies.js';
import { BeachBallManager } from './beachBalls.js';
import { DominoManager } from './dominoes.js';
import { LegoPyramidManager } from './legoPyramid.js';
import { HealthPackManager } from './healthPacks.js';
import { RubiksCubeManager } from './rubiksCube.js';
import { PhysicsWorld } from './physicsWorld.js';
import { initHud, updateHud, showGameOver, hideGameOver, showPause, hidePause, showWaveBanner } from './hud.js';
import { bindDebugPlayer, debugState, initDebugMenu } from './debugMenu.js';

const transformSfxReady = loadSfx('/sfx/Tf_sound.ogg');

// The intro script owns audio unlock. Once the screen starts splitting open, the
// background playlist fades in; gameplay starts later on `introdone`.
const startMusicOnReveal = () => startMusicPlaylist();
if (window.__introDone === false) window.addEventListener('introreveal', startMusicOnReveal, { once: true });
else startMusicOnReveal();

// glTF clip names arrive as "OptimusPrime_G1|idle02|Base Layer"; shorten them.
const shortClip = (name) => {
  const parts = name.split('|');
  return parts.length >= 2 ? parts[1] : name;
};

const overlay = document.getElementById('overlay');
const app = document.getElementById('app');
initDebugMenu();

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
const shakeOffset = new THREE.Vector3();
let shakeTime = 0;
let shakeDuration = 0;
let shakeStrength = 0;
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
const smaa = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);
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
const FLOOR_SIZE = 1000;
const FLOOR_HALF = FLOOR_SIZE / 2;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x111722, metalness: 0.35, roughness: 0.85 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Transparent real-shadow receiver makes Optimus's cast shadow readable on the
// dark Cybertron floor without faking a blob under him.
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.012;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// Glowing energon grid. Mesh strips give the lines a little readable thickness.
const grid = new THREE.Group();
{
  const divisions = 100;
  const step = FLOOR_SIZE / divisions;
  const lineT = 0.08;
  const minorMat = new THREE.MeshBasicMaterial({ color: 0x2f8394, transparent: true, opacity: 0.62 });
  const majorMat = new THREE.MeshBasicMaterial({ color: 0x9fffff, transparent: true, opacity: 0.72 });
  const lineX = new THREE.BoxGeometry(FLOOR_SIZE, 0.01, lineT);
  const lineZ = new THREE.BoxGeometry(lineT, 0.01, FLOOR_SIZE);
  for (let i = 0; i <= divisions; i += 1) {
    const p = -FLOOR_HALF + i * step;
    const mat = Math.abs(p) < 0.001 ? majorMat : minorMat;
    const xLine = new THREE.Mesh(lineX, mat);
    xLine.position.set(0, 0.025, p);
    grid.add(xLine);
    const zLine = new THREE.Mesh(lineZ, mat);
    zLine.position.set(p, 0.025, 0);
    grid.add(zLine);
  }
}
scene.add(grid);

// ---- arena walls (clamp the play area to the visible floor) ----
const ARENA_HALF = FLOOR_HALF;
{
  const wallH = 10, wallT = 2;
  const wallOffset = FLOOR_HALF + wallT / 2;
  const span = FLOOR_SIZE + wallT * 2;
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a26, emissive: 0x1f7fa0, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.4,
  });
  const sides = [
    { x: 0, z: wallOffset, w: span, d: wallT },
    { x: 0, z: -wallOffset, w: span, d: wallT },
    { x: wallOffset, z: 0, w: wallT, d: span },
    { x: -wallOffset, z: 0, w: wallT, d: span },
  ];
  for (const s of sides) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, wallH, s.d), wallMat);
    wall.position.set(s.x, wallH / 2, s.z);
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
  }
}

// ---- enemies / pickups / waves ----
const enemyManager = new EnemyManager(scene, ARENA_HALF);
const healthPackManager = new HealthPackManager(scene);
enemyManager.onKill = ({ reason, position }) => {
  playCombatSfx('enemyDeath');
  if (reason === 'ram') {
    addCameraShake(0.9, 0.16);
  } else if (reason === 'ball') {
    addCameraShake(0.55, 0.12);
  }
  healthPackManager.maybeDrop(position);
};
enemyManager.onWaveStart = (wave) => showWaveBanner(wave);

const physicsWorld = new PhysicsWorld(ARENA_HALF);
const beachBallManager = new BeachBallManager(scene, ARENA_HALF, physicsWorld);
const dominoManager = new DominoManager(scene, physicsWorld);
const legoPyramidManager = new LegoPyramidManager(scene, ARENA_HALF, physicsWorld);
const rubiksCubeManager = new RubiksCubeManager(scene, physicsWorld);

// ---- game state ----
const MAX_HP = 100;
const IFRAME_TIME = 0.9;       // invulnerability window after taking a hit
const DEATH_FLASH_TIME = 0.55;
const GAME_OVER_DELAY = 1.25;
let health = MAX_HP;
let iframe = 0;
let hitFlash = 0;              // red screen-edge flash, decays each frame
let deathTimer = 0;
let deathExploded = false;
let gameState = 'loading';    // 'loading' | 'playing' | 'paused' | 'dying' | 'gameover'
let pendingInitialWave = false;

function addCameraShake(strength, duration) {
  shakeStrength = Math.max(shakeStrength, strength);
  shakeDuration = Math.max(shakeDuration, duration);
  shakeTime = Math.max(shakeTime, duration);
}

function damagePlayer(amount, sourcePosition = null) {
  if (gameState !== 'playing' || iframe > 0) return;
  if (debugState.godMode) {
    health = MAX_HP;
    return;
  }
  health = Math.max(0, health - amount);
  iframe = IFRAME_TIME;
  hitFlash = 1;
  if (player) {
    player.flashDamage();
    if (sourcePosition) player.applyKnockback(sourcePosition, 50);
  }
  addCameraShake(0.75, 0.18);
  playCombatSfx('damage');
  if (health <= 0) {
    gameState = 'dying';
    deathTimer = 0;
    deathExploded = false;
    addCameraShake(1.0, 0.24);
  }
}

function restart() {
  health = MAX_HP; iframe = 0; hitFlash = 0; deathTimer = 0; deathExploded = false;
  player.reset();
  enemyManager.reset();
  healthPackManager.reset();
  beachBallManager.reset();
  dominoManager.reset();
  legoPyramidManager.reset();
  rubiksCubeManager.reset();
  hideGameOver();
  hidePause();
  setMusicPaused(false);
  gameState = 'playing';
  showWaveBanner(1);
}

function beginInitialWave() {
  if (!pendingInitialWave) return;
  pendingInitialWave = false;
  enemyManager.reset(); // queue wave 1
  gameState = 'playing';
  showWaveBanner(1);
}

// ---- load Optimus, then build the player ----
let player = null;

async function bootGame() {
  try {
    overlay.textContent = 'preloading audio...';
    await transformSfxReady;

    overlay.textContent = 'preloading assets...';
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onProgress = (_url, loaded, total) => {
      overlay.textContent = `preloading assets... ${Math.round((loaded / Math.max(total, 1)) * 100)}%`;
    };

    const loader = new GLTFLoader(loadingManager);
    const texLoader = new THREE.TextureLoader(loadingManager);
    texLoader.setPath('/models/optimus/textures/');

    const gltf = await loader.loadAsync('/models/optimus/OptimusPrime_G1.glb');
    const obj = gltf.scene;

    const tex = async (file, srgb) => {
      const t = await texLoader.loadAsync(file);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = false; // match glTF UV convention (opposite of FBX)
      t.anisotropy = 8;
      return t;
    };
    const TEX = {
      body: {
        map: await tex('M_OptimusPrime_G1_baseColor2.png', true),
        normal: await tex('Tx_OptimusPrime_G1_N.png', false),
      },
      rifle: {
        map: await tex('M_OptimusPrime_G1_Rifle_baseColor2.png', true),
        normal: await tex('Tx_OptimusPrime_Rifle_N.png', false),
      },
      axe: {
        map: await tex('M_OptimusPrime_G1_Axe_baseColor2.png', true),
        normal: await tex('Tx_OptimusPrime_Axe_N.png', false),
      },
      matrix: {
        map: await tex('M_Matrix_OP_baseColor2.png', true),
        normal: await tex('Tx_Matrix_N.png', false),
      },
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
        map: t.map,
        normalMap: t.normal,
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
    bindDebugPlayer(player);
    // Attacks destroy enemies in range when the hit window opens.
    player.onHit = (type) => {
      const ballHits = beachBallManager.handleAttack(type, player.object.position, player.heading);
      const dominoHits = dominoManager.handleAttack(type, player.object.position, player.heading);
      const legoHits = legoPyramidManager.handleAttack(type, player.object.position, player.heading);
      const rubiksHits = rubiksCubeManager.handleAttack(type, player.object.position, player.heading);
      const killed = enemyManager.handleAttack(type, player.object.position, player.heading);
      if (killed > 0 || ballHits > 0 || dominoHits > 0 || legoHits > 0 || rubiksHits > 0) {
        addCameraShake(type === 'smash' ? 1.05 : 0.45, type === 'smash' ? 0.22 : 0.1);
        playCombatSfx(type === 'smash' ? 'smash' : 'hit');
      } else {
        playCombatSfx('whiff');
      }
    };
    window.__player = player; window.__scene = scene;

    initHud();
    pendingInitialWave = true;
    if (window.__introDone === false) window.addEventListener('introdone', beginInitialWave, { once: true });
    else beginInitialWave();
  } catch (err) {
    overlay.textContent = 'preload error (see console)';
    console.error(err);
  }
}
bootGame();

// ---- resize ----
window.addEventListener('resize', () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = -FRUSTUM * aspect; camera.right = FRUSTUM * aspect;
  camera.top = FRUSTUM; camera.bottom = -FRUSTUM;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
  smaa.setSize(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
});

// ---- main loop ----
const clock = new THREE.Clock();
const blurA = new THREE.Vector3();
const blurB = new THREE.Vector3();
const blurDir = new THREE.Vector2(1, 0);
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp to avoid huge steps after a stall

  if (input.wasPressed('KeyM')) toggleMusicMute();

  if (player) {
    if (gameState === 'playing') {
      if (input.wasPressed('Escape')) {
        gameState = 'paused';
        showPause();
        setMusicPaused(true);
        player.silenceMovementSfx();
        input.endFrame();
        composer.render();
        return;
      }

      iframe = Math.max(0, iframe - dt);
      hitFlash = Math.max(0, hitFlash - dt * 3);

      if (input.wasPressed('Space')) {
        const wasTransforming = player.transforming;
        player.toggleTransform();
        if (!wasTransforming && player.transforming) addCameraShake(0.35, 0.12);
      }
      if (input.wasPressed('MouseLeft')) {
        if (player.mode === MODE.VEHICLE) player.tryBoost();
        else player.attack('attack01');
      }
      player.update(dt, input.moveAxis());

      // keep Optimus inside the walled arena
      const lim = ARENA_HALF - 3;
      player.object.position.x = Math.max(-lim, Math.min(lim, player.object.position.x));
      player.object.position.z = Math.max(-lim, Math.min(lim, player.object.position.z));

      beachBallManager.update(dt, player);
      dominoManager.update(dt, player, beachBallManager.getImpactors());
      legoPyramidManager.update(dt, player, beachBallManager.getImpactors());
      rubiksCubeManager.update(dt, player, beachBallManager.getImpactors());
      physicsWorld.step(dt);
      beachBallManager.sync(enemyManager);
      dominoManager.sync();
      legoPyramidManager.sync();
      rubiksCubeManager.sync();
      enemyManager.update(dt, player, damagePlayer, [
        ...beachBallManager.getObstacles(),
        ...dominoManager.getObstacles(),
        ...legoPyramidManager.getObstacles(),
        ...rubiksCubeManager.getObstacles(),
      ], { freezeMovement: debugState.freezeEnemies });
      healthPackManager.update(dt, player, (amount) => {
        if (health >= MAX_HP) return false;
        health = Math.min(MAX_HP, health + amount);
        playCombatSfx('upgrade');
        return true;
      });
    } else if (gameState === 'paused') {
      if (input.wasPressed('Escape')) {
        hidePause();
        setMusicPaused(false);
        gameState = 'playing';
      } else if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) {
        restart();
      } else {
        player.silenceMovementSfx();
      }
    } else if (gameState === 'dying') {
      hitFlash = Math.max(0, hitFlash - dt * 3);
      deathTimer += dt;
      player.stepDeathFx(dt);
      if (!deathExploded && deathTimer >= DEATH_FLASH_TIME) {
        deathExploded = true;
        player.explode();
        hitFlash = 1;
        addCameraShake(1.8, 0.36);
        playCombatSfx('smash');
      }
      if (deathTimer >= DEATH_FLASH_TIME + GAME_OVER_DELAY) {
        gameState = 'gameover';
        showGameOver({ wave: enemyManager.wave, kills: enemyManager.kills });
      }
    } else if (gameState === 'gameover') {
      player.stepDeathFx(dt); // keep debris/smoke moving under the panel
      if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) restart();
    }

    // camera eases toward the player (damped follow) instead of locking rigidly
    const p = player.object.position;
    const k = 1 - Math.exp(-CAM_SMOOTH * dt);
    camFocus.x += (p.x - camFocus.x) * k;
    camFocus.z += (p.z - camFocus.z) * k;
    shakeOffset.set(0, 0, 0);
    if (shakeTime > 0) {
      shakeTime = Math.max(0, shakeTime - dt);
      const falloff = shakeDuration > 0 ? shakeTime / shakeDuration : 0;
      const amp = shakeStrength * falloff * falloff;
      shakeOffset.set(
        (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp * 0.45,
        (Math.random() - 0.5) * amp
      );
      if (shakeTime <= 0) {
        shakeDuration = 0;
        shakeStrength = 0;
      }
    }
    camera.position.set(camFocus.x + CAM_OFFSET.x, CAM_OFFSET.y, camFocus.z + CAM_OFFSET.z).add(shakeOffset);
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

    updateHud({
      health, maxHealth: MAX_HP,
      mode: player.mode, transforming: player.transforming,
      boosting: player.boosting, boostReady: player.boostReady, boostCooldownRatio: player.boostCooldownRatio,
      wave: enemyManager.wave, kills: enemyManager.kills, enemies: enemyManager.alive,
      waveBreak: enemyManager.waveBreak, hitFlash,
      playerPos: player.object.position,
      enemyPositions: enemyManager.getRadarTargets(),
    });
  }

  input.endFrame();
  composer.render();
}
animate();
