// HUD: health bar, truck-boost cooldown, wave/kills, hit flash, game-over panel.
// Built once into #overlay; updated each frame from a plain state object.

const overlay = document.getElementById('overlay');
const hitflash = document.getElementById('hitflash');
const gameover = document.getElementById('gameover');
const goStats = document.getElementById('go-stats');
const pausemenu = document.getElementById('pausemenu');

let el = null;

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
    el.boostFill.style.width = '100%';
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
