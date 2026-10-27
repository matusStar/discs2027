/* hero3d.js: engine for the 3D hero. Settings: hero-config.js. Models: hero-models.js. Star: hero-star.js.
   Created once, outside .initial-content, so it keeps running while swap.js changes pages. */
import * as T from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { HERO as cfg } from './hero-config.js';
import { MODELS } from './hero-models.js';
import { createStar } from './hero-star.js';

let current = null;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function studioEnv(renderer) {                       // a few bright panels, so shiny models have something to reflect
  const s = new T.Scene(), pm = new T.PMREMGenerator(renderer);
  s.add(new T.Mesh(new T.BoxGeometry(60, 60, 60), new T.MeshBasicMaterial({ color: 0x03050c, side: T.BackSide })));
  const panel = (w, h, col, x, y, z) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color().setRGB(...col), side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
  panel(30, 12, [7, 6, 4.5], 0, 24, 6);            // warm overhead
  panel(6, 26, [2, 3.5, 7], -22, 4, 8);            // cool left strip
  panel(3, 20, [6, 6, 6], 22, 6, -4);              // white right strip
  panel(20, 4, [3, 2.4, 2], 0, -10, 18);           // faint warm bounce
  const rt = pm.fromScene(s, 0.02); pm.dispose(); return rt.texture;
}

function start(host) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer; try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return null; }
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
  const label = document.createElement('div'); label.className = 'hero3d__label'; host.appendChild(label);

  const scene = new T.Scene(), uScale = { value: 500 };
  scene.environment = studioEnv(renderer);
  const cam = new T.PerspectiveCamera(38, 1, 0.1, 100); cam.position.set(0, 1.5, cfg.cameraZ); cam.lookAt(0, 0, 0);
  const tilt = new T.Group(); tilt.rotation.x = cfg.tilt; scene.add(tilt);

  scene.add(new T.AmbientLight(0x8090c0, 0.35));
  const key = new T.DirectionalLight(0xfff0dd, 1.1); key.position.set(3, 6, 5); scene.add(key);
  scene.add(new T.PointLight(0xffd9a0, cfg.starLight, 0, 2));        // the star lights planets

  const star = createStar(T, cfg, uScale); scene.add(star.object);

  const ctx = { T, cfg, uScale, R: 4.6, inner: cfg.inner, cam }, cache = {};
  const keys = cfg.models.filter(k => MODELS[k]);
  const get = k => cache[k] || (cache[k] = MODELS[k](ctx));
  let idx = 0, active = get(keys[0]); tilt.add(active.group); label.textContent = active.name; star.object.visible = !active.hideStar;
  let phase = 'hold', pt = 0, nextIdx = 0, scaleK = 1;

  function swapTo(i) {
    tilt.remove(active.group); idx = i; active = get(keys[i]); active.group.scale.setScalar(1); tilt.add(active.group); label.textContent = active.name; star.object.visible = !active.hideStar;
  }
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    uScale.value = h * dpr / (2 * Math.tan(cam.fov * Math.PI / 360));
    cam.position.z = w / h < 1.3 ? cfg.cameraZ + (1.3 - w / h) * 6 : cfg.cameraZ;
    if (reduced) renderer.render(scene, cam);
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let visible = true; const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }); io.observe(host);

  let raf = 0, last = performance.now(), time = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const L = window.SKY_LENS = window.SKY_LENS || {};
    if (!visible || document.hidden) { L.on = false; last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.1); last = now; time += dt;
    star.update(time, dt); active.update(time, dt);
    if (keys.length > 1) {
      pt += dt;
      if (phase === 'hold' && pt > cfg.hold) { phase = 'out'; pt = 0; nextIdx = (idx + 1) % keys.length; label.classList.add('is-fading'); }
      else if (phase === 'out') { scaleK = 1 - ease(Math.min(pt / (cfg.transition / 2), 1)); if (pt >= cfg.transition / 2) { swapTo(nextIdx); phase = 'in'; pt = 0; label.classList.remove('is-fading'); } }
      else if (phase === 'in') { scaleK = ease(Math.min(pt / (cfg.transition / 2), 1)); if (pt >= cfg.transition / 2) { phase = 'hold'; pt = 0; scaleK = 1; } }
      active.group.scale.setScalar(Math.max(scaleK, 0.001));
      active.group.rotation.y = (1 - scaleK) * 1.5;
    }
    if (active.lens) {                                                    // tell sky.js where to bend the background stars
      const rc = host.getBoundingClientRect(), pxu = host.clientHeight / (2 * Math.tan(cam.fov * Math.PI / 360)) / cam.position.length();
      L.x = rc.left + rc.width / 2; L.y = rc.top + rc.height / 2; L.r = active.lens * scaleK * pxu; L.on = L.r > 2;
    } else L.on = false;
    renderer.render(scene, cam);
  }
  if (reduced) { star.update(1, 0); active.update(1, 0); renderer.render(scene, cam); } else raf = requestAnimationFrame(frame);

  host.__hero = { show(i) { phase = 'hold'; pt = 0; scaleK = 1; swapTo(i % keys.length); }, star };   // handy for testing in the console
  return () => {
    if (window.SKY_LENS) window.SKY_LENS.on = false;
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    scene.traverse(o => { o.geometry && o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { for (const k in x) x[k] && x[k].isTexture && x[k].dispose(); x.dispose(); }); });
    scene.environment && scene.environment.dispose(); renderer.dispose();
  };
}

function init() {
  if (current) return;
  const ic = document.querySelector('.initial-content'); if (!ic) return;
  const host = document.createElement('div'); host.id = 'hero3d';
  ic.parentNode.insertBefore(host, ic);
  current = start(host); if (!current) host.remove();
}
init();
