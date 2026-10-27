/* hero-star.js: the star: granulated surface, glow, magnetic loops with plasma flowing along them, and CMEs. */
export function createStar(T, cfg, uScale) {
  const S = cfg.star, R = S.radius, group = new T.Group();
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* surface */
  const surf = new T.Mesh(new T.SphereGeometry(R, 64, 48), new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vN, vP; void main(){ vN = normalMatrix*normal; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; varying vec3 vN, vP;
float h(vec3 p){ p = fract(p*.3183099 + .1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x), mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x), mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x), f.y), f.z); }
void main(){
  vec3 p = normalize(vP)*4.;
  float g = n(p*1.6 + uTime*.12)*.55 + n(p*4. - uTime*.18)*.3 + n(p*10.)*.15;
  float spots = smoothstep(.62,.8, n(p*.9 + 7.));                              // dark sunspots
  float mu = clamp(normalize(vN).z, 0., 1.);
  float limb = .3 + .7*pow(mu, .55);
  vec3 col = mix(vec3(1.,.5,.15), vec3(1.,.95,.8), smoothstep(.25,.8,g)) * limb * 1.5;
  col *= 1. - .55*spots;
  gl_FragColor = vec4(col, 1.);
}` }));
  group.add(surf);

  /* soft glow */
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g2 = c.getContext('2d'), gr = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(.12, 'rgba(255,190,110,.55)');
  gr.addColorStop(.35, 'rgba(255,120,50,.3)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 256, 256);
  const glowTex = new T.CanvasTexture(c);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
  glow.scale.set(S.glow, S.glow, 1); group.add(glow);

  const addPts = { transparent: true, depthWrite: false, blending: T.AdditiveBlending };
  const soft = `float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d);`;

  /* magnetic loops: plasma particles stream along arcs between two footpoints */
  const NL = Math.min(8, S.loops), PER = 260;
  const loops = Array.from({ length: NL }, () => ({ A: new T.Vector3(), B: new T.Vector3(), H: 0.4, age: 0, life: 1 }));
  function respawn(l, first) {
    const A = new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
    const t = new T.Vector3().crossVectors(A, new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5)).normalize();
    const sep = rnd(.3, .75);
    l.A.copy(A); l.B.copy(A).multiplyScalar(Math.cos(sep)).addScaledVector(t, Math.sin(sep)).normalize();
    l.H = rnd(...S.loopHeight); l.life = rnd(...S.loopLife); l.age = first ? rnd(0, l.life) : 0;
  }
  loops.forEach(l => respawn(l, true));
  const lg = new T.BufferGeometry(), lN = NL * PER, la = new Float32Array(lN), ls = new Float32Array(lN), lr = new Float32Array(lN * 3);
  for (let i = 0; i < lN; i++) { la[i] = Math.floor(i / PER); ls[i] = Math.random(); lr[i * 3] = Math.random(); lr[i * 3 + 1] = Math.random(); lr[i * 3 + 2] = Math.random(); }
  lg.setAttribute('position', new T.BufferAttribute(new Float32Array(lN * 3), 3));
  lg.setAttribute('aLoop', new T.BufferAttribute(la, 1)); lg.setAttribute('aS', new T.BufferAttribute(ls, 1)); lg.setAttribute('aRnd', new T.BufferAttribute(lr, 3));
  const lu = { uTime: { value: 0 }, uR: { value: R }, uScale: uScale,
    uA: { value: loops.map(l => l.A) }, uB: { value: loops.map(l => l.B) }, uH: { value: loops.map(l => l.H) }, uAl: { value: loops.map(() => 0) } };
  const loopMat = new T.ShaderMaterial({ ...addPts, uniforms: lu,
    vertexShader: `attribute float aLoop, aS; attribute vec3 aRnd;
