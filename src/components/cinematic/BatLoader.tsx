"use client";

import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";

declare global {
  interface Window {
    __rooftopReady?: boolean;
  }
}

const MIN_SHOW_MS = 2400; // never flash the loader away
const MAX_WAIT_MS = 20000; // safety net so nobody gets stuck

const CSS = /* css */ `
.bl-root{position:fixed;inset:0;z-index:1000;background:#03060b;display:flex;flex-direction:column;
  align-items:center;justify-content:center;color:#cfe2ff;overflow:hidden;
  transition:opacity .9s ease, filter .9s ease}
.bl-root::before{content:"";position:absolute;inset:0;
  background:radial-gradient(60% 45% at 50% 62%,rgba(60,110,190,.22),transparent 70%),
             radial-gradient(90% 60% at 50% 0%,rgba(20,35,60,.9),transparent 75%)}
.bl-rain{position:absolute;inset:-20% 0 0 0;opacity:.35;
  background-image:repeating-linear-gradient(105deg,rgba(150,190,255,.0) 0 22px,rgba(150,190,255,.28) 22px 23px,rgba(150,190,255,0) 23px 46px);
  background-size:100% 100%;animation:bl-rain .5s linear infinite}
@keyframes bl-rain{to{background-position:-46px 120px}}
.bl-out{opacity:0;filter:blur(6px)}

.bl-stage{position:relative;width:min(560px,86vw)}
.bl-track{position:relative;height:120px}
.bl-bike{position:absolute;bottom:6px;left:0;width:150px;transform:translateX(-12%);will-change:left;
  filter:drop-shadow(0 0 14px rgba(120,170,255,.35))}
.bl-bob{animation:bl-bob .38s ease-in-out infinite}
@keyframes bl-bob{50%{transform:translateY(-2px)}}
.bl-wheel{transform-box:fill-box;transform-origin:center;animation:bl-spin .45s linear infinite}
@keyframes bl-spin{to{transform:rotate(360deg)}}
.bl-cape{transform-box:fill-box;transform-origin:left center;animation:bl-cape .3s ease-in-out infinite alternate}
@keyframes bl-cape{from{transform:skewY(-4deg) scaleX(1)}to{transform:skewY(5deg) scaleX(1.12)}}
.bl-beam{animation:bl-beam 1.2s ease-in-out infinite alternate}
@keyframes bl-beam{from{opacity:.35}to{opacity:.8}}
.bl-lines line{stroke:#8bbcff;stroke-linecap:round;animation:bl-line .5s linear infinite}
.bl-lines line:nth-child(2){animation-delay:-.17s}
.bl-lines line:nth-child(3){animation-delay:-.33s}
@keyframes bl-line{from{transform:translateX(18px);opacity:0}30%{opacity:.9}to{transform:translateX(-34px);opacity:0}}

.bl-road{position:relative;height:2px;background:linear-gradient(90deg,rgba(139,188,255,0),rgba(139,188,255,.5),rgba(139,188,255,0))}
.bl-fill{position:absolute;left:0;top:-1px;height:4px;width:0;border-radius:2px;
  background:linear-gradient(90deg,rgba(139,188,255,.1),#8bbcff);box-shadow:0 0 14px rgba(139,188,255,.8)}
.bl-meta{margin-top:1.1rem;display:flex;justify-content:space-between;align-items:baseline;
  font-size:.7rem;letter-spacing:.34em;text-transform:uppercase;color:#8bbcff;font-weight:600}
.bl-pct{font-variant-numeric:tabular-nums;font-size:1.05rem;letter-spacing:.12em;color:#eaf3ff}
.bl-hint{margin-top:.6rem;font-size:.62rem;letter-spacing:.3em;color:rgba(207,226,255,.45);text-transform:uppercase}

/* exit: the bike floors it off screen */
.bl-go .bl-bike{transition:left .9s cubic-bezier(.6,0,1,.6)!important;left:115%!important}
.bl-go .bl-wheel{animation-duration:.12s}

@media (prefers-reduced-motion:reduce){
  .bl-rain,.bl-bob,.bl-cape,.bl-lines line,.bl-beam{animation:none}
}
`;

const MESSAGES = [
  "Waking the city",
  "Tuning the skyline",
  "Charging the signal",
  "Suiting up",
  "Almost there",
];

