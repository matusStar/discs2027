/* hero3d.js: a glowing star with a "disc" around it that slowly morphs between different disky things.
   Place <div id="hero3d"></div> in a page; this script fills it. Needs WebGL, else the div stays empty.
   Edit SHAPES / HOLD / MORPH below to change what appears and how fast. */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const N = 45000;         // particles that make up every disc
const HOLD = 5.5;        // seconds each shape stays
const MORPH = 2.4;       // seconds the transition takes
const TAU = Math.PI * 2;

/* ---------- seeded random + helpers ---------- */
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = rng => (rng() + rng() + rng() + rng() - 2) * 1.2;
const _c = new THREE.Color();
const hsl = (h, s, l) => { _c.setHSL(((h % 1) + 1) % 1, s, l); return [_c.r, _c.g, _c.b]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ringR = (r0, r1, u) => Math.sqrt(r0 * r0 + u * (r1 * r1 - r0 * r0));   // uniform over area

/* ---------- the shapes: each returns {p:[x,y,z], c:[r,g,b]} for one particle ---------- */
const SHAPES = [
  { name: 'Protoplanetary disc', kep: 1, f(rng) {
      let r, a;
      do { r = 1.5 * Math.pow(5.2 / 1.5, rng()); } while (Math.abs(r - 3.3) < 0.25 && rng() < 0.9);   // a gap
      do { a = rng() * TAU; } while (rng() > 0.6 + 0.4 * Math.cos(2 * (a - 1.3 * Math.log(r) * 2)));  // faint spirals
      const t = (r - 1.5) / 3.7, k = 0.45 + rng() * 0.55;
      const c = lerp3([1, 0.78, 0.4], [0.7, 0.2, 0.12], t).map(v => v * k);
      return { p: [r * Math.cos(a), gauss(rng) * 0.05 * Math.pow(r, 1.25), r * Math.sin(a)], c };
  } },
  { name: 'DVD', kep: 0, f(rng) {
      const r = ringR(0.5, 5, rng()), a = rng() * TAU, y = (rng() < 0.5 ? 1 : -1) * 0.012;
      let c;
      if (r < 1.3) c = [0.5, 0.55, 0.62];                                    // clear plastic hub
      else if (r > 4.9) c = [0.85, 0.88, 0.92];                              // silver rim
      else c = hsl(a / TAU * 3 + r * 0.3, 0.9, 0.5 + 0.12 * Math.sin(a * 2 + 1));   // rainbow diffraction
      return { p: [r * Math.cos(a), y, r * Math.sin(a)], c };
  } },
  { name: 'Vinyl record', kep: 0, f(rng) {
      const a = rng() * TAU, y = (rng() < 0.5 ? 1 : -1) * 0.015;
      let r, c;
      const u = rng();
      if (u < 0.14) { r = ringR(0.18, 1.5, rng()); c = [1, 0.42, 0.12]; }                     // paper label
      else if (u > 0.985) { r = 4.85 + rng() * 0.15; c = [0.6, 0.62, 0.68]; }                // rim
      else {                                                                                  // grooves
        r = 1.75 + Math.floor(rng() * 70) * (3.05 / 70) + rng() * 0.01;
        const s = Math.pow(Math.abs(Math.cos(a * 2 - 0.8)), 8) * 0.55;
        c = [0.1 + s, 0.12 + s, 0.2 + s];
      }
      return { p: [r * Math.cos(a), y, r * Math.sin(a)], c };
  } },
  { name: "Saturn's rings", kep: 1, f(rng) {
      let r;
      do { r = 1.4 + rng() * 3.6; } while ((Math.abs(r - 2.65) < 0.07) || (Math.abs(r - 3.95) < 0.05) || rng() > 0.55 + 0.45 * Math.sin(r * 11));
      const a = rng() * TAU, k = 0.5 + 0.5 * rng();
      return { p: [r * Math.cos(a), gauss(rng) * 0.008, r * Math.sin(a)], c: [0.9 * k, 0.78 * k, 0.55 * k] };
  } },
  { name: 'Spiral galaxy', kep: 1, f(rng) {
      if (rng() < 0.16) {                                                    // bulge
        const x = gauss(rng) * 0.4, y = gauss(rng) * 0.25, z = gauss(rng) * 0.4;
        return { p: [x, y, z], c: [1, 0.85, 0.55].map(v => v * (0.6 + rng() * 0.4)) };
      }
      const r = 0.3 + 4.9 * Math.pow(rng(), 0.7), arm = rng() < 0.5 ? 0 : Math.PI;
      const a = arm + r * 0.85 + gauss(rng) * (0.25 + 0.04 * r);
      const t = r / 5.2;
      let c = lerp3([1, 0.82, 0.5], [0.45, 0.62, 1], t).map(v => v * (0.5 + rng() * 0.5));
      if (rng() < 0.05) c = [1, 0.35, 0.6];                                  // star-forming knots
      return { p: [r * Math.cos(a), gauss(rng) * 0.09 * (1.2 - t), r * Math.sin(a)], c };
  } },
];

function build(shape, seed) {
  const rng = rngFrom(seed), P = new Float32Array(N * 3), C = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const { p, c } = shape.f(rng);
    P.set(p, i * 3); C.set(c, i * 3);
  }
  return { P, C };
}

