"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import HeroModel from "@/components/cinematic/HeroModel";
import CaveEnvironment from "@/components/cinematic/CaveEnvironment";
import { roofProgress } from "@/components/cinematic/caveState";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";


// Scroll progress 0..1, driven by the GSAP timeline in OpeningExperience.
export const openingProgress = { current: 0 };

// Lightning flash for the reveal (0..1), driven by GSAP.
export const revealFlash = { current: 0 };

// Thunder swell (0..1): a slow push-in, faint handheld settle and a lens breath.
export const impactPunch = { current: 0 };

// Eye power: all driven by GSAP (scrub-safe, no time accumulation).
export const eyeCharge = { current: 0 }; // 0..1 energy gathering in the eyes
export const eyePower = { current: 0 }; // 0..1 beam intensity (the blast)
export const eyeBurst = { current: 0 }; // 0..1 progress since the blast fired
// 0 = original close-up, 1 = behind the hero facing the city.
export const worldProgress = { current: 0 };
// 0 = behind the hero, 1 = camera sits in the hero's head (first-person lens).
export const povProgress = { current: 0 };
// 0 = hero's point of view, 1 = end of first-person flight.
export const flightProgress = { current: 0 };
// 0 = final rooftop flight, 1 = fully entered the underground cave.
export const caveProgress = { current: 0 };

// Flight feel -------------------------------------------------------------
// 0..1 smoothed camera speed, measured every frame from the real camera motion.
// Drives rain streaking, air streaks, FOV, lens fringing and the HUD rush lines.
export const flightSpeed = { current: 0 };
// 0..1 take-off burst, driven by the GSAP timeline around the dive into the
// hero's head. Scrub-safe, so it plays forwards and backwards with the scroll.
export const launchBoost = { current: 0 };

/* -------------------------------------------------------------------------- */
/*  Shared state + constants                                                  */
/* -------------------------------------------------------------------------- */

// One set of uniforms shared by every material, updated once per frame.
const U = {
  time: { value: 0 },
  flash: { value: 0 },
};

// Camera velocity (world units / second), shared by the rain + air streaks so
// every drop streaks along its velocity *relative to the camera*.
const CAM_VEL = { value: new THREE.Vector3() };

// Direction to the moon (low, so it stays in frame from the higher camera).
const MOON_DIR = new THREE.Vector3(-0.05, 0.065, -1).normalize();

// Haze colour. Must match the sky's horizon so distant towers melt into it.
const FOG_COLOR = new THREE.Color("#2b3b4f");
const FOG_RANGE = new THREE.Vector2(35, 150);

const HERO_Y = 0.62; // top of the ledge the hero stands on
const LEDGE_Z = -3.3;

// Distant sheet lightning: a double flicker every 13 seconds, first at ~9s.
function flashAt(t: number) {
  const p = t % 13;
  const pulse = (c: number, w: number) => Math.max(0, 1 - Math.abs(p - c) / w);
  return Math.min(
    1,
    pulse(9.0, 0.09) + 0.7 * pulse(9.28, 0.22) + 0.4 * pulse(9.7, 0.3),
  );
}

const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

/* -------------------------------------------------------------------------- */
/*  Portfolio project data                                                    */
/* -------------------------------------------------------------------------- */

type PortfolioProject = {
  id: string;
  number: string;
  title: string;
  category: string;
  description: string;
  details: string;
  stack: string[];
  link?: string;
  x: number;
  z: number;
  height: number;
  style: number;
};
// Spacing: first tower sits well in front of the hero, then one tower
// every 20 units, alternating sides so the flight can slalom across the avenue.
const PORTFOLIO_PROJECTS: PortfolioProject[] = [
  {
    id: "envx",
    number: "01",
    title: "EnvX",
    category: "DEVELOPER TOOLS / CLI",
    description: "Faster, safer drop-in replacement for .env files.",
    details:
      "A single static Go binary that manages project environment variables in one place. Supports plain variables by default, encrypts secrets at rest using a project-local Fernet key, automatically gitignores sensitive files, and injects variables through envx run and envx shell. Installs through npm, Homebrew, or Scoop and starts in approximately 10ms without background daemons.",
    stack: ["Go", "CLI", "Fernet", "npm", "Homebrew", "Scoop"],
    link: "https://github.com/TJ-programmer/envx",
    x: -9,
    z: -36,
    height: 18,
    style: 0,
  },
  {
    id: "studymate",
    number: "02",
    title: "StudyMate",
    category: "EDTECH / AI",
    description: "A local-first AI study assistant.",
    details:
      "An AI-powered study environment where students can upload PDFs, ask questions grounded in document content, and discover related YouTube videos without leaving the application. Uses a local GGUF language model, Qdrant-based retrieval-augmented generation, a FastAPI ingestion and retrieval backend, and a React interface with an integrated PDF viewer.",
    stack: ["React", "FastAPI", "Qdrant", "llama.cpp", "RAG"],
    link: "https://github.com/TJ-programmer/Studymate",
    x: 10,
    z: -68,
    height: 23,
    style: 2,
  },
  {
    id: "smart-ai-gallery",
    number: "03",
    title: "Smart AI Gallery",
    category: "COMPUTER VISION / AI",
    description: "A self-organizing photo gallery powered by AI.",
    details:
      "An AI-powered photo gallery designed to organize image collections automatically using machine-learning features, reducing dependence on manually created folders and making photo libraries easier to explore.",
    stack: ["TypeScript", "React", "Machine Learning"],
    link: "https://github.com/TJ-programmer/smart-ai-gallery",
    x: -11,
    z: -106,
    height: 20,
    style: 1,
  },
  {
    id: "cal-ai",
    number: "04",
    title: "Cal-AI",
    category: "HEALTH / AI",
    description: "Photo-based calorie and nutrition intelligence.",
    details:
      "An AI-assisted nutrition tracker that analyzes meal and workout photos using vision models, verifies food and activity logs, tracks daily calories and macronutrients, and provides personalized coaching notes.",
    stack: ["React", "Node.js", "Express", "MongoDB", "YOLO", "Gemini"],
    link: "https://github.com/TJ-programmer/Cal-AI",
    x: 9,
    z: -144,
    height: 17,
    style: 0,
  },
  {
    id: "euno",
    number: "05",
    title: "Euno",
    category: "PRODUCT / AI",
    description: "Turning attention into curiosity and understanding.",
    details:
      "A knowledge-focused social experience designed to turn moments of attention into meaningful learning.",
    stack: ["React Native", "Expo", "Supabase", "AI"],
    // Add Euno's GitHub URL here when available.
    x: -12,
    z: -182,
    height: 24,
    style: 2,
  },
];
// Fires once the scene has actually rendered a few frames, so shaders are
// compiled and the city is built before the loader lifts.
function ReadySignal() {
  const frames = useRef(0);
  useFrame(() => {
    if (window.__rooftopReady) return;
    if (++frames.current === 40) {
      window.__rooftopReady = true;
      window.dispatchEvent(new Event("rooftop-ready"));
    }
  });
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Sky: gradient, drifting storm clouds, moon, halo, lightning               */
/* -------------------------------------------------------------------------- */

function Sky() {
  const uniforms = useMemo(
    () => ({ uTime: U.time, uFlash: U.flash, uMoon: { value: MOON_DIR } }),
    [],
  );

  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[300, 48, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vDir;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vDir = normalize(wp.xyz - cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform float uFlash;
          uniform vec3 uMoon;
          varying vec3 vDir;
          ${GLSL_NOISE}
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y;

            vec3 horizon = vec3(0.17, 0.23, 0.31);
            vec3 mid     = vec3(0.055, 0.085, 0.13);
            vec3 top     = vec3(0.012, 0.02, 0.04);

            vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            col = mix(col, top, smoothstep(0.15, 0.75, h));

            // city smog below the horizon + a thin warm band at the horizon
            col = mix(col, vec3(0.30, 0.22, 0.18) * 0.7, smoothstep(0.02, -0.12, h) * 0.8);
            col += vec3(0.30, 0.16, 0.07) * 0.22 * exp(-pow((h + 0.01) * 14.0, 2.0));
            col = pow(col, vec3(2.2));

            float m = max(dot(d, uMoon), 0.0);

            // storm clouds, projected on a plane so they converge at the horizon
            vec2 cuv = d.xz / (max(h, 0.0) + 0.32);
            float c1 = fbm(cuv * 1.2 + vec2(uTime * 0.010, 0.0));
            float c2 = fbm(cuv * 2.6 - vec2(uTime * 0.018, 3.0) + 7.0);
            float cloud = smoothstep(0.38, 0.88, c1 * 0.65 + c2 * 0.35)
                        * smoothstep(-0.03, 0.14, h);

            vec3 cloudDark = vec3(0.012, 0.018, 0.03);
            vec3 cloudLit  = vec3(0.16, 0.22, 0.34);
            vec3 cloudCol = mix(cloudDark, cloudLit, pow(m, 10.0) * 0.9 + 0.05);
            col = mix(col, cloudCol, cloud * 0.8);

            // moon disc + halo, dimmed by cloud cover
            float disc = smoothstep(0.99955, 0.99966, m);
            float halo = pow(m, 70.0) * 0.55 + pow(m, 500.0) * 1.4 + pow(m, 12.0) * 0.12;
            vec3 moonCol = vec3(0.75, 0.88, 1.0);
            col += moonCol * (disc * 3.2 * (1.0 - cloud * 0.75) + halo * (1.0 - cloud * 0.35));

            // lightning lights the clouds from within
            col += uFlash * vec3(0.30, 0.38, 0.58) * (0.08 + cloud * 0.9);

            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Signal beam + emblem projected on the clouds                              */
/* -------------------------------------------------------------------------- */

const BEAM_BASE = new THREE.Vector3(24, -3, -58);
const BEAM_TOP = new THREE.Vector3(17, 14, -76);

function makeEmblemTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  // soft elliptical spot of light on the cloud
  ctx.save();
  ctx.translate(512, 256);
  ctx.scale(1, 0.55);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 480);
  g.addColorStop(0, "rgba(200,230,255,0.95)");
  g.addColorStop(0.35, "rgba(120,170,230,0.55)");
  g.addColorStop(1, "rgba(60,100,170,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-512, -512, 1024, 1024);
  ctx.restore();

  // winged emblem, drawn as a symmetric polygon
  const half: [number, number][] = [
    [0, -50], [16, -82], [28, -54],
    [90, -66], [190, -60], [300, -22],
    [350, 22],
    [296, 14], [250, 40],
    [226, 30], [180, 68],
    [150, 56], [100, 96],
    [64, 70], [30, 86], [0, 100],
  ];
  const pts = [
    ...half,
    ...[...half].reverse().map(([x, y]) => [-x, y] as [number, number]),
  ];
  ctx.fillStyle = "rgba(2,4,9,0.92)";
  ctx.beginPath();
  pts.forEach(([x, y], i) =>
    i === 0 ? ctx.moveTo(512 + x, 256 + y) : ctx.lineTo(512 + x, 256 + y),
  );
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SignalBeam() {
  const { mid, quat, len } = useMemo(() => {
    const dir = BEAM_TOP.clone().sub(BEAM_BASE);
    return {
      len: dir.length(),
      quat: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize(),
      ),
      mid: BEAM_BASE.clone().add(BEAM_TOP).multiplyScalar(0.5),
    };
  }, []);

  const tex = useMemo(() => makeEmblemTexture(), []);
  const uniforms = useMemo(() => ({ uTime: U.time }), []);

  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[5.5, 0.35, len, 40, 1, true]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          uniforms={uniforms}
          vertexShader={/* glsl */ `
            varying vec3 vN;
            varying vec3 vV;
            varying float vH;
            void main(){
              vH = uv.y;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vN = normalize(normalMatrix * normal);
              vV = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }
          `}
          fragmentShader={/* glsl */ `
            uniform float uTime;
            varying vec3 vN;
            varying vec3 vV;
            varying float vH;
            void main(){
              float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
              float a = f * smoothstep(0.0, 0.12, vH) * mix(0.55, 0.12, vH);
              a *= 0.92 + 0.08 * sin(uTime * 2.0);
              gl_FragColor = vec4(vec3(0.62, 0.80, 1.0), a * 0.5);
            }
          `}
        />
      </mesh>

      <mesh position={BEAM_TOP}>
        <planeGeometry args={[26, 13]} />
        <meshBasicMaterial
          map={tex}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  City generation                                                           */
/* -------------------------------------------------------------------------- */

type Block = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  seed: number;
};

// Generic instance for props (pyramid roofs, tanks, signs...).
type Inst = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  seed: number;
  color?: [number, number, number];
};

const SIGN_COLORS: [number, number, number][] = [
  [1.0, 0.18, 0.22], // red
  [0.2, 0.9, 1.0], // cyan
  [1.0, 0.25, 0.8], // magenta
  [0.6, 1.0, 0.3], // sickly green
  [1.0, 0.7, 0.2], // amber
];

// Landmark clock tower, right of the hero.
const CLOCK = { x: 19, z: -31, w: 6, top: 9, tierW: 4.6, tierH: 4, roofH: 4 };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Open air around every project tower, so each one reads cleanly.
const PROJECT_CLEAR_X = 5;
const PROJECT_CLEAR_Z = 4;

function nearProject(cx: number, z: number, w: number, d: number) {
  return PORTFOLIO_PROJECTS.some(
    (p) =>
      Math.abs(cx - p.x) < w / 2 + TOWER_W / 2 + PROJECT_CLEAR_X &&
      Math.abs(z - p.z) < d / 2 + TOWER_W / 2 + PROJECT_CLEAR_Z,
  );
}

function buildCity() {
  const rand = mulberry32(1337);
  const blocks: Block[] = [];
  const pyramids: Inst[] = [];
  const cones: Inst[] = [];
  const cyls: Inst[] = [];
  const signs: Inst[] = [];
  const beacons: number[] = [];

  // Final camera position, used to keep the corridor behind the hero low.
  const camY = 8.5;
  const camZ = 24;
  const BOTTOM = -70;

  const pickColor = () =>
    SIGN_COLORS[Math.floor(rand() * SIGN_COLORS.length)];

  /* ---- Clock tower landmark ---- */
  {
    const c = CLOCK;
    const tierTop = c.top + c.tierH;
    blocks.push({ x: c.x, y: (c.top + BOTTOM) / 2, z: c.z, w: c.w, h: c.top - BOTTOM, d: c.w, seed: 0.31 });
    blocks.push({ x: c.x, y: c.top + c.tierH / 2, z: c.z, w: c.tierW, h: c.tierH, d: c.tierW, seed: 0.62 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        blocks.push({
          x: c.x + sx * c.tierW * 0.46,
          y: tierTop + 0.9,
          z: c.z + sz * c.tierW * 0.46,
          w: 0.4,
          h: 1.8,
          d: 0.4,
          seed: rand(),
        });
      }
    }
    pyramids.push({
      x: c.x,
      y: tierTop + c.roofH / 2,
      z: c.z,
      sx: c.tierW * 0.72,
      sy: c.roofH,
      sz: c.tierW * 0.72,
      ry: Math.PI / 4,
      seed: 0.5,
    });
    blocks.push({ x: c.x, y: tierTop + c.roofH + 1.5, z: c.z, w: 0.18, h: 3, d: 0.18, seed: 0.9 });
    beacons.push(c.x, tierTop + c.roofH + 3, c.z);
  }

  /* ---- Layered skyline ---- */
  // [z, half-span, width range, roof height range, depth, tower boost]
  const layers = [
    { z: -20, S: 50, w: [4, 8], top: [-14, 2], depth: 8, boost: 0 },
    { z: -34, S: 66, w: [4, 9], top: [-6, 7], depth: 9, boost: 6 },
    { z: -52, S: 90, w: [5, 11], top: [-2, 12], depth: 10, boost: 10 },
    { z: -76, S: 120, w: [6, 13], top: [2, 17], depth: 12, boost: 11 },
    { z: -110, S: 160, w: [8, 16], top: [6, 26], depth: 14, boost: 14 },
  ];

  layers.forEach((L, li) => {
    let x = -L.S;
    while (x < L.S) {
      const w = L.w[0] + rand() * (L.w[1] - L.w[0]);
      const cx = x + w / 2;
      const z = L.z - rand() * 6;
      const d = L.depth * (0.7 + rand() * 0.6);
      const outer = Math.abs(cx) >= 16;

      // keep the project avenue clear of skyline blocks
      if (nearProject(cx, z, w, d)) {
        x += w * (0.82 + rand() * 0.2);
        continue;
      }

      // leave room for the clock tower
      if (li === 1 && Math.abs(cx - CLOCK.x) < 7) {
        x += w * (0.82 + rand() * 0.2);
        continue;
      }

      let top = L.top[0] + rand() * (L.top[1] - L.top[0]);
      const isTower = outer && L.boost > 0 && rand() < 0.28;
      if (isTower) top += L.boost * (0.5 + rand() * 0.5);

      // Keep the corridor behind the hero low so the moon stays visible.
      const cap = outer ? Infinity : camY + 0.042 * (camZ - z);
      top = Math.min(top, cap);
      const mainTop = top;

      blocks.push({
        x: cx,
        y: (top + BOTTOM) / 2,
        z,
        w,
        h: top - BOTTOM,
        d,
        seed: rand(),
      });

      /* ---- extra architectural detail ---- */

      // Cornice slab crowning the roofline
      if (outer || top + 0.5 <= cap) {
        blocks.push({ x: cx, y: top + 0.2, z, w: w + 0.6, h: 0.4, d: d + 0.6, seed: rand() });
        top += 0.4;
      }

      // Corner buttresses with spiked finials (gothic / deco feel)
      if (li <= 3 && rand() < 0.5) {
        const bh = mainTop + 0.9;
        if (outer || bh + 1.3 <= cap) {
          for (const sx of [-1, 1]) {
            const bx = cx + sx * (w / 2 - 0.1);
            const bz = z + d / 2 + 0.1;
            blocks.push({ x: bx, y: (bh + BOTTOM) / 2, z: bz, w: 0.7, h: bh - BOTTOM, d: 0.7, seed: rand() });
            cones.push({ x: bx, y: bh + 0.65, z: bz, sx: 0.45, sy: 1.3, sz: 0.45, ry: 0, seed: rand() });
          }
        }
      }

      // Fire escapes: stacked platforms, railings, ladder drops
      if (li <= 1 && rand() < 0.4) {
        const fx = cx + (rand() - 0.5) * w * 0.5;
        const fz = z + d / 2 + 0.55;
        for (let k = 0; k < 8; k++) {
          const yy = mainTop - 2 - k * 3.4;
          blocks.push({ x: fx, y: yy, z: fz, w: 2.4, h: 0.1, d: 1.0, seed: rand() });
          blocks.push({ x: fx, y: yy + 0.5, z: fz + 0.48, w: 2.4, h: 0.06, d: 0.06, seed: rand() });
          blocks.push({ x: fx + 1.0, y: yy - 1.7, z: fz, w: 0.08, h: 3.4, d: 0.08, seed: rand() });
        }
      }

      // Wall-mounted AC units and ducts
      if (li <= 2) {
        const n = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          blocks.push({
            x: cx + (rand() - 0.5) * (w - 1),
            y: mainTop - 3 - rand() * 20,
            z: z + d / 2 + 0.25,
            w: 0.9,
            h: 0.55,
            d: 0.5,
            seed: rand(),
          });
        }
      }

      // Art-deco wedding-cake tiers, crowned with a pyramid or finials.
      let tw = w;
      let td = d;
      const tiers = outer && rand() < 0.45 ? 1 + Math.floor(rand() * 3) : 0;
      for (let k = 0; k < tiers; k++) {
        tw *= 0.68;
        td *= 0.7;
        const th = 1.6 + rand() * 3.5;
        blocks.push({ x: cx, y: top + th / 2, z, w: tw, h: th, d: td, seed: rand() });
        top += th;
      }

      if (tiers > 0) {
        if (rand() < 0.55) {
          const ph = 2 + rand() * 3;
          pyramids.push({
            x: cx,
            y: top + ph / 2,
            z,
            sx: tw * 0.72,
            sy: ph,
            sz: td * 0.72,
            ry: Math.PI / 4,
            seed: rand(),
          });
          top += ph;
        } else {
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const fh = 1.2 + rand() * 1.6;
              blocks.push({
                x: cx + sx * tw * 0.46,
                y: top + fh / 2,
                z: z + sz * td * 0.46,
                w: 0.3,
                h: fh,
                d: 0.3,
                seed: rand(),
              });
            }
          }
        }
      } else {
        // Flat-roof clutter: machinery, water tank, vent stacks.
        if (rand() < 0.5) {
          const mh = 0.8 + rand() * 0.8;
          if (top + mh <= cap) {
            blocks.push({
              x: cx + (rand() - 0.5) * w * 0.5,
              y: top + mh / 2,
              z,
              w: w * (0.2 + rand() * 0.2),
              h: mh,
              d: d * 0.3,
              seed: rand(),
            });
          }
        }
        if (rand() < 0.22 && top + 3.6 <= cap) {
          const tx = cx + (rand() - 0.5) * w * 0.4;
          blocks.push({ x: tx - 0.45, y: top + 0.6, z, w: 0.12, h: 1.2, d: 0.12, seed: rand() });
          blocks.push({ x: tx + 0.45, y: top + 0.6, z, w: 0.12, h: 1.2, d: 0.12, seed: rand() });
          cyls.push({ x: tx, y: top + 2.1, z, sx: 0.85, sy: 1.8, sz: 0.85, ry: 0, seed: rand() });
          cones.push({ x: tx, y: top + 3.35, z, sx: 0.9, sy: 0.7, sz: 0.9, ry: 0, seed: rand() });
        }
        if (rand() < 0.3) {
          const vh = 1 + rand() * 1.2;
          if (top + vh <= cap) {
            cyls.push({
              x: cx + (rand() - 0.5) * w * 0.6,
              y: top + vh / 2,
              z: z + (rand() - 0.5) * d * 0.4,
              sx: 0.22,
              sy: vh,
              sz: 0.22,
              ry: 0,
              seed: rand(),
            });
          }
        }

        // Rooftop billboard on posts
        if (li <= 3 && outer && rand() < 0.15) {
          const bw = 4 + rand() * 3;
          const bh = 1.6 + rand() * 0.8;
          const bz = z + d * 0.25;
          blocks.push({ x: cx - bw * 0.35, y: top + 0.7, z: bz - 0.05, w: 0.14, h: 1.4, d: 0.14, seed: rand() });
          blocks.push({ x: cx + bw * 0.35, y: top + 0.7, z: bz - 0.05, w: 0.14, h: 1.4, d: 0.14, seed: rand() });
          signs.push({
            x: cx,
            y: top + 1.4 + bh / 2,
            z: bz,
            sx: bw,
            sy: bh,
            sz: 1,
            ry: 0,
            seed: rand(),
            color: pickColor(),
          });
        }
      }

      // Vertical neon blade sign on the facade
      if (li <= 2 && rand() < 0.4) {
        const sh = 3 + rand() * 4;
        signs.push({
          x: cx + (rand() - 0.5) * w * 0.6,
          y: mainTop - 2.5 - sh / 2 - rand() * 6,
          z: z + d / 2 + 0.2,
          sx: 0.7 + rand() * 0.5,
          sy: sh,
          sz: 1,
          ry: 0,
          seed: rand(),
          color: pickColor(),
        });
      }

      // Lattice antenna mast + blinking beacon on tall towers
      if (outer && (isTower || top > camY + 4)) {
        const sh = 3 + rand() * 5;
        blocks.push({ x: cx, y: top + sh / 2, z, w: 0.22, h: sh, d: 0.22, seed: rand() });
        for (let k = 1; k <= 3; k++) {
          const cw = 1.6 - k * 0.3;
          blocks.push({ x: cx, y: top + (sh * k) / 4, z, w: cw, h: 0.06, d: 0.06, seed: rand() });
          blocks.push({ x: cx, y: top + (sh * k) / 4 + 0.35, z, w: 0.06, h: 0.7, d: cw, seed: rand() });
        }
        cones.push({ x: cx + 0.7, y: top + sh * 0.6, z, sx: 0.5, sy: 0.35, sz: 0.5, ry: 0, seed: rand() });
        beacons.push(cx, top + sh, z);
      }

      x += w * (0.82 + rand() * 0.2);
    }
  });

  return {
    blocks,
    pyramids,
    cones,
    cyls,
    signs,
    beacons: new Float32Array(beacons),
  };
}