export default function BatLoader({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const { progress } = useProgress();
  const [sceneReady, setSceneReady] = useState(false);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"loading" | "go" | "out" | "gone">("loading");
  const t0 = useRef(0);
  const target = useRef(0);
  const shownRef = useRef(0);

  // lock scrolling while loading
  useEffect(() => {
    t0.current = performance.now();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  // scene signals when its first frames have rendered
  useEffect(() => {
    if (window.__rooftopReady) setSceneReady(true);
    const on = () => setSceneReady(true);
    window.addEventListener("rooftop-ready", on);
    const bail = setTimeout(() => setSceneReady(true), MAX_WAIT_MS);
    return () => {
      window.removeEventListener("rooftop-ready", on);
      clearTimeout(bail);
    };
  }, []);

  // real progress: assets fill to 90%, the last 10% is "scene rendered"
  target.current = sceneReady ? 100 : Math.min(progress * 0.9, 90);

  // smooth display value + min-time gate
  useEffect(() => {
    if (phase !== "loading") return;
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - t0.current;
      // fake gentle creep so it never looks frozen, capped by real progress
      const creep = Math.min(elapsed / MIN_SHOW_MS, 1) * 100;
      const cap = Math.min(target.current, creep);
      shownRef.current += (cap - shownRef.current) * 0.08;
      if (cap - shownRef.current < 0.1) shownRef.current = cap;
      setShown(shownRef.current);
      if (sceneReady && shownRef.current >= 99.5) {
        setPhase("go");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, sceneReady]);

  // exit choreography
  useEffect(() => {
    if (phase === "go") {
      onStart();
      const a = setTimeout(() => setPhase("out"), 550);
      return () => clearTimeout(a);
    }
    if (phase === "out") {
      const b = setTimeout(() => {
        setPhase("gone");
        document.documentElement.style.overflow = "";
        onDone();
      }, 900);
      return () => clearTimeout(b);
    }
  }, [phase, onStart, onDone]);

  if (phase === "gone") return null;

  const pct = Math.round(shown);
  const msg = MESSAGES[Math.min(Math.floor(shown / 21), MESSAGES.length - 1)];

  return (
    <div className={`bl-root ${phase === "out" ? "bl-out" : ""} ${phase !== "loading" ? "bl-go" : ""}`} role="status" aria-label="Loading">
      <style>{CSS}</style>
      <div className="bl-rain" aria-hidden="true" />

      <div className="bl-stage">
        <div className="bl-track">
          <div className="bl-bike" style={{ left: phase === "loading" ? `${shown * 0.82}%` : undefined }}>
            <svg viewBox="0 0 220 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              {/* headlight beam */}
              <path className="bl-beam" d="M196 66 L260 40 L260 96 Z" fill="url(#bl-beam)" />
              {/* speed lines */}
              <g className="bl-lines" strokeWidth="2">
                <line x1="40" y1="52" x2="62" y2="52" />
                <line x1="24" y1="68" x2="52" y2="68" />
                <line x1="44" y1="84" x2="64" y2="84" />
              </g>

              <g className="bl-bob">
                {/* cape */}
                <g className="bl-cape">
                  <path d="M96 40 C70 34 44 48 22 44 C40 56 52 62 74 62 C84 62 92 56 98 52 Z" fill="#05080e" stroke="#8bbcff" strokeOpacity=".55" strokeWidth="1.2" />
                  <path d="M22 44 l6 7 l5 -6 l6 8 l6 -5 l7 7" stroke="#8bbcff" strokeOpacity=".35" strokeWidth="1" />
                </g>

                {/* bike body */}
                <path d="M48 92 L70 70 L128 66 L168 72 L190 84 L168 90 L122 86 L80 90 Z" fill="#0b121c" stroke="#8bbcff" strokeOpacity=".75" strokeWidth="1.4" strokeLinejoin="round" />
                {/* batwing fairing */}
                <path d="M150 70 L186 66 L176 80 L166 76 L158 82 Z" fill="#12202f" stroke="#8bbcff" strokeOpacity=".8" strokeWidth="1.2" />
                {/* gold belt-line accent */}
                <path d="M84 78 L146 76" stroke="#d9a53a" strokeWidth="2" strokeLinecap="round" />
                <circle cx="198" cy="72" r="3.2" fill="#dff0ff" />

                {/* front fork */}
                <path d="M172 74 L184 98" stroke="#8bbcff" strokeOpacity=".8" strokeWidth="3" strokeLinecap="round" />

                {/* rider: torso */}
                <path d="M92 66 C94 50 104 40 118 38 L126 46 C118 52 114 60 112 68 Z" fill="#161f2c" stroke="#8bbcff" strokeOpacity=".7" strokeWidth="1.2" />
                {/* arm to handlebar */}
                <path d="M120 44 L150 56 L166 62" stroke="#0a0f16" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M120 44 L150 56 L166 62" stroke="#8bbcff" strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" />
                {/* leg */}
                <path d="M104 68 L128 78 L120 94" stroke="#0a0f16" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                {/* head + ears */}
                <path d="M118 38 C114 28 118 20 128 20 C136 20 140 28 138 36 L130 42 Z" fill="#05080e" stroke="#8bbcff" strokeOpacity=".8" strokeWidth="1.2" />
                <path d="M122 24 L120 11 L128 21 Z M133 22 L138 10 L139 24 Z" fill="#05080e" stroke="#8bbcff" strokeOpacity=".8" strokeWidth="1" />
                {/* eyes */}
                <path d="M128 31 l5 -1 l1.5 2.4 l-6 .6 Z" fill="#eaf6ff" />
              </g>

              {/* wheels */}
              {[48, 168].map((cx) => (
                <g key={cx} className="bl-wheel">
                  <circle cx={cx} cy="94" r="20" fill="#05080e" stroke="#8bbcff" strokeOpacity=".9" strokeWidth="2.4" />
                  <circle cx={cx} cy="94" r="12" stroke="#8bbcff" strokeOpacity=".35" strokeWidth="1" />
                  <path d={`M${cx} 76 V112 M${cx - 18} 94 H${cx + 18} M${cx - 12.7} 81.3 L${cx + 12.7} 106.7 M${cx + 12.7} 81.3 L${cx - 12.7} 106.7`} stroke="#8bbcff" strokeOpacity=".5" strokeWidth="1.2" />
                  <circle cx={cx} cy="94" r="3" fill="#d9a53a" />
                </g>
              ))}

              <defs>
                <linearGradient id="bl-beam" x1="196" y1="66" x2="260" y2="66" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#cfe6ff" stopOpacity=".55" />
                  <stop offset="1" stopColor="#cfe6ff" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        <div className="bl-road">
          <div className="bl-fill" style={{ width: `${shown}%` }} />
        </div>

        <div className="bl-meta">
          <span>{msg}</span>
          <span className="bl-pct">{String(pct).padStart(2, "0")}%</span>
        </div>
        <div className="bl-hint">Rendering Gotham · please wait</div>
      </div>
    </div>
  );
}