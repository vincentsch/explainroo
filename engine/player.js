import { boot } from './runtime.js';

const get = id => document.getElementById(id);
const player = get('player');
const canvas = get('c');
const audio = get('audio');
const seekBar = get('seek');
const playButton = get('play');
const startButton = get('start');
const poster = get('poster');
const captions = get('captions');
const params = new URLSearchParams(location.search);
let engine;
let duration = 0;
let T = 0;
let playing = false;
let started = false;
let audioClock = false;
let stamp = performance.now();
let audioFailed = false;
let request;
let hideTimer;
let cc = false;
try { cc = localStorage.getItem('explainroo-cc') === '1'; } catch {}
audio.muted = params.get('muted') === '1';
const track = get('track').track;
track.mode = 'hidden';

const formatTime = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
function iconButton(button, name, label) {
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
  if (button.title !== label) button.title = label;
  if (!engine || button.dataset.icon === name) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of engine.icons[name]) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  button.replaceChildren(svg);
  button.dataset.icon = name;
}
function controls() {
  iconButton(playButton, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play');
  iconButton(get('mute'), audio.muted ? 'volume-x' : 'volume-2', audio.muted ? 'Unmute' : 'Mute');
  iconButton(get('cc'), 'closed-caption', cc ? 'Hide captions' : 'Show captions');
  iconButton(get('fullscreen'), document.fullscreenElement ? 'minimize' : 'maximize', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  get('mute').setAttribute('aria-pressed', String(audio.muted));
  get('cc').setAttribute('aria-pressed', String(cc));
  seekBar.value = T;
  seekBar.style.setProperty('--played', `${duration ? T / duration * 100 : 0}%`);
  seekBar.setAttribute('aria-valuetext', `${formatTime(T)} of ${formatTime(duration)}`);
  get('time').textContent = `${formatTime(T)} / ${formatTime(duration)}`;
}
function showControls() {
  player.classList.remove('quiet');
  clearTimeout(hideTimer);
  if (playing) hideTimer = setTimeout(() => {
    if (!get('controls').querySelector(':focus-visible')) player.classList.add('quiet');
  }, 2000);
}
function draw() {
  if (engine && started) engine.renderFrame(Math.min(T, Math.max(0, duration - 1 / engine.fps)));
  const cues = [...(track.cues || [])].filter(c => c.startTime <= T && T < c.endTime);
  captions.replaceChildren();
  if (cc && started && cues.length) {
    const span = document.createElement('span');
    span.textContent = cues.map(c => c.getCueAsHTML().textContent).join('\n');
    captions.append(span);
  }
  controls();
}
function resize() {
  if (!engine) return;
  const bounds = player.getBoundingClientRect();
  const scale = Math.min(bounds.width / engine.W, bounds.height / engine.H);
  const width = Math.max(1, Math.round(engine.W * scale * devicePixelRatio));
  const height = Math.max(1, Math.round(engine.H * scale * devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    for (const buffer of engine.buffers) { buffer.width = width; buffer.height = height; }
    engine.scale = width / engine.W;
    canvas.style.width = `${engine.W * scale}px`;
    canvas.style.height = `${engine.H * scale}px`;
    canvas.style.left = `${(bounds.width - engine.W * scale) / 2}px`;
    canvas.style.top = `${(bounds.height - engine.H * scale) / 2}px`;
  }
  draw();
}
function tick(now) {
  if (!playing) return;
  // The sound leads. While it loads or buffers the picture waits, so no words
  // are cut; only a soundtrack that cannot play at all falls back to the clock.
  if (audioClock) T = Math.min(duration, audio.currentTime);
  else if (audioFailed) T = Math.min(duration, T + (now - stamp) / 1000);
  stamp = now;
  draw();
  if (T >= duration) pause();
  else request = requestAnimationFrame(tick);
}
function pause() {
  playing = false;
  audio.pause();
  audioClock = false;
  cancelAnimationFrame(request);
  showControls();
  controls();
}
async function play() {
  if (!engine || playing) return;
  if (T >= duration) seek(0);
  started = true;
  poster.hidden = true;
  startButton.hidden = true;
  get('controls').hidden = false;
  playing = true;
  stamp = performance.now();
  audio.currentTime = T;
  draw();
  showControls();
  request = requestAnimationFrame(tick);
  try { await audio.play(); }
  catch (e) {
    if (e.name === 'NotAllowedError') { pause(); get('status').textContent = 'Press Play to start playback.'; }
  }
}
function seek(time) {
  T = Math.max(0, Math.min(duration, time));
  stamp = performance.now();
  audio.currentTime = T;
  draw();
}
function toggle() { if (playing) pause(); else play(); }
function mute() { audio.muted = !audio.muted; controls(); }
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await player.requestFullscreen();
  } catch { get('status').textContent = 'Fullscreen is not available here.'; }
}
get('play').onclick = toggle;
startButton.onclick = toggle;
for (const el of [canvas, poster]) el.onclick = toggle;
seekBar.oninput = () => seek(Number(seekBar.value));
get('mute').onclick = mute;
get('fullscreen').onclick = fullscreen;
get('cc').onclick = () => {
  cc = !cc;
  try { localStorage.setItem('explainroo-cc', cc ? '1' : '0'); } catch {}
  draw();
};
player.onpointermove = showControls;
player.onpointerdown = showControls;
player.onfocusin = showControls;
player.onfocusout = showControls;
document.onkeydown = event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  // Leave a focused button's native Space click and the slider's arrows intact.
  if ((key === ' ' && event.target.tagName === 'BUTTON') || (['arrowleft', 'arrowright'].includes(key) && event.target === seekBar)) return;
  const actions = { ' ': toggle, k: toggle, arrowleft: () => seek(T - 5), arrowright: () => seek(T + 5), f: fullscreen, m: mute };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
  showControls();
};
audio.onplaying = () => {
  if (!playing) return;
  if (Math.abs(audio.currentTime - T) > 0.1) audio.currentTime = T;
  audioClock = true;
  get('status').textContent = '';
};
audio.onwaiting = audio.onseeking = () => { audioClock = false; stamp = performance.now(); };
audio.onseeked = () => { audioClock = playing && !audio.paused && audio.readyState >= 3; };
audio.onloadedmetadata = async () => {
  if (audio.src.startsWith('blob:') || (audio.seekable.length && audio.seekable.end(audio.seekable.length - 1) >= duration - 0.1)) return;
  audioClock = false;
  try {
    const res = await fetch('./audio.m4a');
    if (!res.ok) return;
    const blob = await res.blob();
    audio.pause();
    audio.src = URL.createObjectURL(blob);
    audio.currentTime = T;
    if (playing) await audio.play();
  } catch {}
};
audio.onended = () => { T = duration; draw(); pause(); };
audio.onerror = () => { audioFailed = true; audioClock = false; stamp = performance.now(); };
get('track').onload = draw;
document.onfullscreenchange = () => {
  controls();
  resize();
};
new ResizeObserver(resize).observe(player);
window.addEventListener('resize', resize);
controls();
window.explainrooReady = (async () => {
  const result = await boot({ canvas, player: true });
  engine = result.engine;
  duration = result.state.timeline.duration;
  document.title = result.state.title;
  canvas.setAttribute('aria-label', result.state.title);
  poster.alt = `${result.state.title} cover`;
  player.style.aspectRatio = `${engine.W} / ${engine.H}`;
  seekBar.max = duration;
  seekBar.disabled = playButton.disabled = startButton.disabled = false;
  const start = Number(params.get('t'));
  seek(Number.isFinite(start) ? start : 0);
  resize();
  for (const clip of engine.clips.values()) clip.video.onseeked = () => { if (!playing) draw(); };
  if (params.get('autoplay') === '1') await play();
  return engine;
})();
window.explainrooReady.catch(e => { get('status').textContent = `Could not load the player: ${e.message}`; });