/* ---------- shaders ---------- */
const DISC_VS = `
attribute vec3 aTo; attribute vec3 cTo; attribute vec3 cFrom; attribute float aR;
uniform float uMix, uTime, uKepFrom, uKepTo, uScale;
varying vec3 vC;
void main(){
  float t = smoothstep(0., 1., clamp(uMix*1.5 - aR*.5, 0., 1.));
  vec3 p = mix(position, aTo, t);
  p += (vec3(aR, fract(aR*7.3), fract(aR*13.1)) - .5) * sin(t*3.14159) * 1.4;
  float kep = mix(uKepFrom, uKepTo, t);
  float r = length(p.xz);
  float w = mix(.18, 1.4/(.6 + pow(r, 1.5)), kep);
  float a = uTime * w, s = sin(a), c = cos(a);
  p = vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
  vC = mix(cFrom, cTo, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_PointSize = 0.04 * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DISC_FS = `
varying vec3 vC;
void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .15, d); if (a < .01) discard; gl_FragColor = vec4(vC, a*.9); }`;

const STAR_VS = `varying vec3 vN, vP; void main(){ vN = normalMatrix*normal; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const STAR_FS = `
uniform float uTime; varying vec3 vN, vP;
float h(vec3 p){ p = fract(p*.3183099 + .1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x), mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x), mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x), f.y), f.z); }
void main(){
  vec3 p = normalize(vP)*4.;
  float g = n(p*1.6 + uTime*.12)*.55 + n(p*4. - uTime*.18)*.3 + n(p*10.)*.15;   // granulation
  float mu = clamp(normalize(vN).z, 0., 1.);
  float limb = .3 + .7*pow(mu, .55);                                            // limb darkening
  vec3 col = mix(vec3(1.,.5,.15), vec3(1.,.95,.8), smoothstep(.25,.8,g)) * limb * 1.5;
  gl_FragColor = vec4(col, 1.);
}`;

/* ---------- scene ---------- */
let current = null;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(.12, 'rgba(255,190,110,.55)');
  gr.addColorStop(.35, 'rgba(255,120,50,.14)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function start(host) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return null; }
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
  const label = document.createElement('div'); label.className = 'hero3d__label'; host.appendChild(label);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100); cam.position.set(0, 1.5, 13); cam.lookAt(0, 0, 0);
  const tilt = new THREE.Group(); tilt.rotation.x = 0.32; scene.add(tilt);

  // star
  const star = new THREE.Mesh(new THREE.SphereGeometry(0.55, 64, 48),
    new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: { uTime: { value: 0 } } }));
  scene.add(star);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
  glow.scale.set(4.6, 4.6, 1); scene.add(glow);

  // disc particles
  let idx = 0;
  let from = build(SHAPES[0], 11), to = build(SHAPES[1], 22);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(from.P, 3));
  geo.setAttribute("cFrom", new THREE.BufferAttribute(from.C, 3));
  geo.setAttribute('aTo', new THREE.BufferAttribute(to.P, 3));
  geo.setAttribute('cTo', new THREE.BufferAttribute(to.C, 3));
  const rnd = new Float32Array(N), rr = rngFrom(5); for (let i = 0; i < N; i++) rnd[i] = rr();
  geo.setAttribute('aR', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: DISC_VS, fragmentShader: DISC_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uMix: { value: 0 }, uTime: { value: 0 }, uKepFrom: { value: SHAPES[0].kep }, uKepTo: { value: SHAPES[1].kep }, uScale: { value: 500 } },
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; tilt.add(pts);
  label.textContent = SHAPES[0].name;

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    mat.uniforms.uScale.value = h * dpr / (2 * Math.tan(cam.fov * Math.PI / 360));
    cam.position.z = w / h < 1.3 ? 13 + (1.3 - w / h) * 6 : 13;      // pull back on narrow screens
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let mx = 0, my = 0, tx = 0, ty = 0;
  const onMove = e => { const r = host.getBoundingClientRect(); mx = ((e.clientX - r.left) / r.width - .5); my = ((e.clientY - r.top) / r.height - .5); };

  let visible = true;
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }); io.observe(host);

  let raf = 0, t0 = performance.now(), last = t0, time = 0, phase = 'hold', phaseT = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.1); last = now; time += dt;
    mat.uniforms.uTime.value = time; star.material.uniforms.uTime.value = time;
    if (!reduced) {
      phaseT += dt;
      if (phase === 'hold' && phaseT > HOLD) {
        phase = 'morph'; phaseT = 0; label.classList.add('is-fading');
      } else if (phase === 'morph') {
        mat.uniforms.uMix.value = Math.min(phaseT / MORPH, 1);
        if (phaseT >= MORPH) {                                              // arrived: make "to" the new "from", prepare next
          idx = (idx + 1) % SHAPES.length;
          geo.attributes.position.array.set(to.P); geo.attributes.cFrom.array.set(to.C);
          geo.attributes.position.needsUpdate = geo.attributes.cFrom.needsUpdate = true;
          const next = (idx + 1) % SHAPES.length;
          from = to; to = build(SHAPES[next], 100 + next + idx * 7);
          geo.attributes.aTo.array.set(to.P); geo.attributes.cTo.array.set(to.C);
          geo.attributes.aTo.needsUpdate = geo.attributes.cTo.needsUpdate = true;
          mat.uniforms.uKepFrom.value = SHAPES[idx].kep; mat.uniforms.uKepTo.value = SHAPES[next].kep; mat.uniforms.uMix.value = 0;
          label.textContent = SHAPES[idx].name; label.classList.remove('is-fading');
          phase = 'hold'; phaseT = 0;
        }
      }
    }
    tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05;                          // gentle mouse parallax
    // fixed pose: the disc no longer follows the mouse
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  return () => {                                                             // cleanup when the page is swapped away
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); host.removeEventListener('pointermove', onMove);
    geo.dispose(); mat.dispose(); star.geometry.dispose(); star.material.dispose(); renderer.dispose();
  };
}

/* The hero lives OUTSIDE .initial-content, so swap.js never replaces it: it is created once and keeps running on every page. */
function init() {
  if (current) return;
  const ic = document.querySelector('.initial-content');
  if (!ic) return;
  const host = document.createElement('div');
  host.id = 'hero3d';
  ic.parentNode.insertBefore(host, ic);
  current = start(host);
  if (!current) host.remove();
}
init();
