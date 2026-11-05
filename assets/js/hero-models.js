/* hero-models.js: the things that orbit the star. Each model is a function  (ctx) => ({ name, group, update(t, dt) }).
   ctx = { T (three.js), cfg (hero-config), uScale (shared uniform), R (outer radius ~4.6), inner (hole radius, from cfg.inner), cam }.
   A model may also return hideStar: true (no central star) and lens: <Einstein radius in world units> (lenses the sky stars).
   To add a model: write a function, add it to MODELS at the bottom, then put its key in `models` in hero-config.js.
   Models can be points, meshes or anything three.js can draw; the star sits at (0,0,0) and the hole in a disc should be >= 0.6. */

const TAU = Math.PI * 2;
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = rng => (rng() + rng() + rng() + rng() - 2) * 1.2;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------- helpers ---------- */
function pointCloud(ctx, fn, kep, seed, count) {            // fn(rng) -> {p:[x,y,z], c:[r,g,b]}
  const { T, cfg } = ctx, N = count || cfg.particles, rng = rngFrom(seed), P = new Float32Array(N * 3), C = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const o = fn(rng); P.set(o.p, i * 3); C.set(o.c, i * 3); }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(P, 3)); geo.setAttribute('aCol', new T.BufferAttribute(C, 3));
  const mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: ctx.uScale, uKep: { value: kep }, uSize: { value: cfg.pointSize } },
    vertexShader: `attribute vec3 aCol; uniform float uTime, uScale, uKep, uSize; varying vec3 vC;
void main(){
  float r = length(position.xz), w = mix(.18, 1.4/(.6 + pow(r, 1.5)), uKep), a = uTime*w, s = sin(a), c = cos(a);
  vec3 p = vec3(position.x*c - position.z*s, position.y, position.x*s + position.z*c);
  vC = aCol; vec4 mv = modelViewMatrix*vec4(p, 1.); gl_PointSize = uSize*uScale/-mv.z; gl_Position = projectionMatrix*mv;
}`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .15, d); if (a < .01) discard; gl_FragColor = vec4(vC, a*.9); }` });
  const pts = new T.Points(geo, mat); pts.frustumCulled = false;
  return { pts, update: t => { mat.uniforms.uTime.value = t; } };
}

function haze(ctx, radius, rgb, k = 1) {              // soft glow plane lying in the disc plane
  const { T, cfg } = ctx; if (cfg.haze <= 0) return null;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128), col = rgb.map(v => Math.round(v * 255)).join(',');
  gr.addColorStop(0, `rgba(${col},.0)`); gr.addColorStop(.22, `rgba(${col},.45)`); gr.addColorStop(.6, `rgba(${col},.22)`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const m = new T.Mesh(new T.PlaneGeometry(radius * 2, radius * 2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true,
    opacity: cfg.haze * k, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = -0.03; m.renderOrder = -1; return m;
}

function canvasTex(ctx, w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new ctx.T.CanvasTexture(c); if (srgb) t.colorSpace = ctx.T.SRGBColorSpace; t.anisotropy = 4; return t;
}
function planetMaterial(ctx, bands, seed) {           // banded gas-giant surface
  const rng = rngFrom(seed);
  const tex = canvasTex(ctx, 256, 256, (g, w, h) => {
    let y = 0; while (y < h) { const bh = 6 + rng() * 22, k = rng(); g.fillStyle = bands[Math.floor(k * bands.length)]; g.fillRect(0, y, w, bh); y += bh; }
    g.globalAlpha = .15; for (let i = 0; i < 400; i++) { g.fillStyle = rng() < .5 ? '#fff' : '#000'; g.fillRect(rng() * w, rng() * h, 18 + rng() * 40, 1 + rng() * 2); }
  });
  return new ctx.T.MeshStandardMaterial({ map: tex, roughness: .85, metalness: 0, envMapIntensity: .15 });
}
function glowSprite(ctx, rgb, size) {
  const { T } = ctx, col = rgb.map(v => Math.round(v * 255)).join(',');
  const tex = canvasTex(ctx, 128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, `rgba(${col},.8)`); gr.addColorStop(.3, `rgba(${col},.2)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, blending: T.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.set(size, size, 1); return s;
}
const flat = (T, geo) => { geo.rotateX(-Math.PI / 2); return geo; };              // ring faces +Y

/* ---------- 1. debris disc with a planet in the gap (points) ---------- */
function debris(ctx) {
  const { T, cfg } = ctx, g = new T.Group(), r0 = ctx.inner + 0.8;
  const cloud = pointCloud(ctx, rng => {
    let r, a;
    do { r = r0 * Math.pow(5.2 / r0, rng()); } while (Math.abs(r - 3.3) < 0.28 && rng() < 0.97);   // the gap
    do { a = rng() * TAU; } while (rng() > 0.6 + 0.4 * Math.cos(2 * (a - 2.6 * Math.log(r))));
    const t = (r - r0) / (5.2 - r0), k = 0.45 + rng() * 0.55;
    return { p: [r * Math.cos(a), gauss(rng) * 0.05 * Math.pow(r, 1.25), r * Math.sin(a)], c: lerp3([1, .78, .4], [.7, .2, .12], t).map(v => v * k) };
  }, 1, 11);
  g.add(cloud.pts); const h = haze(ctx, 6.4, [1, .55, .25], 1); if (h) g.add(h);
  let planet = null, orbit = 0;
  if (cfg.planet) {
    planet = new T.Group();
    const m = new T.Mesh(new T.SphereGeometry(0.17, 32, 24), planetMaterial(ctx, ['#2a4a8a', '#4f78b8', '#8fb2dc', '#1d3466'], 3));
    planet.add(m, glowSprite(ctx, [.55, .75, 1], 1.1)); g.add(planet); planet.userData.m = m;
    orbit = 1.4 / (0.6 + Math.pow(3.3, 1.5));            // same angular speed as the gap in the particle shader
  }
  return { name: 'Debris disc with a planet', group: g, update(t) {
    cloud.update(t);
    if (planet) { planet.position.set(3.3 * Math.cos(t * orbit), 0, 3.3 * Math.sin(t * orbit)); planet.userData.m.rotation.y = t * 1.2; }
  } };
}