uniform vec3 uA[${NL}], uB[${NL}]; uniform float uH[${NL}], uAl[${NL}], uTime, uR, uScale;
varying float vAl, vHeat;
void main(){
  int i = int(aLoop + .5);
  vec3 A = uA[i]*uR, B = uB[i]*uR, C = normalize(uA[i]+uB[i])*(uR + 2.*uH[i]);
  float s = fract(aS + uTime*(.05 + .08*aRnd.x)), q = 1. - s;
  vec3 p = q*q*A + 2.*q*s*C + s*s*B;
  float arch = sin(3.14159*s);
  p += (aRnd - .5)*.04*(.4 + arch);
  vAl = uAl[i]*(.3 + .7*arch); vHeat = arch;
  vec4 mv = modelViewMatrix*vec4(p, 1.);
  gl_PointSize = uScale*(.018 + .014*arch)/-mv.z;
  gl_Position = projectionMatrix*mv;
}`,
    fragmentShader: `varying float vAl, vHeat; void main(){ ${soft} if (a < .01) discard; gl_FragColor = vec4(mix(vec3(1.,.28,.08), vec3(1.,.8,.5), vHeat), a*vAl*.8); }` });
  const loopPts = new T.Points(lg, loopMat); loopPts.frustumCulled = false; group.add(loopPts);

  /* coronal mass ejection: a cone of plasma that blasts outward and fades */
  const NC = 800, cg = new T.BufferGeometry(), cs = new Float32Array(NC * 3), cr = new Float32Array(NC);
  for (let i = 0; i < NC; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); cs[i * 3] = r * Math.cos(a); cs[i * 3 + 1] = r * Math.sin(a); cs[i * 3 + 2] = rnd(.4, 1); cr[i] = Math.random(); }
  cg.setAttribute('position', new T.BufferAttribute(new Float32Array(NC * 3), 3));
  cg.setAttribute('aSp', new T.BufferAttribute(cs, 3)); cg.setAttribute('aRnd', new T.BufferAttribute(cr, 1));
  const cu = { uT: { value: -1 }, uLife: { value: S.cmeLife }, uR: { value: R }, uScale: uScale,
    uDir: { value: new T.Vector3(1, 0, 0) }, uE1: { value: new T.Vector3(0, 1, 0) }, uE2: { value: new T.Vector3(0, 0, 1) } };
  const cmeMat = new T.ShaderMaterial({ ...addPts, uniforms: cu,
    vertexShader: `attribute vec3 aSp; attribute float aRnd; uniform vec3 uDir, uE1, uE2; uniform float uT, uLife, uR, uScale; varying float vA, vHeat;
void main(){
  float age = max(uT, 0.), f = clamp(age/uLife, 0., 1.);
  vec3 d = normalize(uDir + (uE1*aSp.x + uE2*aSp.y)*(.25 + .35*min(age*.15, 1.)));
  vec3 p = d*(uR*1.02 + (1. - exp(-age*.55))*2.8*aSp.z + .05);
  vA = (uT < 0.) ? 0. : smoothstep(0., .25, age)*pow(1. - f, 1.3); vHeat = 1. - f;
  vec4 mv = modelViewMatrix*vec4(p, 1.);
  gl_PointSize = uScale*(.03 + .05*f + .015*aRnd)/-mv.z;
  gl_Position = projectionMatrix*mv;
}`,
    fragmentShader: `varying float vA, vHeat; void main(){ ${soft} if (a < .01) discard; gl_FragColor = vec4(mix(vec3(1.,.3,.1), vec3(1.,.85,.6), vHeat), a*vA*.75); }` });
  const cmePts = new T.Points(cg, cmeMat); cmePts.frustumCulled = false; group.add(cmePts);

  let nextCme = rnd(2, 4), cmeAge = -1;
  function fireCME() {
    const d = new T.Vector3(Math.random() - .5, (Math.random() - .5) * .6, rnd(-.45, .55)).normalize();   // mostly sideways, so it shows against the sky
    const up = Math.abs(d.y) > .9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
    const e1 = new T.Vector3().crossVectors(d, up).normalize(), e2 = new T.Vector3().crossVectors(d, e1);
    cu.uDir.value.copy(d); cu.uE1.value.copy(e1); cu.uE2.value.copy(e2); cmeAge = 0;
  }

  function update(t, dt) {
    surf.material.uniforms.uTime.value = t; lu.uTime.value = t;
    group.rotation.y += dt * 0.05;
    loops.forEach((l, i) => {
      l.age += dt; if (l.age > l.life) respawn(l, false);
      lu.uH.value[i] = l.H;
      lu.uAl.value[i] = Math.max(0, Math.min(l.age / 1.2, (l.life - l.age) / 1.5, 1));
    });
    nextCme -= dt; if (nextCme <= 0 && cmeAge < 0) { fireCME(); nextCme = rnd(...S.cmeEvery); }
    if (cmeAge >= 0) { cmeAge += dt; if (cmeAge > S.cmeLife) cmeAge = -1; }
    cu.uT.value = cmeAge;
    const flash = cmeAge >= 0 && cmeAge < 1.2 ? Math.sin(cmeAge / 1.2 * Math.PI) : 0;       // brief brightening at launch
    glow.scale.setScalar(S.glow * (1 + .22 * flash));
  }
  function dispose() { group.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); glowTex.dispose(); }
  return { object: group, update, dispose, fireCME };
}
