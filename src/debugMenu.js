export const debugState = {
  godMode: false,
  freezeEnemies: false,
};

let player = null;
let animationNames = [];
let animationIndex = 0;
let animNameEl = null;
let prevButton = null;
let nextButton = null;
let resumeButton = null;

function setAnimationControlsEnabled(enabled) {
  if (prevButton) prevButton.disabled = !enabled;
  if (nextButton) nextButton.disabled = !enabled;
  if (resumeButton) resumeButton.disabled = !enabled;
}

function renderAnimationName() {
  if (!animNameEl) return;
  animNameEl.textContent = animationNames.length
    ? animationNames[animationIndex]
    : 'loading...';
}

function previewAnimation(index) {
  if (!player || animationNames.length === 0) return;
  animationIndex = (index + animationNames.length) % animationNames.length;
  player.previewAnimation(animationNames[animationIndex]);
  renderAnimationName();
}

export function initDebugMenu() {
  const godModeInput = document.getElementById('debug-god-mode');
  const freezeEnemiesInput = document.getElementById('debug-freeze-enemies');
  animNameEl = document.getElementById('debug-animation-name');
  prevButton = document.getElementById('debug-anim-prev');
  nextButton = document.getElementById('debug-anim-next');
  resumeButton = document.getElementById('debug-anim-resume');

  if (godModeInput) {
    godModeInput.addEventListener('change', () => {
      debugState.godMode = godModeInput.checked;
    });
  }
  if (freezeEnemiesInput) {
    freezeEnemiesInput.addEventListener('change', () => {
      debugState.freezeEnemies = freezeEnemiesInput.checked;
    });
  }
  if (prevButton) prevButton.addEventListener('click', () => previewAnimation(animationIndex - 1));
  if (nextButton) nextButton.addEventListener('click', () => previewAnimation(animationIndex + 1));
  if (resumeButton) {
    resumeButton.addEventListener('click', () => {
      if (player) player.clearAnimationPreview();
    });
  }

  setAnimationControlsEnabled(false);
  renderAnimationName();
}

export function bindDebugPlayer(nextPlayer) {
  player = nextPlayer;
  animationNames = player ? player.getAnimationNames() : [];
  animationIndex = Math.max(0, animationNames.indexOf(player?.currentName));
  setAnimationControlsEnabled(animationNames.length > 0);
  renderAnimationName();
}
