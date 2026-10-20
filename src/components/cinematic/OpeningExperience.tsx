"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import RooftopScene, {
  impactPunch,
  openingProgress,
  revealFlash,
  worldProgress,
  povProgress,
  flightProgress,
  caveProgress,
  flightSpeed,
  launchBoost,
} from "@/components/cinematic/RooftopScene";

import BatLoader from "@/components/cinematic/BatLoader";

import {
  CAVE_EVENTS,
  armoryProgress,
  endProgress,
  landProgress,
  roofProgress,
  screenProgress,
} from "@/components/cinematic/caveState";

import CaveScreenUI from "@/components/cinematic/CaveScreenUI";
import SnakeGame from "@/components/cinematic/SnakeGame";
import MusicToggle from "@/components/cinematic/MusicToggle";
import MobileScrollButton from "@/components/cinematic/MobileScrollButton";
/* -------------------------------------------------------------------------- */
/*  Opening statements                                                        */
/* -------------------------------------------------------------------------- */

const statements = [
  { number: "01", text: "Every mystery begins with curiosity.", side: "left" },
  { number: "02", text: "I investigate data to uncover hidden patterns.", side: "right" },
  { number: "03", text: "I turn those patterns into intelligent models.", side: "left" },
  { number: "04", text: "I engineer the systems that bring them to life.", side: "right" },
  { number: "05", text: "From algorithms to interfaces, every layer matters.", side: "left" },
  { number: "06", text: "I build AI products end to end — from idea to deployment.", side: "right" },
];

/* -------------------------------------------------------------------------- */
/*  Timeline configuration                                                    */
/* -------------------------------------------------------------------------- */

const PROGRESS_DURATION = 20;
const THUNDER = 17.6; // the katana starts its pass here

const BAR_SLIM = 0.14;
const BAR_EYES = 0.76; // bars close down to a thin band: only the eyes remain

// Bio beat timing (camera has orbited to the front by ~12.8s).
const BARS_OPEN_AT = 12.0;
const BIO_LEFT_IN = 12.9;
const BIO_RIGHT_IN = 13.3;
const BIO_OUT = 14.8;

// Katana pass (handle pivot, in vw). Blade is 62vw long, so the tip leads by 62vw.
const KATANA_START = -88; // fully off-screen left (after the wind-up pull-back)
const KATANA_END = 114; // fully off-screen right
const KATANA_PASS = 1.1; // seconds for the pass
const HIT_DELAY = 0.47; // when the blade crosses the face / title area

// AUTOPLAY: scrolling down to AUTO_START locks the scroll and plays the timeline
// by itself until AUTO_END (final name state), then hands scroll back.
const AUTO_START = BARS_OPEN_AT + 0.9; // face revealed, no black bars
const AUTO_END = THUNDER + HIT_DELAY + 2.2; // name fully revealed (role + shine done)
const AUTO_PACE = 1; // real seconds per timeline unit (1 = as designed, higher = slower)

// Bat swarm + city reveal begins after the final name hold.
const JOURNEY_START = THUNDER + HIT_DELAY + 2.2 + 2.4;
const JOURNEY_DURATION = 3.6;

// Camera dives from behind the hero into his head (first-person lens).
// The city-facing shot holds for ~1s after the swarm clears, then the dive begins.
const POV_START = JOURNEY_START + JOURNEY_DURATION + 1.0;
const POV_DURATION = 2.4;

// The flight begins the instant the camera sits in the hero's eyes.
const FLIGHT_START = POV_START + POV_DURATION;
const FLIGHT_DURATION = 10.0; // longer avenue + rooftop skim (was 6.0)

// The flight continues into the descending tunnel. It now stops at the tunnel
// mouth (CAVE_END = fraction of the cave curve) instead of flying on to the monitor.
const CAVE_START = FLIGHT_START + FLIGHT_DURATION;
const CAVE_DURATION = 7.5;
const CAVE_END = 0.8;

// Hero landing -> eye-level pan across the weapon arsenal -> giant screen.
const LAND_START = CAVE_START + CAVE_DURATION + 0.8;
const LAND_DURATION = 3.2;
const ARMORY_START = LAND_START + LAND_DURATION + 0.2;
const ARMORY_DURATION = 6.5;
const SCREEN_START = ARMORY_START + ARMORY_DURATION + 1.0;
const SCREEN_DURATION = 4.0;
const SCREEN_HOLD = 3.0;

// THE END: leave the screen, rise through the hatch, rooftop shot, title + contact.
const END_START = SCREEN_START + SCREEN_DURATION + SCREEN_HOLD;
const END_CAVE = 5.5; // camera pull-back + rise through the hatch
const END_ROOF = 9.0; // rooftop shot (title lands ~3s in)
const END_HOLD = 2.0;
const END_CAVE_AT = END_START + 0.2;
const END_ROOF_AT = END_CAVE_AT + END_CAVE + 0.15;

const TOTAL_DURATION = END_ROOF_AT + END_ROOF + END_HOLD;
const PX_PER_SECOND = 286; // same scroll feel as before (13500px / ~47s)
/* -------------------------------------------------------------------------- */
/*  Deterministic decoration data (no Math.random: SSR / hydration safe)      */
/* -------------------------------------------------------------------------- */

const SPEED_LINES = Array.from({ length: 14 }, (_, i) => ({
  top: (i * 37 + 11) % 100,
  width: 28 + ((i * 53) % 46),
  height: 1 + (i % 3),
  opacity: 0.35 + ((i * 17) % 50) / 100,
}));

const BATS = Array.from({ length: 12 }, (_, i) => ({
  top: 10 + ((i * 29) % 78),
  width: 2.6 + (i % 4) * 1.5,
  delay: (i % 5) * 0.07,
}));

const TRANSITION_BATS = Array.from({ length: 22 }, (_, i) => ({
  left: 22 + ((i * 37) % 57),
  top: 18 + ((i * 29) % 64),
  width: 4 + ((i * 13) % 9),
  x: ((i % 2 === 0 ? 1 : -1) * (12 + ((i * 19) % 48))),
  y: ((i % 3 === 0 ? -1 : 1) * (8 + ((i * 17) % 38))),
  rotation: (i % 2 === 0 ? 1 : -1) * (12 + (i % 5) * 9),
  delay: (i % 7) * 0.045,
}));

// Radial rush lines for the take-off / flight (angle, progress, speed, length)
const RUSH_LINES = Array.from({ length: 110 }, (_, i) => ({
  a: (i * 2.399963) % (Math.PI * 2),
  r: (i * 0.61803) % 1,
  s: 0.55 + ((i * 53) % 47) / 60,
  l: 0.5 + ((i * 29) % 31) / 40,
}));

// Bat silhouette (viewBox 0 0 100 50)
const BAT_PATH =
  "M50 12 L55 4 L58 14 Q70 8 85 6 Q92 14 100 22 Q88 20 82 26 Q76 20 68 28 Q62 24 58 34 L50 46 L42 34 Q38 24 32 28 Q24 20 18 26 Q12 20 0 22 Q8 14 15 6 Q30 8 42 14 L45 4 Z";

// Winged emblem (same silhouette as the signal projected on the clouds)
const EMBLEM_HALF: [number, number][] = [
  [0, -50], [16, -82], [28, -54],
  [90, -66], [190, -60], [300, -22],
  [350, 22],
  [296, 14], [250, 40],
  [226, 30], [180, 68],
  [150, 56], [100, 96],
  [64, 70], [30, 86], [0, 100],
];
const EMBLEM_POINTS: [number, number][] = [
  ...EMBLEM_HALF,
  ...[...EMBLEM_HALF].reverse().map(([x, y]) => [-x, y] as [number, number]),
];
const EMBLEM_PATH =
  EMBLEM_POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + " Z";

// Scalloped bat-wing hem drawn under the name (10 points, viewBox 0 0 400 24)
const WING_PATH = (() => {
  let d = "M0 2";
  for (let k = 0; k < 10; k++) {
    const x = k * 40;
    d += ` Q${x + 14} 4 ${x + 20} 22 Q${x + 26} 4 ${x + 40} 2`;
  }
  return d;
})();

/* -------------------------------------------------------------------------- */
/*  Component styles                                                          */
/* -------------------------------------------------------------------------- */

