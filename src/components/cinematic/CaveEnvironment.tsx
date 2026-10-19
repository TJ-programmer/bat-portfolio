"use client";

/* -------------------------------------------------------------------------- */
/*  BATCAVE                                                                   */
/*                                                                            */
/*  Self-contained (imports nothing from RooftopScene).                       */
/*                                                                            */
/*    <CaveEnvironment flight={flightProgress} projects={PORTFOLIO_PROJECTS}/>*/
/*                                                                            */
/*  NEW in this version                                                       */
/*   - CaveCameraDirector: takes over the camera after the tunnel descent     */
/*       landing  -> hero falls out of the sky and lands at eye level         */
/*       armory   -> eye-level pan across the hanging weapon arsenal          */
/*       screen   -> rises + pushes in to the giant screen                    */
/*     (runs at frame priority 0.5, i.e. after the RooftopScene camera rig)   */
/*   - Arsenal: 4 racks x 6 hanging weapons, one weapon per skill             */
/*   - Giant main screen (54 x 27) + DOM overlay glued on it (CaveScreenUI)   */
/*   - ArcadeMonitor: small clickable monitor that launches Bat-Snake         */
/*                                                                            */
/*  BLACK-SCREEN FIXES kept:                                                  */
/*    1. MainScreen shader uses an explicit square instead of pow(neg, 2.0).   */
/*    2. All cave lights live in `lightsRef` (never toggled), including the    */
/*       arsenal lights, so the light count never changes mid-flight.          */
/* -------------------------------------------------------------------------- */

import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import {
  ACHIEVEMENTS,
  CAVE_EVENTS,
  INTERNSHIPS,
  ROOF_SHOT,
  SCREEN,
  armLookX,
  armoryProgress,
  arsenalPower,
  caveUI,
  endProgress,
  landProgress,
  rackFocus,
  roofProgress,
  screenProgress,
} from "@/components/cinematic/caveState";
type ProgressRef = { current: number };
type CaveProject = { number: string; title: string; category: string };
type V3 = [number, number, number];
type Item = { p: V3; s: V3; rx?: number; ry?: number; rz?: number };

/* -------------------------------------------------------------------------- */
/*  Constants + shared state                                                  */
/* -------------------------------------------------------------------------- */

const CAVE_CENTER = new THREE.Vector3(0, 12, -390);
const DOME_R = 74;
const TUNNEL_CY = 13;
const TUNNEL_CZ = -302;
const TUNNEL_LEN = 100;
const WATER_Y = -1.62;
const PLATFORM_Z = -386;
const PLATFORM_TOP = -0.65;

// Own clock so this file never needs the scene's uniforms.
const T = { value: 0 };
// 0 = camera far outside, 1 = close / inside. Fades particles and bats in.
const VIS = { value: 0 };

// Atmospheric haze shared by every rock / tree material.
const HAZE = {
  density: { value: 0.0056 },
  color: { value: new THREE.Color("#2b3b4f") }, // same as the city FOG_COLOR
};
const HAZE_OUT = new THREE.Color("#2b3b4f");
const HAZE_IN = new THREE.Color("#0a1624");

const sstep = (x: number, a: number, b: number) =>
  THREE.MathUtils.smoothstep(x, a, b);

const BULB = new THREE.Color(2.6, 3.4, 4.4);
const GLOW_BLUE = new THREE.Color(0.55, 1.1, 2.2);

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

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillInstances(mesh: THREE.InstancedMesh | null, items: Item[]) {
  if (!mesh) return;
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.p[0], it.p[1], it.p[2]);
    o.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    o.scale.set(it.s[0], it.s[1], it.s[2]);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function Inst({
  items,
  geometry,
  material,
  children,
}: {
  items: Item[];
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material;
  children?: ReactNode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => fillInstances(ref.current, items), [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      frustumCulled={false}
    >
      {children}
    </instancedMesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rock shader: bump, wet patches, moss, veins + distance haze               */
/* -------------------------------------------------------------------------- */

const ROCK_GLSL = /* glsl */ `
float rkHash(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rkNoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rkHash(i), rkHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(rkHash(i + vec3(0.0, 1.0, 0.0)), rkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(rkHash(i + vec3(0.0, 0.0, 1.0)), rkHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(rkHash(i + vec3(0.0, 1.0, 1.0)), rkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float rkFbm(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * rkNoise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
float rkHeight(vec3 p){
  return rkFbm(p * 1.3) * 0.65 + rkNoise(p * 7.0) * 0.25 + rkNoise(p * 19.0) * 0.1;
}
`;

function patchMaterial(mat: THREE.MeshStandardMaterial, rock: boolean) {
  mat.customProgramCacheKey = () => (rock ? "cave-rock" : "cave-haze");

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHazeDensity = HAZE.density;
    shader.uniforms.uHazeColor = HAZE.color;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vHazeDist;
         varying vec3 vWPos;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
         vHazeDist = length(mvPosition.xyz);
         vec4 rkW = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           rkW = instanceMatrix * rkW;
         #endif
         vWPos = (modelMatrix * rkW).xyz;`,
      );

    let frag = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
       uniform float uHazeDensity;
       uniform vec3 uHazeColor;
       varying float vHazeDist;
       varying vec3 vWPos;
       ${rock ? ROCK_GLSL : ""}`,
    );

    if (rock) {
      frag = frag
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           float rkH = rkHeight(vWPos);
           float rkA = rkFbm(vWPos * 0.3);
           float rkStreak = smoothstep(0.62, 0.9, rkNoise(vec3(vWPos.x * 1.5, vWPos.y * 0.12, vWPos.z * 1.5)));
           float rkLow = 1.0 - smoothstep(-1.5, 3.2, vWPos.y);
           float rkWet = clamp(rkLow * smoothstep(0.35, 0.65, rkA) + rkStreak * 0.7, 0.0, 1.0);
           float rkVein = smoothstep(0.64, 0.8, rkNoise(vec3(vWPos.x * 0.3, vWPos.y * 2.6, vWPos.z * 0.3) + 4.0));
           diffuseColor.rgb *= (0.62 + 0.75 * rkH) * (1.0 - 0.4 * rkWet);
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.95, 1.4) * 1.5, rkVein * 0.3);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.06, 0.05), rkLow * rkWet * 0.35);`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
           roughnessFactor = mix(roughnessFactor, 0.2, rkWet);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
           {
             vec3 sp = -vViewPosition;
             vec3 sx = dFdx(sp);
             vec3 sy = dFdy(sp);
             float hx = dFdx(rkH);
             float hy = dFdy(rkH);
             vec3 r1 = cross(sy, normal);
             vec3 r2 = cross(normal, sx);
             float det = dot(sx, r1);
             if (abs(det) > 1e-6) {
               vec3 grad = sign(det) * (hx * r1 + hy * r2);
               float bf = 1.0 - smoothstep(30.0, 110.0, vHazeDist);
               vec3 pn = abs(det) * normal - 0.35 * bf * grad;
               if (dot(pn, pn) > 1e-10) normal = normalize(pn);
             }
           }`,
        );
    }

    frag = frag.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
       float hz = 1.0 - exp(-vHazeDist * uHazeDensity);
       vec3 hzc = mix(gl_FragColor.rgb, uHazeColor, clamp(hz, 0.0, 1.0));
       bool hzOk = (hzc.r == hzc.r) && (hzc.g == hzc.g) && (hzc.b == hzc.b);
       gl_FragColor.rgb = hzOk ? min(hzc, vec3(3.0)) : uHazeColor;`,
    );

    shader.fragmentShader = frag;
  };

  return mat;
}

function makeRockMaterial(side: THREE.Side, vertexColors = true) {
  return patchMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors,
      color: vertexColors ? "#ffffff" : "#16202b",
      roughness: 1,
      metalness: 0.04,
      side,
    }),
    true,
  );
}

/* -------------------------------------------------------------------------- */
/*  3D noise + procedural rock geometry                                       */
/* -------------------------------------------------------------------------- */

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = THREE.MathUtils.lerp;
  return l(
    l(
      l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
      l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u),
      v,
    ),
    l(
      l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
      l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

function fbm3(x: number, y: number, z: number, oct = 4) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * noise3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

const rockTint = (s: number): V3 => [0.13 * s, 0.16 * s, 0.2 * s];

function makeRockGeo(detail: number, amp: number, freq: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * freq + seed, v.y * freq + seed * 0.7, v.z * freq + seed * 1.3, 4);
    const ridge =
      1 - Math.abs(fbm3(v.x * freq * 2 + seed, v.y * freq * 2, v.z * freq * 2, 3) * 2 - 1);
    v.multiplyScalar(1 + (n - 0.5) * amp + (ridge - 0.5) * amp * 0.5);
    pos.setXYZ(i, v.x, v.y, v.z);

    const strata = 0.5 + 0.5 * Math.sin(v.y * 9 + n * 6);
    const c = rockTint(0.55 + n * 0.8 + strata * 0.2 + Math.max(v.y, 0) * 0.12);
    col.set(c, i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function tunnelR(a: number, ly: number) {
  const n = fbm3(Math.cos(a) * 2.2 + 11, Math.sin(a) * 2.2 + 5, ly * 0.07, 4);
  return 16.4 * (1 + (n - 0.45) * 0.2);
}

function makeTunnelGeo() {
  const g = new THREE.CylinderGeometry(1, 1, TUNNEL_LEN, 72, 100, true);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const R = tunnelR(a, y);
    pos.setXYZ(i, Math.cos(a) * R, y, Math.sin(a) * R);

    const n = fbm3(Math.cos(a) * 3.1, Math.sin(a) * 3.1, y * 0.16, 4);
    const strata = 0.5 + 0.5 * Math.sin(y * 0.7 + Math.cos(a) * 2 + n * 5);
    col.set(rockTint(0.45 + n * 0.9 + strata * 0.25), i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function domeRadiusAt(nx: number, ny: number, nz: number) {
  const n = fbm3(nx * 2.2 + 3.1, ny * 2.2 + 1.7, nz * 2.2 + 5.3, 5);
  return DOME_R * (0.94 + (n - 0.45) * 0.15);
}

// Top of the dome (for the skylight).
const DOME_TOP_Y = CAVE_CENTER.y + domeRadiusAt(0, 1, 0) * 0.99;

function makeDomeGeo() {
  const g = new THREE.SphereGeometry(1, 110, 72);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const r = domeRadiusAt(nx, ny, nz);
    pos.setXYZ(i, nx * r, ny * r, nz * r);

    const n = fbm3(nx * 4, ny * 4, nz * 4, 4);
    const strata = 0.5 + 0.5 * Math.sin(ny * 38 + n * 8);
    col.set(rockTint(0.4 + n * 0.8 + strata * 0.3), i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Flat pads so the racks, trophy cases and waterfall pool sit on level ground.
const FLOOR_PADS = [
  { x: 40, z: -422, r: 26, h: -1.1 }, // trophy room
  { x: -6, z: -447, r: 34, h: -1.0 }, // server racks / main screen
  { x: -34, z: -436, r: 13, h: -2.7 }, // waterfall pool (below water level)
];

function makeFloorGeo() {
  const g = new THREE.PlaneGeometry(150, 150, 130, 130);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const wz = z + CAVE_CENTER.z;
    const r = Math.hypot(x, z);
    const shore = sstep(r, 34, 52);
    const n = fbm3(x * 0.045, 0, z * 0.045, 5);
    const detail = fbm3(x * 0.22, 1, z * 0.22, 3);
    let h = -2.9 + shore * ((n - 0.3) * 7 + detail * 1.1) + sstep(r, 50, 78) * 7;

    for (const p of FLOOR_PADS) {
      const d = Math.hypot(x - p.x, wz - p.z);
      const k = 1 - sstep(d, p.r * 0.55, p.r);
      h = THREE.MathUtils.lerp(h, p.h + detail * 0.14, k);
    }
    pos.setY(i, h);

    const wet = THREE.MathUtils.clamp((h + 2.6) / 3.5, 0, 1);
    col.set(rockTint(0.35 + wet * 0.8 + detail * 0.4), i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function makeStalGeo() {
  const g = new THREE.ConeGeometry(1, 1, 7, 6, true);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const n = noise3(Math.cos(a) * 2 + y * 3, Math.sin(a) * 2, y * 4);
    const k = 1 + (n - 0.5) * 0.7;
    pos.setXYZ(i, x * k, y, z * k);
    col.set(rockTint(0.7 + (0.5 - y) * 0.5 + n * 0.4), i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Tiered pine: base at y = 0, tip at y = 1.
function makeTreeGeo() {
  const g = new THREE.ConeGeometry(1, 1, 7, 8, true);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ring = Math.round((y + 0.5) * 8);
    const s = ring % 2 === 0 ? 1 : 0.55;
    pos.setXYZ(i, x * s, y + 0.5, z * s);
    const sh = 0.5 + (y + 0.5) * 0.7;
    col.set([0.012 * sh, 0.045 * sh, 0.04 * sh], i * 3);
  }

  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------------------- */
/*  Ceiling placements (stalactites + roosting bats)                          */
/* -------------------------------------------------------------------------- */

type Placement = {
  x: number;
  y: number;
  z: number;
  len: number;
  w: number;
  tilt: number;
  ry: number;
};

function buildCeiling() {
  const rnd = mulberry32(4242);
  const stal: Placement[] = [];
  const bats: Placement[] = [];

  const onTunnel = (alphaMax: number) => {
    const wz = -256 - rnd() * 96;
    const alpha = (rnd() * 2 - 1) * alphaMax;
    const sx = Math.sin(alpha);
    const yo = Math.cos(alpha);
    const R = tunnelR(Math.atan2(-yo, sx), wz - TUNNEL_CZ) * 0.985;
    return { x: sx * R, y: TUNNEL_CY + yo * R, z: wz };
  };

  const onDome = (nyMin: number) => {
    const ny = nyMin + rnd() * (0.96 - nyMin);
    const phi = rnd() * Math.PI * 2;
    const h = Math.sqrt(1 - ny * ny);
    const dx = h * Math.cos(phi);
    const dz = h * Math.sin(phi);
    const R = domeRadiusAt(dx, ny, dz) * 0.99;
    return {
      x: CAVE_CENTER.x + dx * R,
      y: CAVE_CENTER.y + ny * R,
      z: CAVE_CENTER.z + dz * R,
    };
  };

  for (let i = 0; i < 90; i++) {
    stal.push({
      ...onTunnel(1.15),
      len: 1.5 + rnd() * rnd() * 7,
      w: 0.35 + rnd() * 0.9,
      tilt: (rnd() - 0.5) * 0.25,
      ry: rnd() * 6.28,
    });
  }
  for (let i = 0; i < 160; i++) {
    stal.push({
      ...onDome(0.45),
      len: 3 + rnd() * rnd() * 15,
      w: 0.8 + rnd() * 2.4,
      tilt: (rnd() - 0.5) * 0.3,
      ry: rnd() * 6.28,
    });
  }
  for (let i = 0; i < 60; i++) {
    bats.push({
      ...onTunnel(0.55),
      len: 0.8 + rnd() * 0.5,
      w: 0.8 + rnd() * 0.5,
      tilt: (rnd() - 0.5) * 0.4,
      ry: rnd() * 6.28,
    });
  }
  for (let i = 0; i < 140; i++) {
    bats.push({
      ...onDome(0.5),
      len: 0.8 + rnd() * 0.6,
      w: 0.8 + rnd() * 0.6,
      tilt: (rnd() - 0.5) * 0.4,
      ry: rnd() * 6.28,
    });
  }

  return { stal, bats };
}

function Ceiling({
  rock,
  stalGeo,
}: {
  rock: THREE.Material;
  stalGeo: THREE.BufferGeometry;
}) {
  const stalRef = useRef<THREE.InstancedMesh>(null);
  const batRef = useRef<THREE.InstancedMesh>(null);
  const ceiling = useMemo(buildCeiling, []);

  const batGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.22, 0.9, 6);
    g.rotateX(Math.PI);
    return g;
  }, []);

  useLayoutEffect(() => {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    const fill = (mesh: THREE.InstancedMesh | null, list: Placement[], bat: boolean) => {
      if (!mesh) return;
      list.forEach((pl, i) => {
        if (bat) {
          p.set(pl.x, pl.y - pl.len * 0.4, pl.z);
          s.set(pl.w, pl.len, pl.w);
          e.set(0, pl.ry, pl.tilt * 0.3);
        } else {
          p.set(pl.x, pl.y - pl.len / 2 + 0.5, pl.z);
          s.set(pl.w, pl.len, pl.w);
          e.set(Math.PI + pl.tilt * 0.5, pl.ry, pl.tilt * 0.5, "XYZ");
        }
        q.setFromEuler(e);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };

    fill(stalRef.current, ceiling.stal, false);
    fill(batRef.current, ceiling.bats, true);
  }, [ceiling]);

  return (
    <>
      <instancedMesh
        ref={stalRef}
        args={[stalGeo, rock, ceiling.stal.length]}
        frustumCulled={false}
      />
      <instancedMesh ref={batRef} args={[batGeo, undefined, ceiling.bats.length]} frustumCulled={false}>
        <meshStandardMaterial color="#06080c" roughness={1} />
      </instancedMesh>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cables strung across the dome                                             */
/* -------------------------------------------------------------------------- */

function buildCableGeos() {
  const rnd = mulberry32(88);
  const out: THREE.TubeGeometry[] = [];

  const pt = (phi: number, ny: number) => {
    const h = Math.sqrt(1 - ny * ny);
    const dx = h * Math.cos(phi);
    const dz = h * Math.sin(phi);
    const R = domeRadiusAt(dx, ny, dz) * 0.985;
    return new THREE.Vector3(
      CAVE_CENTER.x + dx * R,
      CAVE_CENTER.y + ny * R,
      CAVE_CENTER.z + dz * R,
    );
  };

  for (let i = 0; i < 18; i++) {
    const phi = rnd() * Math.PI * 2;
    const ny = 0.4 + rnd() * 0.45;
    const dphi = (0.22 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1);
    const ny2 = THREE.MathUtils.clamp(ny + (rnd() - 0.5) * 0.2, 0.35, 0.9);
    const a = pt(phi, ny);
    const b = pt(phi + dphi, ny2);
    const sag = 3 + rnd() * 6;
    const pts = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const p = a.clone().lerp(b, k);
      p.y -= sag * 4 * k * (1 - k);
      return p;
    });
    out.push(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.1 + rnd() * 0.1, 5, false),
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Flying bat colony                                                         */
/* -------------------------------------------------------------------------- */

function BatFlock() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 44;
  const dummy = useMemo(() => {
    const o = new THREE.Object3D();
    o.rotation.order = "YXZ";
    return o;
  }, []);

  const { geo, params } = useMemo(() => {
    const half: [number, number][] = [
      [0, 0.3], [0.08, 0.46], [0.18, 0.3], [0.6, 0.42], [1.2, 0.32], [1.5, 0.1],
      [1.15, 0.12], [0.95, -0.08], [0.72, 0.05], [0.5, -0.15], [0.22, -0.1], [0.12, -0.45],
    ];
    const pts = [
      ...half.map(([x, y]) => new THREE.Vector2(x, y)),
      new THREE.Vector2(0, -0.55),
      ...[...half].reverse().map(([x, y]) => new THREE.Vector2(-x, y)),
    ];
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    g.rotateX(-Math.PI / 2);

    const rnd = mulberry32(99);
    const phase = new Float32Array(N);
    const list = Array.from({ length: N }, (_, i) => {
      phase[i] = rnd() * 6.28;
      return {
        radius: 16 + rnd() * 36,
        height: 8 + rnd() * 24,
        speed: (0.1 + rnd() * 0.18) * (rnd() < 0.5 ? -1 : 1),
        phase: phase[i],
      };
    });
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    return { geo: g, params: list };
  }, []);

  const uniforms = useMemo(() => ({ uTime: T }), []);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.visible = VIS.value > 0.02;
    const t = clock.elapsedTime;
    const o = dummy;

    params.forEach((b, i) => {
      const a = b.phase + t * b.speed;
      const dir = Math.sign(b.speed);
      const vx = -Math.sin(a) * dir;
      const vz = Math.cos(a) * 0.9 * dir;
      o.position.set(
        CAVE_CENTER.x + Math.cos(a) * b.radius,
        CAVE_CENTER.y - 4 + b.height + Math.sin(t * 0.9 + b.phase * 3) * 1.6,
        CAVE_CENTER.z + Math.sin(a) * b.radius * 0.9,
      );
      o.rotation.set(0, Math.atan2(-vx, -vz), -dir * 0.35);
      o.scale.setScalar(1.15);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[geo, undefined, N]} frustumCulled={false}>
      <shaderMaterial
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          attribute float aPhase;
          uniform float uTime;
          void main(){
            vec3 p = position;
            float flap = sin(uTime * (14.0 + aPhase * 0.8) + aPhase * 40.0);
            p.y += abs(p.x) * flap * 0.55;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          void main(){ gl_FragColor = vec4(0.012, 0.018, 0.03, 1.0); }
        `}
      />
    </instancedMesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dust / steam particles                                                    */
