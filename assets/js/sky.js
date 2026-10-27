/* sky.js: starry background with parallax for a Jekyll / Minimal Mistakes site.
   Put this file in assets/js/ and load it from _includes/head/custom.html.
   It adds its own fixed <canvas> behind the page; no other markup is needed.
   Options (all optional): define window.SKY_CONFIG = { density: 1100, spikes: 2 } before this script. */
(() => {
  'use strict';
  const CFG = Object.assign({
    density: 1100,   // stars per million screen pixels
    seed: 2027,      // same seed = same sky on every page load
    spikes: 2,       // 0 none, 1 classic (+), 2 JWST-style (6)
    twinkle: true,
    parallax: true,
    psfSize: 1,      // size of every star's glow and spikes (1 = default, 0.6 smaller, 1.5 bigger)
    halo: 1,         // strength of the wide faint halo around bright stars
    brightness: 1,   // overall star brightness
    blue: 0,         // 0..1 extra share of hot blue-white stars
    warm: 0,         // 0..1 extra share of orange/red stars
    purple: 0.06     // 0..1 share of stars tinted purple/violet
  }, window.SKY_CONFIG || {});

  if (document.getElementById('sky-bg')) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.id = 'sky-bg';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block';
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!gl) return;                       // no WebGL2: the CSS gradient behind it still looks fine
  document.body.prepend(canvas);

  const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;     // x,y in 0..1 across the screen, depth 0.3 (near) .. 1 (far)
layout(location=2) in vec3 aColor;
layout(location=3) in vec3 aParam;   // brightness, phase, twinkle amount
uniform vec2 uView, uCam;
uniform float uTime, uTwinkle, uSpikeMode, uPsf, uHalo;
flat out vec3 vColor; flat out vec4 vP; flat out vec3 vQ; flat out float vI;
out vec2 vS;
void main() {
  float b = aParam.x, d = aPos.z;
  float k = (1.0 - d) / 0.7;
  float sc = 1.0 + 0.5 * k;
  float imul = 0.5 + 0.7 * k;
  const float M = 90.0;                                         // wrap margin in px
  vec2 uv = fract(aPos.xy - uCam / (d * uView));                // parallax: near stars shift more
  vec2 c = uv * (uView + 2.0 * M) - M;
  float ph = aParam.y;
  float tw = 1.0 + uTwinkle * aParam.z * (0.6 * sin(uTime * (1.3 + 1.7 * fract(ph * 7.13)) + ph * 6.2831)
                                        + 0.4 * sin(uTime * (3.1 + 2.3 * fract(ph * 3.7)) + ph * 17.0));
  float s0 = (0.55 + 0.95 * sqrt(b)) * pow(sc, 0.5) * uPsf;
  float s1 = (1.4 + 15.0 * pow(b, 1.2)) * sc * uPsf;
  float a0 = 0.22 + 1.1 * b;
  float a1 = (0.04 + 0.95 * b * b) * uHalo;
  float Ls = (12.0 + 62.0 * b) * pow(sc, 0.6) * uPsf;
  float sa = (uSpikeMode > 0.5) ? smoothstep(0.66, 0.97, b) : 0.0;
  float ext = 5.0 * s1;
  if (sa > 0.0) ext = max(ext, 1.9 * Ls);
  ext = max(ext, 4.0 * s0 + 2.0);
  vec2 off = (aCorner * 2.0 - 1.0) * ext;
  vec2 px = c + off;
  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);
  vColor = aColor; vP = vec4(s0, s1, a0, a1); vQ = vec3(Ls, sa, ext); vI = imul * tw; vS = off;
}`;

  const FRAG = `#version 300 es
