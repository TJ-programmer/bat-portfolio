# ONBOARDING — TARUN CINEMATIC PORTFOLIO

Everything you need to know about how this web experience works, the underlying tech of each piece,
and how to navigate the codebase. Read this before making changes.

---

## 01 · PROJECT IDENTITY

- **Name:** Tarun J — AI End-to-End Developer
- **Repo:** `tarun-cinematic-portfolio`
- **Framework:** Next.js 16.4.2 (App Router)
- **UI:** React 19 + Tailwind CSS v4
- **Language:** TypeScript 5
- **Package manager:** npm (lockfile: `package-lock.json`)
- **Dev server:** `npm run dev` → `http://localhost:3000` (Turbopack)
- **Build:** `npm run build`
- **Lint:** `npm run lint` (eslint-config-next)

The site is a single-page cinematic experience. `src/app/page.tsx` mounts one component:
`<OpeningExperience />`. Everything else is orchestrated inside it.

---

## 02 · HIGH-LEVEL ARCHITECTURE

```
Browser
  │
  ▼
Next.js App Router  (src/app/)
  ├── layout.tsx      Root shell: fonts, metadata, ScrollProgress, <body>
  ├── page.tsx        Renders <OpeningExperience />
  └── globals.css     Design tokens, scene CSS, reduced-motion overrides
  │
  ▼
src/components/cinematic/
  ├── OpeningExperience.tsx   Master GSAP ScrollTrigger timeline (the "film reel")
  ├── RooftopScene.tsx        3D rooftop + city + tunnel camera rig (Three.js/R3F)
  ├── CaveEnvironment.tsx     Procedural Batcave: dome, tunnel, racks, giant screen
  ├── CaveScreenUI.tsx        DOM overlay glued to the 3D screen (career archive)
  ├── HeroModel.tsx           3D hero model (GLB), damping, finale yaw
  ├── BatLoader.tsx           Batmobile loading screen with asset progress
  ├── SnakeGame.tsx           Bat-Snake arcade game (Canvas 2D)
  └── MusicToggle.tsx         Theme audio toggle + autoplay unlock
  │
  └── ScrollProgress.tsx      Fixed bat-head scroll indicator (layout.tsx)
```

**Data layer:** `src/components/cinematic/caveState.ts` holds shared progress refs,
`ACHIEVEMENTS`, `INTERNSHIPS`, `CAVE_EVENTS`, screen dimensions, and rooftop shot constants.

**3D assets:** `public/models/hero/source/model.glb` (hero model), `public/audio/theme.mp3` (looping theme).

---

## 03 · THE SCROLL TIMELINE — HOW THE "FILM REEL" WORKS

`OpeningExperience.tsx` is the brain. It creates **one GSAP timeline** (`tl`) whose `scrollTrigger`
is pinned to the opening section.

### Core contract

- Scroll distance (px) ↔ timeline seconds: `PX_PER_SECOND = 286`.
- `end: () => \`+=${Math.round(TOTAL_DURATION * PX_PER_SECOND)}\`` makes the scrollable height match the
  total cinematic duration (~47 s).
- `pin: true` + `scrub: 0.8` means scrolling scrubs the timeline smoothly.
- `invalidateOnRefresh: true` keeps it responsive on resize.

### Timeline acts (in order)

| Act | Approx. time | What happens |
|-----|-------------|--------------|
| Intro copy | 0 – 1.3s | Welcome copy + scene dressing fades out |
| Statements | 2.0s+ | Six curiosity-driven statements fade in/out left/right |
| Bio panels | ~12s | Left/right bio panels flank the hero face |
| Eye reveal | ~17.6s | Letterbox bars close to a thin band (eyes only) |
| Katana pass | THUNDER | Blade slashes L→R, scar flashes, title wipes in |
| Journey | JOURNEY_START | Bat swarm, city reveal, camera pulls back |
| POV dive | POV_START | First-person dive into hero's eyes |
| Flight | FLIGHT_START | Neon avenue rush, radial HUD streaks |
| Cave descent | CAVE_START | Tunnel descent into Batcave chamber |
| Landing | LAND_START | Hero lands at eye level, arsenal powers up |
| Armory | ARMORY_START | Pan across 4 weapon racks × 6 skills |
| Screen | SCREEN_START | Push in to giant BatComputer screen |
| End | END_START | Rise through hatch → rooftop finale under bat signal |

### Autoplay lock

When scrolling down past `AUTO_START`, `startAuto()` hijacks the wheel/touch/keys, locks scroll,
and tweens a proxy from `AUTO_START` to `AUTO_END`. Upward scroll or PageUp cancels it and returns
control to the user. On complete, scroll is handed back and `ScrollTrigger.refresh()` is called.