/* -------------------------------------------------------------------------- */

function CaveParticles({
  count,
  center,
  extent,
  size,
  color,
  alpha,
  rise,
  drift,
  seed,
}: {
  count: number;
  center: V3;
  extent: V3;
  size: number;
  color: V3;
  alpha: number;
  rise: number;
  drift: number;
  seed: number;
}) {
  const dpr = useThree((s) => s.viewport.dpr);

  const data = useMemo(() => {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() - 0.5;
      pos[i * 3 + 1] = rnd();
      pos[i * 3 + 2] = rnd() - 0.5;
      rand[i * 4] = rnd();
      rand[i * 4 + 1] = rnd();
      rand[i * 4 + 2] = rnd();
      rand[i * 4 + 3] = rnd();
    }
    return { pos, rand };
  }, [count, seed]);

  const uniforms = useMemo(
    () => ({
      uTime: T,
      uVis: VIS,
      uPx: { value: dpr },
      uCenter: { value: new THREE.Vector3(...center) },
      uExtent: { value: new THREE.Vector3(...extent) },
      uSize: { value: size },
      uColor: { value: new THREE.Vector3(...color) },
      uAlpha: { value: alpha },
      uRise: { value: rise },
      uDrift: { value: drift },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dpr],
  );

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-aRand" args={[data.rand, 4]} />
      </bufferGeometry>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          attribute vec4 aRand;
          uniform float uTime;
          uniform float uVis;
          uniform float uPx;
          uniform vec3 uCenter;
          uniform vec3 uExtent;
          uniform float uSize;
          uniform float uAlpha;
          uniform float uRise;
          uniform float uDrift;
          varying float vA;
          void main(){
            float y01 = fract(position.y + uTime * uRise / uExtent.y * (0.5 + aRand.x));
            vec3 p = uCenter + vec3(position.x * uExtent.x, y01 * uExtent.y, position.z * uExtent.z);
            p.x += sin(uTime * 0.3 + aRand.y * 6.283) * uDrift * (1.0 + aRand.z);
            p.z += cos(uTime * 0.25 + aRand.z * 6.283) * uDrift;
            vA = uVis * uAlpha * sin(3.14159 * y01) * (0.55 + 0.45 * sin(uTime * (0.8 + aRand.w * 2.0) + aRand.y * 20.0));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(uSize * (0.6 + aRand.w) * uPx * 400.0 / max(-mv.z, 1.0), 1.2, 70.0 * uPx);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          varying float vA;
          void main(){
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vA;
            gl_FragColor = vec4(uColor * a, a);
          }
        `}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/*  Volumetric light shaft                                                    */
/* -------------------------------------------------------------------------- */

function Shaft({
  height,
  rTop = 0.5,
  rBottom = 8,
  opacity = 0.3,
  color = [0.5, 0.75, 1.0],
}: {
  height: number;
  rTop?: number;
  rBottom?: number;
  opacity?: number;
  color?: V3;
}) {
  const uniforms = useMemo(
    () => ({
      uTime: T,
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Vector3(...color) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opacity],
  );

  return (
    <mesh renderOrder={4}>
      <cylinderGeometry args={[rTop, rBottom, height, 32, 1, true]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          varying vec3 vW;
          varying float vH;
          void main(){
            vH = uv.y;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xyz;
            vec4 mv = viewMatrix * wp;
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec3 vN;
          varying vec3 vV;
          varying vec3 vW;
          varying float vH;
          ${GLSL_NOISE}
          void main(){
            float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
            float dust = 0.6 + 0.8 * fbm(vec2(vW.x * 0.15 + vW.z * 0.1, vW.y * 0.12 - uTime * 0.15));
            float a = f * pow(vH, 1.2) * smoothstep(0.0, 0.2, vH) * dust * uOpacity;
            gl_FragColor = vec4(uColor * a, a);
          }
        `}
      />
    </mesh>
  );
}