/* ---------- 2. DVD (real geometry, diffraction-rainbow data side) ---------- */
function dvd(ctx) {
  const { T, R } = ctx, g = new T.Group(), th = 0.045, hole = ctx.inner, hubR = hole + 0.8, dataR = hole + 1.05;
  const prof = [[hole, -th], [R, -th], [R, th], [hole, th], [hole, -th]].map(p => new T.Vector2(p[0], p[1]));
  const body = new T.Mesh(new T.LatheGeometry(prof, 160), new T.MeshStandardMaterial({ color: 0xcfd3dc, metalness: 1, roughness: .2, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity }));
  const data = new T.Mesh(flat(T, new T.RingGeometry(dataR, R - 0.12, 200, 1)), new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xz; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; varying vec2 vL; uniform float uTime;
vec3 spec(float x){ return .5 + .5*cos(6.2831*(x + vec3(0., .33, .67))); }
float wrap(float d){ return d - 6.2831*floor((d + 3.1416)/6.2831); }
void main(){
  float r = length(vL), a = atan(vL.y, vL.x);
  vec3 V = normalize(cameraPosition - vW);
  float th = .9 + V.x*1.4 + V.z*.6;                         // where the two light fans point: they sweep as the disc sways
  float d1 = wrap(a - th), d2 = wrap(a - th - 3.1416);
  float dd = abs(d1) < abs(d2) ? d1 : d2;                   // angle to the nearest fan axis
  float side = .5 + .5*cos(2.*(a - th));                    // 1 on the fan axes, 0 at 90 degrees
  vec3 col = mix(vec3(.16, .08, .10), vec3(.14, .18, .55), smoothstep(.1, .9, side));   // deep blue-violet, browner away from the fans
  col += spec(.55 + dd*1.25)*exp(-pow(dd/.42, 2.))*.95;     // radial rainbow fan: cyan, green, yellow, pink
  col += vec3(.25, .3, 1.)*exp(-pow((abs(dd) - 1.)/.07, 2.))*.7;   // thin bright blue streaks
  col *= (.8 + .2*smoothstep(1.7, 4.4, r))*(.93 + .07*sin(r*260.));
  gl_FragColor = vec4(col, 1.);
}` }));
  data.position.y = th + 0.002;
  const hub = new T.Mesh(flat(T, new T.RingGeometry(hole, hubR, 96, 1)), new T.MeshPhysicalMaterial({ color: 0xb4c0d2, roughness: .08, metalness: 0, transparent: true, opacity: .55, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity }));
  hub.position.y = th + 0.002;
  const ring = new T.Mesh(flat(T, new T.RingGeometry(hubR, dataR, 96, 1)), new T.MeshStandardMaterial({ color: 0xe6e9ef, metalness: 1, roughness: .15, envMapIntensity: ctx.cfg.envIntensity }));
  ring.position.y = th + 0.002;
  g.add(body, data, hub, ring);
  const outer = new T.Group(); outer.add(g); const h = haze(ctx, 6, [.6, .75, 1], .8); if (h) outer.add(h);
  return { name: 'DVD', group: outer, update(t) { data.material.uniforms.uTime.value = t; g.rotation.x = 0.12 * Math.sin(t * 0.4); g.rotation.z = 0.1 * Math.sin(t * 0.31 + 1); } };
}

/* ---------- 3. Vinyl record (grooves, clear-coat, printed label, light streak) ---------- */
function vinyl(ctx) {
  const { T, R } = ctx, outer = new T.Group(), spin = new T.Group(), th = 0.04, hole = ctx.inner, lab = hole + 0.8, top = R - 0.08;
  const body = new T.Mesh(new T.LatheGeometry([[hole, -th], [R, -th], [R, th], [hole, th], [hole, -th]].map(p => new T.Vector2(p[0], p[1])), 160),
    new T.MeshStandardMaterial({ color: 0x050507, roughness: .5, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity }));
  const bump = canvasTex(ctx, 1024, 1024, (g, w, h) => {
    g.fillStyle = '#777'; g.fillRect(0, 0, w, h); const c = w / 2;
    for (let r = lab / top * c; r < c; r += 2) { g.strokeStyle = (Math.floor(r) % 4 < 2) ? '#bbb' : '#555'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
    [.36, .5, .63, .77, .9].forEach(k => { g.strokeStyle = '#444'; g.lineWidth = 7; g.beginPath(); g.arc(c, c, (lab / top + k * (1 - lab / top)) * c, 0, TAU); g.stroke(); });   // gaps between tracks
  }, false);
  const grooves = new T.Mesh(flat(T, new T.RingGeometry(lab, top, 200, 1)), new T.MeshPhysicalMaterial({ color: 0x0a0a10, roughness: .38, clearcoat: 1, clearcoatRoughness: .22, bumpMap: bump, bumpScale: 1.2, envMapIntensity: ctx.cfg.envIntensity }));
  grooves.position.y = th + 0.002;
  const labelTex = canvasTex(ctx, 512, 512, (g) => {
    g.fillStyle = '#ff7a1f'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#2a1005'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = 'UK & IRELAND DISCS 2027 · ', rad = 200;
    for (let i = 0; i < txt.length; i++) { const a = i / txt.length * TAU - Math.PI / 2; g.save(); g.translate(256 + rad * Math.cos(a), 256 + rad * Math.sin(a)); g.rotate(a + Math.PI / 2); g.fillText(txt[i], 0, 0); g.restore(); }
  });
  const label = new T.Mesh(flat(T, new T.RingGeometry(hole, lab, 96, 1)), new T.MeshStandardMaterial({ map: labelTex, roughness: .7, envMapIntensity: .3 }));
  label.position.y = th + 0.003;
  spin.add(body, grooves, label);
  const streak = new T.Mesh(flat(T, new T.RingGeometry(lab, top, 200, 1)), new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xz; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; varying vec2 vL;
void main(){ float r = length(vL), a = atan(vW.z, vW.x);
  float s = pow(abs(cos(2.*a - .9)), 18.)*.55 + pow(abs(cos(2.*a + 1.9)), 30.)*.25;
  float e = smoothstep(${lab.toFixed(2)}, ${(lab + .6).toFixed(2)}, r)*smoothstep(${top.toFixed(2)}, ${(top - .5).toFixed(2)}, r);
  gl_FragColor = vec4(vec3(.65, .78, 1.)*s*e*.7, 1.); }` }));
  streak.position.y = th + 0.006;
  outer.add(spin, streak); const h = haze(ctx, 6, [.7, .5, 1], .7); if (h) outer.add(h);
  return { name: 'Vinyl record', group: outer, update(t, dt) { spin.rotation.y += dt * 0.9; } };
}

