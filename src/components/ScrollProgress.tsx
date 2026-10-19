"use client";

import { useEffect, useRef } from "react";

const CSS = /* css */ `
.sp-root{position:fixed;right:20px;top:50%;z-index:1500;transform:translateY(-50%);
  display:flex;flex-direction:column;align-items:center;gap:14px;pointer-events:none;
  font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.2em;color:#8bbcff;
  opacity:0;transition:opacity .6s ease}
.sp-root.sp-show{opacity:1}
.sp-label{writing-mode:vertical-rl;letter-spacing:.42em;font-size:9px;color:rgba(139,188,255,.55)}
.sp-pct{font-variant-numeric:tabular-nums;font-size:11px;color:#eaf3ff;text-shadow:0 0 12px rgba(139,188,255,.8)}
.sp-track{position:relative;width:2px;height:38vh;min-height:140px;border-radius:2px;
  background:linear-gradient(180deg,rgba(139,188,255,.08),rgba(139,188,255,.22),rgba(139,188,255,.08))}
.sp-track::before{content:"";position:absolute;inset:0;
  background:repeating-linear-gradient(180deg,transparent 0 19px,rgba(139,188,255,.35) 19px 20px);
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 50%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 50%,transparent);transform:scaleX(8)}
.sp-fill{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:2px;transform-origin:top;transform:scaleY(0);
  background:linear-gradient(180deg,rgba(139,188,255,.15),#8bbcff 70%,#ffffff);
  box-shadow:0 0 14px rgba(139,188,255,.9),0 0 34px rgba(90,150,255,.6)}
.sp-head{position:absolute;left:50%;top:0;width:20px;height:11px;margin:-5px 0 0 -10px;will-change:transform;
  fill:#05080d;stroke:#bfe4ff;stroke-width:6;overflow:visible;
  filter:drop-shadow(0 0 6px rgba(139,188,255,.95)) drop-shadow(0 0 16px rgba(90,150,255,.7))}

@media (max-width:600px){.sp-root{right:8px}.sp-label{display:none}.sp-track{height:30vh}}
`;

const BAT_PATH =
  "M50 12 L55 4 L58 14 Q70 8 85 6 Q92 14 100 22 Q88 20 82 26 Q76 20 68 28 Q62 24 58 34 L50 46 L42 34 Q38 24 32 28 Q24 20 18 26 Q12 20 0 22 Q8 14 15 6 Q30 8 42 14 L45 4 Z";

export default function ScrollProgress() {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const head = useRef<SVGSVGElement>(null);
  const pct = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let target = 0;
    let shown = 0;

    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      measure();
      shown += (target - shown) * 0.12;
      if (Math.abs(target - shown) < 0.0004) shown = target;

      const h = track.current?.clientHeight ?? 0;
      if (fill.current) fill.current.style.transform = `scaleY(${shown})`;
      if (head.current) {
        head.current.style.transform = `translateY(${shown * h}px)`;
      }
      if (pct.current) {
        pct.current.textContent = String(Math.round(shown * 100)).padStart(2, "0");
      }
      root.current?.classList.toggle("sp-show", window.scrollY > 4 || shown > 0.002);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={root} className="sp-root" aria-hidden="true">
      <style>{CSS}</style>
      <span className="sp-label">SCROLL</span>
      <div ref={track} className="sp-track">
        <div ref={fill} className="sp-fill" />
        <svg ref={head} className="sp-head" viewBox="0 0 100 50">
          <path d={BAT_PATH} />
        </svg>
      </div>
      <span className="sp-pct">
        <span ref={pct}>00</span>%
      </span>
    </div>
  );
}