/* Rotating hazard beam: two opposite shafts spinning around Y. */
function SpinBeacon({
  position,
  color = [1.0, 0.55, 0.15],
  speed = 2.4,
}: {
  position: V3;
  color?: V3;
  speed?: number;
}) {
  const spin = useRef<THREE.Group>(null);
  useFrame(() => {
    if (spin.current) spin.current.rotation.y = T.value * speed;
  });

  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.35, 0.45, 0.5, 10]} />
        <meshStandardMaterial color="#0e1721" metalness={0.78} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <sphereGeometry args={[0.32, 10, 10]} />
        <meshBasicMaterial
          color={new THREE.Color(color[0], color[1], color[2]).multiplyScalar(3)}
          toneMapped={false}
        />
      </mesh>
      <group ref={spin} position={[0, 0.45, 0]}>
        {[0, Math.PI].map((a) => (
          <group key={a} rotation={[0, a, 0]}>
            <group rotation={[0, 0, -Math.PI / 2]}>
              <group position={[0, -5, 0]}>
                <Shaft height={10} rTop={0.25} rBottom={2.6} opacity={0.4} color={color} />
              </group>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Water, mist, waterfall                                                    */
/* -------------------------------------------------------------------------- */

function CaveWater() {
  const uniforms = useMemo(() => ({ uTime: T }), []);

  return (
    <mesh position={[0, WATER_Y, CAVE_CENTER.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[150, 150]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vWorld;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main(){
            vec3 V = normalize(cameraPosition - vWorld);
            vec2 p = vWorld.xz;
            float n1 = fbm(p * 0.35 + vec2(uTime * 0.05, uTime * 0.03));
            float n2 = fbm(p * 1.3 - vec2(uTime * 0.08, -uTime * 0.05));
            vec3 N = normalize(vec3((n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.12, 1.0, (n2 - 0.5) * 0.3));
            vec3 R = reflect(-V, N);
            float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);

            vec3 col = vec3(0.006, 0.02, 0.032);
            col += vec3(0.03, 0.08, 0.14) * fres * (0.6 + n1);

            float lamp = pow(max(dot(R, normalize(vec3(0.0, 0.92, -0.25))), 0.0), 60.0);
            col += vec3(0.35, 0.65, 1.0) * lamp * 1.6;

            // streak of the giant mainframe screen
            vec3 toS = normalize(vec3(${SCREEN.x.toFixed(1)}, ${SCREEN.y.toFixed(1)}, ${SCREEN.z.toFixed(1)}) - vWorld);
            float scr = pow(max(dot(R, toS), 0.0), 120.0);
            col += vec3(0.12, 0.4, 0.85) * scr * 2.2;

            float ring = exp(-abs(length(p - vec2(0.0, ${PLATFORM_Z.toFixed(1)})) - 27.0) * 0.45);
            col += vec3(0.1, 0.35, 0.7) * ring * (0.3 + 0.7 * n2) * 0.55;

            gl_FragColor = vec4(col, 0.93);
          }
        `}
      />
    </mesh>
  );
}

/* Low drifting mist hugging the basin. */
function WaterMist({ y, opacity, seed }: { y: number; opacity: number; seed: number }) {
  const uniforms = useMemo(
    () => ({ uTime: T, uOpacity: { value: opacity }, uSeed: { value: seed } }),
    [opacity, seed],
  );

  return (
    <mesh position={[0, y, CAVE_CENTER.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[140, 140]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vWorld;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          uniform float uSeed;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main(){
            vec2 p = vWorld.xz;
            float n  = fbm(p * 0.05 + vec2(uTime * 0.012, uSeed));
            float n2 = fbm(p * 0.13 - vec2(uTime * 0.02, uSeed * 2.0));
            float r = length(p - vec2(0.0, -390.0));
            float edge = smoothstep(60.0, 28.0, r);
            float a = smoothstep(0.36, 0.78, n * 0.6 + n2 * 0.5) * edge * uOpacity;
            gl_FragColor = vec4(0.28, 0.42, 0.6, a);
          }
        `}
      />
    </mesh>
  );
}

function Waterfall() {
  const uniforms = useMemo(() => ({ uTime: T }), []);

  return (
    <mesh position={[-34, 17.4, -438]} renderOrder={5}>
      <planeGeometry args={[8, 38]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
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
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            float x = vUv.x;
            float side = smoothstep(0.0, 0.2, x) * smoothstep(1.0, 0.8, x);
            float s1 = vnoise(vec2(x * 18.0, vUv.y * 5.0 + uTime * 2.2));
            float s2 = vnoise(vec2(x * 40.0 + 3.0, vUv.y * 9.0 + uTime * 3.4));
            float streak = smoothstep(0.35, 0.85, s1 * 0.6 + s2 * 0.5);
            float top = smoothstep(1.0, 0.97, vUv.y);
            float foam = smoothstep(0.12, 0.0, vUv.y);
            float a = (streak * 0.75 + foam * 0.5) * side * top;
            vec3 col = mix(vec3(0.35, 0.6, 0.85), vec3(0.9, 0.97, 1.0), streak * 0.7 + foam);
            gl_FragColor = vec4(col * 1.1, a * 0.75);
          }
        `}
      />
    </mesh>
  );
}

function PoolRipples() {
  const uniforms = useMemo(() => ({ uTime: T }), []);
  return (
    <mesh position={[-34, WATER_Y + 0.04, -436]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[18, 18]} />
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
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            float r = length(vUv - 0.5) * 18.0;
            float ring = pow(0.5 + 0.5 * sin(r * 3.2 - uTime * 2.6), 6.0);
            float fade = smoothstep(8.5, 2.0, r) * smoothstep(0.0, 1.2, r);
            float foam = smoothstep(3.4, 0.0, r) * (0.5 + 0.5 * vnoise(vUv * 40.0 + uTime));
            float a = (ring * 0.35 + foam * 0.6) * fade;
            gl_FragColor = vec4(vec3(0.8, 0.92, 1.0), a);
          }
        `}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Screens                                                                   */
/* -------------------------------------------------------------------------- */

const EMBLEM_HALF_PTS: [number, number][] = [
  [0, -50], [16, -82], [28, -54], [90, -66], [190, -60], [300, -22], [350, 22],
  [296, 14], [250, 40], [226, 30], [180, 68], [150, 56], [100, 96], [64, 70],
  [30, 86], [0, 100],
];

function wrapText(
  x: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (x.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

// Preview texture of the giant screen (the interactive DOM overlay replaces
// it once the camera has pushed in).
function makeScreenTexture(projects: CaveProject[]) {
  const W = 2048;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const rnd = mulberry32(5);

  x.fillStyle = "#020912";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(70,150,230,0.14)";
  x.lineWidth = 1;
  for (let i = 0; i <= W; i += 64) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, H);
    x.stroke();
  }
  for (let j = 0; j <= H; j += 64) {
    x.beginPath();
    x.moveTo(0, j);
    x.lineTo(W, j);
    x.stroke();
  }

  const cyan = "#7cc8ff";
  const dim = "rgba(124,200,255,0.6)";

  const panel = (px: number, py: number, pw: number, ph: number, title: string) => {
    x.fillStyle = "rgba(10,40,70,0.35)";
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = cyan;
    x.lineWidth = 3;
    x.strokeRect(px, py, pw, ph);
    x.fillStyle = cyan;
    x.font = "600 28px monospace";
    x.fillText(title, px + 24, py + 42);
    x.fillRect(px, py + 58, pw, 2);
  };

  x.fillStyle = cyan;
  x.font = "700 48px monospace";
  x.fillText("BATCOMPUTER // CAREER ARCHIVE", 60, 80);
  x.fillStyle = dim;
  x.font = "500 24px monospace";
  x.fillText("SESSION: TARUN J  ·  CLEARANCE: LEVEL 9  ·  STATUS: ONLINE", 60, 120);

  // achievements
  panel(60, 150, 900, 590, "ACHIEVEMENT LOG");
  ACHIEVEMENTS.forEach((a, i) => {
    const y = 230 + i * 128;
    x.fillStyle = cyan;
    x.fillRect(92, y - 30, 82, 36);
    x.fillStyle = "#02101e";
    x.font = "700 24px monospace";
    x.fillText(a.year, 106, y - 4);
    x.fillStyle = "#eaf6ff";
    x.font = "700 34px monospace";
    x.fillText(a.title.toUpperCase(), 196, y - 2);
    x.fillStyle = dim;
    x.font = "500 20px monospace";
    wrapText(x, a.text, 820, 2).forEach((l, k) => x.fillText(l, 96, y + 32 + k * 26));
  });

  // internships
  panel(1000, 150, 988, 590, "FIELD OPERATIONS // INTERNSHIPS");
  INTERNSHIPS.forEach((n, i) => {
    const y = 235 + i * 255;
    x.fillStyle = "rgba(124,200,255,0.08)";
    x.fillRect(1030, y - 40, 928, 232);
    x.fillStyle = "#eaf6ff";
    x.font = "700 40px monospace";
    x.fillText(n.company.toUpperCase(), 1056, y + 6);
    x.fillStyle = cyan;
    x.font = "600 24px monospace";
    x.fillText(`${n.role}  ·  ${n.period}`, 1056, y + 42);
    x.fillStyle = dim;
    x.font = "500 21px monospace";
    n.bullets.slice(0, 3).forEach((b, k) => {
      const l = wrapText(x, b, 880, 1)[0];
      x.fillText(`▸ ${l}${l.length < b.length ? "…" : ""}`, 1056, y + 80 + k * 30);
    });
  });

  // missions + feed
  panel(60, 770, 1928, 210, "ACTIVE MISSIONS // LIVE FEED");
  projects.forEach((p, i) => {
    x.fillStyle = cyan;
    x.font = "700 28px monospace";
    x.fillText(`${p.number} ${p.title.toUpperCase()}`, 92 + i * 370, 850);
    x.fillStyle = dim;
    x.font = "500 18px monospace";
    x.fillText(p.category, 92 + i * 370, 880);
  });
  x.fillStyle = dim;
  x.font = "500 20px monospace";
  for (let r = 0; r < 2; r++) {
    let line = "";
    for (let k = 0; k < 8; k++) {
      line += Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0").toUpperCase() + "  ";
    }
    x.fillText(`> ${line} ${["SYNC", "DEPLOY"][r]} OK`, 92, 925 + r * 32);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function MainScreen({ projects }: { projects: CaveProject[] }) {
  const tex = useMemo(() => makeScreenTexture(projects), [projects]);
  const uniforms = useMemo(() => ({ uTime: T, uTex: { value: tex } }), [tex]);
  const frame = { color: "#101a25", metalness: 0.8, roughness: 0.4 } as const;

  const { w, h } = SCREEN;
  const pylonTop = -(h / 2 + 1.2);
  const pylonBottom = -1.4 - SCREEN.y;
  const pylonH = pylonTop - pylonBottom;
  const pylonY = (pylonTop + pylonBottom) / 2;

  return (
    <group position={[SCREEN.x, SCREEN.y, SCREEN.z]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={/* glsl */ `
            varying vec2 vUv;
            void main(){
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={/* glsl */ `
            uniform sampler2D uTex;
            uniform float uTime;
            varying vec2 vUv;
            void main(){
              vec2 uv = vUv;
              float jitter = step(0.995, fract(sin(floor(uTime * 6.0) * 91.7) * 4375.5)) * 0.004;
              vec3 c = vec3(
                texture2D(uTex, uv + vec2(jitter + 0.0012, 0.0)).r,
                texture2D(uTex, uv + vec2(jitter, 0.0)).g,
                texture2D(uTex, uv + vec2(jitter - 0.0012, 0.0)).b
              );
              float scan = 0.9 + 0.1 * sin(uv.y * 1100.0 - uTime * 4.0);

              // explicit square (pow(negative, 2.0) is undefined in GLSL)
              float bd = (fract(uTime * 0.12) - uv.y) * 14.0;
              float band = exp(-bd * bd);

              float vig = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x)
                        * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.y);
              vec3 col = c * scan * (1.25 + band * 0.9) * vig + vec3(0.0, 0.012, 0.03);
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>

      <mesh position={[0, h / 2 + 0.6, 0]}><boxGeometry args={[w + 2.4, 1.2, 1.4]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[0, -h / 2 - 0.6, 0]}><boxGeometry args={[w + 2.4, 1.2, 1.4]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[-w / 2 - 0.6, 0, 0]}><boxGeometry args={[1.2, h + 2.4, 1.4]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[w / 2 + 0.6, 0, 0]}><boxGeometry args={[1.2, h + 2.4, 1.4]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[0, -h / 2 + 0.05, 0.72]}>
        <boxGeometry args={[w, 0.08, 0.06]} />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>
      <mesh position={[0, h / 2 - 0.05, 0.72]}>
        <boxGeometry args={[w, 0.06, 0.05]} />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>

      {[-w / 2 + 8, w / 2 - 8].map((px) => (
        <mesh key={px} position={[px, pylonY, -0.4]}>
          <boxGeometry args={[1.6, pylonH, 1.6]} />
          <meshStandardMaterial {...frame} />
        </mesh>
      ))}
    </group>
  );
}

function DataScreen({
  size,
  seed,
  color,
}: {
  size: [number, number];
  seed: number;
  color: V3;
}) {
  const uniforms = useMemo(
    () => ({ uTime: T, uSeed: { value: seed }, uColor: { value: new THREE.Vector3(...color) } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed],
  );

  return (
    <mesh>
            <planeGeometry args={size} />
      <shaderMaterial
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
          uniform float uSeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            vec2 g = vec2(vUv.x * 14.0, vUv.y * 18.0 - uTime * (0.4 + hash21(vec2(uSeed, 1.0)) * 0.8));
            float row = floor(g.y);
            float len = 0.25 + 0.7 * hash21(vec2(row, uSeed));
            float seg = step(0.3, hash21(vec2(floor(g.x), row + uSeed)));
            float on = seg * step(vUv.x, len) * step(fract(g.y), 0.62) * step(fract(g.x), 0.78);
            float edge = 1.0 - step(0.03, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
            float flick = 0.92 + 0.08 * sin(uTime * 30.0 + uSeed * 9.0);
            vec3 col = uColor * (0.1 + on * 1.2 + edge * 0.9) * flick;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/* Server rack front: grid of blinking LEDs. */
function RackFront({ seed, size }: { seed: number; size: [number, number] }) {
  const uniforms = useMemo(() => ({ uTime: T, uSeed: { value: seed } }), [seed]);
  return (
    <mesh>
      <planeGeometry args={size} />
      <shaderMaterial
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
          uniform float uSeed;
          varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            vec2 g = vec2(vUv.x * 8.0, vUv.y * 44.0);
            vec2 id = floor(g);
            vec2 f = fract(g) - 0.5;
            float led = smoothstep(0.3, 0.12, length(f * vec2(1.0, 1.6)));
            float r = hash21(id + uSeed * 7.0);
            float blink = step(0.5, fract(uTime * (0.5 + r * 3.0) + r * 10.0));
            float on = step(0.35, r);
            vec3 c = r < 0.7 ? vec3(0.1, 0.7, 1.0) : (r < 0.9 ? vec3(0.2, 1.0, 0.4) : vec3(1.0, 0.5, 0.1));
            float bay = step(0.92, fract(vUv.y * 11.0));
            vec3 col = vec3(0.01, 0.015, 0.02) + vec3(0.02, 0.03, 0.04) * bay
                     + c * led * on * (0.4 + 0.8 * blink) * 1.6;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Batmobile on a slow turntable                                             */
/* -------------------------------------------------------------------------- */

function Batmobile() {
  const turntable = useRef<THREE.Group>(null);
  const jet = useRef<THREE.Mesh>(null);

  const bodyGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-3.2, 0.3);
    s.lineTo(-3.3, 0.95);
    s.lineTo(-1.9, 1.02);
    s.lineTo(0.4, 0.92);
    s.lineTo(2.6, 0.66);
    s.lineTo(3.55, 0.46);
    s.lineTo(3.45, 0.3);
    s.lineTo(2.8, 0.22);
    s.lineTo(-3.0, 0.22);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 1.9,
      bevelEnabled: true,
      bevelSize: 0.12,
      bevelThickness: 0.12,
      bevelSegments: 2,
      steps: 1,
    });
    g.translate(0, 0, -0.95);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, []);

  useFrame((_, dt) => {
    if (turntable.current) turntable.current.rotation.y += Math.min(dt, 0.05) * 0.12;
    if (jet.current) {
      jet.current.scale.set(1, 0.85 + 0.3 * Math.sin(T.value * 40) + 0.1 * Math.sin(T.value * 13), 1);
    }
  });

  const paint = { color: "#080c12", metalness: 0.88, roughness: 0.26 } as const;
  const tyre = { color: "#04060a", roughness: 0.9, metalness: 0.1 } as const;
  const trim = { color: "#0a1018", metalness: 0.9, roughness: 0.35 } as const;

  const wheel = (x: number, z: number, r: number, w: number, key: string) => (
    <group key={key} position={[x, r, z]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, w, 28]} />
        <meshStandardMaterial {...tyre} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.58, r * 0.58, w + 0.04, 20]} />
        <meshStandardMaterial color="#1b2a3a" metalness={0.9} roughness={0.3} />
      </mesh>
      {[0, 1, 2].map((k) => (
        <mesh key={k} rotation={[(k * Math.PI) / 3, 0, 0]}>
          <boxGeometry args={[w + 0.07, r * 1.05, 0.05]} />
          <meshStandardMaterial {...trim} />
        </mesh>
      ))}
      <mesh position={[Math.sign(x) * (w / 2 + 0.01), 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[r * 0.62, 0.04, 6, 28]} />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>
    </group>
  );

  return (
    <group position={[0, PLATFORM_TOP + 0.2, -398]} scale={1.35}>
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[5.6, 5.8, 0.24, 48]} />
        <meshStandardMaterial color="#121e2b" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.5, 0.05, 6, 64]} />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>

      <group ref={turntable} rotation={[0, -0.55, 0]}>
        <mesh geometry={bodyGeo}>
          <meshStandardMaterial {...paint} />
        </mesh>

        {/* Canopy */}
        <mesh position={[0, 1.0, -0.2]} scale={[0.85, 0.5, 1.7]}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color="#03060a"
            metalness={0.9}
            roughness={0.1}
            emissive="#0a2a44"
            emissiveIntensity={0.6}
          />
        </mesh>

        {/* Tail fins */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.95, 1.5, -2.7]} rotation={[-0.35, 0, s * 0.12]}>
            <boxGeometry args={[0.1, 1.5, 1.4]} />
            <meshStandardMaterial {...paint} />
          </mesh>
        ))}

        {/* Rear wing + struts */}
        <mesh position={[0, 1.95, -3.05]}>
          <boxGeometry args={[2.3, 0.07, 0.7]} />
          <meshStandardMaterial {...paint} />
        </mesh>
        {[-0.8, 0.8].map((x) => (
          <mesh key={x} position={[x, 1.55, -3.0]}>
            <boxGeometry args={[0.07, 0.8, 0.18]} />
            <meshStandardMaterial {...trim} />
          </mesh>
        ))}

        {/* Front splitter + machine cannons */}
        <mesh position={[0, 0.2, 3.62]}>
          <boxGeometry args={[2.1, 0.06, 0.55]} />
          <meshStandardMaterial {...trim} />
        </mesh>
        {[-0.42, 0.42].map((x) => (
          <mesh key={x} position={[x, 0.55, 3.55]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.07, 0.8, 8]} />
            <meshStandardMaterial {...trim} />
          </mesh>
        ))}

        {/* Side intakes with glow edges + panel lines */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 1.0, 0.56, 0.5]}>
              <boxGeometry args={[0.45, 0.34, 1.7]} />
              <meshStandardMaterial color="#02050a" metalness={0.6} roughness={0.5} />
            </mesh>
            <mesh position={[s * 1.0, 0.56, 1.37]}>
              <boxGeometry args={[0.38, 0.04, 0.03]} />
              <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
            </mesh>
            <mesh position={[s * 1.06, 0.78, 0.2]}>
              <boxGeometry args={[0.02, 0.03, 4.4]} />
              <meshBasicMaterial color={new THREE.Color(0.2, 0.5, 1.1)} toneMapped={false} />
            </mesh>
          </group>
        ))}

        {/* Wheels */}
        {wheel(-1.35, -2.0, 0.72, 0.8, "rl")}
        {wheel(1.35, -2.0, 0.72, 0.8, "rr")}
        {wheel(-1.15, 2.2, 0.5, 0.5, "fl")}
        {wheel(1.15, 2.2, 0.5, 0.5, "fr")}

        {/* Jet turbine (points backwards) */}
        <mesh position={[0, 0.72, -3.9]}>
          <cylinderGeometry args={[0.46, 0.5, 0.5, 20, 1, true]} />
          <meshStandardMaterial color="#04070b" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.72, -4.16]}>
          <torusGeometry args={[0.46, 0.05, 8, 24]} />
          <meshBasicMaterial color={new THREE.Color(1.4, 2.4, 4)} toneMapped={false} />
        </mesh>
        <mesh ref={jet} position={[0, 0.72, -4.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.34, 0.9, 16]} />
          <meshBasicMaterial color={new THREE.Color(1.2, 2.2, 4)} toneMapped={false} />
        </mesh>

        {/* Lights */}
        {[-0.7, 0.7].map((x) => (
          <mesh key={x} position={[x, 0.5, 3.52]}>
            <boxGeometry args={[0.5, 0.07, 0.05]} />
            <meshBasicMaterial color={BULB} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 0.72, -3.36]}>
          <boxGeometry args={[1.7, 0.06, 0.05]} />
          <meshBasicMaterial color={new THREE.Color(3, 0.2, 0.15)} toneMapped={false} />
        </mesh>

        {/* Underglow */}
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[3.4, 40]} />
          <meshBasicMaterial color="#2b82bd" transparent opacity={0.18} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Suit display cases                                                        */
/* -------------------------------------------------------------------------- */