/* -------------------------------------------------------------------------- */
/*  Skyline: main towers with a detailed procedural facade shader             */
/* -------------------------------------------------------------------------- */

const PROP_VERT = /* glsl */ `
  attribute float aSeed;
  attribute vec3 aColor;
  varying vec3 vWorld;
  varying vec3 vNW;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec2 vSize;
  varying float vSeed;
  void main(){
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vColor = aColor;
    vUv = uv;
    vSeed = aSeed;
    vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const PROP_FRAG = /* glsl */ `
  uniform vec3 uFog;
  uniform vec2 uFogRange;
  varying vec3 vWorld;
  varying vec3 vNW;
  varying float vSeed;
  ${GLSL_NOISE}
  void main(){
    vec3 n = normalize(vNW);
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - abs(dot(n, V)), 2.2);
    vec3 base = vec3(0.05, 0.065, 0.09) * (0.7 + 0.6 * hash21(vec2(vSeed, 1.3)));
    vec3 col = pow(base, vec3(2.2));
    col += vec3(0.08, 0.13, 0.22) * fres * 0.9 + vec3(0.06, 0.09, 0.14) * max(n.y, 0.0);
    float fogT = smoothstep(uFogRange.x, uFogRange.y, length(cameraPosition - vWorld));
    col = mix(col, uFog, fogT);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SIGN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFog;
  uniform vec2 uFogRange;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec2 vSize;
  varying float vSeed;
  ${GLSL_NOISE}
  void main(){
    vec2 q = vUv * vSize;
    // glyph-like strokes along the long axis + a bright tube border
    float bars = vSize.x > vSize.y
      ? step(0.4, fract(q.x * 1.6 + vSeed * 3.0))
      : step(0.4, fract(q.y * 1.6 + vSeed * 3.0));
    float bd = min(min(q.x, vSize.x - q.x), min(q.y, vSize.y - q.y));
    float border = 1.0 - step(0.12, bd);
    float b = 0.22 + 0.78 * max(bars, border);

    // occasional dead-tube flicker + electrical buzz
    float dead = step(0.985, hash21(vec2(floor(uTime * 8.0), vSeed * 50.0)));
    float buzz = 0.92 + 0.08 * sin(uTime * 40.0 + vSeed * 20.0);

    vec3 col = vColor * b * buzz * (1.0 - dead * 0.85) * 1.25;
    float fogT = smoothstep(uFogRange.x, uFogRange.y, length(cameraPosition - vWorld));
    col = mix(col, uFog, fogT * 0.85);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function InstancedProps({
  items,
  geometry,
  kind,
}: {
  items: Inst[];
  geometry: THREE.BufferGeometry;
  kind: "prop" | "sign";
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const geo = useMemo(() => {
    const g = geometry.clone();
    const seeds = new Float32Array(items.map((i) => i.seed));
    const colors = new Float32Array(items.length * 3);
    items.forEach((it, i) => colors.set(it.color ?? [1, 1, 1], i * 3));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
    return g;
  }, [geometry, items]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, it.ry, 0);
      o.scale.set(it.sx, it.sy, it.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [items]);

  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uFog: { value: FOG_COLOR },
      uFogRange: { value: FOG_RANGE },
    }),
    [],
  );

  if (items.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[geo, undefined, items.length]} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={PROP_VERT}
        fragmentShader={kind === "sign" ? SIGN_FRAG : PROP_FRAG}
        side={kind === "sign" ? THREE.DoubleSide : THREE.FrontSide}
      />
    </instancedMesh>
  );
}

