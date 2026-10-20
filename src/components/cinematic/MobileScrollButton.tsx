"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CSS = /* css */ `
.mobile-scroll-wrap{
  position:fixed;
  z-index:60;
  left:50%;
  bottom:8vh;
  transform:translateX(-50%);
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:8px;
  pointer-events:none;
  opacity:0.8;
  transition:opacity .35s ease,transform .35s ease;
}
.mobile-scroll-wrap.autohide{
  opacity:0;
  transform:translateX(-50%) translateY(24px);
  pointer-events:none;
}
.mobile-scroll-btn{
  position:relative;
  pointer-events:auto;
  width:54px;height:54px;
  border:2px solid rgba(139,188,255,.5);
  border-radius:50%;
  background:rgba(5,12,23,.75);
  backdrop-filter:blur(10px);
  color:#8bbcff;
  font-size:9px;
  font-weight:700;
  letter-spacing:0.3em;
  text-transform:uppercase;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  cursor:pointer;
  transition:all .2s ease;
  box-shadow:0 0 28px rgba(139,188,255,.15);
  user-select:none;
  -webkit-tap-highlight-color:transparent;
}
.mobile-scroll-btn.holding{
  border-color:#8bbcff;
  color:#fff;
  background:rgba(139,188,255,.14);
  box-shadow:0 0 40px rgba(139,188,255,.4);
  transform:scale(1.08);
}
.mobile-scroll-arrow{
  font-size:24px;
  line-height:1;
  margin-bottom:5px;
  animation:ms-bounce 2s ease-in-out infinite;
}
.mobile-scroll-btn.holding .mobile-scroll-arrow{animation:none;}
.mobile-scroll-label{
  font-family:'DM Mono',monospace;
  font-size:8px;
  letter-spacing:0.35em;
  opacity:0.85;
}
@keyframes ms-bounce{
  0%,100%{transform:translateY(0)}
  50%{transform:translateY(7px)}
}
@media (min-width:701px){
  .mobile-scroll-wrap{display:none !important;}
}
`;

export default function MobileScrollButton() {
  const rafRef = useRef<number | null>(null);
  const running = useRef(false);
  const [holding, setHolding] = useState(false);
  const [hidden, setHidden] = useState(false);

  const stop = useCallback(() => {
    running.current = false;
    setHolding(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setHolding(true);
    setHidden(false);
    const step = () => {
      if (!running.current) return;
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atBottom) { stop(); return; }
      window.scrollBy(0, 12);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [stop]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      setHidden(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setHidden(true), 4000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    timer = setTimeout(() => setHidden(true), 4000);
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className={`mobile-scroll-wrap${hidden ? " autohide" : ""}`}>
      <button
        className={`mobile-scroll-btn${holding ? " holding" : ""}`}
        aria-label="Hold to scroll down"
        onPointerDown={(e) => { e.preventDefault(); start(); }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onTouchStart={(e) => { e.preventDefault(); start(); }}
        onTouchEnd={stop}
        onTouchCancel={stop}
      >
        <span className="mobile-scroll-arrow">▼</span>
        <span className="mobile-scroll-label">HOLD TO SCROLL</span>
      </button>
      </div>
    </>
  );
}
