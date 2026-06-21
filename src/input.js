// Keyboard input: tracks held keys plus edge-triggered presses for this frame.
const held = new Set();
const pressed = new Set();

window.addEventListener('keydown', (e) => {
  // ignore auto-repeat for edge detection
  if (!e.repeat && !held.has(e.code)) pressed.add(e.code);
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) pressed.add('MouseRight');
});
// drop state if the window loses focus so keys don't "stick"
window.addEventListener('blur', () => { held.clear(); pressed.clear(); });

export const input = {
  isDown: (code) => held.has(code),
  wasPressed: (code) => pressed.has(code),
  // WASD / arrow keys as a raw axis: x = right(+)/left(-), z = down(+)/up(-)
  moveAxis() {
    let x = 0, z = 0;
    if (held.has('KeyW') || held.has('ArrowUp')) z -= 1;
    if (held.has('KeyS') || held.has('ArrowDown')) z += 1;
    if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
    return { x, z };
  },
  // clear per-frame edges; call at the end of each frame
  endFrame() { pressed.clear(); },
};