function SuitCase({
  position,
  rotY,
  accent,
}: {
  position: V3;
  rotY: number;
  accent: string;
}) {
  const suit = { color: "#05080d", metalness: 0.5, roughness: 0.45 } as const;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, -0.8, 0]}>
        <boxGeometry args={[5, 2.2, 4]} />
        <meshStandardMaterial color="#0e1721" metalness={0.7} roughness={0.5} />
      </mesh>
      {/* plaque + base glow */}
      <mesh position={[0, -0.55, 2.02]}>
        <boxGeometry args={[2.4, 0.28, 0.04]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 1.75, 40]} />
        <meshBasicMaterial color={accent} transparent opacity={0.5} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, 3.6, 0]}>
        <boxGeometry args={[3.4, 7, 2.6]} />
        <meshStandardMaterial color="#6fb6ff" transparent opacity={0.1} roughness={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[0, 3.6, -1.25]}>
        <planeGeometry args={[3.2, 6.8]} />
        <meshBasicMaterial color={accent} transparent opacity={0.28} toneMapped={false} />
      </mesh>

      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.7, 3.6, sz * 1.3]}>
            <boxGeometry args={[0.14, 7.2, 0.14]} />
            <meshStandardMaterial color="#182330" metalness={0.8} roughness={0.35} />
          </mesh>
        )),
      )}
      <mesh position={[0, 7.25, 0]}>
        <boxGeometry args={[3.5, 0.2, 2.7]} />
        <meshStandardMaterial color="#182330" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 7.1, 1.2]}>
        <boxGeometry args={[3.0, 0.05, 0.05]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>

      <group>
        <mesh position={[0, 4.1, 0]}><boxGeometry args={[1.1, 1.7, 0.6]} /><meshStandardMaterial {...suit} /></mesh>
        <mesh position={[0, 5.3, 0]}><sphereGeometry args={[0.42, 14, 12]} /><meshStandardMaterial {...suit} /></mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.22, 5.85, 0]} rotation={[0, 0, -s * 0.12]}>
            <coneGeometry args={[0.1, 0.55, 4]} />
            <meshStandardMaterial {...suit} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <group key={`a${s}`}>
            <mesh position={[s * 0.75, 4.2, 0]} rotation={[0, 0, s * 0.08]}><boxGeometry args={[0.32, 1.5, 0.35]} /><meshStandardMaterial {...suit} /></mesh>
            <mesh position={[s * 0.3, 2.35, 0]}><boxGeometry args={[0.42, 2.3, 0.4]} /><meshStandardMaterial {...suit} /></mesh>
          </group>
        ))}
        <mesh position={[0, 4.35, 0.32]}>
          <boxGeometry args={[0.4, 0.22, 0.03]} />
          <meshBasicMaterial color={accent} toneMapped={false} />
        </mesh>
        <mesh position={[0, 3.2, -0.3]}>
          <planeGeometry args={[1.6, 3.4]} />
          <meshStandardMaterial color="#020306" roughness={1} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hologram globe over a pedestal                                            */
/* -------------------------------------------------------------------------- */

function HoloGlobe({ position }: { position: V3 }) {
  const globe = useRef<THREE.Group>(null);
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const scan = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const t = T.value;
    if (globe.current) globe.current.rotation.y = t * 0.4;
    if (r1.current) r1.current.rotation.x = t * 0.7;
    if (r2.current) r2.current.rotation.z = t * 0.55;
    if (scan.current) scan.current.position.y = 4 + Math.sin(t * 0.9) * 2.1;
  });

  const holo = {
    color: GLOW_BLUE,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  } as const;

  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[1.5, 1.9, 1.2, 28]} />
        <meshStandardMaterial color="#111c28" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.45, 0.05, 6, 40]} />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>

      <group position={[0, 4, 0]}>
        <group ref={globe}>
          <mesh>
            <icosahedronGeometry args={[2.1, 2]} />
            <meshBasicMaterial {...holo} wireframe opacity={0.5} />
          </mesh>
          <mesh scale={0.96}>
            <sphereGeometry args={[2.1, 24, 16]} />
            <meshBasicMaterial {...holo} opacity={0.06} />
          </mesh>
        </group>
        <mesh ref={r1} rotation={[0.4, 0, 0]}>
          <torusGeometry args={[2.7, 0.025, 6, 80]} />
          <meshBasicMaterial {...holo} opacity={0.8} />
        </mesh>
        <mesh ref={r2} rotation={[1.2, 0.3, 0]}>
          <torusGeometry args={[3.1, 0.02, 6, 80]} />
          <meshBasicMaterial {...holo} opacity={0.6} />
        </mesh>
      </group>

      <mesh ref={scan} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 2.35, 48]} />
        <meshBasicMaterial {...holo} opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Platform rim, rails, road dashes, tunnel lamps, hazard strips             */
/* -------------------------------------------------------------------------- */

function PlatformRim() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 72;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      o.position.set(Math.cos(a) * 23.4, -0.6, PLATFORM_Z + Math.sin(a) * 23.4);
      o.rotation.set(0, -a, 0);
      o.scale.set(0.5, 0.08, 0.2);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
    </instancedMesh>
  );
}

function angGap(a: number) {
  return Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
}

function buildPlatformRails() {
  const posts: Item[] = [];
  const rails: Item[] = [];
  const N = 72;
  const R = 23.0;
  const GAP = 0.3; // opening for the road

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const a2 = ((i + 1) / N) * Math.PI * 2;
    if (angGap(a) < GAP) continue;

    posts.push({
      p: [Math.cos(a) * R, PLATFORM_TOP + 0.55, PLATFORM_Z + Math.sin(a) * R],
      s: [0.1, 1.1, 0.1],
    });

    if (angGap(a2) < GAP) continue;
    const am = (a + a2) / 2;
    const half = (a2 - a) / 2;
    const len = 2 * R * Math.sin(half);
    const rm = R * Math.cos(half);
    [0.55, 1.05].forEach((h) =>
      rails.push({
        p: [Math.cos(am) * rm, PLATFORM_TOP + h, PLATFORM_Z + Math.sin(am) * rm],
        s: [len, 0.05, 0.05],
        ry: -(am + Math.PI / 2),
      }),
    );
  }
  return { posts, rails };
}

function RoadDashes() {
  const items = useMemo<Item[]>(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        p: [0, -1.43, -262 - i * 3.3] as V3,
        s: [0.25, 0.03, 1.6] as V3,
      })),
    [],
  );
  return (
    <Inst items={items}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={new THREE.Color(2.2, 1.4, 0.4)} toneMapped={false} />
    </Inst>
  );
}

function TunnelLamps() {
  const lamp = useRef<THREE.InstancedMesh>(null);
  const housing = useRef<THREE.InstancedMesh>(null);

  const list = useMemo(() => {
    const a: { x: number; z: number; amber: boolean }[] = [];
    for (let i = 0; i < 14; i++) {
      for (const s of [-1, 1]) a.push({ x: s * 13.95, z: -262 - i * 6.4, amber: i % 4 === 3 });
    }
    return a;
  }, []);

  useLayoutEffect(() => {
    const L = lamp.current;
    const H = housing.current;
    if (!L || !H) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    list.forEach((l, i) => {
      o.rotation.set(0, 0, 0);
      o.position.set(l.x, TUNNEL_CY + 1.4, l.z);
      o.scale.set(0.18, 0.55, 1.5);
      o.updateMatrix();
      L.setMatrixAt(i, o.matrix);
      if (l.amber) c.setRGB(3.2, 1.6, 0.35);
      else c.setRGB(1.8, 2.5, 3.4);
      L.setColorAt(i, c);

      o.position.set(l.x * 1.012, TUNNEL_CY + 1.4, l.z);
      o.scale.set(0.32, 0.8, 1.8);
      o.updateMatrix();
      H.setMatrixAt(i, o.matrix);
    });
    L.instanceMatrix.needsUpdate = true;
    if (L.instanceColor) L.instanceColor.needsUpdate = true;
    H.instanceMatrix.needsUpdate = true;
  }, [list]);

  return (
    <>
      <instancedMesh ref={housing} args={[undefined, undefined, list.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0a1018" metalness={0.8} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={lamp} args={[undefined, undefined, list.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function makeHazard(rx: number, ry: number) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0d10";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#c9a227";
  for (let i = -128; i < 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 32, 128);
    g.lineTo(i + 160, 0);
    g.lineTo(i + 128, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* -------------------------------------------------------------------------- */
/*  Catwalk ring around the left side of the chamber                          */
/* -------------------------------------------------------------------------- */

function buildCatwalk() {
  const deck: Item[] = [];
  const rails: Item[] = [];
  const posts: Item[] = [];
  const glow: Item[] = [];
  const legs: Item[] = [];

  const N = 56;
  const R = 60;
  const Y = 12.5;
  const a0 = Math.PI - 0.95;
  const a1 = Math.PI + 0.75;
  const step = (a1 - a0) / N;

  for (let i = 0; i < N; i++) {
    const a = a0 + (i + 0.5) * step;
    const len = step * R * 1.03;
    const ry = -(a + Math.PI / 2);
    const at = (r: number, y: number): V3 => [
      CAVE_CENTER.x + Math.cos(a) * r,
      y,
      CAVE_CENTER.z + Math.sin(a) * r,
    ];

    deck.push({ p: at(R, Y), s: [len, 0.25, 2.6], ry });
    glow.push({ p: at(R - 1.27, Y - 0.05), s: [len, 0.05, 0.08], ry });

    [-1.2, 1.2].forEach((o) => {
      rails.push({ p: at(R + o, Y + 1.1), s: [len, 0.07, 0.07], ry });
      rails.push({ p: at(R + o, Y + 0.55), s: [len, 0.05, 0.05], ry });
    });

    if (i % 2 === 0) {
      [-1.2, 1.2].forEach((o) => posts.push({ p: at(R + o, Y + 0.55), s: [0.12, 1.1, 0.12] }));
    }
    if (i % 6 === 0) {
      legs.push({ p: at(R, 3.1), s: [0.5, 18.2, 0.5] });
    }
  }
  return { deck, rails, posts, glow, legs };
}

/* -------------------------------------------------------------------------- */
/*  Mountain: layout, raycast-snapped trees and beacons                       */
/* -------------------------------------------------------------------------- */

type RockRow = [number, number, number, number, number, number, number, number];

const ENTRANCE_ROCKS: RockRow[] = [
  [-30, 4, -259, 11, 18, 9, 0, 0.3],
  [-31, 32, -261, 12, 13, 9, 1, 1.2],
  [-21, 47, -262, 11, 10, 8, 2, 2.0],
  [-34, -14, -258, 12, 16, 9, 2, 0.2],
  [30, 6, -259, 11, 17, 9, 1, 2.2],
  [31, 33, -261, 12, 13, 9, 2, 0.4],
  [21, 47, -262, 11, 10, 8, 0, 1.4],
  [34, -14, -258, 12, 16, 9, 0, 2.9],
  [0, 40, -261, 17, 11, 9, 1, 0.7],
  [0, 53, -266, 12, 9, 8, 2, 1.9],
];

// Wider massif behind and around the face, so the mountain has real mass from afar.
// (Nothing low near x = 0: the tunnel runs through there.)
const MASSIF: RockRow[] = [
  [-58, 8, -268, 22, 40, 18, 0, 0.5],
  [58, 8, -268, 22, 40, 18, 1, 2.1],
  [-42, 30, -280, 20, 30, 16, 2, 1.0],
  [42, 30, -280, 20, 30, 16, 0, 0.2],
  [0, 62, -282, 30, 26, 18, 1, 0.9],
  [-22, 55, -278, 18, 18, 14, 2, 0.6],
  [22, 55, -278, 18, 18, 14, 0, 1.7],
  [-84, -4, -262, 24, 32, 18, 1, 0.2],
  [84, -4, -262, 24, 32, 18, 2, 2.4],
];

const MOUNTAIN_BOXES: [number, number, number, number, number, number][] = [
  [-25, -14.5, -263, 28, 111, 12],
  [25, -14.5, -263, 28, 111, 12],
  [0, 39, -263, 24, 14, 12],
  [0, -36.8, -263, 24, 66.6, 12],
];

function buildMountain(crag: THREE.BufferGeometry[]) {
  const basic = new THREE.MeshBasicMaterial();
  const meshes: THREE.Mesh[] = [];

  [...ENTRANCE_ROCKS, ...MASSIF].forEach(([x, y, z, sx, sy, sz, gi, ry]) => {
    const m = new THREE.Mesh(crag[gi], basic);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(0, ry, 0);
    m.updateMatrixWorld(true);
    meshes.push(m);
  });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  MOUNTAIN_BOXES.forEach(([x, y, z, w, h, d]) => {
    const m = new THREE.Mesh(boxGeo, basic);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.updateMatrixWorld(true);
    meshes.push(m);
  });

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const rnd = mulberry32(2025);

  const dropAt = (x: number, z: number) => {
    origin.set(x, 160, z);
    ray.set(origin, down);
    return ray.intersectObjects(meshes, false)[0];
  };

  const trees: Item[] = [];
  for (let i = 0; i < 900 && trees.length < 190; i++) {
    const x = (rnd() * 2 - 1) * 84;
    const z = -298 + rnd() * 48;
    const hit = dropAt(x, z);
    if (!hit || !hit.face || hit.point.y < 20) continue;
    nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (nrm.y < 0.55) continue;
    const w = 1.3 + rnd() * 1.7;
    trees.push({
      p: [hit.point.x, hit.point.y - 0.35, hit.point.z],
      s: [w, 5 + rnd() * 10, w],
      ry: rnd() * 6.28,
    });
  }

  const beacons: V3[] = (
    [
      [-21, -262],
      [21, -262],
      [0, -266],
    ] as [number, number][]
  ).map(([x, z]) => {
    const h = dropAt(x, z);
    return [x, (h ? h.point.y : 58) + 0.6, z] as V3;
  });

  return { trees, beacons };
}

function Blink({ position, offset }: { position: V3; offset: number }) {
  const m = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!m.current) return;
    const on = (T.value * 0.5 + offset) % 1 < 0.14;
    m.current.color.setRGB(1, 0.08, 0.05).multiplyScalar(on ? 9 : 0.5);
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.45, 10, 10]} />
      <meshBasicMaterial ref={m} toneMapped={false} />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*  Misc layout data                                                          */
/* -------------------------------------------------------------------------- */

const RUBBLE: [number, number, number, number][] = [
  [-7, -1.2, -268, 2.4], [7, -1.3, -279, 1.9], [-7.5, -1.2, -296, 3],
  [7, -1.2, -306, 2.2], [-7, -1.2, -322, 2.6], [7.5, -1.2, -335, 3.1],
  [-6.5, -1.2, -348, 2], [7, -1.2, -356, 2.6],
];

const LAMPS: V3[] = [
  [-24, 34, -368], [24, 36, -372], [-14, 38, -412], [16, 35, -416], [0, 40, -398],
];

const SUIT_CASES: { position: V3; rotY: number; accent: string }[] = [
  { position: [34, -0.2, -436], rotY: 0.5, accent: "#6fb6ff" },
  { position: [40, -0.2, -428], rotY: 0.8, accent: "#ff4d5e" },
  { position: [45, -0.2, -418], rotY: 1.05, accent: "#6fb6ff" },
  { position: [48, -0.2, -407], rotY: 1.25, accent: "#ffd24d" },
];

// (renamed: caveState.ts also has a RACK_X, for the weapon racks)
const SERVER_RACK_X = [-15.5, -18.1, -20.7, -23.3];

/* ========================================================================== */
/*  NEW: ARSENAL, LANDING FX, ARCADE MONITOR, CAMERA DIRECTOR                  */
/* ========================================================================== */

// Must match RACK_X in caveState.ts (rackFocus() uses that one).
const ARSENAL_X = [-22.5, -8.1, 8.1, 22.5];
const ARSENAL_Z = [-376, -383, -383, -376];

const EYE_Y = 3.4; // hero eye level on the platform
const LAND_Z = -367; // where the hero touches down (near the ramp)
const FALL_Y = 34;
const FALL_Z = -376;

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = THREE.MathUtils.clamp(x, 0, 1) - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
};

const hexToV3 = (hex: string): V3 => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/* ---- weapon kinds: one per skill ---- */

type Kind =
  | "katana" | "dagger" | "hammer" | "bolt" | "staff" | "cell"
  | "baton" | "claw" | "trident" | "orb" | "batarang" | "grapple"
  | "atom" | "shuriken" | "hex" | "branch" | "crate" | "triangle";

const WEAPON_NAME: Record<Kind, string> = {
  katana: "KATANA", dagger: "COMBAT KNIFE", hammer: "WAR HAMMER", bolt: "ARC BOLT",
  staff: "BO STAFF", cell: "DATA CORE", baton: "PLASMA BATON", claw: "CLAW GAUNTLET",
  trident: "TRIDENT", orb: "NEURAL ORB", batarang: "BATARANG", grapple: "GRAPPLE GUN",
  atom: "ATOM CORE", shuriken: "SHURIKEN", hex: "HEX BLADE", branch: "FORK BLADE",
  crate: "CARGO POD", triangle: "DELTA BLADE",
};

type Skill = { name: string; kind: Kind };

const RACKS: { title: string; sub: string; color: string; skills: Skill[] }[] = [
  {
    title: "CORE ARSENAL", sub: "LANGUAGES", color: "#ffb23d",
    skills: [
      { name: "Python", kind: "katana" }, { name: "C", kind: "dagger" },
      { name: "C++", kind: "hammer" }, { name: "JavaScript", kind: "bolt" },
      { name: "TypeScript", kind: "staff" }, { name: "SQL", kind: "cell" },
    ],
  },
  {
    title: "AI / ML", sub: "INTELLIGENCE", color: "#4dd8ff",
    skills: [
      { name: "NumPy", kind: "baton" }, { name: "Pandas", kind: "claw" },
      { name: "scikit-learn", kind: "trident" }, { name: "PyTorch", kind: "orb" },
      { name: "NLP", kind: "batarang" }, { name: "RAG", kind: "grapple" },
    ],
  },
  {
    title: "WEB & APIS", sub: "INTERFACES", color: "#b48cff",
    skills: [
      { name: "React", kind: "atom" }, { name: "Next.js", kind: "shuriken" },
      { name: "FastAPI", kind: "bolt" }, { name: "Node.js", kind: "hex" },
      { name: "REST APIs", kind: "staff" }, { name: "Tailwind CSS", kind: "claw" },
    ],
  },
  {
    title: "DEPLOYMENT", sub: "OPERATIONS", color: "#4dffb0",
    skills: [
      { name: "Git", kind: "branch" }, { name: "Docker", kind: "crate" },
      { name: "Vercel", kind: "triangle" }, { name: "MySQL", kind: "cell" },
      { name: "MongoDB", kind: "cell" }, { name: "ServiceNow", kind: "baton" },
    ],
  },
];

// 3 columns x 2 rows per rack. y = hang point under the rail.
const SLOTS = Array.from({ length: 6 }, (_, k) => ({
  x: ((k % 3) - 1) * 4,
  y: k < 3 ? 12.8 : 7.5,
  labelY: k < 3 ? 8.6 : 3.25,
}));

/* ---- shared weapon geometry / materials (module level, built once) ---- */

function extrudePts(pts: [number, number][], depth: number, scale = 1) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * scale, y * scale)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

const WG = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  hex: new THREE.CylinderGeometry(1, 1, 1, 6),
  tri: new THREE.CylinderGeometry(1, 1, 1, 3),
  pyr: new THREE.ConeGeometry(1, 1, 4),
  sph: new THREE.SphereGeometry(1, 16, 12),
  ico: new THREE.IcosahedronGeometry(1, 1),
  tor: new THREE.TorusGeometry(1, 0.08, 6, 32),
  hook: new THREE.TorusGeometry(0.4, 0.07, 6, 20, Math.PI * 1.3),
  bolt: extrudePts(
    [[0.25, 0], [-0.55, -1.2], [-0.05, -1.2], [-0.35, -2.4], [0.6, -0.95], [0.08, -0.95], [0.45, 0]],
    0.14,
  ),
  star: extrudePts(
    Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 0.3 : 1;
      return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
    }),
    0.07,
  ),
  bat: extrudePts(
    [
      ...EMBLEM_HALF_PTS,
      ...[...EMBLEM_HALF_PTS].reverse().map(([x, y]) => [-x, y] as [number, number]),
    ].map(([x, y]) => [x, -y] as [number, number]),
    0.08,
    0.0045,
  ),
};

