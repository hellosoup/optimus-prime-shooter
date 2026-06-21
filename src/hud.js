// HUD: health bar, truck-boost cooldown, wave/kills, hit flash, game-over panel.
// Built once into #overlay; updated each frame from a plain state object.

const overlay = document.getElementById('overlay');
const hitflash = document.getElementById('hitflash');
const gameover = document.getElementById('gameover');
const goStats = document.getElementById('go-stats');
const pausemenu = document.getElementById('pausemenu');
const waveBanner = document.getElementById('wave-banner');
const radarCanvas = document.getElementById('radar-canvas');
const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

let el = null;
let waveBannerTimer = null;

export function initHud() {
  overlay.innerHTML = `
    <div class="hud-title">OPTIMUS PRIME</div>
    <div class="hud-row">HEALTH</div>
    <div class="bar"><div class="bar-fill" id="hp-fill"></div><span class="bar-text" id="hp-text"></span></div>
    <div class="hud-row" id="mode-row">MODE: ROBOT</div>
    <div class="hud-row">TRUCK BOOST</div>
    <div class="bar"><div class="bar-fill boost" id="boost-fill"></div><span class="bar-text" id="boost-text"></span></div>
    <div class="hud-stats"><span id="wave-text">WAVE 1</span><span id="kills-text">KILLS 0</span></div>
    <div class="hud-row" id="enemies-row">enemies: 0</div>
    <div class="hud-controls">
      <div class="hud-row">CONTROLS</div>
      <div><b>WASD / arrows</b><span>Move</span></div>
      <div><b>Space</b><span>Transform</span></div>
      <div><b>Left click</b><span>Attack / truck boost</span></div>
      <div><b>Esc</b><span>Pause / continue</span></div>
      <div><b>Enter</b><span>Restart when paused</span></div>
      <div><b>M</b><span>Mute music</span></div>
    </div>
  `;
  el = {
    hpFill: document.getElementById('hp-fill'),
    hpText: document.getElementById('hp-text'),
    modeRow: document.getElementById('mode-row'),
    boostFill: document.getElementById('boost-fill'),
    boostText: document.getElementById('boost-text'),
    waveText: document.getElementById('wave-text'),
    killsText: document.getElementById('kills-text'),
    enemiesRow: document.getElementById('enemies-row'),
  };
}

function hpColor(pct) {
  // green -> amber -> red as health drops
  if (pct > 0.5) return '#39ff8a';
  if (pct > 0.25) return '#ffd23a';
  return '#ff4a5a';
}

function drawRadar(playerPos, enemies = []) {
  if (!radarCtx || !playerPos) return;
  const w = radarCanvas.width;
  const h = radarCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.44;
  const range = 120;

  radarCtx.clearRect(0, 0, w, h);
  radarCtx.save();
  radarCtx.beginPath();
  radarCtx.arc(cx, cy, r, 0, Math.PI * 2);
  radarCtx.clip();

  radarCtx.strokeStyle = 'rgba(127,233,255,.22)';
  radarCtx.lineWidth = 1;
  for (const rr of [r * 0.35, r * 0.68, r]) {
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, rr, 0, Math.PI * 2);
    radarCtx.stroke();
  }
  for (const enemy of enemies) {
    const dx = enemy.x - playerPos.x;
    const dz = enemy.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    const clamped = Math.min(dist, range);
    const scale = (clamped / range) * r;
    const nx = dist > 0.001 ? dx / dist : 0;
    const nz = dist > 0.001 ? dz / dist : 0;
    const x = cx + nx * scale;
    const y = cy + nz * scale;

    radarCtx.fillStyle = dist > range ? 'rgba(255,74,90,.55)' : '#ff4a5a';
    radarCtx.shadowColor = '#ff2030';
    radarCtx.shadowBlur = 8;
    radarCtx.beginPath();
    radarCtx.arc(x, y, dist > range ? 2.2 : 3.2, 0, Math.PI * 2);
    radarCtx.fill();
  }

  radarCtx.shadowBlur = 10;
  radarCtx.shadowColor = '#39d8ff';
  radarCtx.fillStyle = '#9fffff';
  radarCtx.beginPath();
  radarCtx.arc(cx, cy, 4, 0, Math.PI * 2);
  radarCtx.fill();

  radarCtx.restore();
}

export function updateHud(s) {
  if (!el) return;

  const hpPct = Math.max(0, Math.min(1, s.health / s.maxHealth));
  el.hpFill.style.width = (hpPct * 100).toFixed(1) + '%';
  el.hpFill.style.background = hpColor(hpPct);
  el.hpText.textContent = `${Math.ceil(s.health)} / ${s.maxHealth}`;

  el.modeRow.textContent = `MODE: ${s.mode.toUpperCase()}${s.transforming ? ' (transforming)' : ''}`;

  // boost bar: only meaningful in truck mode
  if (s.mode !== 'vehicle') {
    el.boostFill.style.width = '100%';
    el.boostFill.style.opacity = '0.25';
    el.boostText.textContent = 'TRUCK MODE ONLY';
  } else if (s.boosting) {
    el.boostFill.style.width = (s.boostActiveRatio * 100).toFixed(1) + '%';
    el.boostFill.style.opacity = '1';
    el.boostText.textContent = 'BOOSTING';
  } else if (s.boostReady) {
    el.boostFill.style.width = '100%';
    el.boostFill.style.opacity = '1';
    el.boostText.textContent = 'READY';
  } else {
    el.boostFill.style.width = ((1 - s.boostCooldownRatio) * 100).toFixed(1) + '%';
    el.boostFill.style.opacity = '0.7';
    el.boostText.textContent = 'CHARGING';
  }

  el.waveText.textContent = s.waveBreak > 0 ? `WAVE ${s.wave} CLEARED` : `WAVE ${s.wave}`;
  el.killsText.textContent = `KILLS ${s.kills}`;
  el.enemiesRow.textContent = s.waveBreak > 0
    ? `next wave in ${Math.ceil(s.waveBreak)}...`
    : `enemies: ${s.enemies}`;

  hitflash.style.opacity = String(Math.max(0, Math.min(1, s.hitFlash)));
  drawRadar(s.playerPos, s.enemyPositions);
}

export function showGameOver(s) {
  goStats.textContent = `Reached WAVE ${s.wave}  ·  ${s.kills} KILLS`;
  gameover.classList.add('show');
}

export function hideGameOver() {
  gameover.classList.remove('show');
}

export function showPause() {
  pausemenu.classList.add('show');
}

export function hidePause() {
  pausemenu.classList.remove('show');
}

export function showWaveBanner(wave) {
  if (!waveBanner) return;
  if (waveBannerTimer) clearTimeout(waveBannerTimer);
  waveBanner.textContent = `WAVE ${wave}`;
  waveBanner.classList.add('show');
  waveBannerTimer = setTimeout(() => {
    waveBanner.classList.remove('show');
    waveBannerTimer = null;
  }, 1700);
}