/* ---------- 4. Planetary system: 8 planets, irregular spacing, small inclinations, rings and moons ---------- */
function system(ctx) {
  const { T } = ctx, g = new T.Group(), rng = rngFrom(2027), r0 = ctx.inner + 0.1;
  const SPEC = [   // size, surface colours, rings?, moons
    { s: .09, c: ['#8a8a8a', '#a09a92', '#6d6860'], rings: 0, moons: 0 },
    { s: .13, c: ['#e6d8b0', '#d8c28a', '#f2e8c8'], rings: 0, moons: 0 },
    { s: .14, c: ['#2f5f9a', '#4c8a5a', '#d8e4ee', '#3b7a52'], rings: 0, moons: 1 },
    { s: .10, c: ['#a8553a', '#c9774f', '#8a4630'], rings: 0, moons: 2 },
    { s: .27, c: ['#d8b77a', '#c9a064', '#e8d3a0', '#b48a50'], rings: 0, moons: 3 },
    { s: .23, c: ['#e0c890', '#cfae72', '#efe0b8'], rings: 1, moons: 1 },
    { s: .19, c: ['#6fa3d8', '#9cc6ea', '#5a8cc0'], rings: 1, moons: 1 },
    { s: .12, c: ['#5b6a8a', '#7a88a8', '#454f6b'], rings: 0, moons: 0 },
  ];
  const GAP = [0, .5, .5, .5, 1.25, .58, .58, .58];                                // orbit spacing: wide room before planet 5 for the asteroid belt
  const rads = []; { let a = r0; GAP.forEach(x => { a += x; rads.push(a); }); }
  let acc = 0;
  const ringTex = canvasTex(ctx, 256, 4, (c, w, h) => {
    for (let x = 0; x < w; x++) { const u = x / w; let a = .5 + .4 * Math.sin(u * 37) * Math.sin(u * 11 + 1); if (u > .6 && u < .66) a = .05; c.fillStyle = `rgba(226,205,160,${Math.max(0, Math.min(1, a))})`; c.fillRect(x, 0, 1, h); }
  });
  const bodies = SPEC.map((sp0, i) => {
    const sp = { ...sp0, s: sp0.s * 0.8 };                                       // planet size (lower = smaller planets)
    const rad = rads[i];
    const plane = new T.Group(); plane.rotation.set((rng() - .5) * .16, 0, (rng() - .5) * .16);          // small offset from the ecliptic
    const spinner = new T.Group(), holder = new T.Group(); holder.position.x = rad; holder.rotation.z = (rng() - .5) * 1.0;   // axial tilt
    const body = new T.Mesh(new T.SphereGeometry(sp.s, 32, 24), planetMaterial(ctx, sp.c, 30 + i));
    holder.add(body);
    if (sp.rings) {                                         // rings lie in the planet's equator, so they follow its tilt
      const rg = flat(T, new T.RingGeometry(sp.s * 1.35, sp.s * 2.3, 96, 1)), pos = rg.attributes.position, uv = rg.attributes.uv;
      for (let k = 0; k < pos.count; k++) uv.setXY(k, (Math.hypot(pos.getX(k), pos.getZ(k)) - sp.s * 1.35) / (sp.s * .95), .5);
      holder.add(new T.Mesh(rg, new T.MeshBasicMaterial({ map: ringTex, transparent: true, side: T.DoubleSide, depthWrite: false })));
    }
    const moons = [];
    for (let m = 0; m < sp.moons; m++) {
      const mr = sp.s * (2.2 + m * 0.9) + (sp.rings ? sp.s * 1.0 : 0), pivot = new T.Group();
      const moon = new T.Mesh(new T.SphereGeometry(0.025 + rng() * 0.02, 16, 12), new T.MeshStandardMaterial({ color: 0xb8b4ae, roughness: .9, envMapIntensity: .1 }));
      moon.position.x = mr; pivot.add(moon); pivot.rotation.x = (rng() - .5) * .5; pivot.rotation.y = rng() * 6.28; holder.add(pivot);
      moons.push({ pivot, w: 1.8 / Math.pow(m + 1, 0.8) * (rng() < .5 ? 1 : -1) });
    }
    spinner.add(holder); plane.add(spinner);
    plane.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new T.Vector3(rad * Math.cos(k / 128 * TAU), 0, rad * Math.sin(k / 128 * TAU)))),
      new T.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: .09 })));
    g.add(plane);
    return { spinner, body, moons, w: 0.85 / Math.pow(rad, 1.5), a0: rng() * TAU, spin: 0.5 + rng() };
  });
  const ab0 = rads[3] + 0.35, ab1 = rads[4] - 0.4;                                  // asteroid belt between planets 4 and 5
  const abDust = pointCloud(ctx, r2 => { const r = ab0 + r2() * (ab1 - ab0), a = r2() * TAU, k = .35 + r2() * .5; return { p: [r * Math.cos(a), gauss(r2) * .03, r * Math.sin(a)], c: [.95 * k, .8 * k, .6 * k] }; }, 1, 61, 6000);
  const abRocks = rockField(ctx, 90, (r2) => ({ r: ab0 + r2() * (ab1 - ab0), a0: r2() * TAU, y: gauss(r2) * .03, s: .018 + Math.pow(r2(), 3) * .05, tx: r2() * 2, ty: r2() * 2, c: greyRock(r2, true) }), 62);
  const kuiper = pointCloud(ctx, r2 => { const r = 6.0 + r2() * .55, a = r2() * TAU, k = .3 + r2() * .5; return { p: [r * Math.cos(a), gauss(r2) * .07, r * Math.sin(a)], c: [.6 * k, .78 * k, k] }; }, 1, 63, 7000);   // icy Kuiper belt
  g.add(abDust.pts, abRocks.mesh, kuiper.pts);
  g.scale.setScalar(0.85);                                                            // shrink the whole system so the outer belt stays inside the frame
  const root = new T.Group(); root.add(g);
  return { name: 'Planetary system', group: root, update(t) {
    abDust.update(t); abRocks.update(t); kuiper.update(t);
    bodies.forEach(b => { b.spinner.rotation.y = -(b.a0 + t * b.w); b.body.rotation.y = t * b.spin; b.moons.forEach(m => { m.pivot.rotation.y = t * m.w; }); });
  } };
}

/* ---------- 5. Black hole with an accretion disc (ray-traced Schwarzschild lensing) ----------
   At start-up, light rays are traced backwards from the camera through the curved space around the hole (units: G=M=c=1).
   The result (where each pixel hits the disc, and the Doppler boost there) is stored in two textures, so drawing is cheap.
   The model also tells the sky to lens the real background stars (see SKY_LENS in sky.js). */