const STEEL = new THREE.MeshStandardMaterial({ color: "#c3d0e0", metalness: 0.9, roughness: 0.28 });
const DARK = new THREE.MeshStandardMaterial({ color: "#141b26", metalness: 0.7, roughness: 0.45 });

function Pc({
  g,
  m,
  p = [0, 0, 0],
  s = [1, 1, 1],
  r,
}: {
  g: THREE.BufferGeometry;
  m: THREE.Material;
  p?: V3;
  s?: V3;
  r?: V3;
}) {
  return <mesh geometry={g} material={m} position={p} scale={s} rotation={r} />;
}

const SPINNERS: Kind[] = ["shuriken", "orb", "atom", "hex", "triangle"];

/* One weapon. Local origin = hang point; the weapon extends along -y. */
function Weapon({
  kind,
  glow,
  wire,
}: {
  kind: Kind;
  glow: THREE.Material;
  wire: THREE.Material;
}) {
  const spin = useRef<THREE.Group>(null);

  useFrame(() => {
    const s = spin.current;
    if (!s) return;
    const t = T.value;
    if (kind === "shuriken") s.rotation.z = t * 1.8;
    else s.rotation.y = t * 0.9;
  });

  const hook = <Pc g={WG.tor} m={STEEL} p={[0, 0.1, 0]} s={[0.15, 0.15, 0.15]} />;

  if (SPINNERS.includes(kind)) {
    return (
      <group>
        {hook}
        <Pc g={WG.cyl} m={STEEL} p={[0, -0.3, 0]} s={[0.015, 0.6, 0.015]} />
        <group ref={spin} position={[0, -1.35, 0]}>
          {kind === "shuriken" && (
            <>
              <Pc g={WG.star} m={STEEL} s={[0.95, 0.95, 1]} />
              <Pc g={WG.sph} m={glow} s={[0.17, 0.17, 0.17]} />
              <Pc g={WG.tor} m={glow} s={[0.42, 0.42, 0.42]} />
            </>
          )}
          {kind === "orb" && (
            <>
              <Pc g={WG.ico} m={wire} s={[0.85, 0.85, 0.85]} />
              <Pc g={WG.sph} m={glow} s={[0.34, 0.34, 0.34]} />
            </>
          )}
          {kind === "atom" && (
            <>
              <Pc g={WG.sph} m={glow} s={[0.26, 0.26, 0.26]} />
              <Pc g={WG.tor} m={glow} s={[0.85, 0.85, 0.85]} />
              <Pc g={WG.tor} m={glow} s={[0.85, 0.85, 0.85]} r={[Math.PI / 2, 0, 0]} />
              <Pc g={WG.tor} m={glow} s={[0.85, 0.85, 0.85]} r={[0, Math.PI / 2, 0]} />
            </>
          )}
          {kind === "hex" && (
            <>
              <Pc g={WG.hex} m={DARK} s={[0.8, 0.3, 0.8]} r={[Math.PI / 2, 0, 0]} />
              <Pc g={WG.hex} m={glow} s={[0.5, 0.34, 0.5]} r={[Math.PI / 2, 0, 0]} />
            </>
          )}
          {kind === "triangle" && (
            <>
              <Pc g={WG.tri} m={DARK} s={[1.0, 0.26, 1.0]} r={[Math.PI / 2, 0, 0]} />
              <Pc g={WG.tri} m={glow} s={[0.62, 0.3, 0.62]} r={[Math.PI / 2, 0, 0]} />
            </>
          )}
        </group>
      </group>
    );
  }

  switch (kind) {
    case "katana":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={DARK} p={[0, -0.6, 0]} s={[0.09, 1.0, 0.09]} />
          <Pc g={WG.cyl} m={glow} p={[0, -1.12, 0]} s={[0.26, 0.06, 0.2]} />
          <Pc g={WG.box} m={STEEL} p={[0, -2.4, 0]} s={[0.13, 2.5, 0.04]} />
          <Pc g={WG.box} m={glow} p={[0.07, -2.4, 0]} s={[0.02, 2.5, 0.05]} />
          <Pc g={WG.pyr} m={STEEL} p={[0, -3.8, 0]} s={[0.1, 0.3, 0.03]} r={[0, 0, Math.PI]} />
        </group>
      );
    case "dagger":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={DARK} p={[0, -0.5, 0]} s={[0.08, 0.7, 0.08]} />
          <Pc g={WG.box} m={glow} p={[0, -0.9, 0]} s={[0.7, 0.07, 0.14]} />
          <Pc g={WG.pyr} m={STEEL} p={[0, -1.95, 0]} s={[0.2, 2.0, 0.06]} r={[0, 0, Math.PI]} />
          <Pc g={WG.box} m={glow} p={[0, -1.7, 0.04]} s={[0.025, 1.4, 0.02]} />
        </group>
      );
    case "hammer":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={DARK} p={[0, -1.4, 0]} s={[0.07, 2.6, 0.07]} />
          <Pc g={WG.box} m={STEEL} p={[0, -3.0, 0]} s={[1.2, 0.75, 0.75]} />
          <Pc g={WG.box} m={glow} p={[0, -3.0, 0]} s={[1.24, 0.1, 0.79]} />
          <Pc g={WG.box} m={glow} p={[0.61, -3.0, 0]} s={[0.03, 0.6, 0.6]} />
        </group>
      );
    case "bolt":
      return (
        <group>
          {hook}
          <Pc g={WG.bolt} m={glow} p={[0, -0.1, 0]} s={[1.5, 1.5, 1]} />
        </group>
      );
    case "staff":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={STEEL} p={[0, -1.9, 0]} s={[0.06, 3.6, 0.06]} />
          {[-0.4, -1.9, -3.4].map((y) => (
            <Pc key={y} g={WG.cyl} m={glow} p={[0, y, 0]} s={[0.085, 0.25, 0.085]} />
          ))}
          <Pc g={WG.sph} m={glow} p={[0, -3.75, 0]} s={[0.11, 0.11, 0.11]} />
        </group>
      );
    case "cell":
      return (
        <group>
          {hook}
          {[-0.75, -1.3, -1.85].map((y) => (
            <group key={y}>
              <Pc g={WG.cyl} m={DARK} p={[0, y, 0]} s={[0.78, 0.44, 0.78]} />
              <Pc g={WG.cyl} m={glow} p={[0, y + 0.22, 0]} s={[0.81, 0.05, 0.81]} />
            </group>
          ))}
        </group>
      );
    case "baton":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={DARK} p={[0, -1.7, 0]} s={[0.1, 3.0, 0.1]} />
          {[-0.6, -1.7, -2.8].map((y) => (
            <Pc key={y} g={WG.tor} m={glow} p={[0, y, 0]} s={[0.15, 0.15, 0.15]} r={[Math.PI / 2, 0, 0]} />
          ))}
          <Pc g={WG.sph} m={glow} p={[0, -3.25, 0]} s={[0.17, 0.17, 0.17]} />
        </group>
      );
    case "claw":
      return (
        <group>
          {hook}
          <Pc g={WG.box} m={DARK} p={[0, -0.4, 0]} s={[1.2, 0.5, 0.3]} />
          <Pc g={WG.box} m={glow} p={[0, -0.4, 0.16]} s={[1.0, 0.06, 0.02]} />
          {[-0.4, 0, 0.4].map((x, i) => (
            <Pc
              key={x}
              g={WG.pyr}
              m={STEEL}
              p={[x * 1.1, -1.35, 0]}
              s={[0.14, 1.7, 0.05]}
              r={[0, 0, Math.PI + (i - 1) * 0.22]}
            />
          ))}
        </group>
      );
    case "trident":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={DARK} p={[0, -1.3, 0]} s={[0.06, 2.6, 0.06]} />
          <Pc g={WG.box} m={glow} p={[0, -2.6, 0]} s={[1.0, 0.08, 0.08]} />
          <Pc g={WG.pyr} m={STEEL} p={[0, -3.3, 0]} s={[0.12, 1.2, 0.05]} r={[0, 0, Math.PI]} />
          {[-0.45, 0.45].map((x) => (
            <Pc key={x} g={WG.pyr} m={STEEL} p={[x, -3.05, 0]} s={[0.1, 0.9, 0.05]} r={[0, 0, Math.PI]} />
          ))}
        </group>
      );
    case "batarang":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={STEEL} p={[0, -0.3, 0]} s={[0.015, 0.6, 0.015]} />
          <Pc g={WG.bat} m={glow} p={[0, -1.0, -0.05]} s={[1.08, 1.08, 1]} />
          <Pc g={WG.bat} m={STEEL} p={[0, -1.0, 0]} s={[1, 1, 1.6]} />
        </group>
      );
    case "grapple":
      return (
        <group>
          {hook}
          <Pc g={WG.box} m={DARK} p={[0, -0.7, 0]} s={[0.55, 0.95, 0.5]} />
          <Pc g={WG.sph} m={glow} p={[0, -0.5, 0.28]} s={[0.12, 0.12, 0.12]} />
          <Pc g={WG.cyl} m={STEEL} p={[0, -1.95, 0]} s={[0.11, 1.5, 0.11]} />
          <Pc g={WG.tor} m={glow} p={[0, -1.3, 0]} s={[0.17, 0.17, 0.17]} r={[Math.PI / 2, 0, 0]} />
          <Pc g={WG.hook} m={STEEL} p={[0, -3.0, 0]} r={[0, 0, -Math.PI * 0.15]} />
        </group>
      );
    case "branch":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={glow} p={[0, -1.4, 0]} s={[0.045, 2.0, 0.045]} />
          <Pc g={WG.box} m={glow} p={[0.28, -1.0, 0]} s={[0.045, 0.64, 0.045]} r={[0, 0, -2.07]} />
          <Pc g={WG.sph} m={STEEL} p={[0, -0.5, 0]} s={[0.2, 0.2, 0.2]} />
          <Pc g={WG.sph} m={STEEL} p={[0.55, -1.2, 0]} s={[0.2, 0.2, 0.2]} />
          <Pc g={WG.sph} m={STEEL} p={[0, -2.3, 0]} s={[0.2, 0.2, 0.2]} />
        </group>
      );
    case "crate":
      return (
        <group>
          {hook}
          <Pc g={WG.cyl} m={STEEL} p={[0, -0.3, 0]} s={[0.015, 0.6, 0.015]} />
          <Pc g={WG.box} m={DARK} p={[0, -1.35, 0]} s={[1.7, 0.9, 1.0]} />
          {[-0.6, -0.2, 0.2, 0.6].map((x) => (
            <Pc key={x} g={WG.box} m={glow} p={[x, -1.35, 0.51]} s={[0.07, 0.8, 0.02]} />
          ))}
          <Pc g={WG.box} m={STEEL} p={[-0.45, -0.68, 0]} s={[0.7, 0.46, 0.7]} />
          <Pc g={WG.box} m={STEEL} p={[0.45, -0.68, 0]} s={[0.7, 0.46, 0.7]} />
        </group>
      );
    default:
      return null;
  }
}

/* ---- canvas label textures ---- */