const CSS = /* css */ `
.oe-bar {
  position: absolute;
  left: 0;
  right: 0;
  height: 50vh;
  background: #000;
  z-index: 6;
  pointer-events: none;
  will-change: transform;
}

.oe-bar-top {
  top: 0;
  transform-origin: top center;
}

.oe-bar-bottom {
  bottom: 0;
  transform-origin: bottom center;
}

.oe-bio-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5vw;
  pointer-events: none;
}

.oe-bio {
  width: min(27vw, 380px);
  padding: 1.1rem 0 1.1rem 1.25rem;
  border-left: 1px solid rgba(139, 188, 255, 0.55);
  background: linear-gradient(90deg, rgba(4, 8, 14, 0.62), rgba(4, 8, 14, 0));
  color: rgba(222, 234, 255, 0.9);
  font-size: clamp(0.85rem, 1.02vw, 1.05rem);
  line-height: 1.75;
  backdrop-filter: blur(2px);
}

.oe-bio-right {
  border-left: 0;
  border-right: 1px solid rgba(139, 188, 255, 0.55);
  padding: 1.1rem 1.25rem 1.1rem 0;
  text-align: right;
  background: linear-gradient(270deg, rgba(4, 8, 14, 0.62), rgba(4, 8, 14, 0));
}

.oe-bio-tag {
  display: block;
  margin-bottom: 0.7rem;
  font-size: 0.68rem;
  letter-spacing: 0.34em;
  color: #8bbcff;
  font-weight: 600;
}

.oe-bio p {
  margin: 0;
}

/* Cold lightning wash */

.oe-flash {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  mix-blend-mode: screen;
  background: radial-gradient(
    120% 90% at 50% 0%,
    rgba(205, 224, 255, 0.95) 0%,
    rgba(120, 160, 230, 0.55) 55%,
    rgba(40, 70, 130, 0.25) 100%
  );
}

/* Hot white flash where the blade crosses the face */

.oe-cutflash {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  mix-blend-mode: screen;
  background: radial-gradient(
    60% 22% at 52% 50%,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(150, 200, 255, 0.45) 50%,
    rgba(40, 80, 160, 0) 100%
  );
}

/* Soft glow behind the title after the pass */

.oe-glare {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  mix-blend-mode: screen;
  background: radial-gradient(
    45% 35% at 66% 50%,
    rgba(190, 230, 255, 0.6) 0%,
    rgba(90, 150, 255, 0.25) 45%,
    rgba(20, 40, 90, 0) 80%
  );
}

/* Hairline of light that sweeps the eye band as the bars close */

.oe-eyeline {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  z-index: 7;
  pointer-events: none;
  transform-origin: center;
  background: linear-gradient(
    90deg,
    rgba(139, 188, 255, 0),
    rgba(190, 225, 255, 0.95) 50%,
    rgba(139, 188, 255, 0)
  );
  box-shadow: 0 0 18px rgba(139, 188, 255, 0.8);
}

/* Horizontal scar left behind by the blade */

.oe-scar {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 3px;
  margin-top: -1.5px;
  z-index: 8;
  pointer-events: none;
  transform-origin: center;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    #ffffff 12%,
    #ffffff 88%,
    rgba(255, 255, 255, 0)
  );
  box-shadow:
    0 0 14px rgba(190, 225, 255, 0.95),
    0 0 46px rgba(90, 150, 255, 0.8);
}

/* ------------------------------ Speed lines ------------------------------- */

.oe-speed-line {
  position: absolute;
  left: 0;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(139, 188, 255, 0),
    rgba(220, 238, 255, 0.95) 70%,
    rgba(255, 255, 255, 1)
  );
  will-change: transform, opacity;
}

/* ------------------------- Flight rush lines (canvas) --------------------- */
/* Radial streaks that rush out from the centre of the screen. Intensity is
   driven by the real camera speed + the take-off burst (see <RushLines />). */

.oe-rush {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  pointer-events: none;
  mix-blend-mode: screen;
}

/* -------------------------------- KATANA ---------------------------------- */

/* Clips everything that flies in from outside the frame */
.oe-katana-lane {
  position: absolute;
  inset: 0;
  z-index: 9;
  overflow: hidden;
  pointer-events: none;
}

/* Zero-size pivot at the handle. The blade points right. */
.oe-katana {
  position: absolute;
  left: 0;
  top: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

.oe-katana-svg {
  position: absolute;
  left: 0;
  top: -3.1vw;
  width: 62vw;
  height: 6.2vw;
  overflow: visible;
  filter:
    drop-shadow(0 0 6px rgba(190, 225, 255, 0.9))
    drop-shadow(0 0 22px rgba(90, 150, 255, 0.7));
}

/* Thin bright streak that runs from far behind the handle to the tip */
.oe-katana-streak {
  position: absolute;
  left: -90vw;
  top: -0.22vw;
  width: 152vw;
  height: 0.44vw;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(139, 188, 255, 0),
    rgba(190, 225, 255, 0.55) 55%,
    rgba(255, 255, 255, 0.95) 100%
  );
  box-shadow: 0 0 14px rgba(190, 225, 255, 0.9);
}

/* Wide soft glow band around the streak */
.oe-katana-glow {
  position: absolute;
  left: -90vw;
  top: -2vw;
  width: 152vw;
  height: 4vw;
  mix-blend-mode: screen;
  background: linear-gradient(
    90deg,
    rgba(90, 150, 255, 0),
    rgba(90, 150, 255, 0.22) 70%,
    rgba(160, 205, 255, 0.4) 100%
  );
  -webkit-mask-image: linear-gradient(
    180deg,
    transparent,
    #000 50%,
    transparent
  );
  mask-image: linear-gradient(180deg, transparent, #000 50%, transparent);
}

/* --------------------------------- BATS ----------------------------------- */

.oe-bat {
  position: absolute;
  left: 0;
  will-change: transform, opacity;
}

.oe-bat-svg {
  display: block;
  width: 100%;
  height: auto;
  fill: #02040a;
  stroke: rgba(139, 188, 255, 0.7);
  stroke-width: 1.4;
  overflow: visible;
  transform-origin: 50% 65%;
  animation: oe-flap 0.28s ease-in-out infinite;
  filter: drop-shadow(0 0 5px rgba(139, 188, 255, 0.55));
}

@keyframes oe-flap {
  0%,
  100% {
    transform: scaleY(1) scaleX(1);
  }
  50% {
    transform: scaleY(0.5) scaleX(0.92);
  }
}

/* ------------------------- Foreground transition swarm -------------------- */

.oe-transition-swarm {
  position: absolute;
  inset: 0;
  z-index: 11;
  overflow: hidden;
  pointer-events: none;
  perspective: 900px;
}

.oe-transition-bat {
  position: absolute;
  height: auto;
  opacity: 0;
  fill: #02040a;
  stroke: rgba(139, 188, 255, 0.55);
  stroke-width: 1.2;
  transform-origin: 50% 50%;
  filter:
    drop-shadow(0 0 5px rgba(80, 130, 220, 0.35))
    drop-shadow(0 0 16px rgba(20, 40, 80, 0.5));
  will-change: transform, opacity;
}

/* ------------------------------ Title caption ----------------------------- */

.oe-caption {
  position: absolute;
  z-index: 8;
  left: 49%;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: #eaf3ff;
}

.oe-cap-inner {
  position: relative;
  will-change: transform;
}

/* Bat emblem sits behind the whole title block */
.oe-emblem {
  position: absolute;
  left: -5%;
  top: 50%;
  width: 110%;
  height: auto;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
  fill: rgba(139, 188, 255, 0.08);
  stroke: rgba(190, 225, 255, 0.75);
  stroke-width: 2.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  filter:
    drop-shadow(0 0 8px rgba(139, 188, 255, 0.8))
    drop-shadow(0 0 28px rgba(90, 150, 255, 0.55));
}

.oe-emblem path {
  vector-effect: non-scaling-stroke;
}

.oe-kana,
.oe-cap-rule,
.oe-name-wrap,
.oe-wing,
.oe-role-mask {
  position: relative;
  z-index: 1;
}

.oe-kana {
  display: block;
  margin-bottom: 0.7rem;
  font-size: clamp(0.7rem, 1vw, 1rem);
  font-weight: 700;
  letter-spacing: 0.7em;
  color: #8bbcff;
  text-shadow: 0 0 14px rgba(139, 188, 255, 0.7);
}

.oe-cap-rule {
  display: block;
  width: clamp(60px, 9vw, 150px);
  height: 3px;
  margin-bottom: 0.7rem;
  background: linear-gradient(90deg, #ffffff, #8bbcff 40%, rgba(139, 188, 255, 0));
  box-shadow: 0 0 14px rgba(139, 188, 255, 0.7);
  transform-origin: left center;
}

.oe-cap-name {
  --split: 0px;
  margin: 0;
  display: block;
  padding: 0.1em 0.45em 0.1em 0.1em;
  font-weight: 900;
  font-style: italic;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: clamp(2rem, 5.2vw, 5.4rem);
  line-height: 1.1;
  white-space: nowrap;
  color: #ffffff;
  text-shadow:
    calc(var(--split) * -1) 0 0 rgba(0, 240, 255, 0.85),
    var(--split) 0 0 rgba(255, 40, 110, 0.85),
    0 0 26px rgba(139, 188, 255, 0.55);
  will-change: transform, clip-path;
}

.oe-ch-accent {
  color: #8bbcff;
}

/* Bright leading edge that rides the wipe */
.oe-name-edge {
  position: absolute;
  top: -8%;
  bottom: -8%;
  left: 0;
  width: 3px;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0),
    #ffffff 30%,
    #ffffff 70%,
    rgba(255, 255, 255, 0)
  );
  box-shadow:
    0 0 14px rgba(190, 225, 255, 0.95),
    0 0 36px rgba(90, 150, 255, 0.8);
}

.oe-shine {
  position: absolute;
  top: -10%;
  bottom: -10%;
  left: 0;
  width: 18%;
  pointer-events: none;
  transform: skewX(-24deg);
  mix-blend-mode: overlay;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.95),
    rgba(255, 255, 255, 0)
  );
}

/* Scalloped bat-wing hem under the name */
.oe-wing {
  display: block;
  width: 100%;
  height: clamp(10px, 1.1vw, 20px);
  margin: -0.15em 0 0.5rem;
  overflow: visible;
  visibility: hidden; /* hidden until the final scene */
  opacity: 0;
}

.oe-wing path {
  fill: none;
  stroke: #8bbcff;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 6px rgba(139, 188, 255, 0.8));
}

.oe-role-mask {
  overflow: hidden;
  padding: 0.2em 0;
}

.oe-cap-role {
  margin: 0;
  font-weight: 700;
  font-style: italic;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: clamp(0.62rem, 1.05vw, 1.05rem);
  line-height: 1.6;
  white-space: nowrap;
  color: #8bbcff;
  text-shadow: 0 0 14px rgba(139, 188, 255, 0.45);
}

/* ------------------------------ World title ------------------------------- */
/* Horizontal centering is handled by GSAP (xPercent: -50) so it never fights
   with the y / scale animation on this element. */

.oe-world-title {
  position: absolute;
  z-index: 12;
  left: 50%;
  bottom: 12%;
  width: min(90%, 900px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  color: #f4f6fb;
  text-align: center;
  pointer-events: none;
  will-change: transform, opacity, filter;
}

.oe-world-eyebrow {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.42em;
  color: rgba(193, 210, 240, 0.72);
}

.oe-world-title h2 {
  margin: 0;
  font-size: clamp(25px, 4.5vw, 58px);
  font-weight: 500;
  letter-spacing: 0.16em;
  line-height: 1.15;
  text-shadow: 0 0 28px rgba(80, 125, 210, 0.22);
}

.oe-scroll-cue {
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.oe-scroll-line {
  width: 1px;
  height: 30px;
  background: linear-gradient(
    to bottom,
    rgba(180, 205, 245, 0.05),
    rgba(180, 205, 245, 0.8)
  );
  transform-origin: top;
  animation: oe-scroll-line 1.8s ease-in-out infinite;
}

.oe-scroll-label {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.32em;
  color: rgba(220, 229, 245, 0.72);
}

.oe-scroll-arrow {
  font-size: 18px;
  line-height: 1;
  color: rgba(220, 229, 245, 0.85);
  animation: oe-scroll-arrow 1.5s ease-in-out infinite;
}

@keyframes oe-scroll-line {
  0%, 100% {
    opacity: 0.45;
    transform: scaleY(0.65);
  }
  50% {
    opacity: 1;
    transform: scaleY(1);
  }
}

@keyframes oe-scroll-arrow {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.6;
  }
  50% {
    transform: translateY(6px);
    opacity: 1;
  }
}

/* ----------------------------- Batcave reveal ----------------------------- */
.oe-cave-title {
  position: absolute;
  z-index: 13;
  left: 50%;
  top: 16%;
  width: min(90%, 760px);
  text-align: center;
  color: #eaf3ff;
  pointer-events: none;
  opacity: 0;
  will-change: transform, opacity, filter;
}

.oe-cave-title .oe-world-eyebrow {
  display: block;
  margin-bottom: 16px;
}

.oe-cave-title h2 {
  margin: 0;
  font-size: clamp(28px, 5vw, 66px);
  font-weight: 500;
  letter-spacing: 0.22em;
  text-shadow: 0 0 34px rgba(75, 151, 238, 0.42);
}

.oe-cave-title p {
  margin: 16px 0 0;
  font-size: 10px;
  letter-spacing: 0.32em;
  color: rgba(190, 218, 250, 0.72);
}

@media (max-width: 600px) {
  .oe-world-title {
    bottom: 14%;
    gap: 12px;
  }

  .oe-world-eyebrow {
    font-size: 8px;
    letter-spacing: 0.3em;
  }

  .oe-world-title h2 {
    font-size: clamp(23px, 6vw, 36px);
    letter-spacing: 0.1em;
  }

  .oe-cave-title {
    top: 13%;
  }

  .oe-cave-title h2 {
    font-size: clamp(25px, 8vw, 42px);
    letter-spacing: 0.12em;
  }

  .oe-cave-title p {
    font-size: 8px;
    letter-spacing: 0.2em;
  }

  .oe-scroll-cue {
    margin-top: 14px;
  }
}

@media (max-width: 800px) {
  .oe-bio-layer {
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    padding: 12vh 6vw;
  }

  .oe-bio,
  .oe-bio-right {
    width: auto;
    text-align: left;
    border-right: 0;
    border-left: 1px solid rgba(139, 188, 255, 0.55);
    padding: 0.6rem 0 0.6rem 1rem;
    font-size: 0.82rem;
    line-height: 1.6;
    background: linear-gradient(90deg, rgba(4, 8, 14, 0.7), rgba(4, 8, 14, 0));
  }

  .oe-caption {
    left: 8%;
    top: 56%;
    transform: none;
  }

  .oe-cap-name {
    letter-spacing: 0.1em;
    font-size: clamp(1.8rem, 9vw, 3rem);
  }

  .oe-cap-role {
    letter-spacing: 0.18em;
  }
}

/* ------------------------------- THE END ---------------------------------- */
.oe-fade{
  position:absolute;inset:0;z-index:15;pointer-events:none;
  background:radial-gradient(70% 60% at 50% 45%,#f4f9ff,#bcd6ff 60%,#6fa0e8);
}

.oe-end{
  position:absolute;z-index:14;right:6vw;bottom:19%;
  width:min(54vw,760px);
  display:flex;flex-direction:column;align-items:flex-end;text-align:right;
  pointer-events:none;color:#eaf3ff;
}
.oe-end > *{position:relative;z-index:1}

.oe-end-emblem{
  position:absolute!important;z-index:0!important;right:-8%;top:-34%;width:125%;height:auto;
  overflow:visible;fill:rgba(139,188,255,.07);stroke:rgba(190,225,255,.7);stroke-width:2.2;
  stroke-linejoin:round;
  filter:drop-shadow(0 0 8px rgba(139,188,255,.8)) drop-shadow(0 0 28px rgba(90,150,255,.5));
}
.oe-end-emblem path{vector-effect:non-scaling-stroke}

/* huge outlined anime kanji behind the title */
.oe-end-kanji{
  position:absolute!important;z-index:0!important;left:-16%;top:-32%;
  font-size:clamp(8rem,21vw,19rem);line-height:1;font-weight:900;
  color:transparent;-webkit-text-stroke:2px rgba(139,188,255,.45);
  text-shadow:0 0 40px rgba(90,150,255,.35);
}

.oe-end-kana{
  display:block;margin-bottom:.8rem;
  font-size:clamp(.7rem,1vw,1rem);font-weight:700;letter-spacing:.6em;
  color:#8bbcff;text-shadow:0 0 14px rgba(139,188,255,.7);
}

.oe-end-title{
  --split:0px;margin:0;display:flex;gap:.3em;white-space:nowrap;
  font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:.14em;
  font-size:clamp(2.4rem,7vw,7rem);line-height:1;color:#fff;
  text-shadow:
    calc(var(--split) * -1) 0 0 rgba(0,240,255,.85),
    var(--split) 0 0 rgba(255,40,110,.85),
    0 0 34px rgba(139,188,255,.55);
}
.oe-end-title span{display:inline-block;will-change:transform,opacity,filter}
.oe-end-title .oe-end-accent{color:#ffe08a}

.oe-end-wing{display:block;width:min(100%,560px);height:clamp(10px,1.1vw,20px);margin:.7rem 0 0;overflow:visible}
.oe-end-wing path{
  fill:none;stroke:#8bbcff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
  vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 6px rgba(139,188,255,.8));
}

.oe-end-contact{margin-top:1.5rem;max-width:min(100%,540px)}
.oe-end-tag{
  display:flex;align-items:center;justify-content:flex-end;gap:.8em;
  font-size:.68rem;letter-spacing:.34em;color:#8bbcff;font-weight:600;
}
.oe-end-tag i{
  width:8px;height:8px;border-radius:50%;background:#4dffb0;box-shadow:0 0 12px #4dffb0;
  animation:oe-end-pulse 1.4s ease-in-out infinite;
}
@keyframes oe-end-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.oe-end-contact p{
  margin:.8rem 0 0;padding:.9rem 1.2rem .9rem 0;
  font-size:clamp(.85rem,1.05vw,1.05rem);line-height:1.75;color:rgba(222,234,255,.92);
  border-right:1px solid rgba(139,188,255,.55);
  background:linear-gradient(270deg,rgba(4,8,14,.62),rgba(4,8,14,0));
}
.oe-end-links{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.6rem;margin-top:1rem}
.oe-end-links a{
  pointer-events:auto;cursor:pointer;
  padding:.6rem 1.05rem;font-size:.7rem;font-weight:600;letter-spacing:.26em;text-transform:uppercase;
  color:#d7e7fb;text-decoration:none;
  border:1px solid rgba(133,182,239,.45);background:rgba(5,12,23,.72);backdrop-filter:blur(6px);
  transition:background .2s,color .2s,box-shadow .2s,transform .2s;
}
.oe-end-links a:hover,.oe-end-links a:focus-visible{
  background:#8bbcff;color:#03101e;box-shadow:0 0 22px rgba(139,188,255,.6);transform:translateY(-2px);outline:none;
}

@media (max-width:800px){
  .oe-end{left:6vw;right:6vw;width:auto;align-items:flex-start;text-align:left;bottom:17%}
  .oe-end-tag,.oe-end-links{justify-content:flex-start}
  .oe-end-contact p{border-right:0;border-left:1px solid rgba(139,188,255,.55);padding:.7rem 0 .7rem 1rem;
    background:linear-gradient(90deg,rgba(4,8,14,.7),rgba(4,8,14,0))}
  .oe-end-kanji{left:auto;right:-6%}
}

`;