### Shared progress refs

These mutable objects drive the 3D cameras (imported into `RooftopScene` and `CaveEnvironment`):

```
openingProgress, revealFlash, impactPunch, worldProgress,
povProgress, flightProgress, caveProgress, launchBoost,
landProgress, armoryProgress, screenProgress, endProgress, roofProgress
```

Each is `{ current: number }` (0..1). GSAP tweens `current`; the 3D rigs read it every frame via
`useFrame`.

---

## 04 · PIECE-BY-PIECE UNDERLYING TECH

### 4.1 OpeningExperience.tsx — Master conductor

**Tech:** React (client), GSAP + ScrollTrigger, HTML/CSS-in-JS template literal.

Responsibilities:
- Registers `ScrollTrigger` plugin.
- Defines all timing constants (`THUNDER`, `KATANA_PASS`, `JOURNEY_START`, `TOTAL_DURATION`, etc.).
- Builds the master timeline with `.to()`, `.fromTo()`, `.set()` calls.
- Handles autoplay lock (`onWheel`, `onTouchMove`, `onKey`).
- Renders: bat swarm, speed lines, katana SVG, rush-line canvas, title/caption DOM elements,
  end-screen contact links, and the `<CaveScreenUI />` + `<SnakeGame />` portals.
- Listens to `CAVE_EVENTS.openGame` (`batcave:open-game`) to open the snake game.

Key files it imports from `RooftopScene`: `impactPunch`, `openingProgress`, `revealFlash`,
`worldProgress`, `povProgress`, `flightProgress`, `caveProgress`, `flightSpeed`, `launchBoost`.
From `caveState`: `CAVE_EVENTS`, `armoryProgress`, `endProgress`, `landProgress`, `roofProgress`,
`screenProgress`.

### 4.2 RooftopScene.tsx — 3D rooftop + city + tunnel

**Tech:** `@react-three/fiber` (`useFrame`, `useThree`), `three`, GSAP-driven camera.

This is the first 3D scene. It renders:
- The rooftop environment + hero model.
- City blocks / skyline.
- The tunnel entrance leading to the cave.
- A camera rig whose position/look-at is driven by `openingProgress`, `worldProgress`, `povProgress`,
  `flightProgress`, `caveProgress`.

The camera director reads shared progress refs every frame and interpolates between keyframes (e.g.
`ROOF_SHOT.from` → `ROOF_SHOT.to`). It yields frame priority so `CaveEnvironment`'s director
(run at priority 0.5) can take over after the tunnel descent.

### 4.3 CaveEnvironment.tsx — Procedural Batcave

**Tech:** R3F + Three.js, **custom GLSL shaders** (`onBeforeCompile` + `shaderMaterial`),
instanced meshes, seeded noise (`mulberry32`).

This is the largest file. It builds:

- **Dome + tunnel + floor**: procedural geometry generated from `IcosahedronGeometry` /
  `CylinderGeometry` / `SphereGeometry` / `PlaneGeometry`, vertex positions displaced by 3D FBM noise,
  vertex colors for strata/wetness.
- **Rock shader** (`ROCK_GLSL`, `patchMaterial`): bump, wet patches, moss, veins, distance haze.
  Uses `onBeforeCompile` to inject varyings/uniforms into `MeshStandardMaterial`.
- **Ceiling**: 250 stalactites + 200 roosting bats as `InstancedMesh` (seeded placements).
- **Cables**: 18 `TubeGeometry` cables strung across the dome (Catmull-Rom curves with sag).
- **Bat flock**: 44 bats as `InstancedMesh` with a custom `shaderMaterial` (vertex shader flaps wings
  via `aPhase` attribute + `uTime` uniform).
- **Particles / dust / steam**: `Points` with additive-blended `shaderMaterial`, screen-space point size.
- **Volumetric light shaft** (`Shaft`): rim-lit cylinder shader for god rays.
- **Spin beacon**: rotating hazard beam with two opposite shafts.
- **Water / mist / waterfall / pool ripples**: planar `shaderMaterial` with reflection/fresnel/noise.
- **MainScreen**: 54×27 plane with a `shaderMaterial` showing a Canvas texture (`makeScreenTexture`).
  Chromatic jitter, scanlines, brightness band, vignette. Explicit square (`exp(-bd*bd)`) avoids
  GLSL `pow(negative, 2.0)` undefined behavior.
- **DataScreen / RackFront**: blinking LED grid shaders for arsenal racks.
- **Batmobile**: procedural extruded geometry on a slow turntable, jet scale pulses.
- **Arsenal**: 4 racks × 6 hanging weapons, one weapon per skill; `rackFocus()` drives glow/lights.
- **CaveCameraDirector**: takes over camera after tunnel descent → landing → armory pan → screen push-in.
  Runs at frame priority 0.5 (after RooftopScene rig).