function makeLabelTex(name: string, weapon: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgba(3,10,18,0.82)";
  x.fillRect(0, 0, 512, 128);
  x.strokeStyle = color;
  x.lineWidth = 3;
  x.strokeRect(2, 2, 508, 124);
  x.fillStyle = color;
  x.fillRect(2, 2, 10, 124);
  const text = name.toUpperCase();
  let fs = 46;
  while (fs > 20) {
    x.font = `700 ${fs}px monospace`;
    if (x.measureText(text).width <= 450) break;
    fs -= 2;
  }
  x.fillStyle = "#eaf6ff";
  x.fillText(text, 30, 66);
  x.font = "500 22px monospace";
  x.fillStyle = color;
  x.fillText(`${weapon}  //  SKILL`, 30, 102);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeHeaderTex(title: string, sub: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const x = c.getContext("2d")!;
  x.textAlign = "center";
  x.shadowColor = color;
  x.shadowBlur = 28;
  x.fillStyle = "#ffffff";
  x.font = "800 104px monospace";
  x.fillText(title, 512, 120);
  x.shadowBlur = 0;
  x.fillStyle = color;
  x.font = "600 34px monospace";
  x.fillText(`// ${sub} //`, 512, 176);
  x.fillRect(60, 206, 904, 4);
  x.fillRect(60, 206, 150, 10);
  x.fillRect(814, 206, 150, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- one hanging rack ---- */

function Rack({ index }: { index: number }) {
  const spec = RACKS[index];
  const x = ARSENAL_X[index];
  const z = ARSENAL_Z[index];
  const yaw = 0.45 * Math.atan2(-x, LAND_Z - z); // fan the racks slightly toward the camera

  const col = useMemo(() => new THREE.Color(spec.color), [spec]);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: col.clone(), toneMapped: false }), [col]);
  const wire = useMemo(
    () => new THREE.MeshBasicMaterial({ color: col.clone(), wireframe: true, toneMapped: false }),
    [col],
  );
  const labelMats = useMemo(
    () =>
      spec.skills.map(
        (s) =>
          new THREE.MeshBasicMaterial({
            map: makeLabelTex(s.name, WEAPON_NAME[s.kind], spec.color),
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            opacity: 0,
          }),
      ),
    [spec],
  );
  const headerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeHeaderTex(spec.title, spec.sub, spec.color),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    [spec],
  );
  const scanMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: col.clone().multiplyScalar(2),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [col],
  );

  const hang = useRef<(THREE.Group | null)[]>([]);
  const head = useRef<THREE.Mesh>(null);
  const scan = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const p = arsenalPower();
    const f = rackFocus(index);
    const land = landProgress.current;
    const shock = land > 0.45 ? Math.exp(-3.5 * ((land - 0.45) / 0.55)) : 0;
    const t = T.value;

    glow.color.copy(col).multiplyScalar((0.25 + 1.9 * f + 0.7 * shock) * (0.15 + 0.85 * p));
    wire.color.copy(col).multiplyScalar(0.5 + f * 1.5);
    labelMats.forEach((m) => (m.opacity = p * (0.4 + 0.6 * f)));
    headerMat.opacity = p * (0.35 + 0.65 * f);

    if (head.current) head.current.position.y = 15.4 + Math.sin(t * 1.1 + index) * 0.15;
    if (scan.current) {
      scan.current.position.y = 2.6 + ((t * 0.45 + index * 0.23) % 1) * 10.8;
      scanMat.opacity = f * 0.5 * p;
    }

    hang.current.forEach((g, k) => {
      if (!g) return;
      const e = easeOutBack((p - k * 0.055) / 0.5); // staggered drop-in with overshoot
      g.visible = e > 0.01;
      g.position.y = SLOTS[k].y + (1 - e) * 20;
      const ph = k * 1.7 + index * 0.9;
      g.rotation.z = Math.sin(t * 0.8 + ph) * 0.03 + Math.sin(t * 17 + ph) * 0.05 * shock;
      g.rotation.x = Math.cos(t * 0.6 + ph) * 0.02;
      g.rotation.y = Math.sin(t * 0.9 + ph) * 0.45 * f; // in-focus weapons turn on their cable
    });
  });

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* back panel + frame */}
      <mesh position={[0, 8.2, -0.12]}>
        <planeGeometry args={[13, 12.4]} />
        <meshBasicMaterial color="#030912" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      {[13.05, 7.75].map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0]} material={DARK}><boxGeometry args={[12.6, 0.16, 0.22]} /></mesh>
          <mesh position={[0, y - 0.09, 0.12]} material={glow}><boxGeometry args={[12.6, 0.04, 0.04]} /></mesh>
        </group>
      ))}
      {[-6.4, 6.4].map((px) => (
        <mesh key={px} position={[px, 8.2, 0]} material={glow}>
          <boxGeometry args={[0.1, 12.4, 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, 2.15, 0]} material={glow}><boxGeometry args={[13, 0.1, 0.4]} /></mesh>

      {/* cables up into the dome */}
      {[-5.8, 5.8].map((px) => (
        <mesh key={`c${px}`} position={[px, 39.2, 0]} material={DARK}>
          <cylinderGeometry args={[0.05, 0.05, 52, 6]} />
        </mesh>
      ))}

      {/* weapons */}
      {spec.skills.map((s, k) => (
        <group
          key={s.name}
          ref={(g) => {
            hang.current[k] = g;
          }}
          position={[SLOTS[k].x, SLOTS[k].y + 20, 0.15]}
          visible={false}
        >
          <Weapon kind={s.kind} glow={glow} wire={wire} />
        </group>
      ))}

      {/* name plates */}
      {spec.skills.map((s, k) => (
        <mesh key={`l${s.name}`} position={[SLOTS[k].x, SLOTS[k].labelY, 0.12]} material={labelMats[k]}>
          <planeGeometry args={[3.3, 0.825]} />
        </mesh>
      ))}

      {/* hologram header */}
      <mesh ref={head} position={[0, 15.4, 0.1]} material={headerMat} renderOrder={6}>
        <planeGeometry args={[9, 2.25]} />
      </mesh>

      {/* scanning beam that sweeps the rack while it is in focus */}
      <mesh ref={scan} position={[0, 2.6, 0.2]} material={scanMat} renderOrder={6}>
        <planeGeometry args={[12.6, 0.3]} />
      </mesh>
    </group>
  );
}

function Arsenal() {
  return (
    <>
      {RACKS.map((_, i) => (
        <Rack key={i} index={i} />
      ))}
      {RACKS.map((r, i) => (
        <CaveParticles
          key={`spark${i}`}
          count={34}
          center={[ARSENAL_X[i], 2, ARSENAL_Z[i]]}
          extent={[13, 12, 3]}
          size={0.08}
          color={hexToV3(r.color)}
          alpha={0.8}
          rise={0.5}
          drift={0.4}
          seed={200 + i}
        />
      ))}
    </>
  );
}

/* ---- landing: two shockwave rings + dust burst ---- */

function LandingFX() {
  const dpr = useThree((s) => s.viewport.dpr);
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  const data = useMemo(() => {
    const n = 180;
    const rnd = mulberry32(808);
    const rand = new Float32Array(n * 4);
    for (let i = 0; i < rand.length; i++) rand[i] = rnd();
    return { pos: new Float32Array(n * 3), rand };
  }, []);

  const uniforms = useMemo(() => ({ uBurst: { value: 0 }, uPx: { value: dpr } }), [dpr]);

  useFrame(() => {
    const land = landProgress.current;
    const b = land > 0.45 ? Math.min(1, (land - 0.45) / 0.4) : 0;
    uniforms.uBurst.value = b;

    rings.current.forEach((m, i) => {
      if (!m) return;
      const rb = THREE.MathUtils.clamp((b - i * 0.1) / (1 - i * 0.1), 0, 1);
      m.visible = rb > 0 && rb < 1;
      if (!m.visible) return;
      m.scale.setScalar(0.5 + (1 - Math.pow(1 - rb, 3)) * (26 + i * 14));
      (m.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - rb, 2) * (i === 0 ? 0.9 : 0.55);
    });
  });

  return (
    <group position={[0, -0.5, LAND_Z]}>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, i * 0.02, 0]}
          visible={false}
          renderOrder={8}
        >
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial
            color={new THREE.Color(0.8, 1.6, 3.2)}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}

      <points frustumCulled={false} renderOrder={8}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
          <bufferAttribute attach="attributes-aRand" args={[data.rand, 4]} />
        </bufferGeometry>
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={uniforms}
          vertexShader={/* glsl */ `
            attribute vec4 aRand;
            uniform float uBurst;
            uniform float uPx;
            varying float vA;
            void main(){
              float e = 1.0 - pow(1.0 - uBurst, 3.0);
              float ang = aRand.x * 6.2831;
              vec3 p = vec3(cos(ang), 0.0, sin(ang)) * (1.0 + aRand.y * 9.0) * e * 2.2;
              p.y = e * (0.4 + aRand.z * 3.0) - uBurst * uBurst * aRand.z * 1.2;
              vA = (uBurst > 0.0 ? 1.0 : 0.0) * (1.0 - uBurst) * 0.7;
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = clamp((1.2 + aRand.w * 2.6) * 30.0 / max(-mv.z, 0.5) * uPx, 1.0, 40.0);
            }
          `}
          fragmentShader={/* glsl */ `
            varying float vA;
            void main(){
              float d = length(gl_PointCoord - 0.5);
              float a = smoothstep(0.5, 0.0, d) * vA;
              gl_FragColor = vec4(vec3(0.5, 0.72, 1.0) * a, a);
            }
          `}
        />
      </points>
    </group>
  );
}

/* ---- small clickable arcade monitor that launches Bat-Snake ---- */

const ARC = { x: 34.5, y: 20, z: -440, rotY: -0.5, w: 8, h: 5.4 };

function makeArcadeTex() {
  const W = 640;
  const H = 432;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  x.fillStyle = "#020a14";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(70,150,230,0.18)";
  for (let i = 0; i <= W; i += 32) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke();
  }
  for (let j = 0; j <= H; j += 32) {
    x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke();
  }
  x.textAlign = "center";
  x.shadowColor = "#7cc8ff";
  x.shadowBlur = 24;
  x.fillStyle = "#eaf6ff";
  x.font = "800 74px monospace";
  x.fillText("BAT-SNAKE", W / 2, 96);
  x.shadowBlur = 0;
  x.fillStyle = "#7cc8ff";
  x.font = "600 24px monospace";
  x.fillText("// GOTHAM PURSUIT //", W / 2, 138);

  // pixel snake chasing the Joker
  x.fillStyle = "#18222f";
  x.strokeStyle = "#7cc8ff";
  x.lineWidth = 2;
  const seg: [number, number][] = [[150, 250], [182, 250], [214, 250], [246, 250], [246, 218], [278, 218], [310, 218]];
  seg.forEach(([sx, sy]) => {
    x.fillRect(sx, sy, 28, 28);
    x.strokeRect(sx, sy, 28, 28);
  });
  x.fillStyle = "#05080d";
  x.fillRect(342, 214, 36, 36);
  x.strokeRect(342, 214, 36, 36);
  x.fillStyle = "#fff";
  x.fillRect(352, 226, 8, 4);
  x.fillRect(364, 226, 8, 4);
  // joker
  x.fillStyle = "#f3f0e4";
  x.beginPath(); x.arc(470, 232, 24, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#22c55e";
  x.fillRect(446, 198, 48, 14);
  x.strokeStyle = "#e11d48";
  x.lineWidth = 4;
  x.beginPath(); x.moveTo(456, 240); x.quadraticCurveTo(470, 258, 484, 240); x.stroke();

  x.fillStyle = "rgba(124,200,255,0.7)";
  x.font = "500 22px monospace";
  x.fillText("HI-SCORE  000000", W / 2, 370);
  return new THREE.CanvasTexture(c);
}

