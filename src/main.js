import { Game } from './game.js';
import { UI } from './ui.js';

const game = new Game(document.getElementById('game'), document.getElementById('hud'));
const ui = new UI(game);
game.ui = ui;
window.skyfront = game; // handy for debugging from the console

ui.showLoading('Generating the world…');
let last = performance.now();
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  try {
    game.frame(dt);
  } catch (e) {
    console.error(e);
    showError(e);
  }
  requestAnimationFrame(loop);
}

function showError(e) {
  const el = document.getElementById('err');
  if (el && !el.textContent) el.textContent = 'Something went wrong: ' + (e && e.message ? e.message : e) + ' — check the browser console.';
}
addEventListener('error', (e) => showError(e.error || e.message));

game.init((t) => ui.showLoading(t)).then(() => {
  ui.showTitle();
  requestAnimationFrame(loop);
}).catch((e) => { console.error(e); showError(e); });
