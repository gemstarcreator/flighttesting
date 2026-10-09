import { Game } from './game.js';
import { UI } from './ui.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

// Shown when the browser has 3D graphics (WebGL) switched off or blocked.
function showWebglHelp(detail) {
  const ui = document.getElementById('ui');
  ui.classList.add('show');
  ui.innerHTML = `<div class="panel">
    <h1 class="logo" style="font-size:38px">SKYFRONT</h1>
    <h2>3D graphics are turned off in this browser</h2>
    <p>The game needs WebGL, and your browser reports it as disabled. This is a browser or graphics-driver setting, not a problem with the game. Try these in order:</p>
    <ol class="obj">
      <li><b>Turn on hardware acceleration.</b> Chrome: Settings → System → turn on <i>Use graphics acceleration when available</i>, then click <i>Relaunch</i>. Edge: Settings → System and performance → same switch.</li>
      <li><b>Check it worked.</b> Open <code>chrome://gpu</code> (or <code>edge://gpu</code>). The line <i>WebGL</i> should say <i>Hardware accelerated</i>.</li>
      <li><b>If WebGL is still disabled</b>, your graphics driver may be blocklisted. Open <code>chrome://flags</code>, enable <i>Override software rendering list</i>, and relaunch.</li>
      <li><b>Update your graphics driver</b> (Intel, AMD or NVIDIA website, or Windows Update → Optional updates), then restart the laptop.</li>
      <li>Or try another browser such as Firefox or Edge.</li>
    </ol>
    <p class="hint">If you are opening the game inside a preview pane or embedded viewer, open it in a normal browser tab instead.</p>
    ${detail ? `<p class="hint">Details: ${String(detail).replace(/[<>&]/g, '')}</p>` : ''}
    <div class="menu"><button onclick="location.reload()">Try again</button></div>
  </div>`;
}

function showError(e) {
  const el = document.getElementById('err');
  if (el && !el.textContent) el.textContent = 'Something went wrong: ' + (e && e.message ? e.message : e) + ' — check the browser console.';
}

let game = null;
try {
  if (!webglAvailable()) throw new Error('WebGL is not available');
  game = new Game(document.getElementById('game'), document.getElementById('hud'));
} catch (e) {
  console.error(e);
  showWebglHelp(e && e.message);
}

if (game) {
  const ui = new UI(game);
  game.ui = ui;
  window.skyfront = game; // handy for debugging from the console

  ui.showLoading('Generating the world…');
  let last = performance.now();
  const loop = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    try {
      game.frame(dt);
    } catch (e) {
      console.error(e);
      showError(e);
    }
    requestAnimationFrame(loop);
  };
  addEventListener('error', (e) => showError(e.error || e.message));

  game.init((t) => ui.showLoading(t)).then(() => {
    ui.showTitle();
    requestAnimationFrame(loop);
  }).catch((e) => { console.error(e); showError(e); });
}