function makePromptTex() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const x = c.getContext("2d")!;
  x.textAlign = "center";
  x.shadowColor = "#ffd24d";
  x.shadowBlur = 16;
  x.fillStyle = "#ffd24d";
  x.font = "800 38px monospace";
  x.fillText("▶ CLICK TO PLAY", 256, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ArcadeMonitor() {
  const root = useRef<THREE.Group>(null);
  const hover = useRef(0);
  const target = useRef(0);
  const promptMat = useRef<THREE.MeshBasicMaterial>(null);
  const edgeMat = useRef<THREE.MeshBasicMaterial>(null);

  const tex = useMemo(makeArcadeTex, []);
  const promptTex = useMemo(makePromptTex, []);
  const uniforms = useMemo(() => ({ uTime: T, uTex: { value: tex }, uHover: { value: 0 } }), [tex]);
  const frame = { color: "#101a25", metalness: 0.8, roughness: 0.4 } as const;

  useFrame((_, dt) => {
    const live = screenProgress.current > 0.9;
    if (!live) target.current = 0;
    hover.current = THREE.MathUtils.damp(hover.current, target.current, 8, Math.min(dt, 0.05));
    uniforms.uHover.value = hover.current;
    if (root.current) {
      root.current.scale.setScalar(1 + hover.current * 0.05);
      root.current.position.y = ARC.y + Math.sin(T.value * 0.8) * 0.2;
    }
    if (promptMat.current) {
      promptMat.current.opacity = (live ? 0.55 + 0.45 * Math.sin(T.value * 4) : 0.25) + hover.current * 0.3;
    }
    if (edgeMat.current) {
      edgeMat.current.color.setRGB(0.55, 1.1, 2.2).lerp(new THREE.Color(3, 2.2, 0.6), hover.current);
    }
  });

  return (
    <group
      ref={root}
      position={[ARC.x, ARC.y, ARC.z]}
      rotation={[0, ARC.rotY, 0]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        if (screenProgress.current < 0.9) return;
        e.stopPropagation();
        target.current = 1;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        target.current = 0;
        document.body.style.cursor = "";
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (screenProgress.current < 0.9) return;
        e.stopPropagation();
        document.body.style.cursor = "";
        window.dispatchEvent(new Event(CAVE_EVENTS.openGame));
      }}
    >
      {/* screen */}
      <mesh>
        <planeGeometry args={[ARC.w, ARC.h]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={/* glsl */ `
            varying vec2 vUv;
            void main(){
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={/* glsl */ `
            uniform sampler2D uTex;
            uniform float uTime;
            uniform float uHover;
            varying vec2 vUv;
            void main(){
              vec3 c = texture2D(uTex, vUv).rgb;
              float scan = 0.88 + 0.12 * sin(vUv.y * 700.0 - uTime * 5.0);
              float flick = 0.96 + 0.04 * sin(uTime * 23.0);
              float vig = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x)
                        * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
              vec3 col = c * scan * flick * (1.3 + uHover * 0.7) * vig + vec3(0.0, 0.012, 0.03);
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>

      {/* prompt strip */}
      <mesh position={[0, -ARC.h / 2 + 0.55, 0.05]} renderOrder={6}>
        <planeGeometry args={[4.8, 0.6]} />
        <meshBasicMaterial
          ref={promptMat}
          map={promptTex}
          transparent
          opacity={0.3}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* bezel */}
      <mesh position={[0, ARC.h / 2 + 0.3, 0]}><boxGeometry args={[ARC.w + 1.2, 0.6, 0.9]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[0, -ARC.h / 2 - 0.3, 0]}><boxGeometry args={[ARC.w + 1.2, 0.6, 0.9]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[-ARC.w / 2 - 0.3, 0, 0]}><boxGeometry args={[0.6, ARC.h + 1.2, 0.9]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[ARC.w / 2 + 0.3, 0, 0]}><boxGeometry args={[0.6, ARC.h + 1.2, 0.9]} /><meshStandardMaterial {...frame} /></mesh>
      <mesh position={[0, -ARC.h / 2 - 0.02, 0.48]}>
        <boxGeometry args={[ARC.w, 0.07, 0.05]} />
        <meshBasicMaterial ref={edgeMat} color={GLOW_BLUE} toneMapped={false} />
      </mesh>

      {/* halo */}
      <mesh position={[0, 0, -0.5]}>
        <planeGeometry args={[ARC.w * 1.6, ARC.h * 1.7]} />
        <meshBasicMaterial color="#2b82bd" transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* hanging cables */}
      {[-3.2, 3.2].map((px) => (
        <mesh key={px} position={[px, ARC.h / 2 + 26, -0.2]}>
          <cylinderGeometry args={[0.06, 0.06, 52, 6]} />
          <meshStandardMaterial color="#0e1721" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  Camera director (runs at priority 0.5: after the RooftopScene rig,         */
/*  before the post-processing render at priority 1).                          */
/*    land   -> fall out of the sky, impact, settle at eye level               */
/*    armory -> eye-level pan across the hanging weapon racks                  */
/*    screen -> rise + push in to the giant screen, DOM overlay glued on it    */
/* -------------------------------------------------------------------------- */
/* Blast hatch over the skylight: slides open as the camera rises through it. */
function SkyHatch() {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);

  useFrame(() => {
    const o = sstep(endProgress.current, 0.55, 0.8);
    if (left.current) left.current.position.x = -o * 7.6;
    if (right.current) right.current.position.x = o * 7.6;
  });

  const steel = { color: "#18232f", metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide } as const;

  return (
    <group position={[CAVE_CENTER.x, DOME_TOP_Y - 1.4, CAVE_CENTER.z]} rotation={[Math.PI / 2, 0, 0]}>
      <group ref={left}>
        <mesh>
          <circleGeometry args={[7.2, 40, Math.PI / 2, Math.PI]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        <mesh position={[-0.12, 0, 0.02]}>
          <boxGeometry args={[0.1, 14.4, 0.06]} />
          <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
        </mesh>
      </group>
      <group ref={right}>
        <mesh>
          <circleGeometry args={[7.2, 40, -Math.PI / 2, Math.PI]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        <mesh position={[0.12, 0, 0.02]}>
          <boxGeometry args={[0.1, 14.4, 0.06]} />
          <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.03]}>
        <torusGeometry args={[7.2, 0.16, 8, 64]} />
        <meshBasicMaterial color="#6da9e8" toneMapped={false} />
      </mesh>
    </group>
  );
}


function CaveCameraDirector() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pointer = useThree((s) => s.pointer);

  const tmp = useMemo(
    () => ({
      rigPos: new THREE.Vector3(),
      rigQ: new THREE.Quaternion(),
      dirQ: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      sPos: new THREE.Vector3(),
      sLook: new THREE.Vector3(),
      c: new THREE.Vector3(),
      ePos: new THREE.Vector3(),
      eLook: new THREE.Vector3(),
      endCurve: null as THREE.CatmullRomCurve3 | null,
      endKey: 0,
    }),
    [],
  );

  useFrame((state) => {
    const land = landProgress.current;
    const scr = screenProgress.current;
    const end = endProgress.current;
    const roof = roofProgress.current;
    const el = caveUI.screenEl;

    if (land <= 0.0005 && scr <= 0.0005 && end <= 0.0005 && roof <= 0.0005) {
      if (el && el.style.transform !== "scale(0)") el.style.transform = "scale(0)";
      return; // the RooftopScene rig owns the camera
    }

    const { size, clock } = state;
    const t = clock.elapsedTime;
    const aspect = size.width / size.height;
    const lerp = THREE.MathUtils.lerp;
    const clamp = THREE.MathUtils.clamp;

    /* ---- FINALE: rooftop wide shot (cave is hidden, overlay gone) ---- */
    if (roof > 0.0005) {
      if (el && el.style.transform !== "scale(0)") el.style.transform = "scale(0)";
      const r = sstep(roof, 0, 1);
      const A = ROOF_SHOT.from;
      const B = ROOF_SHOT.to;
      tmp.pos.set(
        lerp(A.pos[0], B.pos[0], r) + pointer.x * 0.35,
        lerp(A.pos[1], B.pos[1], r) + pointer.y * 0.15,
        lerp(A.pos[2], B.pos[2], r),
      );
      tmp.look.set(
        lerp(A.look[0], B.look[0], r),
        lerp(A.look[1], B.look[1], r),
        lerp(A.look[2], B.look[2], r),
      );
      camera.position.copy(tmp.pos);
      camera.lookAt(tmp.look);
      camera.rotateZ(Math.sin(t * 0.5) * 0.004);
      const fv = lerp(A.fov, B.fov, r);
      if (Math.abs(camera.fov - fv) > 0.01) {
        camera.fov = fv;
        camera.updateProjectionMatrix();
      }
      return;
    }

    /* ---- landing + armory pose ---- */
    const f = clamp(land / 0.45, 0, 1);
    const fall = f * f;
    const u = land > 0.45 ? clamp((land - 0.45) / 0.55, 0, 1) : 0;
    const impact = land > 0.45 ? Math.exp(-4.5 * u) : 0;
    const dip = -1.6 * Math.sin(Math.min(u / 0.12, 1) * (Math.PI / 2)) * Math.exp(-5 * u);
    const settle = sstep(land, 0.5, 0.85);

    tmp.pos.set(
      pointer.x * 0.9 * settle,
      lerp(FALL_Y, EYE_Y, fall) + dip + pointer.y * 0.3 * settle,
      lerp(FALL_Z, LAND_Z, f),
    );
    tmp.look.set(armLookX(), lerp(-2, 7.5, fall), lerp(-420, -384, f));

    /* ---- giant screen pose ---- */
    const se = scr;
    const tanV = Math.tan(THREE.MathUtils.degToRad(50) / 2);
    const wide = aspect > 1.45;
    const Dv = (SCREEN.h * 1.14) / 2 / tanV;
    const D = clamp(
      wide
        ? Math.max(Dv, 32 / (tanV * aspect) + 7)
        : Math.max(Dv, (SCREEN.w * 1.06) / 2 / (tanV * aspect)),
      30,
      72,
    );
    const cx = SCREEN.x + (wide ? 3.5 : 0);
    tmp.sPos.set(cx, SCREEN.y, SCREEN.z + D);
    tmp.sLook.set(cx, SCREEN.y, SCREEN.z);
    if (se > 0) {
      tmp.pos.lerp(tmp.sPos, se);
      tmp.look.lerp(tmp.sLook, se);
    }

    /* ---- FINALE part 1: pull back from the screen, rise through the hatch ---- */
    if (end > 0.0005) {
      const key = Math.round(aspect * 100);
      if (!tmp.endCurve || tmp.endKey !== key) {
        tmp.endKey = key;
        tmp.endCurve = new THREE.CatmullRomCurve3(
          [
            tmp.sPos.clone(),
            new THREE.Vector3(cx * 0.5, 34, SCREEN.z + D + 24), // drift back
            new THREE.Vector3(0, 58, CAVE_CENTER.z + 4), // up the shaft
            new THREE.Vector3(0, DOME_TOP_Y - 7, CAVE_CENTER.z),
            new THREE.Vector3(0, DOME_TOP_Y + 18, CAVE_CENTER.z), // through the hatch
          ],
          false,
          "centripetal",
        );
      }
      const k = sstep(end, 0, 1);
      tmp.endCurve.getPointAt(k, tmp.ePos);
      tmp.pos.copy(tmp.ePos);
      tmp.eLook.set(tmp.ePos.x, tmp.ePos.y + 30, tmp.ePos.z - 9); // tilt up to the sky
      tmp.look.lerpVectors(tmp.sLook, tmp.eLook, sstep(end, 0.1, 0.55));
    }

    /* ---- apply, blended over the rig's pose during the first part of the fall ---- */
    const blend = sstep(land, 0, 0.1);
    tmp.rigPos.copy(camera.position);
    tmp.rigQ.copy(camera.quaternion);
    const rigFov = camera.fov;

    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.look);
    tmp.dirQ.copy(camera.quaternion);

    if (blend < 1) {
      camera.position.lerpVectors(tmp.rigPos, tmp.pos, blend);
      camera.quaternion.copy(tmp.rigQ).slerp(tmp.dirQ, blend);
    }

    camera.rotateX(-0.08 * impact);
    camera.rotateZ(Math.sin(u * 34) * 0.014 * impact + Math.sin(t * 0.6) * 0.003 * settle);

    const fovScreen = lerp(50, 70, sstep(end, 0.2, 0.9)); // widens as we rise
    const fov = lerp(rigFov, lerp(64, fovScreen, se), blend) - impact * 2;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    /* ---- stick the DOM overlay onto the 3D giant screen ---- */
    if (el) {
      if (scr > 0.35) {
        camera.updateMatrixWorld(true);
        const hw = SCREEN.w / 2;
        const hh = SCREEN.h / 2;
        const pr = (x: number, y: number) => {
          tmp.c.set(x, y, SCREEN.z).project(camera);
          return [(tmp.c.x * 0.5 + 0.5) * size.width, (-tmp.c.y * 0.5 + 0.5) * size.height];
        };
        const [tlx, tly] = pr(SCREEN.x - hw, SCREEN.y + hh);
        const [trx, try_] = pr(SCREEN.x + hw, SCREEN.y + hh);
        const [blx, bly] = pr(SCREEN.x - hw, SCREEN.y - hh);
        const a = (trx - tlx) / SCREEN_UI_W;
        const b = (try_ - tly) / SCREEN_UI_W;
        const c = (blx - tlx) / SCREEN_UI_H;
        const d = (bly - tly) / SCREEN_UI_H;
        el.style.transform = `matrix(${a},${b},${c},${d},${tlx},${tly})`;
      } else if (el.style.transform !== "scale(0)") {
        el.style.transform = "scale(0)";
      }
    }
  }, 0.5);

  return null;
}


// Design size of the overlay (must match SCREEN_UI in caveState.ts: 1600 x 800).
const SCREEN_UI_W = 1600;
const SCREEN_UI_H = 800;

/* -------------------------------------------------------------------------- */
/*  The Batcave                                                               */
/* -------------------------------------------------------------------------- */

export default function CaveEnvironment({
  flight,
  projects,
}: {
  flight: ProgressRef;
  projects: CaveProject[];
}) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const body = useRef<THREE.Group>(null);
  const lightsRef = useRef<THREE.Group>(null);
  const lightList = useRef<THREE.Light[] | null>(null);
  const rackLights = useRef<(THREE.PointLight | null)[]>([]);
  const frames = useRef(0);

  useFrame(({ clock, camera }) => {
    T.value = clock.elapsedTime;
    frames.current++;

    const depth = -camera.position.z;
    const inside = sstep(depth, 244, 266);
    const f = sstep(flight.current, 0.2, 0.97);

    // 0 during the opening, hero and city shots -> 1 as the flight nears the mountain.
    const reveal = sstep(flight.current, 0.35, 0.7);

    // Visible for the first few frames (while the loader covers the screen) so the
    // shaders compile, then hidden until the flight is well under way.
    if (body.current) {
            body.current.visible =
        (frames.current < 30 || flight.current > 0.34) && roofProgress.current < 0.5;
    }

    // Cave lights stay in the scene (no recompile) but are silent until revealed.
    if (lightsRef.current && !lightList.current) {
      const list: THREE.Light[] = [];
      lightsRef.current.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight && l !== hemi.current && !l.userData.skip) {
          l.userData.base = l.intensity;
          list.push(l);
        }
      });
      lightList.current = list;
    }
    lightList.current?.forEach((l) => (l.intensity = l.userData.base * reveal));
    if (hemi.current) hemi.current.intensity = 0.55 * inside * reveal;

    // Arsenal lights: the rack under the camera lights up; the landing flashes all four.
    const land = landProgress.current;
    const shock = land > 0.45 ? Math.exp(-4.5 * ((land - 0.45) / 0.55)) : 0;
    const power = arsenalPower();
    rackLights.current.forEach((l, i) => {
      if (l) l.intensity = (26 * rackFocus(i) * power + 22 * shock) * reveal;
    });

    VIS.value = sstep(depth, 150, 240) * reveal;

    // Heavy haze at first (mountain is fully lost in fog), thinning as you approach,
    // then dark cave air once inside.
    const outside = THREE.MathUtils.lerp(0.0056, 0.0016, f);
    const base = THREE.MathUtils.lerp(outside, 0.0038, inside);
    HAZE.density.value = THREE.MathUtils.lerp(0.03, base, reveal);
    HAZE.color.value.lerpColors(HAZE_OUT, HAZE_IN, inside);
  });

  const geos = useMemo(
    () => ({
      dome: makeDomeGeo(),
      tunnel: makeTunnelGeo(),
      floor: makeFloorGeo(),
      stal: makeStalGeo(),
      tree: makeTreeGeo(),
      crag: [
        makeRockGeo(3, 0.55, 1.3, 1.7),
        makeRockGeo(3, 0.6, 1.1, 4.3),
        makeRockGeo(3, 0.5, 1.5, 8.9),
      ],
      rubble: makeRockGeo(2, 0.6, 1.6, 12.2),
      cables: buildCableGeos(),
    }),
    [],
  );

  const mats = useMemo(
    () => ({
      rock: makeRockMaterial(THREE.FrontSide),
      rockIn: makeRockMaterial(THREE.BackSide),
      boxRock: makeRockMaterial(THREE.FrontSide, false),
      tree: patchMaterial(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
        false,
      ),
      cable: new THREE.MeshStandardMaterial({ color: "#07090c", roughness: 0.7, metalness: 0.3 }),
    }),
    [],
  );

  const mountain = useMemo(() => buildMountain(geos.crag), [geos]);
  const rails = useMemo(buildPlatformRails, []);
  const catwalk = useMemo(buildCatwalk, []);

  const hazardFloor = useMemo(() => makeHazard(0.5, 114), []);
  const hazardDoor = useMemo(() => makeHazard(0.5, 26), []);

  const trayItems = useMemo<Item[]>(
    () =>
      [-2.5, 2.5].map((x) => ({ p: [x, 26, -308] as V3, s: [0.3, 0.3, 112] as V3 })),
    [],
  );
  const trayClamps = useMemo<Item[]>(() => {
    const a: Item[] = [];
    for (let i = 0; i < 28; i++) {
      for (const x of [-2.5, 2.5]) a.push({ p: [x, 26, -258 - i * 3.9], s: [0.5, 0.5, 0.18] });
    }
    return a;
  }, []);

  const steel = { color: "#18232f", metalness: 0.82, roughness: 0.38 } as const;
  const darkSteel = { color: "#0e1721", metalness: 0.78, roughness: 0.42 } as const;

  const chamberRocks = useMemo(() => {
    const rnd = mulberry32(31);
    return Array.from({ length: 22 }, (_, i) => {
      const a = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 16;
      return {
        x: Math.cos(a) * r,
        z: CAVE_CENTER.z + Math.sin(a) * r,
        s: 2 + rnd() * 4.5,
        sy: 2 + rnd() * 5,
        ry: rnd() * 6,
        g: i % 3,
      };
    });
  }, []);

  return (
    <group>
      {/* All cave lights live here (always mounted, intensity driven in useFrame).
          This is the ONLY place cave lights are declared, so the scene's light
          count never changes while the flight toggles `body` below. */}
      <group ref={lightsRef}>
        <hemisphereLight ref={hemi} args={["#3a5f8f", "#070b10", 0]} />
        <pointLight position={[-10.9, 13, -253.1]} color="#3c8fff" intensity={5} distance={24} />
        <pointLight position={[10.9, 13, -253.1]} color="#3c8fff" intensity={5} distance={24} />
        <pointLight position={[0, 8, -276]} color="#397fc5" intensity={12} distance={52} />
        <pointLight position={[0, 13, -330]} color="#1c5c9b" intensity={9} distance={48} />
        <pointLight position={[0, 17, -388]} color="#4d9de8" intensity={16} distance={78} />
        <pointLight position={[-23, 3, -389]} color="#24588d" intensity={7} distance={42} />
        <pointLight position={[23, 3, -389]} color="#24588d" intensity={7} distance={42} />
        <spotLight position={[0, 29, -387]} color="#6caee5" intensity={9} angle={0.58} penumbra={0.7} distance={54} />

        {/* One light per weapon rack. userData.skip: driven by rackFocus() in useFrame,
            not by the generic reveal loop. */}
        {ARSENAL_X.map((x, i) => (
          <pointLight
            key={`rl${i}`}
            ref={(l) => {
              rackLights.current[i] = l;
            }}
            position={[x * 0.9, 9, ARSENAL_Z[i] + 7]}
            color={RACKS[i].color}
            intensity={0}
            distance={30}
            userData={{ skip: true }}
          />
        ))}
      </group>

      {/* Everything visible: hidden until the flight is close */}
      <group ref={body}>

      {/* ====================== MOUNTAIN + ENTRANCE ====================== */}
      {MOUNTAIN_BOXES.map(([x, y, z, w, h, d], i) => (
        <mesh key={`mb${i}`} material={mats.boxRock} position={[x, y, z]}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      ))}

      {[...ENTRANCE_ROCKS, ...MASSIF].map(([x, y, z, sx, sy, sz, gi, ry], i) => (
        <mesh
          key={`er${i}`}
          geometry={geos.crag[gi]}
          material={mats.rock}
          position={[x, y, z]}
          scale={[sx, sy, sz]}
          rotation={[0, ry, 0]}
        />
      ))}

      {/* Pines on the ridge + blinking aviation beacons (visible from afar) */}
      <Inst items={mountain.trees} geometry={geos.tree} material={mats.tree} />
      {mountain.beacons.map((p, i) => (
        <Blink key={`bk${i}`} position={p} offset={i * 0.31} />
      ))}

      {/* Threshold slab, blast-door ring, light strips */}
      <mesh position={[0, -2, -251]}>
        <boxGeometry args={[26, 1, 10]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, 14, -255.8]}>
        <torusGeometry args={[13.1, 1.15, 12, 72]} />
        <meshStandardMaterial color="#182535" metalness={0.72} roughness={0.38} />
      </mesh>
      <mesh position={[0, 14, -255.5]}>
        <torusGeometry args={[15.1, 0.18, 8, 72]} />
        <meshBasicMaterial color="#6da9e8" toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 11.7, 13, -255.1]}>
          <mesh>
            <boxGeometry args={[0.16, 22, 0.18]} />
            <meshBasicMaterial color="#8bcaff" toneMapped={false} />
          </mesh>
          <mesh position={[s * 1.2, 0, -0.4]}>
            <boxGeometry args={[2.4, 24, 0.8]} />
            <meshStandardMaterial {...darkSteel} />
          </mesh>
        </group>
      ))}

      {/* Retracted blast doors with hazard edge + hydraulics */}
      {[-1, 1].map((s) => (
        <group key={`door${s}`} position={[s * 18.2, 14, -254.2]}>
          <mesh>
            <boxGeometry args={[5, 27, 1.4]} />
            <meshStandardMaterial {...darkSteel} />
          </mesh>
          <mesh position={[-s * 2.2, 0, 0.72]}>
            <planeGeometry args={[0.5, 26]} />
            <meshBasicMaterial map={hazardDoor} color="#9a8c50" toneMapped={false} />
          </mesh>
          {[-8, 8].map((y) => (
            <mesh key={y} position={[-s * 3.2, y, 0.2]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.32, 0.32, 5.5, 12]} />
              <meshStandardMaterial {...steel} />
            </mesh>
          ))}
        </group>
      ))}
      <SpinBeacon position={[-11, -1.5, -248]} />
      <SpinBeacon position={[11, -1.5, -248]} speed={-2.4} />

      {/* Glowing wing emblem above the entrance */}
      <mesh position={[0, 36, -250.2]} scale={[0.04, 0.04, 0.04]}>
        <shapeGeometry
          args={[
            new THREE.Shape(
              [
                ...EMBLEM_HALF_PTS,
                ...[...EMBLEM_HALF_PTS].reverse().map(([x, y]) => [-x, y] as [number, number]),
              ].map(([x, y]) => new THREE.Vector2(x, -y)),
            ),
          ]}
        />
        <meshBasicMaterial color={GLOW_BLUE} toneMapped={false} />
      </mesh>

      {/* ============================== TUNNEL ============================== */}
      <mesh
        geometry={geos.tunnel}
        material={mats.rockIn}
        position={[0, TUNNEL_CY, TUNNEL_CZ]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {[-274, -290, -306, -322, -338].map((z, i) => (
        <group key={z} position={[0, TUNNEL_CY, z]}>
          <mesh>
            <torusGeometry args={[14.7, 0.36, 8, 64]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh>
            <torusGeometry args={[14.15, 0.055, 6, 64]} />
            <meshBasicMaterial color={i % 2 === 0 ? "#4e9be8" : "#2d638f"} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <TunnelLamps />

      {/* Overhead cable trays */}
      <Inst items={trayItems}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#07090c" roughness={0.7} metalness={0.3} />
      </Inst>
      <Inst items={trayClamps}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial {...steel} />
      </Inst>

      {/* Utility pipes + LED strips */}
      {[-1, 1].map((s) => (
        <group key={`pipes${s}`}>
          <mesh position={[s * 12.4, 5.5, -308]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.45, 0.45, 112, 14]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh position={[s * 12.9, 8.6, -308]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 112, 12]} />
            <meshStandardMaterial {...darkSteel} />
          </mesh>
          <mesh position={[s * 11.9, 4.4, -308]}>
            <boxGeometry args={[0.06, 0.06, 112]} />
            <meshBasicMaterial color="#3f91df" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Floor deck, road, edge lights, hazard strips */}
      <mesh position={[0, -1.5, -317]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[31, 130]} />
        <meshStandardMaterial color="#080d13" roughness={0.3} metalness={0.45} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -1.47, -309]}>
        <boxGeometry args={[9.6, 0.06, 114]} />
        <meshStandardMaterial color="#0b121b" roughness={0.35} metalness={0.6} />
      </mesh>
      {[-4.7, 4.7].map((x) => (
        <mesh key={x} position={[x, -1.43, -309]}>
          <boxGeometry args={[0.12, 0.03, 114]} />
          <meshBasicMaterial color="#3f91df" toneMapped={false} />
        </mesh>
      ))}
      {[-5.2, 5.2].map((x) => (
        <mesh key={`hz${x}`} position={[x, -1.455, -309]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.5, 114]} />
          <meshBasicMaterial map={hazardFloor} color="#9a8c50" toneMapped={false} />
        </mesh>
      ))}
      <RoadDashes />

      {/* Ramp from the road up onto the operations platform */}
      <mesh position={[0, -1.05, -362.4]} rotation={[0.23, 0, 0]}>
        <boxGeometry args={[9.6, 0.12, 3.6]} />
        <meshStandardMaterial {...steel} />
      </mesh>

      {RUBBLE.map(([x, y, z, s], i) => (
        <mesh
          key={`rb${i}`}
          geometry={geos.rubble}
          material={mats.rock}
          position={[x, y + s * 0.3, z]}
          scale={[s, s * 0.7, s]}
          rotation={[0, i * 1.3, 0]}
        />
      ))}

      <group position={[-6, 14, -300]} rotation={[0, 0, 0.12]}>
        <Shaft height={30} rTop={0.9} rBottom={5.5} opacity={0.22} color={[0.45, 0.7, 1.0]} />
      </group>
      <group position={[6, 14, -336]} rotation={[0, 0, -0.14]}>
        <Shaft height={30} rTop={0.9} rBottom={5.5} opacity={0.22} color={[0.45, 0.7, 1.0]} />
      </group>

      {/* ============================== CHAMBER ============================== */}
      <mesh geometry={geos.dome} material={mats.rockIn} position={CAVE_CENTER} />
      <mesh geometry={geos.floor} material={mats.rock} position={[0, 0, CAVE_CENTER.z]} />
      <CaveWater />
      <WaterMist y={-0.9} opacity={0.2} seed={1.3} />
      <WaterMist y={1.5} opacity={0.12} seed={7.9} />

      {chamberRocks.map((r, i) => (
        <mesh
          key={`cr${i}`}
          geometry={geos.crag[r.g]}
          material={mats.rock}
          position={[r.x, -1.6 + r.sy * 0.4, r.z]}
          scale={[r.s, r.sy, r.s]}
          rotation={[0, r.ry, 0]}
        />
      ))}

      <Ceiling rock={mats.rock} stalGeo={geos.stal} />

      {/* Cables sagging across the ceiling */}
      {geos.cables.map((g, i) => (
        <mesh key={`cb${i}`} geometry={g} material={mats.cable} />
      ))}

      {/* Moonlit skylight + shaft */}
      <mesh position={[CAVE_CENTER.x, DOME_TOP_Y - 0.5, CAVE_CENTER.z]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.5, 32]} />
        <meshBasicMaterial color={new THREE.Color(1.8, 2.6, 3.8)} toneMapped={false} />
      </mesh>
      <group position={[CAVE_CENTER.x, DOME_TOP_Y - 0.8 - (DOME_TOP_Y + 1) / 2, CAVE_CENTER.z]}>
        <Shaft
          height={DOME_TOP_Y + 1}
          rTop={6.5}
          rBottom={19}
          opacity={0.16}
          color={[0.55, 0.78, 1.0]}
        />
      </group>

      <SkyHatch />

      {/* Waterfall */}
      <mesh
        geometry={geos.crag[1]}
        material={mats.rock}
        position={[-36, 20, -445]}
        scale={[11, 22, 6]}
        rotation={[0, 0.4, 0]}
      />
      <Waterfall />
      <PoolRipples />

      {/* Industrial gantries + overhead beam */}
      {[-1, 1].map((s) => (
        <group key={`gantry${s}`} position={[s * 25, 0, -389]}>
          <mesh position={[0, 15, 0]}><boxGeometry args={[1.1, 30, 1.1]} /><meshStandardMaterial {...steel} /></mesh>
          <mesh position={[-s * 3, 27, 0]}><boxGeometry args={[7, 0.55, 1.2]} /><meshStandardMaterial {...steel} /></mesh>
          <mesh position={[-s * 3, 26.65, 0.66]}><boxGeometry args={[5.4, 0.08, 0.06]} /><meshBasicMaterial color="#397fb5" toneMapped={false} /></mesh>
        </group>
      ))}
      <mesh position={[0, 27.3, -389]}>
        <boxGeometry args={[44, 0.6, 1.4]} />
        <meshStandardMaterial {...steel} />
      </mesh>

      {/* Hanging work-lights with volumetric shafts */}
      {LAMPS.map(([x, y, z]) => (
        <group key={`${x}${z}`} position={[x, y, z]}>
          <mesh position={[0, 23, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 46, 6]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <coneGeometry args={[1.6, 1.3, 20, 1, true]} />
            <meshStandardMaterial {...darkSteel} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.35, 0]}>
            <sphereGeometry args={[0.45, 12, 12]} />
            <meshBasicMaterial color={BULB} toneMapped={false} />
          </mesh>
          <group position={[0, -(y + 1.6) / 2 - 0.4, 0]}>
            <Shaft height={y + 1.6} rTop={0.5} rBottom={8.5} opacity={x === 0 ? 0.32 : 0.24} />
          </group>
        </group>
      ))}

      {/* ===================== OPERATIONS PLATFORM ===================== */}
      <mesh position={[0, -1.4, PLATFORM_Z]}>
        <cylinderGeometry args={[24, 28, 1.5, 64]} />
        <meshStandardMaterial color="#111c28" roughness={0.52} metalness={0.68} />
      </mesh>
      <mesh position={[0, -0.58, PLATFORM_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[22, 0.16, 8, 96]} />
        <meshBasicMaterial color="#5ca9f4" toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.55, PLATFORM_Z]}>
        <cylinderGeometry args={[11, 13, 0.18, 48]} />
        <meshStandardMaterial color="#1a2b3e" roughness={0.4} metalness={0.75} />
      </mesh>
      <mesh position={[0, -0.42, PLATFORM_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[9, 0.1, 8, 64]} />
        <meshBasicMaterial color="#9acfff" toneMapped={false} />
      </mesh>
      {[14, 17, 20].map((radius, i) => (
        <mesh key={radius} position={[0, -0.6 + i * 0.015, PLATFORM_Z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius, 0.045, 5, 96]} />
          <meshBasicMaterial color={i === 1 ? "#2e6b9e" : "#1b3c59"} toneMapped={false} />
        </mesh>
      ))}
      <PlatformRim />

      {/* Guard rails */}
      <Inst items={rails.posts}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial {...steel} />
      </Inst>
      <Inst items={rails.rails}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#223244" metalness={0.8} roughness={0.35} />
      </Inst>

      {/* Beacons + globe moved to the back of the platform so they never block the arsenal */}
      <SpinBeacon position={[-21, PLATFORM_TOP, -404]} color={[1.0, 0.5, 0.12]} speed={2.1} />
      <SpinBeacon position={[21, PLATFORM_TOP, -404]} color={[1.0, 0.5, 0.12]} speed={-2.1} />

      <Batmobile />
      <HoloGlobe position={[-11, PLATFORM_TOP, -404]} />

      {/* Batcomputer banks */}
      {[-1, 1].map((s) => (
        <group key={`bank${s}`} position={[s * 16, PLATFORM_TOP, -398]} rotation={[0, s * -0.18, 0]}>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[8.4, 1.6, 3.4]} />
            <meshStandardMaterial {...darkSteel} />
          </mesh>
          <mesh position={[0, 2.5, -0.9]} rotation={[-0.28, 0, 0]}>
            <boxGeometry args={[7.3, 2.3, 0.18]} />
            <meshStandardMaterial color="#02070c" metalness={0.5} roughness={0.25} />
          </mesh>
          {[-2.35, -0.8, 0.8, 2.35].map((x, i) => (
            <group key={x} position={[x, 2.52, -0.78]} rotation={[-0.28, 0, 0]}>
              <DataScreen
                size={[1.45, 1.9]}
                seed={i + (s > 0 ? 5 : 0)}
                color={i % 2 ? [0.1, 0.45, 0.8] : [0.15, 0.65, 0.95]}
              />
            </group>
          ))}
          {[-2.5, 0, 2.5].map((x) => (
            <mesh key={x} position={[x, 1.66, 1.1]}>
              <boxGeometry args={[0.55, 0.08, 0.45]} />
              <meshBasicMaterial color="#57b8f5" toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}

      <MainScreen projects={projects} />

      {/* Server racks beside the main screen */}
      {SERVER_RACK_X.map((x, i) => (
        <group key={`rack${i}`} position={[x, -1.3, -445.5]}>
          <mesh position={[0, 3.7, 0]}>
            <boxGeometry args={[2.2, 7.4, 1.5]} />
            <meshStandardMaterial color="#0b121a" metalness={0.8} roughness={0.4} />
          </mesh>
          <group position={[0, 3.7, 0.77]}>
            <RackFront seed={i + 1} size={[1.9, 7.0]} />
          </group>
          <mesh position={[0, 7.45, 0]}>
            <boxGeometry args={[2.3, 0.12, 1.6]} />
            <meshStandardMaterial {...steel} />
          </mesh>
        </group>
      ))}

      {/* Catwalk ring */}
      <Inst items={catwalk.deck}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#121c28" metalness={0.75} roughness={0.45} />
      </Inst>
      <Inst items={catwalk.rails}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#223244" metalness={0.8} roughness={0.35} />
      </Inst>
      <Inst items={catwalk.posts}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial {...steel} />
      </Inst>
      <Inst items={catwalk.legs}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial {...darkSteel} />
      </Inst>
      <Inst items={catwalk.glow}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#3f91df" toneMapped={false} />
      </Inst>

      {/* Trophy room */}
      {SUIT_CASES.map((c, i) => (
        <SuitCase key={i} {...c} />
      ))}
      <group position={[24, 3.2, -432]} rotation={[0.04, 0.5, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[3.2, 3.2, 0.5, 48]} />
          <meshStandardMaterial color="#b8923c" metalness={1} roughness={0.35} emissive="#2a1c04" emissiveIntensity={0.5} />
        </mesh>
        <mesh>
          <torusGeometry args={[3.0, 0.12, 8, 48]} />
          <meshStandardMaterial color="#d9b24f" metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[0, -4.0, -0.4]}>
          <boxGeometry args={[3.6, 2.4, 1.6]} />
          <meshStandardMaterial color="#0e1721" metalness={0.7} roughness={0.5} />
        </mesh>
      </group>

      {/* Rock pillars */}
      {[-31, -23, 23, 31].map((x, i) => (
        <group key={`pillar${x}`} position={[x, 0, -382 - (i % 2) * 12]}>
          <mesh geometry={geos.crag[i % 3]} material={mats.rock} position={[0, 11, 0]} scale={[3.4, 14, 3.4]} rotation={[0, i, 0]} />
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[3.4, 3.9, 0.8, 8]} />
            <meshStandardMaterial {...steel} />
          </mesh>
        </group>
      ))}

      {/* ============ NEW: arsenal, landing effects, arcade monitor ============ */}
      <Arsenal />
      <LandingFX />
      <ArcadeMonitor />

      {/* Life: colony, steam, dust */}
      <BatFlock />

      <CaveParticles
        count={650}
        center={[0, 0, -392]}
        extent={[90, 40, 110]}
        size={0.1}
        color={[0.45, 0.7, 1.0]}
        alpha={0.6}
        rise={0.35}
        drift={0.8}
        seed={11}
      />
      <CaveParticles
        count={160}
        center={[0, -1, -310]}
        extent={[24, 22, 100]}
        size={0.09}
        color={[0.5, 0.75, 1.0]}
        alpha={0.5}
        rise={0.25}
        drift={0.6}
        seed={23}
      />
      {([[-20, -366], [20, -366], [-22, -408], [22, -408]] as [number, number][]).map(([x, z], i) => (
        <CaveParticles
          key={`steam${i}`}
          count={40}
          center={[x, -0.6, z]}
          extent={[1.8, 9, 1.8]}
          size={2.2}
          color={[0.35, 0.5, 0.7]}
          alpha={0.22}
          rise={1.6}
          drift={0.5}
          seed={50 + i}
        />
      ))}
      <CaveParticles
        count={90}
        center={[-34, -1.4, -436]}
        extent={[9, 10, 6]}
        size={3}
        color={[0.55, 0.7, 0.85]}
        alpha={0.2}
        rise={1.2}
        drift={0.7}
        seed={77}
      />
      </group>

      {/* Camera director: outside `body` so it keeps running while the cave is toggled. */}
      <CaveCameraDirector />
    </group>
  );
}