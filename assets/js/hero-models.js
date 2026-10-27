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
function pointCloud(ctx, fn, kep, seed) {            // fn(rng) -> {p:[x,y,z], c:[r,g,b]}
  const { T, cfg } = ctx, N = cfg.particles, rng = rngFrom(seed), P = new Float32Array(N * 3), C = new Float32Array(N * 3);
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
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xy; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; varying vec2 vL;
void main(){
  float r = length(vL), a = atan(vW.z, vW.x);
  vec3 V = normalize(cameraPosition - vW);
  float t = r*.21 + a*.32 + V.x*.9 + V.z*.6;
  vec3 rain = .55 + .45*cos(6.2831*(t + vec3(0., .33, .67)));
  float sheen = .5 + .5*pow(abs(cos(a + V.x*2.)), 2.);
  float track = .9 + .1*sin(r*260.);
  gl_FragColor = vec4(rain*sheen*track*1.05 + .06, 1.);
}` }));
  data.position.y = th + 0.002;
  const hub = new T.Mesh(flat(T, new T.RingGeometry(hole, hubR, 96, 1)), new T.MeshPhysicalMaterial({ color: 0xb4c0d2, roughness: .08, metalness: 0, transparent: true, opacity: .55, side: T.DoubleSide, envMapIntensity: ctx.cfg.envIntensity }));
  hub.position.y = th + 0.002;
  const ring = new T.Mesh(flat(T, new T.RingGeometry(hubR, dataR, 96, 1)), new T.MeshStandardMaterial({ color: 0xe6e9ef, metalness: 1, roughness: .15, envMapIntensity: ctx.cfg.envIntensity }));
  ring.position.y = th + 0.002;
  g.add(body, data, hub, ring);
  const outer = new T.Group(); outer.add(g); const h = haze(ctx, 6, [.6, .75, 1], .8); if (h) outer.add(h);
  return { name: 'DVD', group: outer, update(t) { g.rotation.x = 0.12 * Math.sin(t * 0.4); g.rotation.z = 0.1 * Math.sin(t * 0.31 + 1); } };
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
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xy; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
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
  const { T } = ctx, g = new T.Group(), rng = rngFrom(2027), r0 = ctx.inner + 0.9, r1 = 5.0;
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
  const inc = [], gaps = SPEC.map(() => 0.6 + rng()); let tot = 0; gaps.forEach(x => tot += x);
  let r = r0 - gaps[0] / tot * (r1 - r0) * 0.0, acc = 0;
  const ringTex = canvasTex(ctx, 256, 4, (c, w, h) => {
    for (let x = 0; x < w; x++) { const u = x / w; let a = .5 + .4 * Math.sin(u * 37) * Math.sin(u * 11 + 1); if (u > .6 && u < .66) a = .05; c.fillStyle = `rgba(226,205,160,${Math.max(0, Math.min(1, a))})`; c.fillRect(x, 0, 1, h); }
  });
  const bodies = SPEC.map((sp, i) => {
    acc += gaps[i]; const rad = r0 + (acc - gaps[0]) / (tot - gaps[0]) * (r1 - r0);
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
  return { name: 'Planetary system', group: g, update(t) {
    bodies.forEach(b => { b.spinner.rotation.y = -(b.a0 + t * b.w); b.body.rotation.y = t * b.spin; b.moons.forEach(m => { m.pivot.rotation.y = t * m.w; }); });
  } };
}

/* ---------- 5. Black hole with an accretion disc (ray-traced Schwarzschild lensing) ----------
   At start-up, light rays are traced backwards from the camera through the curved space around the hole (units: G=M=c=1).
   The result (where each pixel hits the disc, and the Doppler boost there) is stored in two textures, so drawing is cheap.
   The model also tells the sky to lens the real background stars (see SKY_LENS in sky.js). */
function blackhole(ctx) {
  const { T, cfg } = ctx, S = cfg.bhRes || 384, Mw = 0.22, Wd = 5.2, Bmax = Wd / Mw, D = 50, RIN = 6, ROUT = 22, DP = 0.04;
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
    uniforms: { tA: { value: tA }, tB: { value: tB }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tA, tB; uniform float uTime; varying vec2 vUv;
const float RIN = ${RIN.toFixed(1)}, BMAX = ${Bmax.toFixed(3)}, TS = ${S.toFixed(1)};
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
  float inten = 8.*pow(x, 2.4)*(.3 + .7*(1. - sqrt(x))) * turb;
  float Tm = pow(x, .75)*g;
  return ramp(Tm) * inten * pow(clamp(g, .15, 2.2), 3.);                          // relativistic beaming: the approaching side is brighter
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

export const MODELS = { debris, dvd, vinyl, system, blackhole };
