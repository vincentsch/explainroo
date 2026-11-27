// 3D scenes with three.js for s.three. The library loads at boot, only for a
// project that calls s.three. One WebGL renderer serves the whole page, since
// Chrome allows only a few WebGL contexts, and each element copies what it
// rendered into a picture of its own. An element's scene is built once by its
// setup, with Math.random seeded by its key, so every render page builds the
// same one, and its frame function sets everything from the time.
import { hashStr, mulberry32 } from './util.js';

let THREE = null;
let renderer = null;
let studio = null;

// The three.js files the page imports, from the root of the engine's server
// or of an exported player.
export const THREE_FILES = ['three.module.js', 'three.core.js'];

export async function loadThree(root) {
  THREE ??= await import(new URL(`${root}vendor/three/three.module.js`, document.baseURI).href);
  return THREE;
}

export function threeLoaded() {
  return THREE !== null;
}

// The page's renderer, made the first time a 3D element draws. `fail` turns a
// message into the error the scene reports.
function getRenderer(fail) {
  if (renderer && !renderer.getContext().isContextLost()) return renderer;
  if (renderer) throw fail('WebGL stopped working on this page while it drew a 3D scene. Run the command again. If it keeps happening, the scene may need more memory than this computer gives WebGL: use fewer or simpler objects');
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw fail(`3D scenes need WebGL, and this Chrome has none (${e.message}). Run "npx --yes explainroo doctor" to see which Chrome explainroo uses, and try Google Chrome`);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping keeps the look's colors close to what they are in 2D.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setPixelRatio(1);
  return renderer;
}

// A soft studio around the scene, for light that reflects in shiny and metal
// surfaces: a light grey room with a few bright panels, blurred once.
function studioLight() {
  if (studio) return studio;
  const room = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x8a8f98, side: THREE.BackSide }));
  walls.scale.set(30, 16, 30);
  walls.position.y = 6;
  room.add(walls);
  // Each panel: its place, its size and how bright it is.
  for (const [x, y, z, sx, sy, sz, level] of [[0, 13.5, 0, 14, 0.4, 9, 6], [-14.5, 5, 2, 0.4, 8, 9, 3.5], [14.5, 6, -3, 0.4, 6, 8, 2.2], [3, 4, 14.5, 9, 6, 0.4, 1.6]]) {
    const panel = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(level, level, level) }));
    panel.position.set(x, y, z);
    panel.scale.set(sx, sy, sz);
    room.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  studio = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  return studio;
}

// The lit stage a 3D element starts with: a camera 10 units back looking at
// the middle, a sky light, a key light from the upper right and a soft fill
// from the left. setup and frame may move, change or remove any of them.
function stage(w, h) {
  const scene = new THREE.Scene();
  scene.environment = studioLight();
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const sky = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(5, 8, 6);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-7, 2, 4);
  scene.add(sky, key, fill);
  return { scene, camera, lights: { sky, key, fill } };
}

// The element under `key` of this engine, built by its setup the first time it
// is drawn. `tools` are the helpers setup and frame get: texture and color.
export function threeElement(engine, key, spec, w, h, tools, fail) {
  engine.threeEls ??= new Map();
  let el = engine.threeEls.get(key);
  if (el) return el;
  getRenderer(fail);
  const { scene, camera, lights } = stage(w, h);
  el = { scene, camera, lights, state: undefined, bitmap: null, rendered: null };
  const saved = Math.random;
  Math.random = mulberry32(hashStr(`three|${key}`));
  try {
    const out = spec.setup ? spec.setup({ THREE, scene, camera, lights, w, h, ...tools }) : undefined;
    if (out && typeof out.then === 'function') throw fail('s.three setup must not be async. It runs once and builds the scene; texture() gives an image from assets/ at once, with nothing to wait for');
    el.state = out;
  } finally {
    Math.random = saved;
  }
  engine.threeEls.set(key, el);
  return el;
}

// Where a point of the 3D scene lands in the frame, for an element whose box
// has its center at (x, y) and the size w x h, in scene pixels.
export function projectPoint(el, v, x, y, w, h) {
  const p = Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v.x, v.y, v.z);
  el.camera.updateMatrixWorld();
  p.project(el.camera);
  return { x: x + (p.x * w) / 2, y: y - (p.y * h) / 2, behind: p.z > 1 };
}

// The element's picture at `pw` x `ph` pixels for video frame `frame`. One
// frame's motion blur samples share it, so 3D is drawn once per frame.
export function threePicture(el, pw, ph, frame, fail) {
  const tag = `${frame}|${pw}x${ph}`;
  if (el.rendered === tag && el.bitmap) return el.bitmap;
  const r = getRenderer(fail);
  r.setSize(pw, ph, false);
  r.setClearColor(0x000000, 0);
  r.clear();
  r.render(el.scene, el.camera);
  if (r.getContext().isContextLost()) throw fail('WebGL stopped working on this page while it drew a 3D scene. Run the command again. If it keeps happening, use fewer or simpler objects');
  el.bitmap ??= document.createElement('canvas');
  if (el.bitmap.width !== pw || el.bitmap.height !== ph) Object.assign(el.bitmap, { width: pw, height: ph });
  const g = el.bitmap.getContext('2d');
  g.clearRect(0, 0, pw, ph);
  g.drawImage(r.domElement, 0, 0);
  el.rendered = tag;
  return el.bitmap;
}

export function threeLib() {
  return THREE;
}