**Black-screen fixes kept:**
1. MainScreen shader uses explicit square, not `pow(negative, 2.0)`.
2. All cave lights live in `lightsRef` (never toggled), so light count never changes mid-flight.

### 4.4 CaveScreenUI.tsx — DOM overlay on the 3D screen

**Tech:** React (client), absolute-positioned DOM, CSS-in-JS template literal.

A fixed-size DOM panel (`SCREEN_UI = 1600×800`) stuck onto the giant 3D screen via
`caveUI.screenEl`. The `CaveCameraDirector` writes its transform every frame so it tracks the
3D screen exactly. Opacity/pointer events driven by GSAP `autoAlpha` on `.bc-screen`.

Contents:
- **Achievement Log** (2023 Core training → 2026 Enterprise field work). Click to expand.
- **Field Operations // Internships** tabs: ServiceNow (May–Jul 2026) and Inters Tech (2024).
  Tech-stack chips, bullets, role/meta.
- **Footer:** arcade terminal hint ("click the small monitor to play").

### 4.5 HeroModel.tsx — 3D hero model

**Tech:** R3F (`useFrame`, `useGLTF` from `@react-three/drei`), `three`.

Loads `/models/hero/source/model.glb`, fits it to a fixed height (`HERO_HEIGHT = 4.5`) by computing
the bounding box and centering. Damps rotation.y slowly (`Math.sin(t * 0.2) * 0.025`). In the finale,
`roofProgress.current > 0.0005` snaps yaw to `HERO_END_YAW` (1.85 rad) so the hero faces the bat signal.

`useGLTF.preload(MODEL_PATH)` preloads the GLB.

### 4.6 BatLoader.tsx — Loading screen

**Tech:** React (client), `@react-three/drei` `useProgress`, Canvas 2D SVG animation.

- Locks page scroll (`html.style.overflow = "hidden"`).
- Tracks real asset progress (`progress * 0.9`, capped at 90%) + scene-ready signal
  (`window.__rooftopReady` or `rooftop-ready` event, 20 s max-wait bailout).
- Smooth creep so it never looks frozen; min show time 2400 ms.
- Batmobile SVG drives left across a track as progress grows; "go" phase floors it off-screen.
- Calls `onStart()` / `onDone()` to hand off to the scene.

### 4.7 SnakeGame.tsx — Bat-Snake arcade game

**Tech:** React (client), `createPortal`, HTML Canvas 2D, keyboard input.

22×15 grid. Batman is the snake; the Joker is the target. Directional input (arrows / WASD).
Joker laughs (`LAUGHS` array). Bat silhouette drawn via canvas path; head rotates toward travel
direction. Renders into a portal overlay triggered from the cave screen.

### 4.8 MusicToggle.tsx — Theme audio

**Tech:** Web Audio API (via `HTMLAudioElement`), localStorage, `createPortal`.

- Loops `/audio/theme.mp3` at volume 0.5.
- Volume ramps (±0.02 per 40 ms) for smooth fades.
- Autoplay unlock: tries to play on mount; if blocked, listens for `pointerdown`/`keydown`/`touchend`/`click`.
- Persists on/off in `localStorage` under key `bat-music`.
- Pauses on tab hide, resumes on show.
- EQ bar visualizer (CSS `scaleY` animations), slash overlay when muted.

### 4.9 ScrollProgress.tsx — Fixed scroll indicator

**Tech:** React (client), `requestAnimationFrame`, inline CSS.

Fixed right-side track with a bat-head SVG that moves down as you scroll. Shows percentage.
Uses `sp-show` class to fade in after scrolling >4px. `pointer-events: none` so it never blocks
interaction. Responsive: hides label on mobile ≤600px.

---

## 05 · SHARED STATE (caveState.ts)

Single source of truth for cross-component progress and data:

```ts
// Progress refs (0..1), mutated by GSAP timelines
landProgress, armoryProgress, screenProgress, endProgress, roofProgress

// Cave UI bridge
caveUI: { screenEl: HTMLElement | null }   // CaveScreenUI writes its ref here

// Events
CAVE_EVENTS = { openGame: "batcave:open-game" }

// Screen geometry (world space + DOM overlay design size)
SCREEN = { x: 3, y: 24, z: -447, w: 54, h: 27 }
SCREEN_UI = { w: 1600, h: 800 }

// Arsenal rack X positions
RACK_X = [-22.5, -8.1, 8.1, 22.5]

// Helper: smoothstep
ss(x, a, b)

// Camera look-X during armory pan
armLookX()

// Rack focus strength (drives arsenal glow)
rackFocus(i)

// Arsenal power-on curve
arsenalPower()

// Data
ACHIEVEMENTS[]   // { year, tag, title, text }
INTERNSHIPS[]    // { company, period, role, bullets[], stack[] }

// Finale
HERO_END_YAW = 1.85
ROOF_SHOT = { from: {...}, to: {...} }
```

