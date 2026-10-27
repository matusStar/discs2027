/* hero-config.js: every setting for the 3D hero in one place. Edit values freely. */
export const HERO = {
  models: ['debris', 'dvd', 'vinyl', 'system', 'blackhole',
           'belt', 'comets', 'circumbinary', 'pizza', 'dartboard', 'ufo', 'cymbal'],   // order shown; delete / reorder freely
  skyLens: true,       // black hole bends the background stars (false = off)
  bhBright: 1.6,       // brightness of the black hole's disc and dust (1 = old, 2 = much brighter)
  bhRes: 512,          // black hole ray-trace resolution (lower = faster start-up, 384 is fine too)
  hold: 6,             // seconds each model stays
  transition: 1.4,     // seconds to shrink one model and grow the next
  inner: 1.2,          // empty space around the star: inner radius of every disc (0.7 tight, 2 wide)
  cameraZ: 13,         // bigger = everything smaller / more margin
  tilt: 0.32,          // viewing angle of the discs (radians)
  particles: 40000,    // points in the particle models (lower = faster)
  pointSize: 0.04,     // size of each particle
  haze: 0.35,          // 0..1 glow plane around each disc (0 = off)
  envIntensity: 1,     // how strongly shiny models reflect the studio lights
  starLight: 18,       // how strongly the star lights planets
  planet: true,        // planet in the gap of the debris disc
  star: {
    radius: 0.3,
    glow: 8,         // size of the soft glow around the star
    loops: 6,          // magnetic loops (max 8)
    loopHeight: [0.01, 0.2],   // min/max loop height
    loopLife: [5, 10],         // seconds a loop lives
    cmeEvery: [0, 0],         // seconds between coronal mass ejections (min, max)
    cmeLife: 0,                // seconds one ejection takes to fade
  },
};