// Backlit clock dial on the landmark tower, with slowly turning hands.
function ClockFace({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uFog: { value: FOG_COLOR },
      uFogRange: { value: FOG_RANGE },
    }),
    [],
  );

  return (
    <mesh position={position}>
      <circleGeometry args={[radius, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main(){
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform vec3 uFog;
          uniform vec2 uFogRange;
          varying vec2 vUv;
          varying vec3 vWorld;

          float seg(vec2 p, vec2 a, vec2 b){
            vec2 pa = p - a, ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            return length(pa - ba * h);
          }
          vec2 dirOf(float a){ return vec2(sin(a), cos(a)); }

          void main(){
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float ang = atan(p.x, p.y);

            float face = 1.0 - smoothstep(0.95, 1.0, r);
            float ring = smoothstep(0.90, 0.94, r) * (1.0 - smoothstep(0.97, 1.0, r));
            float ticks = step(0.985, abs(cos(ang * 6.0))) * step(0.78, r) * step(r, 0.9);

            float minuteA = uTime * 0.12 + 1.0;
            float hourA = minuteA / 12.0 + 2.5;
            float hands = 1.0 - smoothstep(0.025, 0.05, seg(p, vec2(0.0), dirOf(minuteA) * 0.78));
            hands = max(hands, 1.0 - smoothstep(0.035, 0.07, seg(p, vec2(0.0), dirOf(hourA) * 0.5)));

            vec3 glow = vec3(1.0, 0.72, 0.35);
            vec3 col = glow * 1.1 * face * (0.75 + 0.25 * (1.0 - r));
            col *= 1.0 - 0.88 * max(hands, ticks);
            col += glow * 1.8 * ring;

            float fogT = smoothstep(uFogRange.x, uFogRange.y, length(cameraPosition - vWorld));
            col = mix(col, uFog, fogT * 0.8);
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}


type CityBuilding = {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
};

function buildSurroundingCity(): CityBuilding[] {
  const buildings: CityBuilding[] = [];
  let seed = 9173;

  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Dense blocks on both sides of the project avenue.
  for (let z = 18; z >= -228; z -= 5.5) {
    for (const side of [-1, 1]) {
      for (let lane = 0; lane < 5; lane++) {
        const x = side * (15 + lane * 8 + random() * 4);

        // Leave a clear central avenue around project towers.
        if (Math.abs(x) < 15) continue;

        const h =
          lane < 2
            ? 12 + random() * 30
            : 7 + random() * 18;

        const w = 4 + random() * 5;
        const d = 4 + random() * 7;

        buildings.push({
          x,
          z: z - random() * 3,
          w,
          h,
          d,
          color:
            random() > 0.8
              ? "#18283b"
              : random() > 0.45
                ? "#101a29"
                : "#0a111d",
        });
      }
    }
  }

  // Distant high-rise silhouettes create a deeper skyline.
  for (let i = 0; i < 100; i++) {
    const side = random() > 0.5 ? 1 : -1;

    buildings.push({
      x: side * (50 + random() * 65),
      z: 15 - random() * 245,
      w: 5 + random() * 9,
      h: 18 + random() * 65,
      d: 5 + random() * 10,
      color: random() > 0.5 ? "#101b2b" : "#0b1421",
    });
  }

  return buildings;
}


function Skyline() {
  const ref = useRef<THREE.InstancedMesh>(null);

  const city = useMemo(buildCity, []);
  const { blocks } = city;

  const surroundingBuildings = useMemo(
    buildSurroundingCity,
    [],
  );

  const seeds = useMemo(
    () => new Float32Array(blocks.map((b) => b.seed)),
    [blocks],
  );

  const geos = useMemo(
    () => ({
      pyr: new THREE.ConeGeometry(1, 1, 4),
      cone: new THREE.ConeGeometry(1, 1, 12),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
      plane: new THREE.PlaneGeometry(1, 1),
    }),
    [],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const o = new THREE.Object3D();

    blocks.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [blocks]);

  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uFlash: U.flash,
      uFog: { value: FOG_COLOR },
      uFogRange: { value: FOG_RANGE },
    }),
    [],
  );

  return (
    <>
      {/* Extended city ground */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -70.02, -100]}
        receiveShadow
        frustumCulled={false}
      >
        <planeGeometry args={[260, 440]} />
        <meshStandardMaterial
          color="#070b12"
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>

      {/* -------------------------------------------------- */}
      {/* Surrounding city: buildings on both sides          */}
      {/* -------------------------------------------------- */}
      {surroundingBuildings.map((b, i) => (
        <group
          key={i}
          position={[b.x, -70 + b.h / 2, b.z]}
        >
          {/* Main building */}
          <mesh castShadow={false} receiveShadow={false}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial
              color={b.color}
              roughness={0.88}
              metalness={0.18}
            />
          </mesh>

          {/* Slightly raised rooftop */}
          <mesh
            position={[0, b.h / 2 + 0.12, 0]}
            castShadow={false}
          >
            <boxGeometry
              args={[b.w * 1.04, 0.24, b.d * 1.04]}
            />
            <meshStandardMaterial
              color="#182638"
              roughness={0.85}
              metalness={0.2}
            />
          </mesh>

          {/* Blue vertical architectural lighting */}
          {i % 7 === 0 && (
            <mesh
              position={[0, 0, b.d / 2 + 0.025]}
            >
              <boxGeometry
                args={[0.09, b.h * 0.72, 0.035]}
              />
              <meshBasicMaterial
                color="#268bff"
                toneMapped={false}
              />
            </mesh>
          )}

          {/* Occasional rooftop antenna */}
          {i % 19 === 0 && (
            <mesh
              position={[0, b.h / 2 + 0.65, 0]}
            >
              <boxGeometry args={[0.07, 1.1, 0.07]} />
              <meshBasicMaterial
                color="#387dff"
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* -------------------------------------------------- */}
      {/* Original shader-based city                        */}
      {/* -------------------------------------------------- */}
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, blocks.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]}>
          <instancedBufferAttribute
            attach="attributes-aSeed"
            args={[seeds, 1]}
          />
        </boxGeometry>

        <shaderMaterial
          uniforms={uniforms}
          vertexShader={/* glsl */ `
            attribute float aSeed;

            varying vec3 vWorld;
            varying vec3 vN;
            varying vec2 vEdge;
            varying float vSeed;

            void main() {
              vec4 wp =
                modelMatrix * instanceMatrix * vec4(position, 1.0);

              vWorld = wp.xyz;

              vec3 sc = vec3(
                length(instanceMatrix[0].xyz),
                length(instanceMatrix[1].xyz),
                length(instanceMatrix[2].xyz)
              );

              vec3 lp = position * sc;

              vN = normalize(
                mat3(modelMatrix) *
                mat3(instanceMatrix) *
                normal
              );

              bool zFace = abs(normal.z) > 0.5;
              float hh = zFace ? lp.x : lp.z;
              float halfW = (zFace ? sc.x : sc.z) * 0.5;

              vEdge = vec2(
                halfW - abs(hh),
                sc.y * 0.5 - lp.y
              );

              vSeed = aSeed;

              gl_Position =
                projectionMatrix * viewMatrix * wp;
            }
          `}
          fragmentShader={/* glsl */ `
            uniform float uTime;
            uniform float uFlash;
            uniform vec3 uFog;
            uniform vec2 uFogRange;

            varying vec3 vWorld;
            varying vec3 vN;
            varying vec2 vEdge;
            varying float vSeed;

            ${GLSL_NOISE}

            float rectIn(vec2 f, vec4 b) {
              return step(b.x, f.x)
                * step(f.x, b.y)
                * step(b.z, f.y)
                * step(f.y, b.w);
            }

            void main() {
              vec3 n = normalize(vN);
              float isTop = step(0.5, n.y);
              float zFace = step(0.5, abs(n.z));
              float side = 1.0 - isTop;

              float tone = hash21(vec2(vSeed, 3.7));
              float hue = hash21(vec2(vSeed, 8.3));

              float style =
                floor(hash21(vec2(vSeed, 5.5)) * 3.0);

              vec2 uvw = zFace > 0.5
                ? vec2(vWorld.x, vWorld.y)
                : vec2(vWorld.z, vWorld.y);

              vec2 cell = style < 0.5
                ? vec2(1.15, 1.7)
                : (style < 1.5
                    ? vec2(0.75, 2.3)
                    : vec2(2.3, 1.45));

              vec2 g = uvw / cell;
              vec2 id = floor(g);
              vec2 f = fract(g);

              /* Wall */
              vec3 base = mix(
                vec3(0.05, 0.065, 0.09),
                vec3(0.10, 0.125, 0.16),
                tone
              );

              vec3 tint = hue < 0.33
                ? vec3(1.15, 0.92, 0.85)
                : (hue < 0.66
                    ? vec3(0.88, 0.98, 1.1)
                    : vec3(0.9, 1.08, 1.02));

              base *= tint;
              base *= mix(
                0.55,
                1.0,
                smoothstep(-40.0, 8.0, vWorld.y)
              );

              base += isTop * vec3(0.05, 0.065, 0.09);

              float pierEvery = style < 1.5 ? 3.0 : 4.0;

              float pier =
                (1.0 - step(0.5, mod(id.x, pierEvery)))
                * (1.0 - step(0.14, f.x));

              float bandRow =
                1.0 - step(0.5, mod(id.y, 7.0));

              float band = bandRow * (1.0 - step(0.3, f.y));

              float sill =
                step(0.18, f.y)
                * (1.0 - step(0.25, f.y))
                * step(0.15, f.x)
                * step(f.x, 0.85);

              base += vec3(0.035, 0.045, 0.06)
                * (pier + band) * side;

              base += vec3(0.02, 0.026, 0.035)
                * sill * side;

              float pipe =
                1.0 - step(
                  0.014,
                  abs(fract(uvw.x / (7.0 + tone * 5.0)) - 0.5)
                );

              base += vec3(0.03, 0.035, 0.045) * pipe * side;

              float grime = vnoise(
                vec2(uvw.x * 1.7, uvw.y * 0.07 + vSeed * 10.0)
              );

              float stain = smoothstep(
                0.55,
                0.9,
                vnoise(
                  vec2(
                    uvw.x * 0.9 + vSeed * 7.0,
                    uvw.y * 0.03
                  )
                )
              );

              base *= (0.75 + 0.4 * grime)
                * (1.0 - 0.25 * stain);

              vec3 col = pow(base, vec3(2.2));

              /* Moonlit building edges */
              float topEdge =
                (1.0 - smoothstep(0.0, 0.35, vEdge.y)) * side;

              float sideEdge =
                (1.0 - smoothstep(0.0, 0.25, vEdge.x)) * side;

              col += vec3(0.10, 0.16, 0.26)
                * topEdge * 0.45;

              col += vec3(0.05, 0.08, 0.13)
                * sideEdge * 0.4;

              /* Windows */
              vec4 wb = style < 0.5
                ? vec4(0.2, 0.8, 0.25, 0.75)
                : (style < 1.5
                    ? vec4(0.3, 0.7, 0.12, 0.88)
                    : vec4(0.04, 0.96, 0.3, 0.7));

              float mask =
                step(0.9, vEdge.x)
                * step(1.3, vEdge.y)
                * side
                * (1.0 - band);

              float winRect = rectIn(f, wb);
              float win = winRect * mask;

              float mull =
                (1.0 - step(0.03, abs(f.x - 0.5)))
                * (1.0 - step(0.5, style));

              win *= 1.0 - 0.7 * mull;

              float frame =
                (rectIn(f, wb + vec4(-0.07, 0.07, -0.05, 0.05))
                - winRect) * mask;

              float lintel =
                step(wb.w + 0.05, f.y)
                * step(f.y, wb.w + 0.14)
                * step(wb.x - 0.1, f.x)
                * step(f.x, wb.y + 0.1)
                * mask;

              col += vec3(0.02, 0.026, 0.036) * frame;
              col += vec3(0.03, 0.04, 0.055) * lintel;

              float balRow =
                (1.0 - step(0.5, mod(id.y, 5.0)))
                * (style < 1.5 ? 1.0 : 0.0);

              float slab =
                balRow
                * step(f.y, 0.1)
                * step(0.04, f.x)
                * step(f.x, 0.96)
                * mask;

              float bars =
                balRow
                * step(0.1, f.y)
                * step(f.y, 0.4)
                * step(0.55, fract(f.x * 8.0))
                * mask;

              col += vec3(0.03, 0.04, 0.055)
                * (slab + bars * 0.7);

              win *= 1.0 - 0.55 * balRow * step(f.y, 0.4);

              float r = hash21(id + vSeed * 37.0 + zFace * 11.0);

              float density = mix(
                0.06,
                0.3,
                hash21(vec2(vSeed, 9.1))
              );

              float rowLit =
                step(0.9, hash21(vec2(id.y, vSeed * 13.0 + zFace)));

              float lit = max(
                step(1.0 - density, r),
                rowLit * step(0.25, hash21(id + 4.4))
              );

              float blind = step(0.72, hash21(id + 9.1));
              lit *= mix(1.0, step(0.5, f.y), blind);

              float flick =
                step(0.985, hash21(id * 1.7 + 3.0));

              lit *= 1.0 - flick
                * step(0.5, sin(uTime * 2.0 + r * 60.0));

              float cr = hash21(id + 7.7);

              vec3 wc = vec3(1.0, 0.70, 0.36);
              wc = mix(wc, vec3(0.55, 0.78, 1.0), step(0.72, cr));
              wc = mix(wc, vec3(0.65, 1.0, 0.60), step(0.93, cr));
              wc = mix(wc, vec3(1.0, 0.45, 0.25), step(0.97, cr));

              float bright = 0.7 + 0.9 * hash21(id + 2.2);
              vec3 emit = wc * lit * win * bright * 2.0;

              emit += wc * lit * frame * 0.35 * bright;
              emit += wc * lit * 0.03 * mask * (1.0 - winRect);

              col += win * (1.0 - lit)
                * vec3(0.02, 0.03, 0.045)
                * (0.4 + hash21(id + 1.9));

              col += win * (1.0 - lit)
                * vec3(0.03, 0.045, 0.07)
                * smoothstep(
                  0.35,
                  0.5,
                  fract(f.x * 0.8 + f.y * 0.6 + vSeed * 4.0)
                ) * 0.5;

              /* Neon accents */
              vec3 accent =
                hash21(vec2(vSeed, 2.1)) > 0.5
                  ? vec3(0.1, 0.75, 1.0)
                  : vec3(1.0, 0.2, 0.6);

              float trim =
                step(0.62, hue)
                * (1.0 - smoothstep(0.0, 0.1, vEdge.y))
                * step(0.0, vEdge.y)
                * side;

              float strip =
                step(0.85, hue)
                * (1.0 - step(0.05, abs(vEdge.x - 0.35)))
                * side
                * step(1.0, vEdge.y);

              float pulse =
                0.85 + 0.15 * sin(uTime * 1.5 + vSeed * 30.0);

              emit += accent * (trim * 1.8 + strip * 1.2) * pulse;

              /* Atmospheric haze */
              float dist = length(cameraPosition - vWorld);
              float fogT = smoothstep(uFogRange.x, uFogRange.y, dist);

              col = mix(
                col + emit * (1.0 - fogT * 0.7),
                uFog,
                fogT
              );

              col += uFlash * vec3(0.05, 0.07, 0.11)
                * (1.0 - fogT);

              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </instancedMesh>

      {/* Original city props */}
      <InstancedProps
        items={city.pyramids}
        geometry={geos.pyr}
        kind="prop"
      />

      <InstancedProps
        items={city.cones}
        geometry={geos.cone}
        kind="prop"
      />

      <InstancedProps
        items={city.cyls}
        geometry={geos.cyl}
        kind="prop"
      />

      <InstancedProps
        items={city.signs}
        geometry={geos.plane}
        kind="sign"
      />

      {/* Original clock */}
      <ClockFace
        position={[
          CLOCK.x,
          CLOCK.top + CLOCK.tierH / 2,
          CLOCK.z + CLOCK.tierW / 2 + 0.06,
        ]}
        radius={1.6}
      />

      {/* Original city beacons */}
      <Beacons positions={city.beacons} />
    </>
  );
}


function Beacons({ positions }: { positions: Float32Array }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const phases = useMemo(() => {
    const n = positions.length / 3;
    return Float32Array.from({ length: n }, (_, i) => (i * 0.6180339) % 1);
  }, [positions]);
  const uniforms = useMemo(
    () => ({ uTime: U.time, uPx: { value: dpr } }),
    [dpr],
  );

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          attribute float aPhase;
          uniform float uTime;
          uniform float uPx;
          varying float vOn;
          void main(){
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float ph = fract(uTime * 0.45 + aPhase);
            vOn = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.12, 0.3, ph)) + 0.12;
            gl_PointSize = clamp(520.0 / -mv.z, 2.0, 22.0) * uPx;
          }
        `}
        fragmentShader={/* glsl */ `
          varying float vOn;
          void main(){
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vec3(1.0, 0.12, 0.08) * 3.0 * vOn * a, a * vOn);
          }
        `}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mist layers (depth!)                                                      */
/* -------------------------------------------------------------------------- */

function Mist(props: {
  z: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  speed: number;
  color?: string;
}) {
  const { z, y, w, h, opacity, speed, color = "#5d7694" } = props;
  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
      uScale: { value: w * 0.08 },
      uColor: { value: new THREE.Color(color) },
    }),
    [opacity, speed, w, color],
  );

  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, h]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          uniform float uSpeed;
          uniform float uScale;
          uniform vec3 uColor;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            float n = fbm(vec2(vUv.x * uScale + uTime * uSpeed, vUv.y * 2.0 + uTime * uSpeed * 0.3));
            float edge = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.5, vUv.y)
                       * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
            float a = smoothstep(0.30, 0.85, n) * edge * uOpacity;
            gl_FragColor = vec4(uColor, a);
          }
        `}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rain + air streaks                                                        */
/*                                                                            */
/*  Real, camera-relative rain. Thousands of drops fall in world space with   */
/*  their own speed and a gentle wind, and wrap around the camera so the      */
/*  volume never runs out. Each drop is a thin quad stretched along its       */
/*  velocity RELATIVE TO THE CAMERA, so when the camera flies the rain        */
/*  streaks past, which is what sells the feeling of speed.                   */
/*                                                                            */
/*  Two depth layers: a near volume (fine, close drops) and a far volume      */
/*  (huge, faint, gives the city depth). Both are depth-tested, so buildings  */
/*  and the hero occlude them, and drops very close to the lens fade out so   */
/*  nothing ever slaps the face / hero close-ups.                             */
/*                                                                            */
/*  The same shader drives the AirStreaks used during the flight (no fall,    */
/*  only camera motion), faded in by the flight state.                        */
/* -------------------------------------------------------------------------- */

const RAIN_VERT = /* glsl */ `
  attribute vec4 aRand;
  uniform float uTime;
  uniform float uFlash;
  uniform float uFall;
  uniform float uAlpha;
  uniform float uWidth;
  uniform float uNear;
  uniform float uFar;
  uniform float uStreak;
  uniform float uGain;
  uniform float uBoost;
  uniform vec3 uBox;
  uniform vec3 uWind;
  uniform vec3 uCamVel;
  varying float vA;
  varying float vT;
  varying float vS;
  void main(){
    // each drop falls at its own speed
    float sv = 0.8 + 0.5 * aRand.w;
    vec3 vel = vec3(uWind.x, -uFall * sv, uWind.z);

    // world position of the drop, wrapped into a box centred on the camera
    vec3 p = aRand.xyz * uBox + vel * uTime;
    vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 head = cameraPosition + rel;

    // streak along the velocity relative to the camera
    vec3 rv = vel - uCamVel;
    float sp = length(rv);
    vec3 dir = rv / max(sp, 0.0001);

    vec3 toCam = cameraPosition - head;
    float dist = length(toCam);

    float len = sp * uStreak * (1.0 + dist * 0.02);
    vec3 tail = head - dir * len;

    // camera-facing quad, constant ~1px thickness on screen
    vec3 side = cross(dir, toCam);
    side = side / max(length(side), 0.0001);
    float w = dist * uWidth;

    float tt = position.y + 0.5; // 0 = tail, 1 = head
    vec3 wp = mix(tail, head, tt) + side * position.x * w;

    float fade = smoothstep(uNear, uNear * 2.5, dist)
               * (1.0 - smoothstep(uFar * 0.55, uFar, dist));
    float vary = 0.45 + 0.55 * fract(aRand.x * 91.7 + aRand.z * 17.3);
    float speedBoost = 1.0 + clamp(length(uCamVel) * 0.02, 0.0, 1.5) * uBoost;

    vA = uAlpha * fade * vary * uGain * speedBoost * (1.0 + uFlash * 2.0);
    vT = tt;
    vS = position.x * 2.0;

    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vT;
  varying float vS;
  void main(){
    float a = vA * smoothstep(0.0, 0.85, vT) * (1.0 - vS * vS);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

type RainFieldProps = {
  count: number;
  box: [number, number, number];
  fall: number;
  wind?: [number, number, number];
  alpha: number;
  width: number; // multiplier on the ~1px screen-space thickness
  near: number; // drops closer than this fade out (starts fading in at near)
  far: number; // drops further than this are gone
  streak: number; // seconds of motion a drop is stretched over
  seed: number;
  color?: [number, number, number];
  air?: boolean; // flight air streaks: only visible while the camera flies
  renderOrder?: number;
};

function RainField({
  count,
  box,
  fall,
  wind = [1.6, 0, 0.6],
  alpha,
  width,
  near,
  far,
  streak,
  seed,
  color = [0.6, 0.76, 1.0],
  air = false,
  renderOrder = -5,
}: RainFieldProps) {
  const mesh = useRef<THREE.Mesh>(null);

  const geo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.instanceCount = count;

    const rnd = mulberry32(seed);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < rand.length; i++) rand[i] = rnd();
    g.setAttribute("aRand", new THREE.InstancedBufferAttribute(rand, 4));
    return g;
  }, [count, seed]);

  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uFlash: U.flash,
      uCamVel: CAM_VEL,
      uBox: { value: new THREE.Vector3(...box) },
      uWind: { value: new THREE.Vector3(...wind) },
      uColor: { value: new THREE.Vector3(...color) },
      uFall: { value: fall },
      uAlpha: { value: alpha },
      uWidth: { value: 0.0012 * width },
      uNear: { value: near },
      uFar: { value: far },
      uStreak: { value: streak },
      uGain: { value: air ? 0 : 1 },
      uBoost: { value: air ? 0 : 1 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

    useFrame(({ camera }) => {
    if (!air) {
      // rain fades out as the camera enters the Batcave
      uniforms.uGain.value = 1 - sstep(-camera.position.z, 238, 262);
      return;
    }
    const gate = sstep(povProgress.current, 0.35, 0.9);
    const gain = gate * Math.max(flightSpeed.current, launchBoost.current * 0.9);
    uniforms.uGain.value = gain;
    if (mesh.current) mesh.current.visible = gain > 0.01;
  });

  return (
    <mesh ref={mesh} geometry={geo} frustumCulled={false} renderOrder={renderOrder}>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={RAIN_VERT}
        fragmentShader={RAIN_FRAG}
      />
    </mesh>
  );
}