**Rule:** never import `OpeningExperience` into `RooftopScene` or `CaveEnvironment` (circular
dependency risk). Communicate only through shared refs in `caveState`.

---

## 06 · CSS / STYLING CONVENTIONS

- **Tailwind v4** via `@import "tailwindcss"` in `globals.css`.
- Design tokens in `:root`: `--background`, `--foreground`, `--muted`, `--accent`.
- Color-scheme: `dark`. Background `#07090d`.
- Most cinematic components use **CSS-in-JS template literals** (`const CSS = \`...\``)
  injected via `<style>{CSS}</style>` for component-scoped, SSR-safe styles.
- `scrollbar-width: none` everywhere (native scrollbar hidden, scroll still works).
- `prefers-reduced-motion: reduce` disables animations/transitions globally.

---

## 07 · ADDING A NEW SCENE / ACT

1. Add a progress ref to `caveState.ts` if the 3D camera needs to react to it.
2. Add a timing constant and a `.to()`/`.fromTo()` block to the master timeline in
   `OpeningExperience.tsx`.
3. If you need 3D, add a camera branch in `RooftopScene.tsx` or `CaveEnvironment.tsx` driven by
   the new progress ref.
4. Keep decoration deterministic (seeded `mulberry32`) for SSR/hydration safety.
5. Wrap new client components in `"use client"`.

---

## 08 · PERFORMANCE GUIDELINES

- Use `InstancedMesh` for repeated geometry (stalactites, bats, racks) — thousands of objects,
  one draw call.
- Keep light count stable (`lightsRef`) to avoid shader recompilation.
- `frustumCulled={false}` on ceiling instanced meshes so they render behind the camera.
- Rush-line canvas clears itself and stops RAF when intensity < 0.01 (zero cost at rest).
- `will-change` on animated DOM transforms.
- Avoid `Math.random()` in the intro timeline (SSR/hydration mismatch).

---

## 09 · ACCESSIBILITY

- `aria-label` / `aria-pressed` on `MusicToggle`.
- `aria-hidden="true"` on decorative SVG/canvas (rush lines, loader, bats).
- Loader locks scroll while assets load (`role="status"`, `aria-label="Loading"`).
- Reduced-motion media query disables motion.
- `pointer-events: none` on all purely decorative HUD elements.

---

## 10 · DEPLOYMENT

| Platform | Command |
|----------|---------|
| Vercel | `vercel` (zero-config Next.js) |
| Static export | `npm run build` → serve `.next/standalone` or adapter output |
| Node host | `npm run build` && `npm run start` |

No build-time env vars are required. Audio and model are served from `public/`.

---

## 11 · SCRIPT REFERENCE

| Script | Purpose |
|--------|---------|
| `npm run dev` | Turbopack dev with HMR |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint (next config) |

---

## 12 · COMMON GOTCHAS

- **Black screen after changes:** check that light count is stable and MainScreen isn't using
  `pow(negative, 2.0)`.
- **Hydration mismatch:** don't use `Math.random()` or `Date.now()` in the opening timeline;
  use seeded `mulberry32`.
- **Scroll broken after editing timeline:** `PX_PER_SECOND` and `TOTAL_DURATION` must stay in sync;
  `ScrollTrigger.refresh()` is called on autoplay done.
- **Cave UI not tracking the screen:** `caveUI.screenEl` must be set by `CaveScreenUI` and written
  by `CaveCameraDirector` every frame.
- **Audio silent until click:** browsers block autoplay; `MusicToggle` handles unlock, but the user
  must gesture first.

---

```
  ___                               ___
 /  /\                             /  /\
/  /::\     ___     ___           /  /::\
/  /:/\:\   /__/\   /  /\         /  /:/\:\
/  /:/  \:\  \  \:\ /  /:/        /  /:/  \:\
/__/:/ \__\:\  \  \:\  /::\      /__/:/ \__\:\
\  \:\ /  /:/  \  \:\/  /:/      \  \:\ /  /:/
 \  \:\  /:/    \  \::/ /:/       \  \:\  /:/
  \  \:\/:/      \__\::/ /:/       \  \:\/:/
   \  \::/       /__\:/ /:/         \  \::/
    \__\/        \__\/ \/            \__\/

  Tarun J · AI End-to-End Developer
  Read onboarding.md before contributing.
```
