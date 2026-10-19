# TARUN J — CINEMATIC PORTFOLIO

```
 _____ _   _ _   _ ____   ____ _____ ____  
| ____| \ | | \ | / ___| / ___| ____|  _ \ 
|  _| |  \| |  \| \___ \| |  _|  _| | |_) |
| |___| |\  | |\  |___) | |_| | |___|  __/ 
|_____|_| \_|_| \_|____/ \____|_____|_|    
                                           
   AI END-TO-END DEVELOPER · CINEMATIC WEB  
```

## TL;DR

A scroll-driven, WebGL-powered cinematic portfolio built with Next.js 16, React 19,
Three.js / R3F, GSAP, and Tailwind CSS v4. It opens with a katana-slash reveal,
flies through a neon city, lands in a procedural Batcave with a giant screen
(BatComputer career archive), and ends on a rooftop under the bat signal.
Includes a Bat-Snake arcade mini-game inside the cave screen.

---

## QUICK START

```bash
# install
npm install

# dev server (http://localhost:3000)
npm run dev

# production build
npm run build

# production preview
npm run start

# lint
npm run lint
```

---

## WHO IS THIS?

| | |
|---|---|
| **Name** | Tarun J |
| **Role** | AI End-to-End Developer |
| **Stack** | Next.js · React · Three.js · GSAP · TypeScript · Tailwind · ServiceNow · Python |
| **Clearance** | Level 9 (BatComputer) |

**The story:** every mystery begins with curiosity → investigate data → uncover patterns → turn patterns into intelligent models → engineer systems that bring them to life → build AI products end to end.

---

## WHAT'S INSIDE THE EXPERIENCE

```
SCROLL
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  01  INTRO   Copy fades in over the rooftop scene           │
│  02  STATEMENTS  Six cinematic beats as the camera orbits   │
│  03  BIO        Left/right panels flank the hero face       │
│  04  KATANA     Blade slashes across the screen → title     │
│  05  JOURNEY    Bat swarm + city reveal, camera pulls back  │
│  06  POV        Dive into first-person lens over the city   │
│  07  FLIGHT     Rush through the neon avenue to the cave    │
│  08  CAVE       Descend the tunnel into the Batcave chamber │
│  09  LANDING    Hero lands at eye level, arsenal powers up  │
│  10  ARMORY     Pan across 4 racks × 6 hanging weapons      │
│  11  SCREEN     Push in to the giant BatComputer screen     │
│  12  END        Rise through the hatch → rooftop finale     │
└─────────────────────────────────────────────────────────────┘
```

---

## TECH STACK (THE BATCAVE BENCH)

| Layer | Tech | What it does |
|-------|------|--------------|
| Framework | **Next.js 16** (App Router) | Pages, routing, SSR, metadata, fonts |
| UI | **React 19** + **Tailwind CSS v4** | Components, styling, design tokens |
| 3D | **Three.js r186** + **@react-three/fiber** + **@react-three/drei** | WebGL scene, declarative 3D, GLB loading |
| Animation | **GSAP** + **ScrollTrigger** | Scroll-driven cinematic timeline, autoplay lock |
| Smooth scroll | **Lenis** | Buttery scroll with scroll-jacking for the intro |
| Post-processing | **postprocessing** + **@react-three/postprocessing** | Bloom, shader effects on the 3D canvas |
| Audio | Web Audio API (via `<audio>`) | Looped theme, fade ramps, visibility handling |
| Shaders | **GLSL** (custom `onBeforeCompile` + `shaderMaterial`) | Rock displacement, water, mist, data screens, bats |
| Build | **Turbopack** | Fast dev/build |

---

## FOLDER LAYOUT

```
src/
├── app/
│   ├── layout.tsx        Root layout, Geist fonts, ScrollProgress, metadata
│   ├── page.tsx          Mounts <OpeningExperience />
│   └── globals.css       Design tokens, scene CSS, reduced-motion
└── components/
    ├── cinematic/
    │   ├── OpeningExperience.tsx   Master scroll-timeline (GSAP) + all scenes
    │   ├── RooftopScene.tsx        3D rooftop + city + tunnel camera rig
    │   ├── CaveEnvironment.tsx     Procedural Batcave (dome, tunnel, racks, screen)
    │   ├── CaveScreenUI.tsx        DOM overlay glued to the 3D screen (achievements, internships)
    │   ├── HeroModel.tsx           3D hero model (GLB) + damping + finale yaw
    │   ├── BatLoader.tsx           Batmobile loading screen with asset progress
    │   ├── SnakeGame.tsx           Bat-Snake arcade game (Canvas 2D)
    │   └── MusicToggle.tsx         Theme audio toggle + autoplay unlock
    └── ScrollProgress.tsx          Fixed bat-head scroll indicator
```

---

## HOW THE SCROLL TIMELINE WORKS

`OpeningExperience.tsx` builds one **GSAP timeline** whose `scrollTrigger` is pinned to the opening section.
The scroll distance maps 1:1 to timeline seconds (`PX_PER_SECOND = 286`), so scrolling scrubs the entire
cinematic like a film reel.

Key mechanics:
- **Autoplay lock**: scrolling down past the face-reveal gate locks the wheel/touch/keys and plays the
  sequence itself until the name is revealed, then hands scroll back.
- **Shared progress refs** (`openingProgress`, `worldProgress`, `flightProgress`, `caveProgress`, …)
  drive the 3D camera rigs in `RooftopScene.tsx` and `CaveEnvironment.tsx`.
- **Deterministic decoration** — no `Math.random()` in the intro (seeded `mulberry32` instead), so it's
  SSR/hydration safe.

---

## CAVE SCREEN (BATCOMPUTER)

The giant 54×27 world-space screen in `CaveEnvironment.tsx` renders a seeded Canvas texture
(`makeScreenTexture`) showing the career archive. Once the camera pushes in, a React DOM overlay
(`CaveScreenUI.tsx`) is stuck onto it via `caveUI.screenEl`, driven frame-by-frame by the
`CaveCameraDirector` so it tracks the 3D screen exactly.

Tabs: **Achievement Log** (Core training → Enterprise field work) and **Field Operations**
(ServiceNow & Inters Tech internships with tech-stack chips).

Arcade terminal: click the small monitor → launches **Bat-Snake** (`SnakeGame.tsx`), a Canvas 2D game
where Batman is the snake and the Joker is the target.

---

## PERFORMANCE & ACCESSIBILITY

- Instanced meshes for stalactites, bats, ceiling roost, and weapon racks (thousands of draw calls collapsed).
- All cave lights live in a stable `lightsRef` so the light count never changes mid-flight (prevents shader recompile / black screen).
- `prefers-reduced-motion` disables HUD rush lines, EQ bars, loader animations, and CSS animations.
- Scrollbar hidden natively; scroll still works.
- `aria-label` / `aria-pressed` on interactive controls; loader locks scroll while assets load.

---

## DEPLOY

```bash
# Vercel (recommended)
vercel

# or any Node static host after `npm run build`
```

---

## SCRIPT REFERENCE

| Script | Purpose |
|--------|---------|
| `npm run dev` | Turbopack dev server with HMR |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |

---

```
                 __
               /  \____
              /        \
          ___/  BATMAN  \___
         /                  \
        |   TARUN J · PORTFOLIO   |
         \______________________/
```

Built with curiosity, patterns, and a katana. Scroll down to begin.
