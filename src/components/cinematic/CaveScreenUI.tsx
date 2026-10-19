
"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACHIEVEMENTS,
  INTERNSHIPS,
  SCREEN_UI,
  caveUI,
} from "@/components/cinematic/caveState";

/* The CaveEnvironment camera director writes this element's transform every
   frame so it sits exactly on top of the 3D giant screen. Opacity / pointer
   events are driven by the GSAP timeline (autoAlpha on .bc-screen). */

// Paste this over the `const CSS = ...` block in CaveScreenUI.tsx
// (it still needs SCREEN_UI imported from caveState, as before)

const CSS = /* css */ `
.bc-screen{
  position:absolute;left:0;top:0;
  width:${SCREEN_UI.w}px;height:${SCREEN_UI.h}px;
  transform-origin:0 0;transform:scale(0);
  z-index:8;box-sizing:border-box;overflow:hidden;
  padding:28px 36px 20px;
  display:flex;flex-direction:column;gap:16px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#cfe8ff;user-select:none;
  background:radial-gradient(120% 90% at 50% 0%,#07213c 0%,#020a14 70%),#020912;
  border:3px solid rgba(124,200,255,.6);
  box-shadow:inset 0 0 140px rgba(40,110,200,.28);
}
.bc-screen::before{
  content:"";position:absolute;inset:0;z-index:20;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(124,200,255,.055) 0 2px,transparent 2px 5px);
}
.bc-screen::after{
  content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(70,150,230,.09) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(70,150,230,.09) 1px,transparent 1px);
  background-size:64px 64px;
}
.bc-screen > *{position:relative;z-index:1}

.bc-head{flex:none;display:flex;justify-content:space-between;align-items:flex-end;
  padding-bottom:12px;border-bottom:2px solid rgba(124,200,255,.5)}
.bc-title{font-size:36px;font-weight:700;letter-spacing:.14em;color:#7cc8ff;
  text-shadow:0 0 22px rgba(124,200,255,.6)}
.bc-sub{margin-top:8px;font-size:18px;letter-spacing:.2em;color:rgba(124,200,255,.62)}
.bc-live{display:flex;align-items:center;gap:12px;font-size:20px;letter-spacing:.28em;color:#7cc8ff}
.bc-dot{width:14px;height:14px;border-radius:50%;background:#4dffb0;
  box-shadow:0 0 14px #4dffb0;animation:bc-pulse 1.4s ease-in-out infinite}
@keyframes bc-pulse{0%,100%{opacity:.35}50%{opacity:1}}

/* body is locked to the space between header and footer */
.bc-body{flex:1;min-height:0;display:grid;
  grid-template-columns:620px minmax(0,1fr);
  grid-template-rows:minmax(0,1fr);
  gap:24px}
.bc-col{min-height:0;min-width:0;overflow:hidden;display:flex;flex-direction:column;gap:12px;
  padding:16px 18px;background:rgba(10,40,70,.32);border:2px solid rgba(124,200,255,.5)}
.bc-label{flex:none;display:flex;justify-content:space-between;align-items:center;gap:12px;
  font-size:21px;font-weight:700;letter-spacing:.2em;color:#7cc8ff;
  padding-bottom:10px;border-bottom:2px solid rgba(124,200,255,.35)}
.bc-label small{font-size:16px;font-weight:500;color:rgba(124,200,255,.6);letter-spacing:.18em;white-space:nowrap}

.bc-list{display:flex;flex-direction:column;gap:10px;position:relative;
  flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;
  scrollbar-width:thin;scrollbar-color:rgba(124,200,255,.5) transparent}
.bc-ach{all:unset;box-sizing:border-box;cursor:pointer;display:block;
  padding:14px 18px 14px 26px;position:relative;
  background:rgba(124,200,255,.06);border-left:4px solid rgba(124,200,255,.35);
  transition:background .2s,border-color .2s,transform .2s}
.bc-ach:hover{background:rgba(124,200,255,.14);transform:translateX(6px)}
.bc-ach.on{background:rgba(124,200,255,.18);border-left-color:#bfe4ff;
  box-shadow:0 0 28px rgba(80,150,255,.25)}
.bc-ach-row{display:flex;align-items:center;gap:16px}
.bc-year{font-size:20px;font-weight:700;padding:3px 12px;color:#02101e;background:#7cc8ff}
.bc-ach-title{font-size:29px;font-weight:700;color:#eaf6ff;letter-spacing:.04em;flex:1;min-width:0;overflow-wrap:anywhere}
.bc-chev{font-size:22px;color:#7cc8ff;transition:transform .2s}
.bc-ach.on .bc-chev{transform:rotate(90deg)}
.bc-tagline{margin-top:8px;font-size:15px;letter-spacing:.26em;color:#8bbbe9}
.bc-ach-text{margin-top:8px;font-size:20px;line-height:1.45;color:rgba(222,236,252,.88);
  overflow-wrap:anywhere;animation:bc-in .3s ease both}
@keyframes bc-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.bc-tabs{flex:none;display:flex;gap:12px}
.bc-tab{all:unset;box-sizing:border-box;cursor:pointer;flex:1;min-width:0;padding:10px 14px;
  background:rgba(124,200,255,.06);border:2px solid rgba(124,200,255,.35);
  transition:background .2s,border-color .2s}
.bc-tab:hover{background:rgba(124,200,255,.15)}
.bc-tab.on{background:rgba(124,200,255,.22);border-color:#bfe4ff;box-shadow:0 0 24px rgba(80,150,255,.25)}
.bc-tab b{display:block;font-size:23px;color:#eaf6ff;letter-spacing:.06em}
.bc-tab span{display:block;margin-top:3px;font-size:15px;color:#8bbbe9;letter-spacing:.12em}

/* internship detail: wraps, tighter type, scrolls only as a last resort */
.bc-detail{animation:bc-in .3s ease both;display:flex;flex-direction:column;gap:8px;
  flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;
  scrollbar-width:thin;scrollbar-color:rgba(124,200,255,.5) transparent}
.bc-role{font-size:27px;font-weight:700;color:#eaf6ff;letter-spacing:.03em;overflow-wrap:anywhere}
.bc-meta{font-size:16px;letter-spacing:.14em;color:#8bbbe9}
.bc-sec{font-size:15px;letter-spacing:.24em;color:#7cc8ff;font-weight:700;margin-top:2px}
.bc-detail ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.bc-detail li{position:relative;padding-left:20px;font-size:17px;line-height:1.3;
  color:rgba(222,236,252,.9);overflow-wrap:anywhere;word-break:break-word}
.bc-detail li::before{content:"▸";position:absolute;left:0;color:#7cc8ff}
.bc-chips{display:flex;flex-wrap:wrap;gap:7px}
.bc-chip{font-size:14px;padding:4px 10px;color:#d7e7fb;white-space:nowrap;
  border:1px solid rgba(133,182,239,.5);background:rgba(124,200,255,.08);transition:background .2s}
.bc-chip:hover{background:rgba(124,200,255,.25)}

/* footer always keeps its own space, never overlapped */
.bc-foot{flex:none;display:flex;justify-content:space-between;gap:20px;font-size:16px;letter-spacing:.18em;
  color:rgba(124,200,255,.65);padding-top:2px}
.bc-foot b{color:#ffd24d;font-weight:700}
`;
export default function CaveScreenUI() {
  const ref = useRef<HTMLDivElement>(null);
  const [ach, setAch] = useState(3);
  const [op, setOp] = useState(0);

  useEffect(() => {
    caveUI.screenEl = ref.current;
    return () => {
      caveUI.screenEl = null;
    };
  }, []);

  const internship = INTERNSHIPS[op];

  return (
    <div ref={ref} className="bc-screen" aria-label="Career archive">
      <style>{CSS}</style>

      <div className="bc-head">
        <div>
          <div className="bc-title">BATCOMPUTER // CAREER ARCHIVE</div>
          <div className="bc-sub">
            SESSION: TARUN J · CLEARANCE: LEVEL 9 · ACHIEVEMENTS &amp; INTERNSHIPS
          </div>
        </div>
        <div className="bc-live">
          <span className="bc-dot" /> LIVE FEED
        </div>
      </div>

      <div className="bc-body">
        {/* ---------------- Achievements ---------------- */}
        <section className="bc-col">
          <div className="bc-label">
            ◤ ACHIEVEMENT LOG <small>{String(ACHIEVEMENTS.length).padStart(2, "0")} ENTRIES</small>
          </div>
          <div className="bc-list">
            {ACHIEVEMENTS.map((a, i) => (
              <button
                key={a.title}
                type="button"
                className={`bc-ach${i === ach ? " on" : ""}`}
                onClick={() => setAch(i)}
              >
                <div className="bc-ach-row">
                  <span className="bc-year">{a.year}</span>
                  <span className="bc-ach-title">{a.title}</span>
                  <span className="bc-chev">▶</span>
                </div>
                {i === ach && (
                  <>
                    <div className="bc-tagline">
                      LOG {String(i + 1).padStart(2, "0")} / {a.tag}
                    </div>
                    <div className="bc-ach-text">{a.text}</div>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ---------------- Internships ---------------- */}
        <section className="bc-col">
          <div className="bc-label">
            ◤ FIELD OPERATIONS // INTERNSHIPS <small>SELECT A MISSION</small>
          </div>

          <div className="bc-tabs">
            {INTERNSHIPS.map((n, i) => (
              <button
                key={n.company}
                type="button"
                className={`bc-tab${i === op ? " on" : ""}`}
                onClick={() => setOp(i)}
              >
                <b>{n.company}</b>
                <span>{n.period}</span>
              </button>
            ))}
          </div>

          <div className="bc-detail" key={internship.company}>
            <div className="bc-role">{internship.role}</div>
            <div className="bc-meta">
              {internship.company.toUpperCase()} · {internship.period.toUpperCase()}
            </div>

            <div className="bc-sec">KEY CONTRIBUTIONS</div>
            <ul>
              {internship.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>

            <div className="bc-sec">TECH STACK</div>
            <div className="bc-chips">
              {internship.stack.map((s) => (
                <span key={s} className="bc-chip">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="bc-foot">
        <span>▸ CLICK AN ENTRY TO EXPAND · SWITCH MISSIONS WITH THE TABS</span>
        <span>
          <b>ARCADE TERMINAL ►</b> CLICK THE SMALL MONITOR TO PLAY
        </span>
      </div>
    </div>
  );
}