function Rain() {
  return (
    <>
      {/* Far curtain: huge volume, faint, gives the skyline depth */}
      <RainField
        count={3600}
        box={[260, 110, 320]}
        fall={15}
        wind={[1.8, 0, 0.8]}
        alpha={0.16}
        width={1.5}
        near={16}
        far={210}
        streak={0.05}
        seed={7}
      />

      {/* Near rain: finer, brighter drops around the camera */}
      <RainField
        count={2400}
        box={[64, 38, 76]}
        fall={17}
        wind={[1.6, 0, 0.6]}
        alpha={0.2}
        width={1.1}
        near={3.5}
        far={55}
        streak={0.04}
        seed={19}
      />

      {/* Flight air streaks: rushing wind particles, only while flying */}
      <RainField
        air
        count={900}
        box={[46, 30, 80]}
        fall={0}
        wind={[0, 0, 0]}
        alpha={0.55}
        width={1.4}
        near={1.2}
        far={45}
        streak={0.05}
        seed={41}
        color={[0.78, 0.9, 1.0]}
        renderOrder={14}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rooftop (wet roof shader, parapet, props)                                 */
/* -------------------------------------------------------------------------- */

function Rooftop() {
  const roofUniforms = useMemo(
    () => ({
      uMoon: { value: MOON_DIR },
      uFog: { value: FOG_COLOR },
      uFlash: U.flash,
    }),
    [],
  );
  const beaconRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const m = beaconRef.current;
    if (!m) return;
    const on = (clock.elapsedTime * 0.45) % 1 < 0.16;
    m.color.setRGB(1, 0.1, 0.06).multiplyScalar(on ? 7 : 0.4);
  });

  const stone = "#0b1119";
  const pilasters = [-24, -18, -12, -6, 6, 12, 18, 24];

  return (
    <group>
      {/* Wet roof (extends behind the farthest camera position) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 18.8]}>
        <planeGeometry args={[140, 45]} />
        <shaderMaterial
          uniforms={roofUniforms}
          vertexShader={/* glsl */ `
            varying vec3 vWorld;
            void main(){
              vec4 wp = modelMatrix * vec4(position, 1.0);
              vWorld = wp.xyz;
              gl_Position = projectionMatrix * viewMatrix * wp;
            }
          `}
          fragmentShader={/* glsl */ `
            uniform vec3 uMoon;
            uniform vec3 uFog;
            uniform float uFlash;
            varying vec3 vWorld;
            ${GLSL_NOISE}
            void main(){
              vec3 V = normalize(cameraPosition - vWorld);
              vec3 r = reflect(-V, vec3(0.0, 1.0, 0.0));
              float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.0);

              float puddle = smoothstep(0.50, 0.60, fbm(vWorld.xz * 0.22));
              float grain = vnoise(vWorld.xz * 6.0);

              vec3 col = pow(vec3(0.05, 0.06, 0.075) * (0.7 + 0.5 * grain), vec3(2.2));
              float mg = pow(max(dot(r, uMoon), 0.0), 40.0);
              vec3 sky = vec3(0.03, 0.05, 0.08) * (0.4 + fres * 2.2)
                       + vec3(0.45, 0.6, 0.9) * mg * 2.0;

              col = mix(col + vec3(0.004, 0.006, 0.01) * fres * 3.0, sky,
                        puddle * clamp(fres * 2.5 + 0.15, 0.0, 1.0));
              col += uFlash * vec3(0.05, 0.07, 0.11) * (0.3 + puddle);

              float d = length(cameraPosition - vWorld);
              col = mix(col, uFog, smoothstep(40.0, 85.0, d) * 0.6);
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>

      {/* Parapet + cornice + pilasters */}
      <mesh position={[0, 0.275, LEDGE_Z]}>
        <boxGeometry args={[120, 0.55, 0.9]} />
        <meshStandardMaterial color={stone} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.58, LEDGE_Z]}>
        <boxGeometry args={[120, 0.08, 1.1]} />
        <meshStandardMaterial color="#111a26" roughness={0.8} />
      </mesh>
      {pilasters.map((x) => (
        <mesh key={x} position={[x, 0.6, LEDGE_Z]}>
          <boxGeometry args={[0.9, 1.2, 1.2]} />
          <meshStandardMaterial color={stone} roughness={0.9} />
        </mesh>
      ))}

      {/* Foreground silhouettes for depth */}
      <mesh position={[-10, 0.6, 3]}>
        <boxGeometry args={[3.2, 1.2, 2]} />
        <meshStandardMaterial color="#070b11" roughness={1} />
      </mesh>
      <mesh position={[-7.6, 0.35, 5]}>
        <boxGeometry args={[1.6, 0.7, 1.4]} />
        <meshStandardMaterial color="#070b11" roughness={1} />
      </mesh>
      <mesh position={[12, 0.5, 2]}>
        <boxGeometry args={[2.4, 1, 1.6]} />
        <meshStandardMaterial color="#070b11" roughness={1} />
      </mesh>
      <mesh position={[6, 0.2, 5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.12, 8, 10]} />
        <meshStandardMaterial color="#0a0f16" roughness={0.6} metalness={0.4} />
      </mesh>

      {/* Antenna mast with blinking beacon */}
      <mesh position={[13, 5.5, -2.8]}>
        <cylinderGeometry args={[0.05, 0.07, 11, 8]} />
        <meshStandardMaterial color="#0a0f16" roughness={0.7} />
      </mesh>
      <mesh position={[13, 8.5, -2.8]}>
        <boxGeometry args={[2.2, 0.05, 0.05]} />
        <meshStandardMaterial color="#0a0f16" />
      </mesh>
      <mesh position={[13, 6.8, -2.8]}>
        <boxGeometry args={[1.5, 0.05, 0.05]} />
        <meshStandardMaterial color="#0a0f16" />
      </mesh>
      <mesh position={[13, 11, -2.8]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial ref={beaconRef} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hero: procedural fallback Batman (unused while HeroModel is active)       */
/* -------------------------------------------------------------------------- */

const HERO_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uCape;
  varying vec3 vN;
  varying vec3 vView;
  varying vec2 vUv;
  varying float vT;
  void main(){
    vec3 p = position;
    vUv = uv;
    float t = 1.0 - uv.y;   // 0 at the shoulders, 1 at the hem
    vT = t;

    if (uCape > 0.5) {
      float gust = sin(uTime * 0.6) * 0.5 + 0.5;
      float sx = abs(position.x) / 0.5;
      float topMask = 1.0 - smoothstep(0.0, 0.22, t);
      float centre = 1.0 - smoothstep(0.0, 0.4, sx);

      // raised collar behind the neck, then drape over the shoulders
      p.y += centre * topMask * 0.12;
      p.z += centre * topMask * 0.03;
      p.z -= smoothstep(0.3, 1.0, sx) * 0.2 * topMask;
      p.y -= smoothstep(0.3, 1.0, sx) * 0.07 * topMask;

      // asymmetric flare: the wind side opens, the other side hugs the body
      float side = smoothstep(-0.2, 0.2, position.x);
      float flare = mix(t * 0.5 + t * t * 0.15, t * 1.2 + t * t * 0.5, side);
      p.x *= 1.0 + flare;

      // fabric weight: heavy vertical folds that grow toward the hem
      float folds = sin(uv.x * 15.0 + sin(t * 2.5) * 0.7) * 0.040
                  + sin(uv.x * 31.0 - t * 3.0 + uTime * 0.4) * 0.012;
      p.z += (t * 0.10 + t * t * 0.20) + folds * smoothstep(0.04, 0.5, t);

      // wind: slow travelling ripple + sideways push
      float ripple = sin(uTime * 1.4 - t * 4.0 + uv.x * 3.0);
      p.z += ripple * 0.05 * t * t * (0.6 + gust);
      p.x += t * t * (0.35 + 0.35 * gust) + ripple * 0.03 * t;
      p.y += ripple * 0.02 * t;
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const HERO_FRAG = /* glsl */ `
  uniform float uFlash;
  uniform float uCape;
  uniform vec3 uRim;
  uniform vec3 uBase;
  varying vec3 vN;
  varying vec3 vView;
  varying vec2 vUv;
  varying float vT;
  void main(){
    if (uCape > 0.5) {
      // pointed bat-wing scalloped hem
      float s = 0.98 - 0.13 * pow(abs(sin(vUv.x * 15.70796)), 0.55);
      if (vT > s) discard;
    }

    vec3 n = normalize(vN);
    if (uCape > 0.5) {
      // faceted normals read as cloth folds
      n = normalize(cross(dFdx(vView), dFdy(vView)));
    }
    n = faceforward(n, vView, n);

    vec3 V = normalize(-vView);
    float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.4);
    float top = max(n.y, 0.0);

    // moon from behind-left: soft key + a wet-suit specular glint
    vec3 L = normalize(vec3(-0.35, 0.7, -0.6));
    float key = pow(max(dot(n, L), 0.0), 2.5);
    float spec = pow(max(dot(n, normalize(L + V)), 0.0), 18.0);

    vec3 col = uBase;
    col += uRim * (fres * 0.8 + top * 0.10 + key * 0.18 + spec * 0.35);
    col *= 1.0 - vT * 0.25 * uCape;
    col += uFlash * uRim * 0.5 * fres;
    gl_FragColor = vec4(col, 1.0);
  }
`;

type V3 = [number, number, number];

/* Small helper so every body part is one line. */
function Part({
  g,
  m,
  position,
  rotation,
  scale,
}: {
  g: THREE.BufferGeometry;
  m: THREE.Material;
  position?: V3;
  rotation?: V3;
  scale?: V3;
}) {
  return (
    <mesh
      geometry={g}
      material={m}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
}

export function Hero() {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  const { M, G } = useMemo(() => {
    const rim = { value: new THREE.Color("#9cc4ff").multiplyScalar(1.25) };
    const make = (isCape: number, base: V3) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: U.time,
          uFlash: U.flash,
          uRim: rim,
          uCape: { value: isCape },
          uBase: { value: new THREE.Vector3(...base) },
        },
        vertexShader: HERO_VERT,
        fragmentShader: HERO_FRAG,
        side: THREE.DoubleSide,
      });

    // Profiles are [radius, height], bottom to top, closed on the axis.
    const L = (pts: [number, number][], seg = 24) =>
      new THREE.LatheGeometry(
        pts.map(([r, y]) => new THREE.Vector2(r, y)),
        seg,
      );

    return {
      M: {
        suit: make(0, [0.05, 0.06, 0.075]), // charcoal-grey armoured suit
        black: make(0, [0.006, 0.008, 0.012]), // cowl, gauntlets, boots, trunks
        gold: make(0, [0.16, 0.11, 0.03]), // utility belt
        cape: make(1, [0.0025, 0.0035, 0.007]), // near-black cloth
      },
      G: {
        sph: new THREE.SphereGeometry(1, 20, 14),
        box: new THREE.BoxGeometry(1, 1, 1),
        cone: new THREE.ConeGeometry(1, 1, 4),
        torus: new THREE.TorusGeometry(1, 0.12, 8, 32),
        // Athletic leg: ankle, calf bulge, knee, quad sweep, hip.
        leg: L(
          [
            [0, 0], [0.05, 0.01], [0.06, 0.1], [0.085, 0.24], [0.088, 0.3],
            [0.07, 0.46], [0.082, 0.52], [0.115, 0.66], [0.138, 0.8],
            [0.14, 0.93], [0, 0.95],
          ],
          22,
        ),
        // V-taper torso: narrow waist, deep chest, wide traps.
        torso: L(
          [
            [0, 0], [0.19, 0.01], [0.2, 0.1], [0.225, 0.24], [0.275, 0.4],
            [0.305, 0.5], [0.3, 0.57], [0.2, 0.62], [0, 0.63],
          ],
          30,
        ),
        neck: L(
          [
            [0, 0], [0.22, 0], [0.17, 0.035], [0.11, 0.09], [0.085, 0.15],
            [0.085, 0.2], [0, 0.2],
          ],
          20,
        ),
        // elbow (y=0) to shoulder (y=0.42)
        upper: L(
          [
            [0, 0], [0.052, 0], [0.058, 0.06], [0.07, 0.2], [0.076, 0.32],
            [0.066, 0.4], [0, 0.42],
          ],
          16,
        ),
        // fist end (y=0) to elbow (y=0.37)
        fore: L(
          [
            [0, 0], [0.04, 0], [0.05, 0.06], [0.046, 0.12], [0.06, 0.17],
            [0.07, 0.28], [0.056, 0.36], [0, 0.37],
          ],
          16,
        ),
      },
    };
  }, []);

  // Quiet life: breathing, a slow turn of the head.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (torso.current) {
      torso.current.scale.y = 1 + Math.sin(t * 1.3) * 0.004;
      torso.current.rotation.z = -0.02 + Math.sin(t * 0.5) * 0.004;
    }
    if (head.current) {
      head.current.rotation.y =
        0.1 + Math.sin(t * 0.2) * 0.05 + Math.sin(t * 0.07) * 0.04;
    }
  });

  const P = 0.95; // pelvis pivot height; upper-body parts are placed relative to it

  return (
    <group position={[0, HERO_Y, LEDGE_Z]} rotation={[0, 0.05, 0]} scale={1.25}>
      {/* Legs + boots: planted, shoulder-width, left foot a touch forward */}
      {[-1, 1].map((s) => {
        const lz = s < 0 ? -0.06 : 0.02;
        return (
          <group key={s} position={[s * 0.115, 0, lz]} rotation={[0, s * 0.12, 0]}>
            <Part g={G.leg} m={M.suit} />
            {/* knee guard */}
            <Part g={G.sph} m={M.black} position={[0, 0.5, -0.055]} scale={[0.07, 0.085, 0.045]} />
            {/* armoured boot: shin + foot + toe cap + cuff */}
            <Part g={G.leg} m={M.black} scale={[1.08, 0.42, 1.08]} />
            <Part g={G.sph} m={M.black} position={[0, 0.05, -0.06]} scale={[0.082, 0.05, 0.18]} />
            <Part g={G.box} m={M.black} position={[0, 0.03, 0.04]} scale={[0.1, 0.06, 0.07]} />
            <Part
              g={G.torus}
              m={M.black}
              position={[0, 0.4, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[0.1, 0.1, 0.9]}
            />
            {/* boot fins */}
            {[0, 1, 2].map((i) => (
              <Part
                key={i}
                g={G.box}
                m={M.black}
                position={[s * 0.1, 0.12 + i * 0.07, -0.01]}
                rotation={[0.35, 0, 0]}
                scale={[0.012, 0.045, 0.1]}
              />
            ))}
          </group>
        );
      })}

      {/* Pelvis */}
      <group position={[0, P, 0]} rotation={[0, 0.05, 0.02]}>
        <Part g={G.sph} m={M.black} scale={[0.255, 0.12, 0.165]} />

        {/* Utility belt: gold band, buckle, pouches */}
        <Part
          g={G.torus}
          m={M.gold}
          position={[0, 0.06, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.215, 0.165, 0.95]}
        />
        <Part g={G.box} m={M.gold} position={[0, 0.06, -0.15]} scale={[0.07, 0.06, 0.03]} />
        {[-1, 1].map((s) =>
          [0.07, 0.13].map((x, k) => (
            <Part
              key={`${s}${k}`}
              g={G.box}
              m={M.gold}
              position={[s * (x + 0.04), 0.045, -0.14 + k * 0.02]}
              rotation={[0, s * k * 0.4, 0]}
              scale={[0.05, 0.075, 0.04]}
            />
          )),
        )}
        {/* rear belt pouch */}
        <Part g={G.box} m={M.gold} position={[0, 0.05, 0.16]} scale={[0.12, 0.07, 0.05]} />

        {/* Torso: counter-rotated against the hips, leaning slightly forward */}
        <group ref={torso} rotation={[-0.04, -0.04, -0.02]}>
          <Part g={G.torso} m={M.suit} position={[0, 0.92 - P, 0]} scale={[1.08, 1, 0.64]} />

          {/* armoured spine plates + scapular ridges */}
          {[0, 1, 2, 3, 4].map((i) => (
            <Part
              key={i}
              g={G.box}
              m={M.black}
              position={[0, 0.98 - P + i * 0.1, 0.1 - i * 0.004]}
              scale={[0.05, 0.035, 0.035]}
            />
          ))}
          {[-1, 1].map((s) => (
            <Part
              key={s}
              g={G.sph}
              m={M.black}
              position={[s * 0.13, 1.28 - P, 0.1]}
              rotation={[0, 0, s * 0.35]}
              scale={[0.1, 0.17, 0.045]}
            />
          ))}

          <Part g={G.neck} m={M.suit} position={[0, 1.5 - P, 0]} scale={[1.05, 1, 0.75]} />

          {/* Arms: pauldrons, relaxed bend, gauntlets with blade fins, clenched fists */}
          {[-1, 1].map((s) => (
            <group key={s}>
              <Part g={G.sph} m={M.black} position={[s * 0.33, 1.5 - P, 0]} scale={[0.11, 0.095, 0.1]} />
              <group position={[s * 0.375, 1.48 - P, 0]} rotation={[0.08, 0, s * 0.1]}>
                <Part g={G.upper} m={M.suit} position={[0, -0.42, 0]} />
                <group position={[0, -0.42, 0]} rotation={[0.28, 0, 0]}>
                  <Part g={G.fore} m={M.black} position={[0, -0.37, 0]} />
                  <Part g={G.sph} m={M.black} position={[0, -0.41, -0.005]} scale={[0.06, 0.075, 0.065]} />
                  {[0, 1, 2].map((i) => (
                    <Part
                      key={i}
                      g={G.box}
                      m={M.black}
                      position={[s * 0.07, -0.14 - i * 0.07, 0.065]}
                      rotation={[0, 0, s * 0.3]}
                      scale={[0.012, 0.05, 0.17]}
                    />
                  ))}
                </group>
              </group>
            </group>
          ))}

          {/* Head: black cowl, strong jaw, tall pointed ears, head bowed over the city */}
          <group ref={head} position={[0, 1.7 - P, 0]} rotation={[-0.12, 0.1, 0]}>
            <Part g={G.sph} m={M.black} position={[0, 0.12, 0]} scale={[0.1, 0.125, 0.118]} />
            <Part g={G.sph} m={M.black} position={[0, 0.03, -0.035]} scale={[0.082, 0.08, 0.09]} />
            <Part g={G.box} m={M.black} position={[0, -0.01, -0.07]} scale={[0.1, 0.05, 0.06]} />
            {[-1, 1].map((s) => (
              <Part
                key={s}
                g={G.cone}
                m={M.black}
                position={[s * 0.062, 0.32, 0.02]}
                rotation={[0.16, Math.PI / 4, -s * 0.1]}
                scale={[0.034, 0.26, 0.026]}
              />
            ))}
          </group>
        </group>
      </group>

      {/* Heavy cape with pointed bat-wing hem */}
      <mesh position={[0, 0.88, 0.2]}>
        <planeGeometry args={[1.08, 1.7, 30, 44]} />
        <primitive object={M.cape} attach="material" />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hero accent lights: cool edge light + city-side kick + front face fill    */
/* -------------------------------------------------------------------------- */

const sstep = (x: number, a: number, b: number) =>
  THREE.MathUtils.smoothstep(x, a, b);

function HeroLights() {
  const spot = useRef<THREE.SpotLight>(null);
  const kick = useRef<THREE.PointLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const endFill = useRef<THREE.PointLight>(null);

  // The spot's target must live in the scene graph or it aims at the origin.
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 2, LEDGE_Z);
    return o;
  }, []);

  useFrame(() => {
    const flash = U.flash.value;
    const p = THREE.MathUtils.clamp(openingProgress.current, 0, 1);

    // Faint front fill that only fades in for the face close-up, so the eyes
    // and cowl read once the camera has orbited to the front.
    const front = sstep(p, 0.58, 0.76);

    // Lightning briefly lifts every accent light.
    if (spot.current) spot.current.intensity = 90 * (1 + flash * 1.4);
    if (kick.current) kick.current.intensity = 12 * (1 + flash * 1.4);
    if (fill.current) fill.current.intensity = front * (10 + flash * 60);
    if (endFill.current) endFill.current.intensity = sstep(roofProgress.current, 0, 0.3) * (28 + flash * 60);
  });

  return (
    <>
      <primitive object={target} />

      {/* Cool cinematic edge light */}
      <spotLight
        ref={spot}
        position={[-4, 6, 1]}
        target={target}
        color="#8bbcff"
        intensity={90}
        angle={0.7}
        penumbra={0.8}
        distance={18}
      />

      {/* Subtle highlight from the city side */}
      <pointLight
        ref={kick}
        position={[3, 2.8, -1.5]}
        color="#d5e7ff"
        intensity={12}
        distance={7}
      />

      {/* Face fill for the close-up (starts at 0, driven by scroll) */}
      <pointLight
        ref={fill}
        position={[-0.9, 3.2, -6.2]}
        color="#9fc4ff"
        intensity={0}
        distance={9}
      />

      <pointLight
        ref={endFill}
        position={[5.5, 3.4, 1.5]}
        color="#9fc4ff"
        intensity={0}
        distance={14}
      />
      
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Camera constants                                                          */
/* -------------------------------------------------------------------------- */

// Tune these to match your HeroModel.
const BACK_Y = HERO_Y + 1.4; // look target while behind the hero
const EYE_Y = HERO_Y + 4; // eye line for the close-up
const FRONT_Y = HERO_Y + 3.4; // look target for the front bio shot (higher = less waist/legs)
const FACE_SHIFT = -0.3; // slides the face left so text can sit to its right
const ORBIT_R0 = 7.5; // orbit radius when the orbit starts (behind the hero)
const ORBIT_R1 = 3.1; // orbit radius at the front (closer = tighter upper-body shot)
const FACE_R = 1.65; // final camera distance from the face
const EYE_GAP = 0.07; // half distance between the eyes (world units)
const EYE_FWD = 0.12; // how far the eyes sit in front of the head centre (toward the camera)

// Eye height used by the power effect. If your HeroModel exports a measured
// `heroMetrics`, delete this line and import it from HeroModel instead.
const heroMetrics = { eyeY: EYE_Y };

/* ---- City-facing shot, hero point of view, and flight path ---- */

// City-facing shot: camera sits behind the hero and looks down the project avenue.
const WORLD_POS = new THREE.Vector3(0, 4.8, 8.5);
const WORLD_LOOK = new THREE.Vector3(0, 12, -55);

// Hero POV: the camera sits at his eye line, a hair in front of the head so the
// cowl never fills the lens, looking out at the city.
// Tune POV_Y / POV_Z to your HeroModel (POV_Y should match its eye height).
const POV_Y = heroMetrics.eyeY;
const POV_Z = LEDGE_Z - 0.45;
const POV_POS = new THREE.Vector3(0, POV_Y, POV_Z);
const POV_LOOK = new THREE.Vector3(0, POV_Y - 0.35, -60);

// The hero is hidden once the camera is this far into the POV transition, so
// the lens never shows the inside of the model.
const POV_HERO_HIDE_AT = 0.9;

// Rooftop-skimming flight. Generated from PORTFOLIO_PROJECTS, so moving or
// resizing a tower moves the flight with it.
const FLIGHT_SIDE = 11.0; // keep the camera safely outside each tower footprint
const FLIGHT_CLEARANCE = 10.0; // clear crowns, masts, and roof-level geometry

function buildFlightCurve() {
  const first = PORTFOLIO_PROJECTS[0];
  const last = PORTFOLIO_PROJECTS[PORTFOLIO_PROJECTS.length - 1];

  const pts: THREE.Vector3[] = [
    POV_POS.clone(),
    // lift-off: climb out of the hero's eyes toward roof height
    new THREE.Vector3(0.5, 8, first.z * 0.28),
    new THREE.Vector3(-1.5, 14.5, first.z * 0.55),
  ];

  PORTFOLIO_PROJECTS.forEach((p) => {
    // fly over the city-centre side of the roof (clutter sits on the outer side)
    const inner = p.x < 0 ? 1 : -1;
    const x = p.x + inner * FLIGHT_SIDE;
    const y = p.height + FLIGHT_CLEARANCE;
    pts.push(
      new THREE.Vector3(x, y + 2.0, p.z + 10), // come in over the front edge
      new THREE.Vector3(x, y, p.z), // skim the rooftop
      new THREE.Vector3(x, y + 1.0, p.z - 10), // leave over the back edge
    );
  });

  pts.push(new THREE.Vector3(-2, last.height + 8, last.z - 22));
  return new THREE.CatmullRomCurve3(pts, false, "centripetal");
}

const FLIGHT_CURVE = buildFlightCurve();

// The cave path begins at the exact endpoint of the rooftop flight. It then
// descends through the entrance tunnel and opens into the underground chamber.
function buildCaveCurve() {
  const flightEnd = FLIGHT_CURVE.getPointAt(1);
  return new THREE.CatmullRomCurve3(
    [
      flightEnd,
      new THREE.Vector3(-0.8, 27, -224),
      new THREE.Vector3(0, 18, -250),
      new THREE.Vector3(0, 11, -278),
      new THREE.Vector3(0, 8.5, -310),
      new THREE.Vector3(0, 9, -340),
      new THREE.Vector3(0, 11, -370),
      new THREE.Vector3(0, 12, -390),
    ],
    false,
    "centripetal",
  );
}

const CAVE_CURVE = buildCaveCurve();

/* -------------------------------------------------------------------------- */
/*  EYE POWER: charge-up -> anime-style beam blast                            */
/*                                                                            */
/*  Everything here is a pure function of eyeCharge / eyePower / eyeBurst     */
/*  (all driven by the scrubbed GSAP timeline), so it plays correctly both    */
/*  forwards and backwards while scrolling.                                   */
/* -------------------------------------------------------------------------- */

const ARCS = 16;
const SEGS = 9;
const BEAM_LEN = 60;
const PARTICLES = 260;

const easeOutCubic = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);

// Camera-facing star flare: core + 6/10-point rays + anamorphic horizontal streak.
const FLARE_VERT = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const FLARE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float ang = atan(p.y, p.x);

    float core   = exp(-r * r * 22.0);
    float glow   = exp(-r * 3.6) * 0.55;
    float rays   = pow(abs(cos(ang * 3.0 + uTime * 1.6)), 26.0) * exp(-r * 2.3);
    float rays2  = pow(abs(cos(ang * 5.0 - uTime * 2.8)), 44.0) * exp(-r * 3.2);
    float streak = exp(-abs(p.y) * 46.0) * exp(-abs(p.x) * 3.2);

    float edge = smoothstep(1.0, 0.75, r);
    float a = (core * 2.2 + glow + rays * 0.9 + rays2 * 0.6 + streak * 1.5) * uPower * edge;

    vec3 c = mix(vec3(0.22, 0.58, 1.0), vec3(1.0), clamp(core * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(c * a * 2.0, a);
  }
`;

// Energy beam: travelling front, scrolling bands, noisy shimmer.
const BEAM_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec2 vUv;
  void main(){
    vH = uv.y;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uReach;
  uniform float uLayer;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec2 vUv;
  ${GLSL_NOISE}
  void main(){
    float dist = 1.0 - vH;               // 0 at the eye, 1 at the far end
    if (dist > uReach) discard;

    float head = smoothstep(uReach, uReach - 0.1, dist);

    float rimP = uLayer < 0.5 ? 0.7 : (uLayer < 1.5 ? 1.4 : 2.2);
    float rim = pow(abs(dot(normalize(vN), normalize(vV))), rimP);

    float bands = 0.62 + 0.38 * sin(dist * 140.0 - uTime * 150.0);
    float noise = vnoise(vec2(vUv.x * 10.0, dist * 30.0 - uTime * 70.0));
    float near  = mix(0.4, 1.0, vH);

    float a = rim * bands * (0.55 + 0.9 * noise) * near * uPower * (0.5 + 0.5 * head);

    vec3 colA = uLayer < 0.5 ? vec3(1.0)
              : (uLayer < 1.5 ? vec3(0.42, 0.82, 1.0) : vec3(0.15, 0.4, 1.0));
    float gain = uLayer < 0.5 ? 3.2 : (uLayer < 1.5 ? 1.7 : 0.55);

    gl_FragColor = vec4(colA * gain * a, a);
  }
`;

// Energy particles: spiral into the eyes while charging, explode out on fire.
const PART_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute float aSeed;
  attribute float aEye;
  uniform float uCharge;
  uniform float uBurst;
  uniform float uGap;
  uniform float uPx;
  varying float vA;
  void main(){
    float s = aSeed;
    float rad = mix(0.3 + s * 0.9, 0.0, pow(uCharge, 1.5 + s));
    vec3 p = aDir * rad;

    float ang = uCharge * (4.0 + s * 8.0);
    float ca = cos(ang), sa = sin(ang);
    p.xy = mat2(ca, -sa, sa, ca) * p.xy;

    // blast: fly outward and toward the camera (-z)
    p += aDir * uBurst * (0.8 + s * 4.0);
    p.z -= uBurst * (1.5 + s * 6.0);
    p.x += aEye * uGap;

    vA = smoothstep(0.0, 0.25, uCharge) * (1.0 - smoothstep(0.0, 1.0, uBurst));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((0.6 + s) * 9.0 / max(-mv.z, 0.2) * uPx, 1.0, 42.0);
  }
`;

const PART_FRAG = /* glsl */ `
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    gl_FragColor = vec4(vec3(0.5, 0.85, 1.0) * 2.5 * a, a);
  }
`;

function EyePower() {
  const dpr = useThree((s) => s.viewport.dpr);

  const root = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const arcGeo = useRef<THREE.BufferGeometry>(null);
  const arcMat = useRef<THREE.LineBasicMaterial>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const lastArc = useRef(0);

  const arcPos = useMemo(() => new Float32Array(ARCS * SEGS * 2 * 3), []);

  // Shared uniform objects (updated every frame).
  const flareU = useMemo(
    () => ({ uTime: U.time, uPower: { value: 0 }, uSize: { value: 0.3 } }),
    [],
  );

  const beamShared = useMemo(
    () => ({ uTime: U.time, uPower: { value: 0 }, uReach: { value: 0 } }),
    [],
  );

  // core / body / haze
  const beamLayers = useMemo(
    () => [
      { layer: 0, rt: 0.012, rb: 0.16 },
      { layer: 1, rt: 0.04, rb: 0.5 },
      { layer: 2, rt: 0.1, rb: 1.5 },
    ],
    [],
  );
  const beamUniforms = useMemo(
    () => beamLayers.map((l) => ({ ...beamShared, uLayer: { value: l.layer } })),
    [beamLayers, beamShared],
  );

  // Particle attributes
  const particles = useMemo(() => {
    const pos = new Float32Array(PARTICLES * 3); // unused, required by Points
    const dir = new Float32Array(PARTICLES * 3);
    const seed = new Float32Array(PARTICLES);
    const eye = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      dir[i * 3] = r * Math.cos(th);
      dir[i * 3 + 1] = r * Math.sin(th);
      dir[i * 3 + 2] = u;
      seed[i] = Math.random();
      eye[i] = i % 2 === 0 ? -1 : 1;
    }
    return { pos, dir, seed, eye };
  }, []);

  const partUniforms = useMemo(
    () => ({
      uCharge: { value: 0 },
      uBurst: { value: 0 },
      uGap: { value: EYE_GAP },
      uPx: { value: dpr },
    }),
    [dpr],
  );

  useFrame(({ clock }) => {
    const c = eyeCharge.current;
    const p = eyePower.current;
    const b = eyeBurst.current;
    const t = clock.elapsedTime;
    const g = root.current;
    if (!g) return;

    g.visible = c > 0.001 || p > 0.001;
    if (!g.visible) return;

    // Follow the eye height
    g.position.set(0, heroMetrics.eyeY, LEDGE_Z - EYE_FWD);

    // Flicker on top of the curves
    const flick = 0.9 + 0.1 * Math.sin(t * 70) + 0.06 * Math.sin(t * 31);
    const fire = p * flick;
    const charging = c * (0.8 + 0.2 * Math.sin(t * 42));

    // Eye flares: soft build-up, then a huge star-burst on fire
    flareU.uPower.value = Math.max(charging * 0.6, fire * 1.3);
    flareU.uSize.value = 0.22 + c * 0.3 + fire * 1.5;

    // Beams: front travels outward quickly after the strike
    beamShared.uPower.value = fire;
    beamShared.uReach.value = easeOutCubic(b / 0.15);

    // Face light
    if (light.current) light.current.intensity = c * 2 + fire * 12;

    // Particles
    partUniforms.uCharge.value = c;
    partUniforms.uBurst.value = b;

    // Shockwave rings (two, slightly staggered)
    rings.current.forEach((m, i) => {
      if (!m) return;
      const rb = THREE.MathUtils.clamp((b - i * 0.08) / (1 - i * 0.08), 0, 1);
      m.visible = rb > 0 && rb < 1;
      if (!m.visible) return;
      m.scale.setScalar(0.15 + easeOutCubic(rb) * (8 + i * 4));
      (m.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - rb, 2) * (i === 0 ? 1 : 0.6);
    });

    // Crackling lightning arcs around the face (regenerate ~30x per second)
    const arcAmt = THREE.MathUtils.clamp(c * 0.35 + p, 0, 1);
    if (arcMat.current) arcMat.current.opacity = arcAmt;
    if (arcAmt > 0.05 && t - lastArc.current > 0.033 && arcGeo.current) {
      lastArc.current = t;
      let k = 0;
      for (let a = 0; a < ARCS; a++) {
        const side = a % 2 === 0 ? -1 : 1;
        let x = side * EYE_GAP;
        let y = 0;
        let z = 0;
        let dx = (Math.random() - 0.5) * 2 + side * 0.8;
        let dy = (Math.random() - 0.3) * 1.6;
        let dz = (Math.random() - 0.6) * 1.4;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
        const step = (0.08 + Math.random() * 0.12) * (0.4 + p * 1.6 + c * 0.2);
        for (let s = 0; s < SEGS; s++) {
          arcPos[k++] = x; arcPos[k++] = y; arcPos[k++] = z;
          x += dx * step + (Math.random() - 0.5) * step * 1.2;
          y += dy * step + (Math.random() - 0.5) * step * 1.2;
          z += dz * step + (Math.random() - 0.5) * step * 1.2;
          arcPos[k++] = x; arcPos[k++] = y; arcPos[k++] = z;
        }
      }
      const attr = arcGeo.current.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      {/* Light that the eyes throw onto the cowl / face */}
      <pointLight ref={light} position={[0, 0.02, -0.5]} color="#7fc4ff" intensity={0} distance={7} />

      {/* Beams: core + body + haze per eye, diverging slightly */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * EYE_GAP, 0, 0]} rotation={[0, -s * 0.05, 0]}>
          {beamLayers.map((l, i) => (
            <mesh
              key={l.layer}
              position={[0, 0, -BEAM_LEN / 2]}
              rotation={[Math.PI / 2, 0, 0]}
              renderOrder={12}
            >
              <cylinderGeometry args={[l.rt, l.rb, BEAM_LEN, 28, 1, true]} />
              <shaderMaterial
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
                uniforms={beamUniforms[i]}
                vertexShader={BEAM_VERT}
                fragmentShader={BEAM_FRAG}
              />
            </mesh>
          ))}
        </group>
      ))}

      {/* Eye flares (billboarded, always on top) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * EYE_GAP, 0, -0.03]} renderOrder={20}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            uniforms={flareU}
            vertexShader={FLARE_VERT}
            fragmentShader={FLARE_FRAG}
          />
        </mesh>
      ))}

      {/* Energy particles */}
      <points frustumCulled={false} renderOrder={18}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.pos, 3]} />
          <bufferAttribute attach="attributes-aDir" args={[particles.dir, 3]} />
          <bufferAttribute attach="attributes-aSeed" args={[particles.seed, 1]} />
          <bufferAttribute attach="attributes-aEye" args={[particles.eye, 1]} />
        </bufferGeometry>
        <shaderMaterial
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          uniforms={partUniforms}
          vertexShader={PART_VERT}
          fragmentShader={PART_FRAG}
        />
      </points>

      {/* Shockwave rings */}
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          position={[0, 0, -0.1 - i * 0.05]}
          visible={false}
          renderOrder={15}
        >
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial
            color={new THREE.Color(1.5, 2.6, 4)}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Lightning arcs */}
      <lineSegments frustumCulled={false} renderOrder={16}>
        <bufferGeometry ref={arcGeo}>
          <bufferAttribute attach="attributes-position" args={[arcPos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={arcMat}
          color={new THREE.Color(1.8, 3.0, 5.0)}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Portfolio project towers                                                  */
/* -------------------------------------------------------------------------- */

const TOWER_W = 8; // footprint of every project tower
const TOWER_BOTTOM = -70; // same floor as the skyline blocks, so nothing floats
const TOWER_TIER_H = 3.2; // setback tier above the main roof
const MAST_H = 4; // antenna mast above the crown
// Height of the crown above the setback tier, per crown style (see <Crown />).
const CROWN_H = [3.6, 0.2, 3.8, 6, 1];

const FACADE_VERT = /* glsl */ `
  uniform float uSeed;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec2 vEdge;
  varying float vSeed;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec3 sc = vec3(
      length(modelMatrix[0].xyz),
      length(modelMatrix[1].xyz),
      length(modelMatrix[2].xyz)
    );
    vec3 lp = position * sc;
    vN = normalize(mat3(modelMatrix) * normal);
    bool zFace = abs(normal.z) > 0.5;
    float hh = zFace ? lp.x : lp.z;
    float halfW = (zFace ? sc.x : sc.z) * 0.5;
    vEdge = vec2(halfW - abs(hh), sc.y * 0.5 - lp.y);
    vSeed = uSeed;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FACADE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uFog;
  uniform vec2 uFogRange;
  uniform float uStyle;
  uniform float uId;
  uniform float uLitBoost;
  uniform float uHover;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec2 vEdge;
  varying float vSeed;
  ${GLSL_NOISE}

  float rectIn(vec2 f, vec4 b){
    return step(b.x, f.x) * step(f.x, b.y) * step(b.z, f.y) * step(f.y, b.w);
  }

  void main(){
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    float isTop = step(0.5, n.y);
    float zFace = step(0.5, abs(n.z));
    float side = step(abs(n.y), 0.5);
    float fres = pow(1.0 - clamp(abs(dot(n, V)), 0.0, 1.0), 3.0);

    // identity shared by shaft, tier and cornices of one project
    float pk = uId * 0.37 + 0.11;
    float tone = hash21(vec2(pk, 3.7));
    float hue  = hash21(vec2(pk, 8.3));
    float style = floor(uStyle + 0.5);

    vec2 uvw = zFace > 0.5 ? vec2(vWorld.x, vWorld.y) : vec2(vWorld.z, vWorld.y);
    vec2 cell = style < 0.5 ? vec2(1.15, 1.7)
              : (style < 1.5 ? vec2(0.75, 2.3) : vec2(2.3, 1.45));
    vec2 g = uvw / cell;
    vec2 id = floor(g);
    vec2 f = fract(g);

    /* ---- wall ---- */
    vec3 base = mix(vec3(0.05, 0.065, 0.09), vec3(0.10, 0.125, 0.16), tone);
    vec3 tint = hue < 0.33 ? vec3(1.15, 0.92, 0.85)
              : (hue < 0.66 ? vec3(0.88, 0.98, 1.1) : vec3(0.9, 1.08, 1.02));
    base *= tint;
    base *= mix(0.6, 1.0, smoothstep(-20.0, 14.0, vWorld.y));

    float pierEvery = style < 1.5 ? 3.0 : 4.0;
    float pier = (1.0 - step(0.5, mod(id.x, pierEvery))) * (1.0 - step(0.14, f.x));
    float bandRow = 1.0 - step(0.5, mod(id.y, 7.0));
    float band = bandRow * (1.0 - step(0.3, f.y));
    float sill = step(0.18, f.y) * (1.0 - step(0.25, f.y)) * step(0.15, f.x) * step(f.x, 0.85);
    base += vec3(0.035, 0.045, 0.06) * (pier + band) * side;
    base += vec3(0.02, 0.026, 0.035) * sill * side;

    // mechanical floor: louvred band every 12th storey, no windows
    float mechRow = 1.0 - step(0.5, mod(id.y, 12.0));
    float louver = mechRow * step(0.5, fract(f.y * 7.0)) * side;
    base += vec3(0.03, 0.038, 0.05) * louver;

    // drain pipes, rain streaks, weathering
    float pipe = 1.0 - step(0.014, abs(fract(uvw.x / (7.0 + tone * 5.0)) - 0.5));
    base += vec3(0.03, 0.035, 0.045) * pipe * side;
    float grime = vnoise(vec2(uvw.x * 1.7, uvw.y * 0.07 + pk * 10.0));
    float stain = smoothstep(0.55, 0.9, vnoise(vec2(uvw.x * 0.9 + pk * 7.0, uvw.y * 0.03)));
    base *= (0.75 + 0.4 * grime) * (1.0 - 0.25 * stain);

    vec3 col = pow(base, vec3(2.2));

    // moonlit rim along rooflines and vertical edges
    float topEdge  = (1.0 - smoothstep(0.0, 0.35, vEdge.y)) * side;
    float sideEdge = (1.0 - smoothstep(0.0, 0.25, vEdge.x)) * side;
    col += vec3(0.10, 0.16, 0.26) * topEdge * 0.45;
    col += vec3(0.05, 0.08, 0.13) * sideEdge * 0.4;

    /* ---- windows ---- */
    vec4 wb = style < 0.5 ? vec4(0.2, 0.8, 0.25, 0.75)
            : (style < 1.5 ? vec4(0.3, 0.7, 0.12, 0.88) : vec4(0.04, 0.96, 0.3, 0.7));
    float mask = step(0.9, vEdge.x) * step(1.3, vEdge.y) * side * (1.0 - band) * (1.0 - mechRow);

    float winRect = rectIn(f, wb);
    float win = winRect * mask;
    float mull = (1.0 - step(0.03, abs(f.x - 0.5))) * (1.0 - step(0.5, style));
    win *= 1.0 - 0.7 * mull;

    float frame = (rectIn(f, wb + vec4(-0.07, 0.07, -0.05, 0.05)) - winRect) * mask;
    float lintel = step(wb.w + 0.05, f.y) * step(f.y, wb.w + 0.14)
                 * step(wb.x - 0.1, f.x) * step(f.x, wb.y + 0.1) * mask;
    col += vec3(0.02, 0.026, 0.036) * frame + vec3(0.03, 0.04, 0.055) * lintel;

    // balconies every 5th floor
    float balRow = (1.0 - step(0.5, mod(id.y, 5.0))) * (style < 1.5 ? 1.0 : 0.0);
    float slab = balRow * step(f.y, 0.1) * step(0.04, f.x) * step(f.x, 0.96) * mask;
    float bars = balRow * step(0.1, f.y) * step(f.y, 0.4) * step(0.55, fract(f.x * 8.0)) * mask;
    col += vec3(0.03, 0.04, 0.055) * (slab + bars * 0.7);
    win *= 1.0 - 0.55 * balRow * step(f.y, 0.4);

    float r = hash21(id + vSeed * 37.0 + zFace * 11.0);
    float density = clamp(mix(0.08, 0.32, hash21(vec2(pk, 9.1))) + uLitBoost, 0.0, 0.75);
    float rowLit = step(0.9, hash21(vec2(id.y, vSeed * 13.0 + zFace)));
    float lit = max(step(1.0 - density, r), rowLit * step(0.25, hash21(id + 4.4)));
    float blind = step(0.72, hash21(id + 9.1));
    lit *= mix(1.0, step(0.5, f.y), blind);
    float flick = step(0.985, hash21(id * 1.7 + 3.0));
    lit *= 1.0 - flick * step(0.5, sin(uTime * 2.0 + r * 60.0));

    float cr = hash21(id + 7.7);
    vec3 wc = vec3(1.0, 0.70, 0.36);
    wc = mix(wc, vec3(0.55, 0.78, 1.0), step(0.72, cr));
    wc = mix(wc, vec3(0.65, 1.0, 0.60), step(0.93, cr));
    wc = mix(wc, vec3(1.0, 0.45, 0.25), step(0.97, cr));
    float bright = 0.7 + 0.9 * hash21(id + 2.2);
    vec3 emit = wc * lit * win * bright * 2.0;
    emit += wc * lit * frame * 0.35 * bright;
    emit += wc * lit * 0.03 * mask * (1.0 - winRect);
    emit *= 1.0 + uHover * 0.7;

    // dark glass: sky reflection that strengthens at grazing angles + a diagonal glint
    col += win * (1.0 - lit) * vec3(0.02, 0.03, 0.045) * (0.4 + hash21(id + 1.9));
    col += win * (1.0 - lit) * vec3(0.03, 0.05, 0.085) * (0.4 + fres * 2.4);
    col += win * (1.0 - lit) * vec3(0.03, 0.045, 0.07)
         * smoothstep(0.35, 0.5, fract(f.x * 0.8 + f.y * 0.6 + pk * 4.0)) * 0.5;

    /* ---- roof surface: gravel, panel seams, wet sheen ---- */
    float gr = vnoise(vWorld.xz * 7.0);
    float seam = max(step(0.97, fract(vWorld.x * 0.45)), step(0.97, fract(vWorld.z * 0.45)));
    vec3 roof = pow(vec3(0.05, 0.058, 0.072) * (0.65 + 0.7 * gr), vec3(2.2))
              + vec3(0.012, 0.016, 0.022) * seam;
    float puddle = smoothstep(0.52, 0.62, fbm(vWorld.xz * 0.4 + pk * 9.0));
    float topFres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.0);
    vec3 sheen = vec3(0.03, 0.05, 0.085) * (0.5 + topFres * 2.5) + vec3(0.02, 0.03, 0.05);
    roof = mix(roof, sheen, puddle * 0.7);
    col = mix(col, roof, isTop);

    // hover: the whole tower lifts a touch
    col += uHover * vec3(0.02, 0.04, 0.07) * (side + isTop * 0.5);

    /* ---- haze: reduced for project towers so they stay readable ---- */
    float dist = length(cameraPosition - vWorld);
    float fogT = smoothstep(uFogRange.x, uFogRange.y, dist) * 0.6;
    col = mix(col + emit * (1.0 - fogT * 0.5), uFog, fogT);
    col += uFlash * vec3(0.05, 0.07, 0.11) * (1.0 - fogT);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function FacadeBox({
  position,
  size,
  seed,
  id,
  style,
  litBoost = 0.16,
  hover,
}: {
  position: [number, number, number];
  size: [number, number, number];
  seed: number;
  id: number;
  style: number;
  litBoost?: number;
  hover: { current: number };
}) {
  const uniforms = useMemo(
    () => ({
      uTime: U.time,
      uFlash: U.flash,
      uFog: { value: FOG_COLOR },
      uFogRange: { value: FOG_RANGE },
      uSeed: { value: seed },
      uId: { value: id },
      uStyle: { value: style },
      uLitBoost: { value: litBoost },
      uHover: { value: 0 },
    }),
    [seed, id, style, litBoost],
  );

  useFrame((_, dt) => {
    uniforms.uHover.value = THREE.MathUtils.damp(
      uniforms.uHover.value,
      hover.current,
      8,
      Math.min(dt, 0.05),
    );
  });

  return (
    <mesh position={position} scale={size}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={FACADE_VERT}
        fragmentShader={FACADE_FRAG}
      />
    </mesh>
  );
}

// Five different crowns so the towers are told apart at a glance.
function Crown({
  kind,
  y,
  w,
  hovered,
}: {
  kind: number;
  y: number;
  w: number;
  hovered: boolean;
}) {
  const glow = hovered ? "#b5dcff" : "#4d8fc9";
  const metal = { color: "#0b1119", roughness: 0.5, metalness: 0.65 } as const;

  if (kind === 0) {
    // pyramid spire
    return (
      <mesh
        position={[0, y + 1.8, 0]}
        rotation={[0, Math.PI / 4, 0]}
        scale={[w * 0.62, 3.6, w * 0.62]}
      >
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial {...metal} emissive="#102c4a" emissiveIntensity={0.4} />
      </mesh>
    );
  }

  if (kind === 1) {
    // helipad: amber ring + H
    return (
      <group position={[0, y + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh>
          <ringGeometry args={[1.5, 1.68, 48]} />
          <meshBasicMaterial color="#ffb23d" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={x} position={[x, 0, 0.01]}>
            <boxGeometry args={[0.16, 1.1, 0.02]} />
            <meshBasicMaterial color="#ffb23d" toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.01]}>
          <boxGeometry args={[0.9, 0.16, 0.02]} />
          <meshBasicMaterial color="#ffb23d" toneMapped={false} />
        </mesh>
      </group>
    );
  }

  if (kind === 2) {
    // stepped art-deco crown
    return (
      <>
        <mesh position={[0, y + 1.1, 0]}>
          <boxGeometry args={[w * 0.62, 2.2, w * 0.62]} />
          <meshStandardMaterial {...metal} emissive="#102c4a" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, y + 3.0, 0]}>
          <boxGeometry args={[w * 0.34, 1.6, w * 0.34]} />
          <meshStandardMaterial {...metal} emissive="#102c4a" emissiveIntensity={0.3} />
        </mesh>
      </>
    );
  }

  if (kind === 3) {
    // twin blade fins with lit edges
    return (
      <>
        {[-1.2, 1.2].map((x) => (
          <group key={x} position={[x, y + 3, 0]}>
            <mesh>
              <boxGeometry args={[0.45, 6, 2.6]} />
              <meshStandardMaterial {...metal} />
            </mesh>
            <mesh position={[0, 0, 1.33]}>
              <boxGeometry args={[0.1, 6, 0.06]} />
              <meshBasicMaterial color={glow} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </>
    );
  }

  // 4: glowing halo ring on a drum
  return (
    <>
      <mesh position={[0, y + 0.5, 0]}>
        <cylinderGeometry args={[w * 0.3, w * 0.34, 1, 20]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, y + 1.0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[w * 0.36, 0.1, 8, 48]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
    </>
  );
}



function ProjectTower({
  project,
  index,
  onSelect,
  selected,
}: {
  project: PortfolioProject;
  index: number;
  onSelect: (project: PortfolioProject) => void;
  selected: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const expanded = hovered || selected;

  const hover = useRef(0);
  hover.current = expanded ? 1 : 0;

  const cardRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<THREE.MeshBasicMaterial>(null);
  const labelWorld = useMemo(() => new THREE.Vector3(), []);

  const H = project.height;
  const W = TOWER_W;
  const tierW = W * 0.6;
  const kind = index % CROWN_H.length;
  const tierBase = H + 0.4;
  const tierTop = tierBase + TOWER_TIER_H;
  const crownBase = tierTop + 0.3;
  const crownTop = crownBase + CROWN_H[kind];
  const apex = crownTop + MAST_H;
  const labelY = apex + 3.4;
  const seed = 0.17 + index * 0.19;

  // The flight passes on the city-centre side.
  const outer = project.x < 0 ? -1 : 1;
  const glow = expanded ? "#b5dcff" : "#4d8fc9";

  const dark = {
    color: "#0a0f16",
    roughness: 0.7,
    metalness: 0.4,
  } as const;

  const stone = {
    color: "#0b1119",
    roughness: 0.85,
    metalness: 0.2,
  } as const;

  // Facade piers
  const PIER_BOTTOM = -20;
  const pierH = H - 0.3 - PIER_BOTTOM;
  const pierY = (H - 0.3 + PIER_BOTTOM) / 2;

  useFrame(({ camera, clock }) => {
    const card = cardRef.current;

    if (card) {
      labelWorld.set(project.x, labelY, project.z);

      const d = camera.position.distanceTo(labelWorld);

      const opacity =
        THREE.MathUtils.smoothstep(d, 4, 10) *
        (1 - THREE.MathUtils.smoothstep(d, 55, 90));

      card.style.opacity = String(opacity);

      // Keep the selected label interactive.
      card.style.pointerEvents =
        opacity > 0.2 || selected ? "auto" : "none";
    }

    const material = beaconRef.current;

    if (material) {
      const on =
        (clock.elapsedTime * 0.45 + index * 0.23) % 1 < 0.16;

      material.color
        .setRGB(1, 0.1, 0.06)
        .multiplyScalar(on ? 7 : 0.4);
    }
  });

  return (
    <group
      position={[project.x, 0, project.z]}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(project);
      }}
    >
      {/* Main shaft */}
      <FacadeBox
        position={[0, (H + TOWER_BOTTOM) / 2, 0]}
        size={[W, H - TOWER_BOTTOM, W]}
        seed={seed}
        id={index}
        style={project.style}
        litBoost={0.14}
        hover={hover}
      />

      {/* Belt cornices */}
      {[8, 16, 24].map((drop) => (
        <FacadeBox
          key={`belt${drop}`}
          position={[0, H - drop, 0]}
          size={[W + 0.5, 0.3, W + 0.5]}
          seed={seed + 0.05}
          id={index}
          style={project.style}
          litBoost={0}
          hover={hover}
        />
      ))}

      {/* Cornice and setback tier */}
      <FacadeBox
        position={[0, H + 0.2, 0]}
        size={[W + 0.8, 0.4, W + 0.8]}
        seed={seed + 0.03}
        id={index}
        style={project.style}
        litBoost={0}
        hover={hover}
      />

      <FacadeBox
        position={[0, tierBase + TOWER_TIER_H / 2, 0]}
        size={[tierW, TOWER_TIER_H, tierW]}
        seed={seed + 0.07}
        id={index}
        style={project.style}
        litBoost={0.2}
        hover={hover}
      />

      <FacadeBox
        position={[0, tierTop + 0.15, 0]}
        size={[tierW + 0.5, 0.3, tierW + 0.5]}
        seed={seed + 0.11}
        id={index}
        style={project.style}
        litBoost={0}
        hover={hover}
      />

      {/* Facade piers */}
      {[-1, 1].flatMap((s) =>
        [-1.7, 1.7].flatMap((o) => [
          <mesh
            key={`pierz${s}${o}`}
            position={[o, pierY, s * (W / 2 + 0.1)]}
          >
            <boxGeometry args={[0.45, pierH, 0.25]} />
            <meshStandardMaterial {...stone} />
          </mesh>,

          <mesh
            key={`pierx${s}${o}`}
            position={[s * (W / 2 + 0.1), pierY, o]}
          >
            <boxGeometry args={[0.25, pierH, 0.45]} />
            <meshStandardMaterial {...stone} />
          </mesh>,
        ]),
      )}

      {/* Corner fins */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * (W / 2), H - 7, sz * (W / 2)]}
          >
            <boxGeometry args={[0.5, 14, 0.5]} />
            <meshStandardMaterial {...dark} />
          </mesh>
        )),
      )}

      {/* Parapet walls */}
      {[-1, 1].map((s) => (
        <mesh
          key={`paz${s}`}
          position={[0, H + 0.65, s * (W / 2 + 0.3)]}
        >
          <boxGeometry args={[W + 0.8, 0.5, 0.2]} />
          <meshStandardMaterial {...stone} />
        </mesh>
      ))}

      {[-1, 1].map((s) => (
        <mesh
          key={`pax${s}`}
          position={[s * (W / 2 + 0.3), H + 0.65, 0]}
        >
          <boxGeometry args={[0.2, 0.5, W + 0.4]} />
          <meshStandardMaterial {...stone} />
        </mesh>
      ))}

      {/* Lit roof rim */}
      {[-1, 1].map((s) => (
        <mesh
          key={`rx${s}`}
          position={[0, H + 0.93, s * ((W + 0.8) / 2)]}
        >
          <boxGeometry args={[W + 0.8, 0.08, 0.08]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      ))}

      {[-1, 1].map((s) => (
        <mesh
          key={`rz${s}`}
          position={[s * ((W + 0.8) / 2), H + 0.93, 0]}
        >
          <boxGeometry args={[0.08, 0.08, W + 0.8]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      ))}

      {/* Roof AC units and water tank */}
      <mesh position={[outer * 3.0, H + 0.85, 1.8]}>
        <boxGeometry args={[1.3, 0.9, 1.7]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      <mesh position={[outer * 3.0, H + 0.75, -0.2]}>
        <boxGeometry args={[1.0, 0.7, 1.2]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      <mesh position={[outer * 3.1, H + 2.0, -3.0]}>
        <cylinderGeometry args={[0.7, 0.7, 1.8, 14]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      <mesh position={[outer * 3.1, H + 3.15, -3.0]}>
        <coneGeometry args={[0.78, 0.5, 14]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      {/* Solar panels */}
      {[-1.3, 0, 1.3].map((x) => (
        <mesh
          key={`sp${x}`}
          position={[x, H + 0.75, 3.4]}
          rotation={[-0.45, 0, 0]}
        >
          <boxGeometry args={[1.1, 0.05, 0.9]} />
          <meshStandardMaterial
            color="#0c1a2e"
            roughness={0.25}
            metalness={0.8}
            emissive="#0a2a4a"
            emissiveIntensity={0.25}
          />
        </mesh>
      ))}

      {/* Satellite dish */}
      <mesh position={[0.9, H + 0.85, -3.4]}>
        <cylinderGeometry args={[0.06, 0.06, 0.9, 8]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      <mesh
        position={[0.9, H + 1.5, -3.4]}
        rotation={[Math.PI * 0.8, 0, 0]}
      >
        <sphereGeometry
          args={[0.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.4]}
        />
        <meshStandardMaterial {...dark} side={THREE.DoubleSide} />
      </mesh>

      {/* Vent pipes */}
      {[-1.2, -0.6].map((x, k) => (
        <mesh
          key={`vent${x}`}
          position={[x, H + 0.8 + k * 0.2, -3.4]}
        >
          <cylinderGeometry args={[0.15, 0.15, 0.8 + k * 0.4, 10]} />
          <meshStandardMaterial {...dark} />
        </mesh>
      ))}

      {/* Amber aviation lights */}
      {[-1, 1].map((s) => (
        <mesh
          key={`av${s}`}
          position={[outer * 4.0, H + 1.15, s * 4.0]}
        >
          <sphereGeometry args={[0.1, 10, 10]} />
          <meshBasicMaterial color="#ffb23d" toneMapped={false} />
        </mesh>
      ))}

      {/* Crown and antenna */}
      <Crown
        kind={kind}
        y={crownBase}
        w={tierW}
        hovered={expanded}
      />

      <mesh position={[0, crownTop + MAST_H / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.08, MAST_H, 8]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      <mesh position={[0, crownTop + MAST_H * 0.62, 0]}>
        <boxGeometry args={[1.4, 0.05, 0.05]} />
        <meshStandardMaterial {...dark} />
      </mesh>

      {/* Blinking beacon */}
      <mesh position={[0, apex, 0]}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshBasicMaterial ref={beaconRef} toneMapped={false} />
      </mesh>

      {/* Antenna-to-label light line */}
      <mesh position={[0, apex + 1.55, 0]}>
        <boxGeometry args={[0.04, 3.1, 0.04]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>

      {/* Project label */}
      <Html
        position={[0, labelY, 0]}
        center
        zIndexRange={[5, 0]}
        pointerEvents="auto"
      >
        <div
          ref={cardRef}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => onSelect(project)}
          style={{
            opacity: 0,
            width: expanded ? 250 : "auto",
            minWidth: 150,
            padding: "9px 15px 10px",
            color: "#eaf3ff",
            background: "rgba(5, 12, 23, 0.82)",
            border: "1px solid rgba(139, 195, 255, 0.26)",
            borderLeft: `2px solid ${
              expanded ? "#b5dcff" : "#7fb8ff"
            }`,
            boxShadow: expanded
              ? "0 0 30px rgba(55, 135, 220, 0.22)"
              : "0 6px 24px rgba(0, 0, 0, 0.35)",
            backdropFilter: "blur(10px)",
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            transition:
              "width 200ms ease, box-shadow 200ms ease, border-color 200ms ease",
          }}
        >
          {/* Project category */}
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.28em",
              color: "#8bbbe9",
            }}
          >
            {project.number} — {project.category}
          </div>

          {/* Project title */}
          <div
            style={{
              marginTop: 5,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            {project.title}
          </div>

          {/* Details remain visible on hover OR selection */}
          {expanded && (
            <div
              style={{
                marginTop: 8,
                whiteSpace: "normal",
                fontSize: 11,
                lineHeight: 1.6,
                color: "rgba(222, 234, 250, 0.78)",
              }}
            >
              {project.description}

              {/* GitHub mission link */}
              {project.link && (
                <a
                  href={project.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onMouseEnter={() => setHovered(true)}
                  style={{
                    display: "block",
                    width: "fit-content",
                    marginTop: 9,
                    color: "#9ccaff",
                    letterSpacing: "0.14em",
                    fontSize: 9,
                    textDecoration: "none",
                    cursor: "pointer",
                    position: "relative",
                    zIndex: 10,
                  }}
                >
                  VIEW MISSION ↗
                </a>
              )}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}


function ProjectDistrict({
  onSelect,
  selectedProject,
}: {
  onSelect: (project: PortfolioProject) => void;
  selectedProject: PortfolioProject | null;
}) {
  return (
    <group>
      {PORTFOLIO_PROJECTS.map((project, i) => (
        <ProjectTower
          key={project.id}
          project={project}
          index={i}
          onSelect={onSelect}
          selected={selectedProject?.id === project.id}
        />
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Camera: wide skyline -> slow approach (statements 01-05) -> reaches the   */
/*  back of the hero at statement 06 -> tilt/orbit to the front (upper-body   */
/*  shot) -> zoom to the eyes -> charge -> eye blast -> city-facing shot ->   */
/*  DIVE INTO THE HERO'S HEAD (POV) -> first-person flight over the rooftops  */
/*                                                                            */
/*  The rig also measures its own real velocity every frame (CAM_VEL /        */
/*  flightSpeed) which drives the rain streaks, air streaks, FOV widening,    */
/*  lens fringing and the HUD rush lines: the faster you scroll, the faster   */
/*  you fly, and the more it feels like it.                                   */
/* -------------------------------------------------------------------------- */

function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pointer = useThree((s) => s.pointer);

  const pos = useMemo(() => new THREE.Vector3(0, 11.5, 38), []);
  const lookNow = useMemo(() => new THREE.Vector3(0, 1.8, -10), []);
  const wantPos = useMemo(() => new THREE.Vector3(), []);
  const wantLook = useMemo(() => new THREE.Vector3(), []);
  const flightPos = useMemo(() => new THREE.Vector3(), []);
  const flightTan = useMemo(() => new THREE.Vector3(), []);
  const flightTanAhead = useMemo(() => new THREE.Vector3(), []);
  const flightLook = useMemo(() => new THREE.Vector3(), []);
  const cavePos = useMemo(() => new THREE.Vector3(), []);
  const caveTan = useMemo(() => new THREE.Vector3(), []);
  const caveLook = useMemo(() => new THREE.Vector3(), []);

  // velocity measurement
  const prevCam = useMemo(() => new THREE.Vector3(), []);
  const rawVel = useMemo(() => new THREE.Vector3(), []);
  const started = useRef(false);

  // smoothed bank angle (roll into turns)
  const bank = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const lerp = THREE.MathUtils.lerp;
    const damp = THREE.MathUtils.damp;
    const clamp = THREE.MathUtils.clamp;

    const p = clamp(openingProgress.current, 0, 1);
    const wide = state.size.width / state.size.height > 1.2;

    // Scroll phases (progress = time / 20s)
    const approach = sstep(p, 0.1, 0.46); // skyline -> behind the hero (reached at statement 06)
    const orbit = sstep(p, 0.48, 0.64); // behind -> in front (180 degrees), starts with statement 06
    const drift = sstep(p, 0.64, 0.74); // slow push during the bio beat
    const zoom = sstep(p, 0.76, 0.88); // upper body -> eyes
    const hit = impactPunch.current;
    const charge = eyeCharge.current;
    const blast = clamp(eyePower.current, 0, 1);

    // Orbit around the hero's vertical axis.
    const theta = orbit * Math.PI;
    const R =
      lerp(lerp(ORBIT_R0, ORBIT_R1, orbit) - drift * 0.3, FACE_R, zoom) -
      hit * 0.07 - // the camera creeps in as the lightning breaks
      charge * 0.1; // ...and leans into the face as the eyes charge
    const shift = (wide ? FACE_SHIFT : 0) * zoom;

    const orbitX = Math.sin(theta) * R;
    const orbitY = lerp(2.4, FRONT_Y + 0.05, orbit);
    const orbitZ = LEDGE_Z + Math.cos(theta) * R;

    // Idle parallax only while the opening shot is still wide.
    const startX = pointer.x * 0.35 + Math.sin(t * 0.21) * 0.12;
    const startY = 11.5 + pointer.y * 0.15;

    wantPos.set(
      lerp(startX, orbitX, approach) + shift,
      lerp(startY, lerp(orbitY, EYE_Y, zoom), approach),
      lerp(38, orbitZ, approach),
    );

    // Attention shifts from the skyline to the hero's back, then up to the
    // chest/face line for the front shot, then to the eyes.
    const lookY = lerp(
      lerp(lerp(1.8 + pointer.y * 0.4, BACK_Y, approach), FRONT_Y, orbit),
      EYE_Y,
      zoom,
    );

    wantLook.set(shift, lookY, lerp(-10, LEDGE_Z, approach));

    /* ---- City-facing shot: camera moves behind the hero, looks at the city ---- */
    const world = sstep(worldProgress.current, 0, 1);
    wantPos.lerp(WORLD_POS, world);
    wantLook.lerp(WORLD_LOOK, world);

    /* ---- Hero POV: camera dives forward from behind the hero into his head ---- */
    const povRaw = clamp(povProgress.current, 0, 1);
    const pov = sstep(povRaw, 0, 1);
    wantPos.lerp(POV_POS, pov);
    wantLook.lerp(POV_LOOK, pov);

    /* ---- First-person flight along the curve ---- */
    // The curve starts exactly at POV_POS, so there is no jump at the handover.
    const flight = clamp(flightProgress.current, 0, 1);
    let targetBank = 0;

    if (flight > 0) {
      const f = sstep(flight, 0, 1);
      FLIGHT_CURVE.getPointAt(f, flightPos);
      FLIGHT_CURVE.getTangentAt(f, flightTan);
      FLIGHT_CURVE.getTangentAt(Math.min(f + 0.02, 1), flightTanAhead);

      // Look ahead along the path without aiming too far into the next tower.
      flightLook.copy(flightPos).addScaledVector(flightTan, 14);
      flightLook.y -= 2.0; // look a little down so the roof stays in frame

      wantPos.copy(flightPos);
      wantLook.lerp(flightLook, sstep(flight, 0, 0.12));

      // Bank into turns like a glider: how fast the heading is rotating.
      // (flip the sign of the 3.2 if you ever want it to lean the other way)
      const turn =
        flightTan.z * flightTanAhead.x - flightTan.x * flightTanAhead.z;
      targetBank = clamp(turn * 3.2, -0.3, 0.3);
    }

    /* ---- Continue seamlessly from the final project into the Batcave ---- */
    const cave = clamp(caveProgress.current, 0, 1);
    if (cave > 0) {
      const c = sstep(cave, 0, 1);
      CAVE_CURVE.getPointAt(c, cavePos);
      CAVE_CURVE.getTangentAt(Math.min(c + 0.012, 1), caveTan);
      caveLook.copy(cavePos).addScaledVector(caveTan, 24);
      caveLook.y -= c < 0.55 ? 1.2 : 0.4;
      wantPos.copy(cavePos);
      wantLook.copy(caveLook);
      targetBank = THREE.MathUtils.lerp(targetBank, 0, c);
    }

    // Banking scales with real speed, so it never leans while standing still.
    bank.current = damp(
      bank.current,
      targetBank * (0.4 + 0.6 * flightSpeed.current),
      3,
      dt,
    );

    pos.x = damp(pos.x, wantPos.x, 4, dt);
    pos.y = damp(pos.y, wantPos.y, 4, dt);
    pos.z = damp(pos.z, wantPos.z, 4, dt);
    lookNow.x = damp(lookNow.x, wantLook.x, 6, dt);
    lookNow.y = damp(lookNow.y, wantLook.y, 6, dt);
    lookNow.z = damp(lookNow.z, wantLook.z, 6, dt);

    const fs = flightSpeed.current; // 0..1 how fast we're really moving
    const launch = launchBoost.current; // 0..1 take-off burst

    // Thunder swell: very slow, low-frequency drift.
    const sway = hit * 0.012;
    // Power rumble: a building tremor while charging, a hard shake on the blast,
    // plus wind buffeting during the take-off and the flight.
    const rumble =
      charge * 0.0025 + blast * 0.014 + launch * 0.012 + fs * 0.004;
    // Soft turbulence while flying: slow bob + drift, scaled by speed.
    const turbX = Math.sin(t * 0.9) * 0.05 * fs;
    const turbY = Math.sin(t * 1.3 + 1.2) * 0.07 * fs;

    camera.position.set(
      pos.x +
        turbX +
        (Math.sin(t * 2.3) + Math.sin(t * 1.4)) * 0.5 * sway +
        (Math.sin(t * 57) + Math.sin(t * 91) * 0.5) * rumble,
      pos.y + turbY + Math.cos(t * 1.9) * sway + Math.cos(t * 63) * rumble,
      pos.z + Math.sin(t * 47) * rumble * 0.6,
    );
    camera.lookAt(lookNow);

    // Dutch tilt while orbiting + hit jolt + a little roll on the blast
    // + a swing during the dive into the head + banking in flight.
    camera.rotateZ(
      Math.sin(orbit * Math.PI) * 0.07 * (1 - zoom) +
        Math.sin(t * 1.7) * 0.008 * hit +
        Math.sin(t * 38) * 0.006 * blast +
        Math.sin(povRaw * Math.PI) * 0.07 +
        Math.sin(t * 0.8) * 0.01 * fs +
        bank.current,
    );

    // Tighter lens on the face; wider "eyes of the hero" lens in POV;
    // lens breath on the strike; FOV kick on the blast; wide-angle in flight,
    // which opens up further with speed and punches out on take-off.
    const baseFov = lerp(lerp(48, 38, zoom), 58, pov);
    const fov =
      lerp(baseFov, 66, sstep(flight, 0, 0.2)) +
      fs * 5 +
      launch * 9 -
      hit * 2.5 -
      blast * 2.5 -
      charge * 0.8;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    /* ---- Measure the camera's real velocity (drives rain / air streaks) ---- */
    if (!started.current) {
      prevCam.copy(camera.position);
      started.current = true;
    } else {
      rawVel
        .copy(camera.position)
        .sub(prevCam)
        .divideScalar(Math.max(delta, 1 / 240));
      prevCam.copy(camera.position);
      if (rawVel.length() > 90) rawVel.setLength(90);
      CAM_VEL.value.lerp(rawVel, 1 - Math.exp(-9 * dt));
    }

    const speed = CAM_VEL.value.length();
    flightSpeed.current = damp(
      flightSpeed.current,
      clamp((speed - 4) / 36, 0, 1),
      5,
      dt,
    );
  });

  return null;
}


/* -------------------------------------------------------------------------- */
/*  Scene                                                                     */
/* -------------------------------------------------------------------------- */

function Scene({
  onSelectProject,
}: {
  onSelectProject: (project: PortfolioProject) => void;
}) {
  const flashLight = useRef<THREE.DirectionalLight>(null);
  const heroGroup = useRef<THREE.Group>(null);

  const caOffset = useMemo(
    () => new THREE.Vector2(0.0006, 0.0009),
    [],
  );

  const [selectedProject, setSelectedProject] =
    useState<PortfolioProject | null>(null);

  const handleProjectSelect = (project: PortfolioProject) => {
    setSelectedProject(project);
    onSelectProject(project);
  };

  // The project district only exists once the city-facing shot begins,
  // so the towers never block the moon / skyline in the opening and hero shots.
  const [districtOn, setDistrictOn] = useState(false);
  const districtRef = useRef(false);

  useFrame(({ clock }) => {
    // Hide the hero once the camera is inside his head
    // and throughout the flight.
    if (heroGroup.current) {
      heroGroup.current.visible =
        (povProgress.current < POV_HERO_HIDE_AT && flightProgress.current < 0.015) ||
        roofProgress.current > 0.0005;
    }
    // Mount the project district mid-swarm while bats cover the screen.
    const wantDistrict = worldProgress.current > 0.3;

    if (wantDistrict !== districtRef.current) {
      districtRef.current = wantDistrict;
      setDistrictOn(wantDistrict);

      if (!wantDistrict) {
        document.body.style.cursor = "";
      }
    }


    const t = clock.elapsedTime;

    U.time.value = t;

    const hit = impactPunch.current;
    const power = THREE.MathUtils.clamp(eyePower.current, 0, 1);
    const charge = eyeCharge.current;
    const fs = flightSpeed.current;
    const launch = launchBoost.current;

    // Keep lens fringing subtle so the character stays crisp. It widens a
    // touch with speed and on take-off, like a real wide lens at velocity.
    caOffset.set(
      0.0003 + hit * 0.0004 + power * 0.0008 + fs * 0.0005 + launch * 0.0009,
      0.0004 + hit * 0.0003 + power * 0.0006 + fs * 0.0004 + launch * 0.0007,
    );

    // Bloom intensity is intentionally static during this diagnostic.
    // If the black frame disappears, the per-frame Bloom mutation was involved.

    const naturalFlash = flashAt(t);
    const cinematicFlash = THREE.MathUtils.clamp(
      revealFlash.current,
      0,
      1,
    );

    U.flash.value = Math.max(
      naturalFlash,
      cinematicFlash,
      power * 0.25,
    );

    if (flashLight.current) {
      flashLight.current.intensity = U.flash.value * 3;
    }
  });

  return (
    <>
      <color attach="background" args={["#05080d"]} />

      {/* Only used by the ledge and props; everything else is shader-lit. */}
      <hemisphereLight args={["#4d6a8f", "#05070a", 0.6]} />

      <directionalLight
        position={[-6, 10, -8]}
        intensity={1.2}
        color="#9fc1ee"
      />

      <directionalLight
        position={[8, 3, 10]}
        intensity={0.15}
        color="#ffb877"
      />

      <directionalLight
        ref={flashLight}
        position={[0, 10, -20]}
        intensity={0}
        color="#a8c8ff"
      />

      <Sky />
      <SignalBeam />
      <Skyline />

      {districtOn && (
        <ProjectDistrict
          onSelect={handleProjectSelect}
          selectedProject={selectedProject}
        />
      )}

      <CaveEnvironment flight={flightProgress} projects={PORTFOLIO_PROJECTS} />

      <Mist
        z={-55}
        y={4}
        w={240}
        h={34}
        opacity={0.12}
        speed={0.006}
      />

      <Mist
        z={-28}
        y={2}
        w={170}
        h={26}
        opacity={0.09}
        speed={0.009}
      />

      <Mist
        z={-10}
        y={3}
        w={130}
        h={18}
        opacity={0.06}
        speed={0.012}
      />

      <Mist
        z={6}
        y={1.3}
        w={80}
        h={4}
        opacity={0.05}
        speed={0.015}
        color="#7d93ad"
      />

      <Rooftop />

      <group ref={heroGroup}>
        <HeroModel />
        <HeroLights />
        <EyePower />
        <ReadySignal />
      </group>

      <Rain />
      <CameraRig />

      {/* Depth of field was removed: the pass was a black-frame risk during the
          flight (NaN / zero-resolution CoC buffers) and was already disabled. */}
      <EffectComposer multisampling={0}>

        <Bloom
          intensity={0.2}
          luminanceThreshold={0.95}
          luminanceSmoothing={0.1}
          radius={0.15}
        />

        <ChromaticAberration
          offset={caOffset}
          radialModulation={false}
          modulationOffset={0}
        />

        <Noise
          premultiply
          blendFunction={BlendFunction.SOFT_LIGHT}
          opacity={0.18}
        />

        <Vignette offset={0.2} darkness={0.9} />
      </EffectComposer>
    </>
  );
}

export default function RooftopScene() {
  const [selectedProject, setSelectedProject] =
    useState<PortfolioProject | null>(null);

  return (
    <div className="rooftop-canvas">
      <Canvas
        camera={{ position: [0, 11.5, 38], fov: 48, near: 0.1, far: 600 }}
        dpr={[1, 1.6]}
        gl={{
          antialias: false, // MSAA is handled by the composer
          powerPreference: "high-performance",
          toneMapping: THREE.NoToneMapping,
        }}
      >
        <Scene onSelectProject={setSelectedProject} />
      </Canvas>

      {selectedProject && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "clamp(16px, 5vw, 72px)",
            background: "rgba(2, 6, 12, 0.32)",
            backdropFilter: "blur(3px)",
          }}
        >
          <article
            style={{
              position: "relative",
              width: "min(100%, 440px)",
              padding: "32px",
              color: "#edf4ff",
              background: "rgba(5, 12, 23, 0.96)",
              border: "1px solid rgba(133, 182, 239, 0.35)",
              boxShadow: "0 24px 100px rgba(0, 0, 0, 0.45)",
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedProject(null)}
              aria-label="Close project details"
              style={{
                position: "absolute",
                top: 15,
                right: 18,
                border: 0,
                background: "transparent",
                color: "#d9e8ff",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ×
            </button>

            <p
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                color: "#8bbbe9",
              }}
            >
              CASE STUDY / {selectedProject.number}
            </p>

            <h2
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                fontWeight: 500,
                lineHeight: 1.15,
                margin: "18px 0",
              }}
            >
              {selectedProject.title}
            </h2>

            <p
              style={{
                fontSize: 15,
                lineHeight: 1.8,
                color: "rgba(226, 237, 252, 0.82)",
              }}
            >
              {selectedProject.details}
            </p>

            <p
              style={{
                marginTop: 24,
                fontSize: 10,
                letterSpacing: "0.18em",
                color: "#8bbbe9",
              }}
            >
              TECHNOLOGIES
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
              }}
            >
              {selectedProject.stack.map((item) => (
                <span
                  key={item}
                  style={{
                    padding: "7px 10px",
                    border: "1px solid rgba(133, 182, 239, 0.24)",
                    fontSize: 11,
                    color: "#d7e7fb",
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          </article>
        </div>
      )}
    </div>
  );
}