/* -------------------------------------------------------------------------- */
/*  Katana artwork (drawn pointing right, pivot at the pommel end)            */
/* -------------------------------------------------------------------------- */

function KatanaSvg() {
  return (
    <svg
      className="oe-katana-svg"
      viewBox="0 0 600 60"
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="oe-blade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#cfe3ff" />
          <stop offset="1" stopColor="#6f8fc4" />
        </linearGradient>
        <linearGradient id="oe-handle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2230" />
          <stop offset="1" stopColor="#05080d" />
        </linearGradient>
      </defs>

      {/* Handle (tsuka) with diamond wrap */}
      <rect x="0" y="23" width="132" height="14" rx="3" fill="url(#oe-handle)" />
      <path
        d="M10 23 L24 37 M24 23 L38 37 M38 23 L52 37 M52 23 L66 37 M66 23 L80 37 M80 23 L94 37 M94 23 L108 37 M108 23 L122 37
           M24 23 L10 37 M38 23 L24 37 M52 23 L38 37 M66 23 L52 37 M80 23 L66 37 M94 23 L80 37 M108 23 L94 37 M122 23 L108 37"
        stroke="#8bbcff"
        strokeOpacity="0.55"
        strokeWidth="1.2"
        fill="none"
      />
      <rect x="-4" y="21" width="10" height="18" rx="3" fill="#8bbcff" />

      {/* Guard (tsuba) */}
      <ellipse cx="140" cy="30" rx="7" ry="19" fill="#0b1119" stroke="#8bbcff" strokeWidth="1.5" />
      <ellipse cx="140" cy="30" rx="2.5" ry="8" fill="#8bbcff" fillOpacity="0.6" />

      {/* Blade: slight curve, kissaki tip */}
      <path
        d="M150 26.5 Q380 17 572 24 L598 30.5 Q400 38 150 36.5 Z"
        fill="url(#oe-blade)"
      />
      {/* Spine highlight */}
      <path d="M150 26.5 Q380 17 572 24" stroke="#ffffff" strokeWidth="1.4" fill="none" />
      {/* Hamon (temper line) */}
      <path
        d="M165 33 Q200 30.5 235 33 T305 33 T375 32.5 T445 32 T515 31.5 T575 30.5"
        stroke="#ffffff"
        strokeOpacity="0.85"
        strokeWidth="1.1"
        fill="none"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rush lines: the "you are flying" HUD layer                                */
/*                                                                            */
/*  A 2D canvas of thin radial streaks that rush outward from the centre of   */
/*  the frame. Its intensity is the max of the real camera speed (so it       */
/*  follows how fast you scroll) and the scrubbed take-off burst. When both   */
/*  are ~0 it clears itself and stops drawing, so it costs nothing at rest.   */
/* -------------------------------------------------------------------------- */

function RushLines() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect reduced-motion: the 3D scene still streaks, only the HUD is skipped.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let last = performance.now();
    let level = 0;
    let cleared = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const lines = RUSH_LINES.map((l) => ({ ...l }));

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);

      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const target = Math.max(flightSpeed.current * 0.8, launchBoost.current);
      level += (target - level) * (1 - Math.exp(-8 * dt));

      if (level < 0.01) {
        if (!cleared) {
          ctx.clearRect(0, 0, w, h);
          cleared = true;
        }
        return;
      }

      cleared = false;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);

      ctx.lineCap = "round";

      for (const L of lines) {
        // lines accelerate outward; faster when the intensity is higher
        L.r += dt * L.s * (0.2 + level * 1.5);
        if (L.r > 1) {
          L.r -= 1;
          L.a += 2.399963; // new angle on every lap so it never loops visibly
        }

        const e = L.r * L.r;
        const r0 = maxR * (0.2 + e * 0.95); // centre stays clear
        const len = maxR * (0.03 + level * 0.2) * (0.4 + e * 1.6) * L.l;
        const fade = Math.sin(Math.PI * L.r);
        const alpha = Math.min(0.5, level * 0.55 * fade);

        const cos = Math.cos(L.a);
        const sin = Math.sin(L.a);

        ctx.strokeStyle = `rgba(200,226,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.6 + e * 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="oe-rush" aria-hidden="true" />;
}

/* -------------------------------------------------------------------------- */
/*  Opening experience                                                        */
/* -------------------------------------------------------------------------- */

export default function OpeningExperience() {
  const sectionRef = useRef<HTMLElement>(null);

  const [started, setStarted] = useState(false);

  const handleStart = useCallback(() => {
    setStarted(true);
  }, []);

  const handleDone = useCallback(() => {
    window.scrollTo(0, 0);
    ScrollTrigger.refresh();
  }, []);

  const [gameOpen, setGameOpen] = useState(false);
  const closeGame = useCallback(() => setGameOpen(false), []);

  useEffect(() => {
    const open = () => setGameOpen(true);
    window.addEventListener(CAVE_EVENTS.openGame, open);
    return () => window.removeEventListener(CAVE_EVENTS.openGame, open);
  }, []);
  
  /* ------------------------------------------------------------------------ */
  /*  Intro reveal                                                            */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!started) return;

    const section = sectionRef.current;
    if (!section) return;

    const context = gsap.context(() => {
      gsap.to(".oe-bar", {
        scaleY: BAR_SLIM,
        duration: 1.6,
        ease: "power3.out",
        delay: 0.1,
      });

      gsap.fromTo(
        ".opening-copy > *",
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 1.1,
          ease: "power3.out",
          stagger: 0.18,
          delay: 0.3,
        },
      );
    }, section);

    return () => {
      context.revert();
    };
  }, [started]);

  /* ------------------------------------------------------------------------ */
  /*  Scroll-driven cinematic timeline                                        */
  /* ------------------------------------------------------------------------ */

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    if (!section) return;

    const resetShared = () => {
      openingProgress.current = 0;
      revealFlash.current = 0;
      impactPunch.current = 0;
      worldProgress.current = 0;
      povProgress.current = 0;
      flightProgress.current = 0;
      caveProgress.current = 0;
      launchBoost.current = 0;
      landProgress.current = 0;
      armoryProgress.current = 0;
      screenProgress.current = 0;
      endProgress.current = 0;
      roofProgress.current = 0;
    };

    /* ---------------- Autoplay state (scroll lock) ---------------- */

    let playing = false;
    let autoTween: gsap.core.Tween | null = null;
    let lastY = 0;
    let touchY = 0;
    const proxy = { y: 0 };

    const jumpTo = (y: number) =>
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });

    const stopAuto = () => {
      if (autoTween) autoTween.kill();
      autoTween = null;
      playing = false;
    };

    // Downward input is swallowed while the sequence plays itself.
    // Upward input hands control straight back to the user.
    const onWheel = (e: WheelEvent) => {
      if (!playing) return;
      if (e.deltaY < 0) {
        stopAuto();
        return;
      }
      e.preventDefault();
    };

    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!playing) return;
      const y = e.touches[0].clientY;
      const dy = y - touchY; // finger moving down = scrolling up
      touchY = y;
      if (dy > 0) {
        stopAuto();
        return;
      }
      e.preventDefault();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!playing) return;
      const up =
        e.key === "PageUp" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        (e.key === " " && e.shiftKey);
      const down =
        e.key === "PageDown" ||
        e.key === "ArrowDown" ||
        e.key === "End" ||
        (e.key === " " && !e.shiftKey);
      if (up) {
        stopAuto();
        return;
      }
      if (down) e.preventDefault();
    };

    const context = gsap.context(() => {
      resetShared();

      /* ---------------- Initial states ---------------- */

      gsap.set(".opening-copy", { autoAlpha: 1, y: 0 });
      gsap.set(".scroll-cue", { autoAlpha: 1 });
      gsap.set(".opening-statement", { autoAlpha: 0, y: 35 });
      gsap.set(".oe-bio", { autoAlpha: 0, y: 30 });
      gsap.set(".oe-bar", { scaleY: 0 });
      gsap.set(".oe-flash", { autoAlpha: 0 });
      gsap.set(".oe-cutflash", { autoAlpha: 0 });
      gsap.set(".oe-glare", { autoAlpha: 0 });
      gsap.set(".oe-eyeline", { autoAlpha: 0, scaleX: 0 });
      gsap.set(".oe-scar", { autoAlpha: 0, scaleY: 1 });

      // Katana waits off-screen left
      gsap.set(".oe-katana", {
        autoAlpha: 0,
        x: `${KATANA_START + 8}vw`,
        rotation: -2,
        transformOrigin: "0px 0px",
      });

      // Bats + speed lines
      gsap.set(".oe-bat", {
        autoAlpha: 0,
        x: "-20vw",
        y: (i: number) => `${(i % 2 ? -1 : 1) * (2 + (i % 5))}vh`,
      });
      gsap.set(".oe-speed-line", { autoAlpha: 0, x: "-50vw" });

      // Foreground transition swarm
      gsap.set(".oe-transition-bat", {
        autoAlpha: 0,
        scale: 0.06,
        x: 0,
        y: 0,
        rotation: 0,
        transformOrigin: "50% 50%",
      });

      // World title (revealed after the swarm). xPercent keeps it centred
      // on the left: 50% anchor without relying on a CSS transform.
      // scale + blur are animated later for the zoom-through into the dive.
      gsap.set(".oe-world-title", {
        autoAlpha: 0,
        xPercent: -50,
        y: 28,
        scale: 1,
        transformOrigin: "50% 50%",
        filter: "blur(0px)",
      });

      gsap.set(".oe-cave-title", {
        autoAlpha: 0,
        xPercent: -50,
        y: 24,
        filter: "blur(0px)",
      });

      gsap.set(".bc-screen", { autoAlpha: 0 });

      gsap.set(".oe-fade", { autoAlpha: 0 });
      gsap.set(".oe-end", { autoAlpha: 0 });
      gsap.set(".oe-end-emblem", { autoAlpha: 0, scale: 1.5, transformOrigin: "50% 50%" });
      gsap.set(".oe-end-kanji", { autoAlpha: 0, x: 30 });
      gsap.set(".oe-end-kana", { autoAlpha: 0, x: 24 });
      gsap.set(".oe-end-title", { "--split": "18px" });
      gsap.set(".oe-end-title span", {
        autoAlpha: 0,
        scale: 1.7,
        x: 60,
        filter: "blur(12px)",
        transformOrigin: "100% 50%",
      });
      gsap.set(".oe-end-wing", { autoAlpha: 0, clipPath: "inset(-60% 0% -60% 100%)" });
      gsap.set(".oe-end-contact > *", { autoAlpha: 0, y: 22 });

      // Title pieces
      gsap.set(".oe-cap-rule", { scaleX: 0 });
      gsap.set(".oe-kana", { autoAlpha: 0, x: -24 });
      gsap.set(".oe-cap-name", {
        "--split": "16px",
        clipPath: "inset(-40% 100% -40% 0%)",
        x: -40,
        scale: 1.1,
        transformOrigin: "0% 50%",
      });
      gsap.set(".oe-name-edge", { autoAlpha: 0, left: "0%" });
      gsap.set(".oe-emblem", {
        autoAlpha: 0,
        scale: 1.6,
        yPercent: -50,
        transformOrigin: "50% 50%",
      });
      gsap.set(".oe-wing", {
        autoAlpha: 0,
        clipPath: "inset(-60% 100% -60% 0%)",
      });
      gsap.set(".oe-role-in", { yPercent: 120, letterSpacing: "0.9em" });
      gsap.set(".oe-shine", { autoAlpha: 0, xPercent: -140 });

      /* ---------------- Main scroll timeline ---------------- */

      // Scroll position (px) that corresponds to a given timeline time.
      const yAt = (time: number) => {
        const st = tl.scrollTrigger;
        if (!st) return 0;
        return st.start + (time / tl.duration()) * (st.end - st.start);
      };

      // Lock the scroll and let the sequence play itself from face reveal to name reveal.
      const startAuto = () => {
        const from = yAt(AUTO_START);
        const to = yAt(AUTO_END);

        playing = true;
        proxy.y = from;
        jumpTo(from);
        lastY = from;

        autoTween = gsap.to(proxy, {
          y: to,
          duration: (AUTO_END - AUTO_START) * AUTO_PACE,
          ease: "none",
          onUpdate: () => {
            lastY = proxy.y;
            jumpTo(proxy.y);
          },
          onComplete: () => {
            autoTween = null;
            playing = false;
          },
        });
      };

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          // Timeline grew with the longer rooftop flight (+4s), so the scroll
          // distance grew with it (keeps the same ~286px per timeline second).
          end: () => `+=${Math.round(TOTAL_DURATION * PX_PER_SECOND)}`,
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const y = self.scroll();
            const prev = lastY;
            lastY = y;

            if (playing) return;

            // Only when scrolling DOWN across the face-reveal point.
            // Scrolling up (or re-entering from below) never triggers it,
            // so reversing works exactly like the plain scrubbed timeline.
            const gate = yAt(AUTO_START);
            if (self.direction === 1 && prev < gate && y >= gate) {
              startAuto();
            }
          },
        },
      });

      // Welcome copy leaves; scene dressing fades.
      tl.to(".scroll-cue", { autoAlpha: 0, duration: 0.4 }, 0.3)
        .to(
          ".opening-copy",
          { autoAlpha: 0, y: -35, duration: 0.6, ease: "power2.in" },
          1.3,
        )
        .to(".title-scrim", { autoAlpha: 0, duration: 1 }, 1.4)
        .to(
          ".scene-coordinate, .scene-index",
          { autoAlpha: 0, duration: 0.5 },
          2.0,
        );

      // Camera progress.
      tl.to(
        openingProgress,
        { current: 1, duration: PROGRESS_DURATION, ease: "none" },
        0,
      );

      // Six statements during the camera approach and orbit.
      gsap.utils.toArray<HTMLElement>(".opening-statement").forEach((el, i) => {
        const start = 2.0 + i * 1.5;

        tl.to(
          el,
          { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out" },
          start,
        ).to(
          el,
          { autoAlpha: 0, y: -20, duration: 0.3, ease: "power2.in" },
          start + 1.2,
        );
      });

      // Cinema bars open to full screen for the bio beat.
      tl.fromTo(
        ".oe-bar",
        { scaleY: BAR_SLIM },
        {
          scaleY: 0,
          duration: 0.9,
          ease: "power2.inOut",
          immediateRender: false,
        },
        BARS_OPEN_AT,
      );

      // Biography panels flank the hero.
      tl.to(
        ".oe-bio-left",
        { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out" },
        BIO_LEFT_IN,
      )
        .to(
          ".oe-bio-right",
          { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out" },
          BIO_RIGHT_IN,
        )
        .to(
          ".oe-bio",
          { autoAlpha: 0, y: -20, duration: 0.5, ease: "power2.in" },
          BIO_OUT,
        );

      /* ---------------- EYE REVEAL: bars close, eyes appear ---------------- */

      tl.fromTo(
        ".oe-bar",
        { scaleY: 0 },
        {
          scaleY: BAR_EYES,
          duration: 2.4,
          ease: "power3.inOut",
          immediateRender: false,
        },
        THUNDER - 2.6,
      );

      // Hairline of light sweeps across the eye band as it narrows.
      tl.to(
        ".oe-eyeline",
        { autoAlpha: 0.9, scaleX: 1, duration: 1.0, ease: "power3.out" },
        THUNDER - 1.8,
      ).to(
        ".oe-eyeline",
        { autoAlpha: 0, duration: 0.5, ease: "power2.in" },
        THUNDER - 0.7,
      );

      // Quiet build-up: rule draws in, katakana slides in.
      tl.to(
        ".oe-cap-rule",
        { scaleX: 1, duration: 1.3, ease: "power3.out" },
        THUNDER - 1.5,
      ).to(
        ".oe-kana",
        { autoAlpha: 0.9, x: 0, duration: 0.9, ease: "power3.out" },
        THUNDER - 1.1,
      );

      // Faint electric stutter right before the pass.
      tl.to(".oe-flash", { autoAlpha: 0.08, duration: 0.07, ease: "sine.in" }, THUNDER - 0.5)
        .to(".oe-flash", { autoAlpha: 0, duration: 0.3, ease: "sine.out" }, THUNDER - 0.43)
        .to(".oe-flash", { autoAlpha: 0.14, duration: 0.06, ease: "sine.in" }, THUNDER - 0.15)
        .to(".oe-flash", { autoAlpha: 0, duration: 0.2, ease: "sine.out" }, THUNDER - 0.09);

      tl.to(revealFlash, { current: 0.2, duration: 0.07, ease: "sine.in" }, THUNDER - 0.5)
        .to(revealFlash, { current: 0, duration: 0.3, ease: "sine.out" }, THUNDER - 0.43)
        .to(revealFlash, { current: 0.35, duration: 0.06, ease: "sine.in" }, THUNDER - 0.15)
        .to(revealFlash, { current: 0, duration: 0.2, ease: "sine.out" }, THUNDER - 0.09);

      /* ---------------- KATANA: anticipation ---------------- */

      // The blade materialises at the left edge and pulls back a touch.
      tl.fromTo(
        ".oe-katana",
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.3, ease: "power2.out", immediateRender: false },
        THUNDER - 0.7,
      ).fromTo(
        ".oe-katana",
        { x: `${KATANA_START + 8}vw` },
        {
          x: `${KATANA_START}vw`,
          duration: 0.7,
          ease: "power2.out",
          immediateRender: false,
        },
        THUNDER - 0.7,
      );

      /* ---------------- KATANA: the pass (left -> right) ---------------- */

      tl.fromTo(
        ".oe-katana",
        { x: `${KATANA_START}vw`, rotation: -2 },
        {
          x: `${KATANA_END}vw`,
          rotation: 1.5,
          duration: KATANA_PASS,
          ease: "power1.inOut",
          immediateRender: false,
        },
        THUNDER,
      ).to(
        ".oe-katana",
        { autoAlpha: 0, duration: 0.15, ease: "power1.in" },
        THUNDER + KATANA_PASS - 0.1,
      );

      // Speed lines streak across with the blade.
      tl.to(
        ".oe-speed-line",
        { x: "115vw", duration: 0.7, ease: "power3.out", stagger: 0.016 },
        THUNDER + 0.15,
      )
        .to(
          ".oe-speed-line",
          { autoAlpha: 1, duration: 0.08, stagger: 0.016 },
          THUNDER + 0.15,
        )
        .to(
          ".oe-speed-line",
          { autoAlpha: 0, duration: 0.35, ease: "power2.in", stagger: 0.012 },
          THUNDER + 0.55,
        );

      // Bat swarm bursts through the letterbox behind the blade.
      tl.to(
        ".oe-bat",
        {
          x: "120vw",
          y: (i: number) => `${(i % 2 ? 1 : -1) * (3 + (i % 4))}vh`,
          duration: 1.3,
          ease: "power2.inOut",
          stagger: { each: 0.045 },
        },
        THUNDER + 0.15,
      ).to(
        ".oe-bat",
        { autoAlpha: 0.95, duration: 0.1, stagger: { each: 0.045 } },
        THUNDER + 0.15,
      );

      /* ---------------- IMPACT: blade crosses the face ---------------- */

      const HIT = THUNDER + HIT_DELAY;

      // Lightning / camera punch.
      tl.to(revealFlash, { current: 1, duration: 0.1, ease: "power2.in" }, HIT)
        .to(revealFlash, { current: 0.25, duration: 0.4, ease: "expo.out" }, HIT + 0.1)
        .to(revealFlash, { current: 0.6, duration: 0.08, ease: "sine.in" }, HIT + 0.5)
        .to(revealFlash, { current: 0, duration: 1.3, ease: "power3.out" }, HIT + 0.58);

      tl.to(".oe-flash", { autoAlpha: 0.38, duration: 0.08, ease: "power2.in" }, HIT)
        .to(".oe-flash", { autoAlpha: 0.06, duration: 0.45, ease: "expo.out" }, HIT + 0.08)
        .to(".oe-flash", { autoAlpha: 0, duration: 1.2, ease: "power3.out" }, HIT + 0.55);

      tl.to(impactPunch, { current: 1, duration: 0.6, ease: "power2.out" }, HIT).to(
        impactPunch,
        { current: 0, duration: 2.0, ease: "sine.inOut" },
        HIT + 0.7,
      );

      // White flash + the scar flares along the blade path, then thins out.
      tl.to(".oe-cutflash", { autoAlpha: 1, duration: 0.05, ease: "power4.out" }, HIT)
        .to(".oe-cutflash", { autoAlpha: 0, duration: 0.6, ease: "power3.out" }, HIT + 0.05);

      tl.to(".oe-scar", { autoAlpha: 1, duration: 0.02 }, HIT)
        .to(".oe-scar", { scaleY: 7, duration: 0.07, ease: "power4.out" }, HIT)
        .to(
          ".oe-scar",
          { scaleY: 0.2, autoAlpha: 0, duration: 0.7, ease: "power3.out" },
          HIT + 0.08,
        );

      // The bars jolt apart for a beat, as if the frame itself was cut.
      tl.to(".oe-bar-top", { y: -12, duration: 0.05, ease: "power4.out" }, HIT)
        .to(".oe-bar-top", { y: 0, duration: 0.45, ease: "power3.out" }, HIT + 0.05)
        .to(".oe-bar-bottom", { y: 12, duration: 0.05, ease: "power4.out" }, HIT)
        .to(".oe-bar-bottom", { y: 0, duration: 0.45, ease: "power3.out" }, HIT + 0.05);

      // Glow behind the title.
      tl.to(".oe-glare", { autoAlpha: 0.8, duration: 0.1, ease: "power4.out" }, HIT + 0.02).to(
        ".oe-glare",
        { autoAlpha: 0.14, duration: 1.6, ease: "power3.out" },
        HIT + 0.12,
      );

      /* ---------------- BATMAN FUSION: emblem slam ---------------- */

      tl.to(
        ".oe-emblem",
        { autoAlpha: 1, scale: 1, duration: 0.5, ease: "expo.out" },
        HIT + 0.02,
      ).to(
        ".oe-emblem",
        { autoAlpha: 0.26, duration: 1.1, ease: "power2.out" },
        HIT + 0.45,
      );

      /* ---------------- TITLE: wipes in behind the blade ---------------- */

      const WIPE = 0.75;

      tl.to(
        ".oe-cap-name",
        {
          clipPath: "inset(-40% -8% -40% 0%)",
          x: 0,
          scale: 1,
          duration: WIPE,
          ease: "power2.out",
        },
        HIT + 0.05,
      );

      // Bright leading edge rides the wipe, then disappears.
      tl.to(
        ".oe-name-edge",
        { autoAlpha: 1, duration: 0.05 },
        HIT + 0.05,
      )
        .to(
          ".oe-name-edge",
          { left: "108%", duration: WIPE, ease: "power2.out" },
          HIT + 0.05,
        )
        .to(
          ".oe-name-edge",
          { autoAlpha: 0, duration: 0.12 },
          HIT + 0.05 + WIPE - 0.05,
        );

      // RGB-split glitch settles as the name lands.
      tl.to(
        ".oe-cap-name",
        { "--split": "0px", duration: 0.9, ease: "power3.out" },
        HIT + 0.15,
      );

      // Small caption shake.
      tl.to(".oe-cap-inner", { x: -7, duration: 0.04 }, HIT + 0.3)
        .to(".oe-cap-inner", { x: 5, duration: 0.04 }, HIT + 0.34)
        .to(".oe-cap-inner", { x: -2, duration: 0.04 }, HIT + 0.38)
        .to(".oe-cap-inner", { x: 0, duration: 0.06 }, HIT + 0.42);

      // Bat-wing hem appears only in the final scene, wiping in left to right.
      tl.to(".oe-wing", { autoAlpha: 1, duration: 0.05 }, HIT + 0.45).to(
        ".oe-wing",
        {
          clipPath: "inset(-60% -5% -60% 0%)",
          duration: 0.9,
          ease: "power3.out",
        },
        HIT + 0.45,
      );
      // Role line rises from its mask while the tracking tightens.
      tl.to(
        ".oe-role-in",
        { yPercent: 0, letterSpacing: "0.3em", duration: 0.9, ease: "power4.out" },
        HIT + 0.65,
      );

      // Shine sweep across the name + a tiny glitch re-hit.
      tl.to(".oe-shine", { autoAlpha: 0.9, duration: 0.05 }, HIT + 1.2)
        .to(".oe-shine", { xPercent: 620, duration: 0.9, ease: "power2.inOut" }, HIT + 1.2)
        .to(".oe-shine", { autoAlpha: 0, duration: 0.1 }, HIT + 2.0)
        .to(".oe-cap-name", { "--split": "6px", duration: 0.05, ease: "none" }, HIT + 1.45)
        .to(".oe-cap-name", { "--split": "0px", duration: 0.25, ease: "power2.out" }, HIT + 1.5);

      // Hold the final composition.
      tl.to({}, { duration: 2.4 }, HIT + 2.2);

      /* ---------------- BAT SWARM + CITY REVEAL ---------------- */

      // The title retreats as the swarm begins.
      tl.to(
        ".oe-caption",
        {
          autoAlpha: 0,
          scale: 0.94,
          duration: 0.65,
          ease: "power2.inOut",
        },
        JOURNEY_START,
      );

      // Pull the camera away from the close-up and behind the hero.
      tl.to(
        worldProgress,
        {
          current: 1,
          duration: JOURNEY_DURATION,
          ease: "power2.inOut",
        },
        JOURNEY_START,
      );

      // Foreground swarm: each bat rushes toward the lens, grows, and sweeps past.
      gsap.utils.toArray<SVGElement>(".oe-transition-bat").forEach((el, i) => {
        const bat = TRANSITION_BATS[i];
        if (!bat) return;

        const t = JOURNEY_START + 0.15 + bat.delay;
        const flightTime = 1.9;
        const endScale = 3 + (i % 4) * 1.5;

        // Quick fade in at the start of the flight.
        tl.to(
          el,
          { autoAlpha: 1, duration: 0.2, ease: "power1.out" },
          t,
        );

        // Fly toward / past the camera: scale up, drift outward, rotate.
        tl.to(
          el,
          {
            scale: endScale,
            x: `${bat.x}vw`,
            y: `${bat.y}vh`,
            rotation: bat.rotation,
            duration: flightTime,
            ease: "power2.in",
          },
          t,
        );

        // Vanish as it passes the lens.
        tl.to(
          el,
          { autoAlpha: 0, duration: 0.35, ease: "power1.in" },
          t + flightTime - 0.35,
        );
      });

      // Restore the cinematic letterbox bars for the final camera shot.
      tl.to(
        [".oe-bar-top", ".oe-bar-bottom"],
        {
          scaleY: 0.15,
          duration: 0.8,
          ease: "power2.inOut",
        },
        JOURNEY_START + 2.3,
      );

      // World title (headline + scroll indicator) fades up once the swarm clears.
      tl.to(
        ".oe-world-title",
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: "power3.out",
        },
        JOURNEY_START + 2.35,
      );

      /* ---------------- TRANSITION: EXPLORE THE WORLD -> HERO POV ---------------- */

      // 1) The title is not just hidden: the camera ZOOMS THROUGH it. It rushes
      //    toward the lens, grows, blurs and dissolves while the dive begins.
      tl.to(
        ".oe-world-title",
        {
          autoAlpha: 0,
          y: -40,
          scale: 1.9,
          filter: "blur(10px)",
          duration: 1.0,
          ease: "power3.in",
        },
        POV_START,
      );

      // 2) Camera travels forward from behind the hero into his head; the lens
      //    opens up to a first-person field of view. Lands exactly at FLIGHT_START.
      tl.to(
        povProgress,
        {
          current: 1,
          duration: POV_DURATION,
          ease: "power2.inOut",
        },
        POV_START,
      );

      // 3) Letterbox opens up a little so the first-person view feels wider.
      tl.to(
        [".oe-bar-top", ".oe-bar-bottom"],
        {
          scaleY: 0.06,
          duration: POV_DURATION * 0.8,
          ease: "power2.inOut",
        },
        POV_START + POV_DURATION * 0.2,
      );

      // 4) Take-off burst builds while we are sucked into the head: FOV widens,
      //    the lens fringes, wind particles + rush lines ramp up, the camera
      //    starts to buffet. Ends exactly when the flight begins...
      tl.to(
        launchBoost,
        {
          current: 1,
          duration: POV_DURATION * 0.75,
          ease: "power2.in",
        },
        POV_START + POV_DURATION * 0.25,
      );

      // ...then settles as the flight finds its cruising speed (from there on
      // the feel is driven by the real camera speed, i.e. how fast you scroll).
      tl.to(
        launchBoost,
        {
          current: 0,
          duration: 2.6,
          ease: "power3.out",
        },
        FLIGHT_START,
      );

      // 5) Brief lightning-white blink at the moment the camera passes into the
      //    head (the hero model is hidden right here), so the swap never pops.
      tl.to(
        revealFlash,
        { current: 0.45, duration: 0.16, ease: "power2.in" },
        POV_START + 1.7,
      ).to(
        revealFlash,
        { current: 0, duration: 0.7, ease: "power3.out" },
        POV_START + 1.86,
      );

      // A soft cold wash over the 2D layer on top of it, so the blink reads
      // as a "whoomph" and not just a lighting change.
      tl.to(
        ".oe-flash",
        { autoAlpha: 0.2, duration: 0.12, ease: "power2.in" },
        POV_START + 1.72,
      ).to(
        ".oe-flash",
        { autoAlpha: 0, duration: 0.9, ease: "power3.out" },
        POV_START + 1.84,
      );

      /* ---------------- FIRST-PERSON FLIGHT ---------------- */

      // Fly out from the hero's eyes, skimming over each project rooftop.
      tl.to(
        flightProgress,
        {
          current: 1,
          duration: FLIGHT_DURATION,
          ease: "none",
        },
        FLIGHT_START,
      );

      /* ---------------- FLIGHT -> BATCAVE DESCENT ---------------- */
      // The cave camera curve starts at the flight curve's final point, so the
      // camera continues forward without snapping when this tween takes over.
      tl.to(
        caveProgress,
        {
          current: CAVE_END,
          duration: CAVE_DURATION,
          ease: "power2.inOut",
        },
        CAVE_START,
      );

      // Bring the cave title in only after the tunnel opens into the chamber.
      tl.to(
        ".oe-cave-title",
        {
          autoAlpha: 1,
          y: 0,
          duration: 1.1,
          ease: "power3.out",
        },
        CAVE_START + CAVE_DURATION - 1.2,
      );
      tl.fromTo(
        ".oe-cave-title h2",
        { letterSpacing: "0.38em", filter: "blur(8px)" },
        {
          letterSpacing: "0.22em",
          filter: "blur(0px)",
          duration: 1.2,
          ease: "power3.out",
        },
        CAVE_START + CAVE_DURATION - 1.2,
      );

            /* ---------------- HERO LANDING -> ARSENAL -> GIANT SCREEN ---------------- */

      // The cave title leaves just before the drop; letterbox bars open fully.
      tl.to(
        ".oe-cave-title",
        { autoAlpha: 0, y: -20, duration: 0.6, ease: "power2.in" },
        LAND_START - 0.3,
      );
      tl.to(
        [".oe-bar-top", ".oe-bar-bottom"],
        { scaleY: 0, duration: 1.2, ease: "power2.inOut" },
        LAND_START,
      );

      // 1) fall out of the sky, impact, settle at eye level
      tl.to(landProgress, { current: 1, duration: LAND_DURATION, ease: "none" }, LAND_START);

      // 2) eye-level pan across the four hanging racks
      tl.to(armoryProgress, { current: 1, duration: ARMORY_DURATION, ease: "none" }, ARMORY_START);

      // 3) rise + push in to the giant screen, then fade in the interactive overlay
      tl.to(
        screenProgress,
        { current: 1, duration: SCREEN_DURATION, ease: "power2.inOut" },
        SCREEN_START,
      );
      tl.to(
        ".bc-screen",
        { autoAlpha: 1, duration: 0.8, ease: "power2.out" },
        SCREEN_START + SCREEN_DURATION - 1.1,
      );

      // Hold on the screen so the last scroll "lands" on it.
      tl.to({}, { duration: SCREEN_HOLD }, SCREEN_START + SCREEN_DURATION);

            /* ---------------- THE END ---------------- */

      // 1) overlay leaves the screen; camera pulls back and rises through the hatch
      tl.to(".bc-screen", { autoAlpha: 0, duration: 0.7, ease: "power2.in" }, END_START);
      tl.fromTo(
        endProgress,
        { current: 0 },
        { current: 1, duration: END_CAVE, ease: "none", immediateRender: false },
        END_CAVE_AT,
      );

      // 2) white-out as the camera exits into the night sky
      tl.fromTo(
        ".oe-fade",
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.8, ease: "power2.in", immediateRender: false },
        END_CAVE_AT + END_CAVE - 0.8,
      );

      // 3) rooftop wide shot (the director swaps the camera while the screen is white)
      tl.fromTo(
        roofProgress,
        { current: 0 },
        { current: 1, duration: END_ROOF, ease: "none", immediateRender: false },
        END_ROOF_AT,
      );
      tl.to(".oe-fade", { autoAlpha: 0, duration: 1.6, ease: "power2.out" }, END_ROOF_AT + 0.3);

      // 4) black bars close in for the final frame
      const TITLE_T0 = END_ROOF_AT + 3.0;
      tl.to(
        [".oe-bar-top", ".oe-bar-bottom"],
        { scaleY: 0.15, duration: 1.4, ease: "power2.inOut" },
        TITLE_T0 - 0.8,
      );

      // 5) THE END: cinematic emblem slam + anime wipe / RGB-split
      tl.to(".oe-end", { autoAlpha: 1, duration: 0.01 }, TITLE_T0 - 0.05);

      tl.to(".oe-end-emblem", { autoAlpha: 1, scale: 1, duration: 0.5, ease: "expo.out" }, TITLE_T0)
        .to(".oe-end-emblem", { autoAlpha: 0.24, duration: 1.1, ease: "power2.out" }, TITLE_T0 + 0.45)
        .to(".oe-end-kanji", { autoAlpha: 0.9, x: 0, duration: 1.0, ease: "power3.out" }, TITLE_T0 + 0.1)
        .to(".oe-end-kana", { autoAlpha: 0.95, x: 0, duration: 0.8, ease: "power3.out" }, TITLE_T0 + 0.1);

      tl.to(
        ".oe-end-title span",
        {
          autoAlpha: 1,
          scale: 1,
          x: 0,
          filter: "blur(0px)",
          duration: 0.55,
          ease: "expo.out",
          stagger: 0.18,
        },
        TITLE_T0 + 0.25,
      ).to(".oe-end-title", { "--split": "0px", duration: 0.9, ease: "power3.out" }, TITLE_T0 + 0.35);

      // impact flash + scar as the word lands
      tl.to(".oe-cutflash", { autoAlpha: 1, duration: 0.05, ease: "power4.out" }, TITLE_T0 + 0.3)
        .to(".oe-cutflash", { autoAlpha: 0, duration: 0.6, ease: "power3.out" }, TITLE_T0 + 0.35)
        .to(".oe-scar", { autoAlpha: 1, duration: 0.02 }, TITLE_T0 + 0.3)
        .to(".oe-scar", { scaleY: 7, duration: 0.07, ease: "power4.out" }, TITLE_T0 + 0.3)
        .to(".oe-scar", { scaleY: 0.2, autoAlpha: 0, duration: 0.7, ease: "power3.out" }, TITLE_T0 + 0.38);

      // glitch re-hit
      tl.to(".oe-end-title", { "--split": "7px", duration: 0.05, ease: "none" }, TITLE_T0 + 1.5)
        .to(".oe-end-title", { "--split": "0px", duration: 0.25, ease: "power2.out" }, TITLE_T0 + 1.55);

      // bat-wing hem wipes in, then the contact block
      tl.to(".oe-end-wing", { autoAlpha: 1, duration: 0.05 }, TITLE_T0 + 0.9).to(
        ".oe-end-wing",
        { clipPath: "inset(-60% -5% -60% -5%)", duration: 0.9, ease: "power3.out" },
        TITLE_T0 + 0.9,
      );

      tl.to(
        ".oe-end-contact > *",
        { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.14 },
        TITLE_T0 + 1.5,
      );

      // keep the timeline length == TOTAL_DURATION (autoplay maths depends on it)
      tl.to({}, { duration: END_HOLD }, END_ROOF_AT + END_ROOF);


      lastY = window.scrollY;
    }, section);

    // Input guards must be non-passive so preventDefault works.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);

      stopAuto();
      context.revert();
      resetShared();
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /*  Render                                                                  */
  /* ------------------------------------------------------------------------ */

  return (
    <section
      ref={sectionRef}
      className="opening-scene"
      aria-label="Introduction"
    >
      <style>{CSS}</style>

      <BatLoader onStart={handleStart} onDone={handleDone} />
      
      <MusicToggle start={started} />
      
      <MobileScrollButton />
      
      <RooftopScene />

      {/* Flight rush lines (radial speed streaks, speed-driven) */}
      <RushLines />

      <div className="title-scrim" aria-hidden="true" />

      {/* Opening welcome shot */}
      <div className="opening-copy">
        <p className="eyebrow">FROM SIGNAL TO SYSTEM</p>

        <h1>
          WELCOME TO
          <br />
          <span>MY WORLD.</span>
        </h1>

        <p className="opening-description">
          I follow ideas from raw data
          <br />
          to intelligence in the real world.
        </p>
      </div>

      {/* Scene coordinates */}
      <div className="scene-coordinate">
        <span>11°00&apos; N</span>
        <span>76°58&apos; E</span>
      </div>

      {/* Scroll cue */}
      <div className="scroll-cue">
        <span>SCROLL TO ENTER</span>

        <div className="scroll-line">
          <div className="scroll-line-progress" />
        </div>
      </div>

      {/* Scene index */}
      <div className="scene-index">
        <span>01</span>
        <span className="scene-index-divider" />
        <span>THE BEGINNING</span>
      </div>

      {/* Statement sequence */}
      <div className="opening-statements">
        {statements.map((statement) => (
          <div
            key={statement.number}
            className={`opening-statement statement-${statement.side}`}
          >
            <span className="statement-number">{statement.number}</span>

            <p>{statement.text}</p>
          </div>
        ))}
      </div>

      {/* Full-body beat: biography panels flank the hero */}
      <div className="oe-bio-layer">
        <div className="oe-bio oe-bio-left">
          <span className="oe-bio-tag">THE PROFILE</span>

          <p>
            B.Tech — Artificial Intelligence &amp; Data Science student
            at Sri Eshwar College of Engineering. I focus on converting
            strong programming fundamentals into AI projects that prove
            the full path — from raw data to a deployed, working product.
          </p>
        </div>

        <div className="oe-bio oe-bio-right">
          <span className="oe-bio-tag">THE WORK</span>

          <p>
            I&apos;ve shipped a local-first RAG study assistant, a legal
            chatbot for the judiciary ecosystem, a vision-powered calorie
            tracker, and more. Right now I&apos;m sharpening PyTorch, NLP,
            and MLOps while working at the enterprise scale.
          </p>
        </div>
      </div>

      {/* Cinema bars */}
      <div className="oe-bar oe-bar-top" aria-hidden="true" />
      <div className="oe-bar oe-bar-bottom" aria-hidden="true" />

      {/* Eye-band light, glow and the scar left by the blade */}
      <div className="oe-eyeline" aria-hidden="true" />
      <div className="oe-glare" aria-hidden="true" />
      <div className="oe-scar" aria-hidden="true" />

      {/* Katana pass + speed lines + bat swarm (clipped to the frame) */}
      <div className="oe-katana-lane" aria-hidden="true">
        {SPEED_LINES.map((l, i) => (
          <i
            key={i}
            className="oe-speed-line"
            style={{
              top: `${l.top}%`,
              width: `${l.width}vw`,
              height: `${l.height}px`,
              opacity: l.opacity,
            }}
          />
        ))}

        {BATS.map((b, i) => (
          <div
            key={i}
            className="oe-bat"
            style={{ top: `${b.top}%`, width: `${b.width}vw` }}
          >
            <svg
              className="oe-bat-svg"
              viewBox="0 0 100 50"
              style={{ animationDelay: `${b.delay}s` }}
            >
              <path d={BAT_PATH} />
            </svg>
          </div>
        ))}

        <div className="oe-katana">
          <div className="oe-katana-glow" />
          <div className="oe-katana-streak" />
          <KatanaSvg />
        </div>
      </div>

      {/* Final reveal: anime + Batman title */}
      <div
        className="oe-caption"
        aria-label="Tarun J, AI End-to-End Developer"
      >
        <div className="oe-cap-inner">
          {/* Bat emblem behind everything */}
          <svg
            className="oe-emblem"
            viewBox="-360 -100 720 205"
            aria-hidden="true"
          >
            <path d={EMBLEM_PATH} />
          </svg>

          <span className="oe-kana" aria-hidden="true">
            タルン
          </span>

          <span className="oe-cap-rule" aria-hidden="true" />

          <div className="oe-name-wrap" aria-hidden="true">
            <p className="oe-cap-name">
              TARUN <span className="oe-ch-accent">J</span>
            </p>

            <span className="oe-name-edge" />
            <span className="oe-shine" />
          </div>

          {/* Scalloped bat-wing hem */}
          <svg
            className="oe-wing"
            viewBox="0 0 400 24"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={WING_PATH} pathLength={1} />
          </svg>

          <div className="oe-role-mask" aria-hidden="true">
            <p className="oe-cap-role oe-role-in">AI End-to-End Developer</p>
          </div>
        </div>
      </div>

      {/* Foreground swarm: bats rush toward and past the lens */}
      <div className="oe-transition-swarm" aria-hidden="true">
        {TRANSITION_BATS.map((bat, i) => (
          <svg
            key={i}
            className="oe-transition-bat"
            viewBox="0 0 100 50"
            style={{
              left: `${bat.left}%`,
              top: `${bat.top}%`,
              width: `${bat.width}vw`,
            }}
          >
            <path d={BAT_PATH} />
          </svg>
        ))}
      </div>

      {/* World title + scroll-to-fly indicator (revealed after the swarm) */}
      <div className="oe-world-title" aria-label="Explore the world">
        <span className="oe-world-eyebrow">THE WORLD IS YOURS</span>

        <h2>EXPLORE THE WORLD</h2>

        <div className="oe-scroll-cue">
          <span className="oe-scroll-line" />
          <span className="oe-scroll-label">SCROLL TO FLY</span>
          <span className="oe-scroll-arrow">↓</span>
        </div>
      </div>

      {/* Final beat of the flight: the underground base is revealed. */}
      <div className="oe-cave-title" aria-label="The Batcave">
        <span className="oe-world-eyebrow">ACCESS GRANTED / UNDERGROUND SYSTEMS</span>
        <h2>THE BATCAVE</h2>
        <p>WHERE THE WORK BEGINS</p>
      </div>

      {/* Interactive achievements / internships overlay, glued onto the 3D giant screen */}
      <CaveScreenUI />

      {/* Bat-Snake arcade (opened by clicking the small monitor) */}
      {gameOpen && <SnakeGame onExit={closeGame} />}

            {/* THE END: title + contact (rooftop finale) */}
      <div className="oe-end" aria-label="The End. Contact.">
        <svg className="oe-end-emblem" viewBox="-360 -100 720 205" aria-hidden="true">
          <path d={EMBLEM_PATH} />
        </svg>

        <span className="oe-end-kanji" aria-hidden="true">終</span>

        <span className="oe-end-kana" aria-hidden="true">終劇 // ジ・エンド</span>

        <h2 className="oe-end-title">
          <span>THE</span>
          <span className="oe-end-accent">END</span>
        </h2>

        <svg className="oe-end-wing" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
          <path d={WING_PATH} />
        </svg>

        <div className="oe-end-contact">
          <div className="oe-end-tag">
            <i /> SIGNAL OPEN
          </div>
          <p>
            Open to AI, software, data, and product-building opportunities. If you
            have a case worth solving together, my signal is always on.
          </p>
          <div className="oe-end-links">
            <a href="mailto:tarunjj2006@gmail.com">Email</a>
            <a href="https://github.com/TJ-programmer" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://www.linkedin.com/in/tarun-j-66a374247/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a href="https://www.hackerrank.com/profile/tarunjj2006" target="_blank" rel="noopener noreferrer">HackerRank</a>
          </div>
        </div>
      </div>

      {/* white-out used for the exit through the hatch */}
      <div className="oe-fade" aria-hidden="true" />

      {/* Cold lightning wash + cut flash */}
      <div className="oe-cutflash" aria-hidden="true" />
      <div className="oe-flash" aria-hidden="true" />
    </section>
  );
}