function blackhole(ctx) {
  const { T, cfg } = ctx, S = cfg.bhRes || 512, Mw = 0.22, Wd = 6.2, Bmax = Wd / Mw, D = 50, RIN = 6, ROUT = 30, DP = 0.04;
  const el = cfg.tilt + Math.atan2(1.5, cfg.cameraZ), sE = Math.sin(el), cE = Math.cos(el);
  const A = new Float32Array(S * S * 4), B = new Float32Array(S * S * 4), cdp = Math.cos(DP), sdp = Math.sin(DP);
  function row(j) {
    for (let i = 0; i < S; i++) {
      const X = ((i + .5) / S * 2 - 1) * Bmax, Y = ((j + .5) / S * 2 - 1) * Bmax, b = Math.max(Math.hypot(X, Y), 1e-3);
      const e2x = X / b, e2y = Y * cE / b, e2z = -Y * sE / b;                      // image-plane direction in the hole's frame; e1 = (0, sE, cE)
      let u = 1 / D, up = Math.sqrt(Math.max(0, 1 / (b * b) - u * u * (1 - 2 * u))), ph = 0, c = 1, s = 0, n = 0;
      const o = (j * S + i) * 4;
      for (let k = 0; k < 400 && ph < 11.3; k++) {
        const um = u + 0.5 * DP * up, upm = up + 0.5 * DP * (-u + 3 * u * u);
        const u1 = u + DP * upm, up1 = up + DP * (-um + 3 * um * um);
        if (u1 > 0.5) break;                                                        // fell into the hole
        const c1 = c * cdp - s * sdp, s1 = s * cdp + c * sdp;
        const d0 = c * sE + s * e2y, d1 = c1 * sE + s1 * e2y;                       // height above the disc plane before / after
        if (d0 * d1 < 0 && n < 2) {
          const f = d0 / (d0 - d1), uh = u + f * (u1 - u), r = 1 / uh;
          if (r > RIN && r < ROUT) {
            const ch = c + f * (c1 - c), sh = s + f * (s1 - s), nn = Math.hypot(ch, sh);
            const cc = ch / nn, ss = sh / nn;
            const px = r * ss * e2x, pz = r * (cc * cE + ss * e2z), phi = Math.atan2(pz, px);
            const dr = -(up + f * (up1 - up)) / (uh * uh);                           // photon direction (traced ray points away from the observer)
            const dx = dr * ss * e2x + r * (cc * e2x), dy = dr * (cc * sE + ss * e2y) + r * (-ss * sE + cc * e2y), dz = dr * (cc * cE + ss * e2z) + r * (-ss * cE + cc * e2z);
            const dl = Math.hypot(dx, dy, dz), nx = -dx / dl, nz = -dz / dl;
            const vl = Math.sqrt(1 / (r - 2)), vx = -pz / r * vl, vz = px / r * vl;  // disc matter moves counter-clockwise
            const g = Math.sqrt(1 - 2 / r) * Math.sqrt(1 - vl * vl) / (1 - (vx * nx + vz * nz));
            const arr = n === 0 ? A : B; arr[o] = r; arr[o + 1] = Math.cos(phi); arr[o + 2] = Math.sin(phi); arr[o + 3] = g; n++;
          }
        }
        u = u1; up = up1; c = c1; s = s1; ph += DP;
        if (up < 0 && u < 1 / (ROUT * 1.2)) break;                                  // escaped to infinity
      }
    }
  }
  const mk = d => { const t = new T.DataTexture(d, S, S, T.RGBAFormat, T.FloatType); t.minFilter = t.magFilter = T.NearestFilter; return t; };
  const tA = mk(A), tB = mk(B);
  const mat = new T.ShaderMaterial({ transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, side: T.DoubleSide,
    uniforms: { tA: { value: tA }, tB: { value: tB }, uTime: { value: 0 }, uBright: { value: cfg.bhBright || 1.6 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tA, tB; uniform float uTime, uBright; varying vec2 vUv;
const float RIN = ${RIN.toFixed(1)}, BMAX = ${Bmax.toFixed(3)}, ROUT = ${ROUT.toFixed(1)}, TS = ${S.toFixed(1)};
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
vec3 ramp(float t){
  vec3 c = mix(vec3(.45,.07,.02), vec3(1.,.42,.1), smoothstep(0., .5, t));
  c = mix(c, vec3(1.,.82,.55), smoothstep(.4, 1., t));
  return mix(c, vec3(.8,.9,1.), smoothstep(.95, 1.7, t));
}
vec3 disc(vec4 q){
  if (q.x < 1.) return vec3(0.);
  float r = q.x, g = q.w, x = RIN / r;
  float ang = atan(q.z, q.y) - uTime*6./pow(r, 1.5);                              // matter orbits faster on the inside
  vec2 pc = vec2(cos(ang), sin(ang)); float lr = log(r);                           // noise on (cos, sin) so it has no seam at +-180 degrees
  float turb = .55 + .45*n2(pc*2.2 + vec2(lr*9., lr*5.)) + .25*(n2(pc*5.5 + vec2(lr*26., 3.)) - .5);
  float inten = uBright*8.*pow(x, 1.9)*(.3 + .7*(1. - sqrt(x))) * turb;
  float Tm = pow(x, .75)*g;
  float edge = smoothstep(ROUT, ROUT*.5, r + (turb - .5)*9.) * smoothstep(RIN, RIN*1.06, r);   // dusty, ragged outer edge; soft inner edge
  return ramp(Tm) * inten * edge * pow(clamp(g, .15, 2.2), 3.);                          // relativistic beaming: the approaching side is brighter
}
vec4 samp(sampler2D t, vec2 uv, out float cov){                                   // bilinear, but only between texels that hit the disc
  vec2 p = uv*TS - .5, i = floor(p), f = fract(p);
  vec4 s00 = texture2D(t, (i + .5)/TS), s10 = texture2D(t, (i + vec2(1.5, .5))/TS), s01 = texture2D(t, (i + vec2(.5, 1.5))/TS), s11 = texture2D(t, (i + 1.5)/TS);
  float w00 = (1.-f.x)*(1.-f.y)*step(1., s00.x), w10 = f.x*(1.-f.y)*step(1., s10.x), w01 = (1.-f.x)*f.y*step(1., s01.x), w11 = f.x*f.y*step(1., s11.x);
  cov = w00 + w10 + w01 + w11;
  return (s00*w00 + s10*w10 + s01*w01 + s11*w11)/max(cov, 1e-4);
}
void main(){
  float k1, k2; vec4 a = samp(tA, vUv, k1), b = samp(tB, vUv, k2);
  vec3 c1 = disc(a)*k1, c2 = disc(b)*k2;
  float a1 = clamp(max(c1.r, max(c1.g, c1.b))*1.4, 0., 1.);
  vec3 col = c1 + (1. - a1)*c2;
  float bb = length(vUv*2. - 1.)*BMAX;
  col += (1. - a1)*vec3(1., .75, .5)*.3*exp(-pow((bb - 5.45)/.22, 2.));                    // photon ring
  float shadow = 1. - smoothstep(5.14, 5.26, bb);                                  // rays that fall in: black, unless the disc is in front
  float al = clamp(max(col.r, max(col.g, col.b)), 0., 1.);
  al = max(al, shadow);
  col = min(col, vec3(al)) ;
  col = 1. - exp(-col*1.6);                                                        // soft highlight roll-off
  col = min(col, vec3(al));
  gl_FragColor = vec4(col, al);
}` });
  const mesh = new T.Mesh(new T.PlaneGeometry(Wd * 2, Wd * 2), mat); mesh.visible = false; mesh.frustumCulled = false;
  const g = new T.Group(); g.add(mesh);
  let r = 0, ready = false; const q = new T.Quaternion();
  return { name: 'Black hole', group: g, hideStar: true, lens: cfg.skyLens ? 7.7 * Mw : 0, update(t) {
    if (!ready) {
      const t0 = performance.now(); while (r < S && performance.now() - t0 < 7) row(r++);
      if (r >= S) { tA.needsUpdate = tB.needsUpdate = true; ready = true; mesh.visible = true; }
    }
    mesh.parent.getWorldQuaternion(q); mesh.quaternion.copy(q.invert()).multiply(ctx.cam.quaternion);   // always faces the camera
    mat.uniforms.uTime.value = t;
  } };
}

/* ================= more models ================= */
/* the engine sets rotation.y of a model's top group during transitions, so models that spin themselves spin an inner group */
const wrapGroup = (T, g) => { const o = new T.Group(); o.add(g); return o; };
const kw = r => 1.4 / (0.6 + Math.pow(r, 1.5));                     // same orbital speed as the particle shader
const cosTex = (ctx, w, h, fn) => canvasTex(ctx, w, h, fn);

function rockField(ctx, n, fn, seed) {                              // lots of real little rocks (one draw call)
  const { T } = ctx, rng = rngFrom(seed), geo = new T.IcosahedronGeometry(1, 1), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.35 * Math.abs(Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7) * 43758.5 % 1); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  geo.computeVertexNormals();
  const mesh = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: .95, flatShading: true, envMapIntensity: .2 }), n);
  const P = [], col = new T.Color();
  for (let i = 0; i < n; i++) { const o = fn(rng, i); P.push(o); mesh.setColorAt(i, col.setRGB(...o.c)); }
  const d = new T.Object3D();
  return { mesh, update(t) {
    for (let i = 0; i < n; i++) {
      const o = P[i], [r, a] = o.f ? o.f(t) : [o.r, o.a0 + t * kw(o.r)];
      d.position.set(r * Math.cos(a), o.y, r * Math.sin(a)); d.rotation.set(t * o.tx, t * o.ty, 0); d.scale.setScalar(o.s); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  } };
}
const greyRock = (rng, warm) => { const k = 0.45 + rng() * 0.4; return warm ? [k * 1.05, k * .92, k * .8] : [k * .8, k * .9, k * 1.1]; };

/* ---------- 6. Asteroid belts: a rocky main belt with a gap, and an icy outer belt ---------- */
function belt(ctx) {
  const { T } = ctx, g = new T.Group();
  const dust = pointCloud(ctx, rng => {
    const outer = rng() < .35; let r;
    do { r = outer ? 4.6 + rng() * .8 : 2.7 + rng() * 1.3; } while (Math.abs(r - 3.3) < .1 && rng() < .9);
    const a = rng() * TAU, k = .35 + rng() * .5;
    return { p: [r * Math.cos(a), gauss(rng) * .04, r * Math.sin(a)], c: outer ? [.55 * k, .7 * k, k] : [.95 * k, .8 * k, .6 * k] };
  }, 1, 5, 14000);
  const rocks = rockField(ctx, 260, (rng, i) => {
    const outer = i > 170; let r; do { r = outer ? 4.6 + rng() * .8 : 2.7 + rng() * 1.3; } while (!outer && Math.abs(r - 3.3) < .1 && rng() < .9);
    return { r, a0: rng() * TAU, y: gauss(rng) * .05, s: .02 + Math.pow(rng(), 3) * .07, tx: rng() * 2, ty: rng() * 2, c: greyRock(rng, !outer) };
  }, 6);
  g.add(dust.pts, rocks.mesh); const h = haze(ctx, 6, [.8, .65, .5], .6); if (h) g.add(h);
  return { name: 'Asteroid belts', group: g, update(t) { dust.update(t); rocks.update(t); } };
}

/* ---------- 7. Horseshoe orbit: rocks share a planet's orbit and swap places with it ---------- */
function horseshoe(ctx) {
  const { T } = ctx, g = new T.Group(), rp = 3.7, wp = kw(rp);
  const dust = pointCloud(ctx, rng => { const r = rp + gauss(rng) * .22, a = rng() * TAU, k = .3 + rng() * .4; return { p: [r * Math.cos(a), gauss(rng) * .03, r * Math.sin(a)], c: [.9 * k, .75 * k, .55 * k] }; }, 1, 9, 6000);
  const rocks = rockField(ctx, 150, (rng) => {
    const d0 = .08 + rng() * .35, pmin = .3 + rng() * .35, s0 = rng(), Th = 22 + rng() * 10;
    return { y: gauss(rng) * .03, s: .025 + Math.pow(rng(), 3) * .05, tx: rng() * 2, ty: rng() * 2, c: greyRock(rng, true),
      f: t => { const s = (s0 + t / Th) * TAU; return [rp + d0 * Math.tanh(3 * Math.sin(s)) / Math.tanh(3), wp * t + Math.PI + (Math.PI - pmin) * Math.cos(s)]; } };
  }, 12);
  const planet = new T.Mesh(new T.SphereGeometry(.24, 32, 24), planetMaterial(ctx, ['#7a4a8a', '#a064b0', '#5b3a70', '#c08ad0'], 21));
  const ring = new T.LineLoop(new T.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new T.Vector3(rp * Math.cos(i / 160 * TAU), 0, rp * Math.sin(i / 160 * TAU)))), new T.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: .12 }));
  g.add(dust.pts, rocks.mesh, planet, ring, glowSprite(ctx, [.75, .55, .9], 1).translateY(0));
  const gl = g.children[g.children.length - 1];
  return { name: 'Horseshoe orbit', group: g, update(t) {
    dust.update(t); rocks.update(t); planet.position.set(rp * Math.cos(wp * t), 0, rp * Math.sin(wp * t)); gl.position.copy(planet.position); planet.rotation.y = t;
  } };
}

/* ---------- 8. Comet cloud: an inclined icy disc plus comets with tails that point away from the star ---------- */
function comets(ctx) {
  const { T } = ctx, g = new T.Group(), rng = rngFrom(31), tilted = new T.Group(); tilted.rotation.set(.12, 0, .06);
  const cloud = pointCloud(ctx, r2 => { const r = 3 + r2() * 1.9, a = r2() * TAU, k = .3 + r2() * .5; return { p: [r * Math.cos(a), gauss(r2) * .3, r * Math.sin(a)], c: [.6 * k, .8 * k, k] }; }, 1, 3, 9000);
  tilted.add(cloud.pts); g.add(tilted);
  const NC = 6, PT = 130, C = [];
  for (let i = 0; i < NC; i++) {
    const a = 3.0 + rng() * .9, e = .4 + rng() * .2;
    C.push({ a, e, n: .7 / Math.pow(a, 1.5), M0: rng() * TAU, q: new T.Quaternion().setFromEuler(new T.Euler((rng() - .5) * 1.6, rng() * TAU, (rng() - .5) * .8)),
      nuc: new T.Mesh(new T.IcosahedronGeometry(.045, 1), new T.MeshStandardMaterial({ color: 0xcfd6e0, roughness: .9, flatShading: true })), off: Array.from({ length: PT }, () => [rng() - .5, rng() - .5, rng() - .5, rng()]) });
    g.add(C[i].nuc);
  }
  const pos = new Float32Array(NC * PT * 3), col = new Float32Array(NC * PT * 3), geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
  const sprite = canvasTex(ctx, 64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
  const tails = new T.Points(geo, new T.PointsMaterial({ size: .07, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); tails.frustumCulled = false; g.add(tails);
  const v = new T.Vector3(), dir = new T.Vector3(), vel = new T.Vector3(), p0 = new T.Vector3();
  const at = (c, t) => {
    let M = c.M0 + c.n * t, E = M; for (let k = 0; k < 4; k++) E -= (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
    return v.set(c.a * (Math.cos(E) - c.e), 0, c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E)).applyQuaternion(c.q);
  };
  return { name: 'Comet cloud', group: g, update(t) {
    cloud.update(t);
    C.forEach((c, i) => {
      p0.copy(at(c, t)); c.nuc.position.copy(p0); vel.copy(at(c, t + .3)).sub(p0).normalize();
      dir.copy(p0).normalize(); const len = Math.min(1.8, .6 + 2.2 / Math.max(p0.length(), .8)), act = Math.min(1, 2.4 / p0.length() / 1.4);
      for (let k = 0; k < PT; k++) {
        const o = c.off[k], s = k / PT, ion = k % 2 === 0, L = len * Math.pow(s, 1.15) * (ion ? 1 : .7), sp = .05 * s;
        const b = (i * PT + k) * 3;
        pos[b] = p0.x + dir.x * L - (ion ? 0 : vel.x * .4 * s * s) + o[0] * sp * 2; pos[b + 1] = p0.y + dir.y * L - (ion ? 0 : vel.y * .4 * s * s) + o[1] * sp * 2; pos[b + 2] = p0.z + dir.z * L - (ion ? 0 : vel.z * .4 * s * s) + o[2] * sp * 2;
        const f = Math.pow(1 - s, 1.6) * act * (.7 + .3 * o[3]);
        col[b] = (ion ? .45 : 1) * f; col[b + 1] = (ion ? .7 : .85) * f; col[b + 2] = (ion ? 1 : .6) * f;
      }
    });
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
  } };
}

/* ---------- 9. Circumbinary disc: two stars orbit each other inside a disc with spiral arms ---------- */
function circumbinary(ctx) {
  const { T } = ctx, g = new T.Group(), r0 = ctx.inner + 1.0;
  const cloud = pointCloud(ctx, rng => {
    let r, a; r = r0 * Math.pow(5.2 / r0, rng());
    do { a = rng() * TAU; } while (rng() > .5 + .3 * Math.cos(2 * (a - 2.2 * Math.log(r))) + .2 * Math.cos(a - 1));
    const t = (r - r0) / (5.2 - r0), k = .45 + rng() * .55;
    return { p: [r * Math.cos(a), gauss(rng) * .06 * Math.pow(r, 1.15), r * Math.sin(a)], c: lerp3([.9, .85, 1], [.55, .3, .8], t).map(v => v * k) };
  }, 1, 41);
  const bk = ctx.cfg.binaryBright || 1;                                           // brightness of the two stars (hero-config.js)
  const mk = (rad, rgb) => { const m = new T.Mesh(new T.SphereGeometry(rad, 32, 24), new T.MeshBasicMaterial({ color: new T.Color(...rgb.map(v => v * bk)) })); m.add(glowSprite(ctx, rgb, rad * 7 * bk), glowSprite(ctx, rgb, rad * 3 * bk)); return m; };
  const A = mk(.36, [1, .78, .4]), B = mk(.26, [.85, .92, 1]);
  g.add(cloud.pts, A, B); const h = haze(ctx, 6.4, [.75, .6, 1], .8); if (h) g.add(h);
  return { name: 'Circumbinary disc', group: g, hideStar: true, update(t) {
    cloud.update(t); const a = t * 1.3, d = .85;
    A.position.set(Math.cos(a) * d * .4, 0, Math.sin(a) * d * .4); B.position.set(-Math.cos(a) * d * .6, 0, -Math.sin(a) * d * .6);
  } };
}

/* ---------- 10. Young star with a disc and two jets ---------- */
function jet(ctx) {
  const { T } = ctx, g = new T.Group(), r0 = ctx.inner + 0.8;
  const cloud = pointCloud(ctx, rng => {
    const r = r0 * Math.pow(5.2 / r0, rng()), a = rng() * TAU, t = (r - r0) / (5.2 - r0), k = .4 + rng() * .5;
    return { p: [r * Math.cos(a), gauss(rng) * .06 * Math.pow(r, 1.25), r * Math.sin(a)], c: lerp3([.9, .8, .6], [.45, .25, .2], t).map(v => v * k) };
  }, 1, 51);
  const NJ = 4000, geo = new T.BufferGeometry(), ph = new Float32Array(NJ), sg = new Float32Array(NJ), rn = new Float32Array(NJ * 3), rg = rngFrom(8);
  for (let i = 0; i < NJ; i++) { ph[i] = rg(); sg[i] = i % 2 ? 1 : -1; rn[i * 3] = rg(); rn[i * 3 + 1] = rg(); rn[i * 3 + 2] = rg(); }
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(NJ * 3), 3)); geo.setAttribute('aPh', new T.BufferAttribute(ph, 1));
  geo.setAttribute('aSg', new T.BufferAttribute(sg, 1)); geo.setAttribute('aRn', new T.BufferAttribute(rn, 3));
  const mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { uTime: { value: 0 }, uScale: ctx.uScale },
    vertexShader: `attribute float aPh, aSg; attribute vec3 aRn; uniform float uTime, uScale; varying float vA, vS;
void main(){
  float s = fract(aPh + uTime*.12), L = 3.4;
  float w = .04 + .22*pow(s, .9);                                              // beam widens with distance
  float ang = aRn.x*6.2831 + s*9. + uTime*1.5;                                 // helical wobble
  vec3 p = vec3(cos(ang)*w*aRn.y, aSg*(.6 + s*L), sin(ang)*w*aRn.y);
  p.x += sin(s*8. + uTime)*.05*s;
  vS = s; vA = smoothstep(0., .08, s)*(1. - s)*(1. - s);
  vec4 mv = modelViewMatrix*vec4(p, 1.); gl_PointSize = uScale*(.035 + .02*aRn.z)/-mv.z; gl_Position = projectionMatrix*mv;
}`,
    fragmentShader: `varying float vA, vS; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d); if (a < .01) discard;
  vec3 c = mix(vec3(.75, .88, 1.), vec3(.9, .35, .6), vS); gl_FragColor = vec4(c, a*vA*.9); }` });
  const pts = new T.Points(geo, mat); pts.frustumCulled = false;
  g.add(cloud.pts, pts); const h = haze(ctx, 6, [1, .6, .4], .6); if (h) g.add(h);
  return { name: 'Young star with jets', group: g, update(t) { cloud.update(t); mat.uniforms.uTime.value = t; } };
}

/* ---------- 11. Pizza: puffy bubbled crust, real height on the cheese, and 3D toppings ---------- */
function pizza(ctx) {
  const { T, R } = ctx, g = new T.Group(), hole = ctx.inner, rim = R - .35, th = .12, rng = rngFrom(4);
  const blobs = Array.from({ length: 700 }, () => ({ a: rng() * TAU, r: hole + rng() * (rim - hole), rx: 10 + rng() * 26, ry: 8 + rng() * 18, rot: rng() * 3, al: .5 + rng() * .4, gg: 200 + rng() * 40 | 0, bb: 90 + rng() * 40 | 0 }));
  const spots = Array.from({ length: 160 }, () => ({ a: rng() * TAU, r: hole + rng() * (rim - hole), s: 4 + rng() * 9 }));
  function draw(c, w, bump) {                                         // same layout for the colour map and the height map
    const C = w / 2, px = r => r / rim * C;
    c.fillStyle = bump ? '#3a3a3a' : '#c4361e'; c.fillRect(0, 0, w, w);
    blobs.forEach(o => {
      c.save(); c.translate(C + Math.cos(o.a) * px(o.r), C + Math.sin(o.a) * px(o.r)); c.rotate(o.rot); c.scale(o.rx, o.ry);
      if (bump) { const gr = c.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, '#fff'); gr.addColorStop(.7, '#aaa'); gr.addColorStop(1, 'rgba(120,120,120,0)'); c.fillStyle = gr; }
      else c.fillStyle = `rgba(255,${o.gg},${o.bb},${o.al})`;
      c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore();
    });
    if (!bump) spots.forEach(o => { c.fillStyle = 'rgba(190,110,40,.45)'; c.beginPath(); c.arc(C + Math.cos(o.a) * px(o.r), C + Math.sin(o.a) * px(o.r), o.s, 0, TAU); c.fill(); });
    c.strokeStyle = bump ? '#000' : 'rgba(40,15,5,.55)'; c.lineWidth = bump ? 6 : 3;                      // slice cuts
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.beginPath(); c.moveTo(C + Math.cos(a) * px(hole), C + Math.sin(a) * px(hole)); c.lineTo(C + Math.cos(a) * px(rim), C + Math.sin(a) * px(rim)); c.stroke(); }
  }
  const colTex = canvasTex(ctx, 1024, 1024, (c, w) => draw(c, w, false));
  const hTex = canvasTex(ctx, 1024, 1024, (c, w) => draw(c, w, true), false);
  const body = new T.Mesh(new T.LatheGeometry([[hole, -th], [rim, -th], [rim, th], [hole, th], [hole, -th]].map(p => new T.Vector2(...p)), 96), new T.MeshStandardMaterial({ color: 0xd9a35a, roughness: .8, side: T.DoubleSide, envMapIntensity: .2 }));
  const top = new T.Mesh(flat(T, new T.RingGeometry(hole, rim, 160, 56)), new T.MeshStandardMaterial({ map: colTex, bumpMap: hTex, bumpScale: 5, displacementMap: hTex, displacementScale: .07, displacementBias: -.02, roughness: .45, envMapIntensity: .6 }));
  top.position.y = th + .002;
  /* crust: noisy, puffy torus with a blistered, floury texture */
  const cg = new T.TorusGeometry(rim, .22, 40, 220), pp = cg.attributes.position, nz = (x, y) => Math.sin(x * 3.1 + Math.sin(y * 2.3) * 2) * Math.sin(y * 4.7 + x * 1.3) * .5 + Math.sin(x * 9.1 + y * 5.3) * .25;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i), U = Math.atan2(y, x), cx = rim * Math.cos(U), cy = rim * Math.sin(U);
    const dx = x - cx, dy = y - cy, k = 1 + .22 * nz(U * 6, z * 7), puff = .07 * nz(U * 3, 1.7);
    pp.setXYZ(i, cx + dx * k + Math.cos(U) * puff, cy + dy * k + Math.sin(U) * puff, z * (1 + .25 * nz(U * 5, 3)));
  }
  cg.computeVertexNormals();
  const crustTex = (srgb) => canvasTex(ctx, 512, 128, (c, w, h) => {
    const r2 = rngFrom(9); c.fillStyle = srgb ? '#d9a050' : '#808080'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = r2() * w, y = r2() * h, s = 2 + r2() * 9; c.fillStyle = srgb ? `rgba(${110 + r2() * 40 | 0},${55 + r2() * 25 | 0},20,${.25 + r2() * .35})` : (r2() < .5 ? '#202020' : '#e0e0e0'); c.beginPath(); c.ellipse(x, y, s, s * .7, r2() * 3, 0, TAU); c.fill(); }   // blisters and char
    if (srgb) for (let i = 0; i < 400; i++) { c.fillStyle = 'rgba(255,245,225,.18)'; c.fillRect(r2() * w, r2() * h, 2, 1); }   // flour
  }, srgb);
  const cMap = crustTex(true), cBump = crustTex(false); [cMap, cBump].forEach(t => { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(10, 1); });
  const crust = new T.Mesh(cg, new T.MeshStandardMaterial({ map: cMap, bumpMap: cBump, bumpScale: 4, roughness: .8, envMapIntensity: .25 })); crust.rotation.x = Math.PI / 2; crust.position.y = th * .6;
  g.add(body, top, crust);
  /* toppings: real geometry sitting on the cheese */
  const place = () => { const a = rng() * TAU, r = hole + .55 + rng() * (rim - hole - 1.1); return [r * Math.cos(a), r * Math.sin(a), a]; };
  const olive = new T.MeshStandardMaterial({ color: 0x1b1b22, roughness: .3, envMapIntensity: .7 });
  for (let i = 0; i < 12; i++) { const [x, z] = place(), o = new T.Mesh(new T.TorusGeometry(.14, .06, 14, 24), olive); o.rotation.x = Math.PI / 2 + (rng() - .5) * .3; o.position.set(x, th + .085, z); g.add(o); }
  const pep = new T.MeshStandardMaterial({ color: 0x3f9a3c, roughness: .4, envMapIntensity: .6 });
  for (let i = 0; i < 16; i++) {
    const [x, z] = place(), a0 = rng() * TAU, sw = 1.3 + rng() * 1.3, rr = .22 + rng() * .12, pts = [];
    for (let k = 0; k <= 8; k++) { const a = a0 + sw * k / 8; pts.push(new T.Vector3(x + rr * Math.cos(a), th + .09 + .02 * Math.sin(k), z + rr * Math.sin(a))); }
    g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 16, .035, 8), pep));
  }
  const leaf = new T.MeshStandardMaterial({ color: 0x2c8a3a, roughness: .55, envMapIntensity: .4 });
  for (let i = 0; i < 10; i++) { const [x, z] = place(), l = new T.Mesh(new T.SphereGeometry(1, 14, 10), leaf); l.scale.set(.16, .02, .09); l.rotation.set((rng() - .5) * .4, rng() * TAU, (rng() - .5) * .4); l.position.set(x, th + .09, z); g.add(l); }
  return { name: 'Pizza', group: wrapGroup(T, g), update(t) { g.rotation.y = t * .3; } };
}

/* ---------- 12. Dartboard (the star is the bullseye) ---------- */
function dartboard(ctx) {
  const { T, R } = ctx, g = new T.Group(), hole = ctx.inner, rad = R - .15, th = .08;
  const nums = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const tex = canvasTex(ctx, 1024, 1024, (c, w) => {
    const C = w / 2, S = C - 2, seg = TAU / 20;
    c.fillStyle = '#111'; c.beginPath(); c.arc(C, C, S, 0, TAU); c.fill();
    const band = (r0, r1, k) => { for (let i = 0; i < 20; i++) { const a0 = -Math.PI / 2 + (i - .5) * seg, a1 = a0 + seg, even = i % 2 === 0;
      c.fillStyle = k === 'single' ? (even ? '#161616' : '#eadcb4') : (even ? '#c4202a' : '#1f8a3f'); c.beginPath(); c.arc(C, C, S * r1, a0, a1); c.arc(C, C, S * r0, a1, a0, true); c.closePath(); c.fill(); } };
    band(.2, .455, 'single'); band(.455, .5, 'multi'); band(.5, .72, 'single'); band(.72, .765, 'multi');
    c.fillStyle = '#1f8a3f'; c.beginPath(); c.arc(C, C, S * .27, 0, TAU); c.fill();                       // outer bull
    c.strokeStyle = '#bbb'; c.lineWidth = 2; [.455, .5, .72, .765, .27].forEach(r => { c.beginPath(); c.arc(C, C, S * r, 0, TAU); c.stroke(); });
    for (let i = 0; i < 20; i++) { const a = -Math.PI / 2 + (i - .5) * seg; c.beginPath(); c.moveTo(C + Math.cos(a) * S * .27, C + Math.sin(a) * S * .27); c.lineTo(C + Math.cos(a) * S * .765, C + Math.sin(a) * S * .765); c.stroke(); }
    c.fillStyle = '#fff'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    nums.forEach((n, i) => { const a = -Math.PI / 2 + i * seg; c.save(); c.translate(C + Math.cos(a) * S * .88, C + Math.sin(a) * S * .88); c.rotate(a + Math.PI / 2); c.fillText(n, 0, 0); c.restore(); });
  });
  const body = new T.Mesh(new T.LatheGeometry([[hole, -th], [rad, -th], [rad, th], [hole, th], [hole, -th]].map(p => new T.Vector2(...p)), 96), new T.MeshStandardMaterial({ color: 0x222222, roughness: .8, side: T.DoubleSide, envMapIntensity: .2 }));
  const face = new T.Mesh(flat(T, new T.RingGeometry(hole, rad, 160, 1)), new T.MeshStandardMaterial({ map: tex, roughness: .7, envMapIntensity: .3 })); face.position.y = th + .002;
  g.add(body, face);
  return { name: 'Dartboard', group: wrapGroup(T, g), update(t) { g.rotation.y = t * .25; } };
}

/* ---------- 13. UFO (a saucer ring with a glass band and chasing lights) ---------- */
function ufo(ctx) {
  const { T, R } = ctx, g = new T.Group(), hole = ctx.inner + .1, rim = R - .2, N = 24;
  const prof = [[hole, .18], [hole + .5, .3], [hole + 1.4, .26], [rim - .8, .13], [rim, 0], [rim - .8, -.14], [hole + 1.4, -.26], [hole + .5, -.2], [hole, -.1], [hole, .18]].map(p => new T.Vector2(...p));
  const hull = new T.Mesh(new T.LatheGeometry(prof, 128), new T.MeshStandardMaterial({ color: 0xb9c2d0, metalness: 1, roughness: .22, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity }));
  const glass = new T.Mesh(new T.TorusGeometry(hole + .75, .18, 16, 96), new T.MeshPhysicalMaterial({ color: 0x66e0ff, roughness: .05, metalness: 0, transparent: true, opacity: .55, emissive: 0x0a4a66, envMapIntensity: ctx.cfg.envIntensity }));
  glass.rotation.x = Math.PI / 2; glass.position.y = .27;
  const lights = [], rl = rim - .45;
  for (let i = 0; i < N; i++) { const a = i / N * TAU, m = new T.Mesh(new T.SphereGeometry(.06, 12, 8), new T.MeshBasicMaterial({ color: 0xffffff })); m.position.set(rl * Math.cos(a), .06, rl * Math.sin(a)); lights.push(m); g.add(m); }
  const under = new T.Mesh(flat(T, new T.RingGeometry(hole + .3, rim - .5, 96, 1)), new T.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: .16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })); under.position.y = -.3;
  g.add(hull, glass, under); const h = haze(ctx, 6, [.4, 1, .8], .5); if (h) g.add(h);
  const cc = new T.Color();
  return { name: 'UFO', group: wrapGroup(T, g), update(t) {
    lights.forEach((m, i) => { m.material.color.setHSL((i / N + t * .15) % 1, 1, .5 + .35 * Math.max(0, Math.sin(i / N * TAU * 3 - t * 5))); });
    g.rotation.y = t * .4; g.rotation.z = .06 * Math.sin(t * .8);
  } };
}

/* ---------- 14. Cymbal ---------- */
function cymbal(ctx) {
  const { T, R } = ctx, g = new T.Group(), hole = ctx.inner, rim = R - .1;
  const top = [[hole, .28], [hole + .3, .34], [hole + .8, .27], [hole + 1.1, .1], [rim * .5, .03], [rim * .85, -.02], [rim, -.12]];
  const prof = top.concat(top.slice().reverse().map(p => [p[0], p[1] - .04])).concat([top[0]]).map(p => new T.Vector2(...p));
  const bump = canvasTex(ctx, 4, 512, (c, w, h) => { c.fillStyle = '#888'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { c.fillStyle = (y / 3) % 2 ? '#aaa' : '#666'; c.fillRect(0, y, w, 2); } }, false);
  bump.wrapS = bump.wrapT = T.RepeatWrapping;
  const mesh = new T.Mesh(new T.LatheGeometry(prof, 160), new T.MeshStandardMaterial({ color: 0xe0a93c, metalness: 1, roughness: .26, bumpMap: bump, bumpScale: .6, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity * 1.2 }));
  g.add(mesh); const h = haze(ctx, 6, [1, .8, .4], .5); if (h) g.add(h);
  return { name: 'Cymbal', group: g, update(t) { mesh.rotation.y = t * .6; g.rotation.x = .09 * Math.sin(t * .9) + .05 * Math.sin(t * 11) * Math.exp(-((t % 6) * .9)); g.rotation.z = .07 * Math.sin(t * .7 + 1); } };
}


/* helper: stacks copies of one flat ring at different heights, flaring outwards, so a flat image gets real thickness */
function stackedDisc(ctx, geo, makeMat, ys, sigma) {
  const { T } = ctx, g = new T.Group(), w = ys.map(y => Math.exp(-Math.pow(y / sigma, 2))), tot = w.reduce((s, v) => s + v, 0), mats = [];
  ys.forEach((y, i) => { const mat = makeMat(y, w[i] / tot * 1.15); mats.push(mat); const mesh = new T.Mesh(geo, mat); mesh.renderOrder = -1; g.add(mesh); });
  return { group: g, mats };
}
const FLARE_VS = `uniform float uY; varying vec2 vL; void main(){ vL = position.xz; vec3 p = position; p.y += uY*pow(length(position.xz)/3., 1.3); gl_Position = projectionMatrix*modelViewMatrix*vec4(p, 1.); }`;
const NOISE_GLSL = `float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }`;
const premul = (T, extra) => Object.assign({ transparent: true, depthWrite: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, side: T.DoubleSide }, extra);

/* ---------- Protoplanetary disc, ALMA-style: dust continuum rings in the afmhot colour map, with some thickness ---------- */
function protoplanetary(ctx) {
  const { T } = ctx, g = new T.Group(), R0 = ctx.inner + 0.3, R1 = 5.3, uTime = { value: 0 };
  const geo = flat(T, new T.RingGeometry(R0, R1, 256, 8));
  const fs = `varying vec2 vL; uniform float uTime, uOp;
const float R0 = ${R0.toFixed(3)}, R1 = ${R1.toFixed(3)};
${NOISE_GLSL}
vec3 afmhot(float t){ return clamp(vec3(2.*t, 2.*t - .5, 2.*t - 1.), 0., 1.); }     // black, red, orange, yellow, white
float ring(float r, float c, float w, float amp){ return amp*exp(-pow((r - c)/w, 2.)); }
float wrap(float d){ return d - 6.2831*floor((d + 3.1416)/6.2831); }
void main(){
  float r = length(vL), a = atan(vL.y, vL.x);
  if (r < R0 || r > R1) discard;
  float ang = a - uTime*.03;                                                      // slow rigid drift (no shearing, so no spirals)
  float I = .34*exp(-(r - R0)/2.4) + ring(r, R0 + .05, .45, .8);                 // pedestal + bright inner disc
  I += ring(r, 1.95, .24, .50) + ring(r, 2.85, .22, .34*(1. + 1.4*exp(-pow(wrap(ang - 1.1)/.6, 2.)))) + ring(r, 3.75, .22, .25) + ring(r, 4.6, .2, .16);   // four broad rings, one with a crescent
  vec2 pc = vec2(cos(ang), sin(ang));
  float cl = .6*n2(pc*2.4 + vec2(floor(r*4.)*7.13, 0.)) + .4*n2(pc*7. + vec2(floor(r*7.)*3.7, 5.));   // clumps that stay inside their own ring
  I *= (.55 + .9*cl) + .1*(n2(pc*45. + r*45.) - .5);
  I *= smoothstep(R1, R1 - .5, r)*smoothstep(R0, R0 + .15, r);
  vec3 c = afmhot(I*.95);
  gl_FragColor = vec4(c*uOp, clamp(max(c.r, max(c.g, c.b))*1.1, 0., 1.)*uOp);
}`;
  const st = stackedDisc(ctx, geo, (y, op) => new T.ShaderMaterial(premul(T, { uniforms: { uTime, uOp: { value: op }, uY: { value: y } }, vertexShader: FLARE_VS, fragmentShader: fs })), [-.3, -.22, -.15, -.08, 0, .08, .15, .22, .3], .17);
  g.add(st.group);
  return { name: 'Protoplanetary disc (ALMA-style)', group: g, update(t) { uTime.value = t; } };
}

/* ---------- Debris disc, scattered-light image (SPHERE / GPI style): coronagraph mask, broad belt, one bright side ---------- */
function scattered(ctx) {
  const { T } = ctx, g = new T.Group(), R0 = 1.0, R1 = 5.4, uTime = { value: 0 };
  const geo = flat(T, new T.RingGeometry(R0, R1, 256, 8));
  const fs = `varying vec2 vL; uniform float uTime, uOp;
const float R0 = ${R0.toFixed(3)}, R1 = ${R1.toFixed(3)};
${NOISE_GLSL}
void main(){
  float r = length(vL), a = atan(vL.y, vL.x);
  if (r < R0 || r > R1) discard;
  float rc = 3.5*(1. - .10*cos(a - 2.2));                                          // belt centre is offset from the star
  float x = r/rc;
  float prof = x < 1. ? pow(x, 7.) : pow(x, -3.2);                                 // steep inside, shallow outside: a broken power law
  float scat = .32 + 1.1*pow(.5 + .5*cos(a - 1.3), 2.);                            // forward scattering: one side brighter
  vec2 pc = vec2(cos(a), sin(a));
  float I = prof*scat*(.85 + .3*n2(pc*5. + vec2(r*.7, 3.)));
  float sp = n2(vec2(a*70., r*2.5 + uTime*.03))*.7 + n2(vec2(a*23., r*4. + 9.))*.3;     // radial speckle left over after removing the star
  I += .5*exp(-(r - R0)/.75)*sp*sp + .1*exp(-(r - R0)/2.4)*sp;
  I += .1*(n2(pc*90. + r*90.) - .5)*step(2.2, r);                                  // photon grain
  I *= smoothstep(R1, R1 - .7, r)*smoothstep(R0, R0 + .08, r);
  vec3 c = vec3(.86, .92, 1.)*clamp(I*1.15, 0., 1.);                               // grey-blue, like the greyscale/bone maps these are shown in
  gl_FragColor = vec4(c*uOp, clamp(I*1.15, 0., 1.)*uOp);
}`;
  const st = stackedDisc(ctx, geo, (y, op) => new T.ShaderMaterial(premul(T, { uniforms: { uTime, uOp: { value: op }, uY: { value: y } }, vertexShader: FLARE_VS, fragmentShader: fs })), [-.22, -.14, -.07, 0, .07, .14, .22], .13);
  g.add(st.group);
  const mask = new T.Mesh(new T.CircleGeometry(1.0, 64), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false })); mask.renderOrder = 10; g.add(mask);   // coronagraph mask, always facing the camera
  const q = new T.Quaternion();
  return { name: 'Debris disc (scattered light)', group: g, hideStar: true, update(t) {
    uTime.value = t; mask.parent.getWorldQuaternion(q); mask.quaternion.copy(q.invert()).multiply(ctx.cam.quaternion);
  } };
}

export const MODELS = { scattered, protoplanetary, debris, dvd, vinyl, system, blackhole, belt, horseshoe, comets, circumbinary, jet, pizza, dartboard, ufo, cymbal };