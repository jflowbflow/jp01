import { Game } from './Game.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const weekNum = document.getElementById('week-num');
const lineCount = document.getElementById('line-count');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');

const renderer = new Renderer(canvas);
const game = new Game(window.innerWidth, window.innerHeight);
const input = new InputHandler(canvas, game);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  game.w = w;
  game.h = h;
}

window.addEventListener('resize', resize);
resize();

startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  game.start();
});

window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (game.running) game.paused = !game.paused;
  }
});

let lastTime = 0;
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  game.update(dt);

  renderer.clear();
  renderer.drawLines(game.lines);
  renderer.drawTrains(game.lines);

  const dragState = input.getDragState();
  if (dragState.dragging) {
    renderer.drawDragPreview(dragState.drag, dragState.snapTarget, dragState.snapT);
  }

  renderer.drawStations(game.stations);

  const hud = game.getHud();
  weekNum.textContent = hud.week;
  lineCount.textContent = hud.linesRemaining;

  if (hud.gameOver) {
    overlay.classList.remove('hidden');
    overlayTitle.textContent = 'Overcrowded';
    overlayMsg.innerHTML = `Week ${hud.week} — a station was overwhelmed.<br>Click to try again.`;
    startBtn.textContent = 'Retry';
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