precision highp float;
flat in vec3 vColor; flat in vec4 vP; flat in vec3 vQ; flat in float vI;
in vec2 vS;
uniform float uSpikeMode, uGain;
out vec4 o;
float spikeLine(vec2 p, float ang, float w, float Ls, float len) {
  vec2 d = vec2(cos(ang), sin(ang));
  float a = dot(p, d), q = dot(p, vec2(-d.y, d.x));
  return exp(-(q * q) / (2.0 * w * w)) * exp(-abs(a) / (Ls * len * 0.45));
}
void main() {
  float r2 = dot(vS, vS);
  float I = vP.z * exp(-r2 / (2.0 * vP.x * vP.x)) + vP.w * pow(1.0 + r2 / (vP.y * vP.y), -1.5);
  if (vQ.y > 0.001) {
    float w = 0.62, Ls = vQ.x, sp;
    if (uSpikeMode < 1.5) sp = spikeLine(vS, 0.0, w, Ls, 1.0) + spikeLine(vS, 1.5708, w, Ls, 1.0);
    else sp = spikeLine(vS, 1.5708, w, Ls, 1.0) + spikeLine(vS, 0.5236, w, Ls, 1.0)
            + spikeLine(vS, 2.6180, w, Ls, 1.0) + 0.35 * spikeLine(vS, 0.0, w, Ls, 0.55);
    I += vQ.y * 0.85 * sp;
  }
  I *= smoothstep(0.0, vQ.z * 0.35, vQ.z - max(abs(vS.x), abs(vS.y)));
  I *= vI * uGain;
  vec3 c = vColor * I;
  c = mix(c, vec3(1.0, 0.97, 0.93) * I, smoothstep(0.8, 3.0, I) * 0.75);   // saturated cores go white
  c = 1.0 - exp(-c * 1.25);
  o = vec4(c, max(max(c.r, c.g), c.b));
}`;

  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(x)); return null; } return x; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.remove(); return; }
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); canvas.remove(); return; }
  const U = {}; ['uView', 'uCam', 'uTime', 'uTwinkle', 'uSpikeMode', 'uPsf', 'uHalo', 'uGain'].forEach(n => U[n] = gl.getUniformLocation(prog, n));

  const F = 9, vao = gl.createVertexArray(), buf = gl.createBuffer(), corner = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (let a = 0; a < 3; a++) {
    gl.enableVertexAttribArray(1 + a); gl.vertexAttribPointer(1 + a, 3, gl.FLOAT, false, F * 4, a * 12); gl.vertexAttribDivisor(1 + a, 1);
  }
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);

  /* ---- star data: seeded, so every page shows the same sky ---- */
  let seed = CFG.seed >>> 0;
  const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = (a, b) => a + rand() * (b - a);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  function blackbody(T) {                         // Tanner Helland approximation
    const t = T / 100; let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
    const c = v => Math.max(0, Math.min(255, v)) / 255; let R = c(r), G = c(g), B = c(b);
    const L = .3 * R + .59 * G + .11 * B, s = 1.35, f = v => Math.max(0, Math.min(1, L + (v - L) * s));
    return [f(R), f(G), f(B)];
  }
  function temperature(b) {
    const r = rand();
    if (b > 0.45) return r < 0.5 ? rnd(9000, 26000) : r < 0.85 ? rnd(3400, 4800) : rnd(5200, 7800);
    return r < 0.42 ? rnd(2800, 4300) : r < 0.74 ? rnd(4300, 6100) : r < 0.9 ? rnd(6100, 8800) : rnd(8800, 20000);
  }
  let VW = 0, VH = 0, count = 0;
  function build() {
    seed = CFG.seed >>> 0;
    VW = document.documentElement.clientWidth; VH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(VW * dpr); canvas.height = Math.round(VH * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    count = Math.max(1500, Math.min(9000, Math.round(CFG.density * VW * VH / 1e6)));
    const data = new Float32Array(count * F);
    for (let i = 0; i < count; i++) {
      let x, y;
      if (rand() < 0.38) { x = rand(); y = 0.62 - 0.3 * x + gauss() * 0.07; } else { x = rand(); y = rand(); }   // faint Milky Way band
      const b = Math.min(1, -Math.log2(1 - rand()) / 10.5);
      const u = rand();
      const T = u < CFG.blue ? rnd(9000, 26000) : u < CFG.blue + CFG.warm ? rnd(2800, 4800) : temperature(b);
      let col = blackbody(T);
      if (rand() < CFG.purple) col = col.map((v, k) => v * 0.3 + [0.75, 0.45, 1][k] * 0.7);   // violet tint
      const o = i * F;
      data.set([x, y - Math.floor(y), rnd(0.3, 1), col[0], col[1], col[2], b, rand(), 0.42 * Math.pow(1 - b, 3) + 0.06], o);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  /* ---- parallax input: mouse on desktop, scrolling everywhere ---- */
  const m = { x: 0, y: 0 }, cam = { x: 0, y: 0 };
  if (CFG.parallax && !reduce) addEventListener('pointermove', e => { m.x = e.clientX / VW - 0.5; m.y = e.clientY / VH - 0.5; }, { passive: true });
  let last = 0, lastDraw = -1;
  function draw(ts) {
    requestAnimationFrame(draw);
    const now = ts / 1000, dt = Math.min(0.05, now - last); last = now;
    if (now - lastDraw < 1 / 30) return;                          // 30 fps is plenty and saves battery
    lastDraw = now;
    const par = CFG.parallax && !reduce;
    const tx = par ? m.x * 40 : 0, ty = par ? m.y * 40 + (window.scrollY || 0) * 0.12 : 0;
    const k = 1 - Math.exp(-dt * 6); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(U.uView, VW, VH); gl.uniform2f(U.uCam, cam.x, cam.y);
    gl.uniform1f(U.uTime, now % 1000);
    gl.uniform1f(U.uTwinkle, CFG.twinkle && !reduce ? 1 : 0);
    gl.uniform1f(U.uSpikeMode, CFG.spikes);
    gl.uniform1f(U.uPsf, CFG.psfSize); gl.uniform1f(U.uHalo, CFG.halo); gl.uniform1f(U.uGain, CFG.brightness);
    gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); gl.bindVertexArray(null);
  }
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(build, 150); });
  build();
  requestAnimationFrame(ts => { last = ts / 1000; draw(ts); });
})();
