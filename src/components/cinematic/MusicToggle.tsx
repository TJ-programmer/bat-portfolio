"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SRC = "/audio/theme.mp3";
const VOLUME = 0.5;
const KEY = "bat-music";

const CSS = /* css */ `
.mt-btn{all:unset;box-sizing:border-box;position:fixed;left:22px;bottom:22px;z-index:2000;cursor:pointer;
  display:flex;align-items:center;gap:0;height:46px;min-width:46px;padding:0 14px;border-radius:999px;
  color:#cfe2ff;background:rgba(5,12,23,.72);backdrop-filter:blur(10px);
  border:1px solid rgba(139,188,255,.4);box-shadow:0 0 0 rgba(139,188,255,0),0 8px 28px rgba(0,0,0,.45);
  font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.26em;
  animation:mt-in .8s ease both;transition:box-shadow .25s,border-color .25s,background .25s}
.mt-btn:hover,.mt-btn:focus-visible{border-color:#bfe4ff;box-shadow:0 0 26px rgba(139,188,255,.5),0 8px 28px rgba(0,0,0,.45)}
.mt-btn.is-on{border-color:rgba(139,188,255,.75);box-shadow:0 0 22px rgba(139,188,255,.3),0 8px 28px rgba(0,0,0,.45)}
@keyframes mt-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

.mt-bars{position:relative;display:flex;align-items:flex-end;gap:3px;width:18px;height:16px;flex:none}
.mt-bars i{display:block;flex:1;height:100%;background:#8bbcff;border-radius:2px;transform-origin:bottom;
  transform:scaleY(.18);box-shadow:0 0 8px rgba(139,188,255,.7);transition:transform .3s,opacity .3s}
.is-on .mt-bars i{animation:mt-eq 1s ease-in-out infinite}
.is-on .mt-bars i:nth-child(2){animation-duration:.74s;animation-delay:-.2s}
.is-on .mt-bars i:nth-child(3){animation-duration:1.15s;animation-delay:-.45s}
.is-on .mt-bars i:nth-child(4){animation-duration:.88s;animation-delay:-.1s}
@keyframes mt-eq{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(1)}}

/* slash across the bars when muted */
.mt-btn.is-off .mt-bars i{opacity:.4}
.mt-btn.is-off .mt-bars::after{content:"";position:absolute;left:-3px;right:-3px;top:50%;height:2px;
  background:#ff6b7d;box-shadow:0 0 8px rgba(255,107,125,.8);transform:rotate(-38deg)}

.mt-label{max-width:0;overflow:hidden;white-space:nowrap;opacity:0;margin-left:0;
  transition:max-width .35s ease,opacity .25s,margin-left .35s}
.mt-btn:hover .mt-label,.mt-btn:focus-visible .mt-label,.mt-btn.is-wait .mt-label{max-width:130px;opacity:1;margin-left:12px}
.mt-btn.is-wait{animation:mt-in .8s ease both,mt-pulse 1.6s ease-in-out .8s infinite}
@keyframes mt-pulse{0%,100%{box-shadow:0 0 0 rgba(139,188,255,0),0 8px 28px rgba(0,0,0,.45)}
  50%{box-shadow:0 0 28px rgba(139,188,255,.6),0 8px 28px rgba(0,0,0,.45)}}

@media (max-width:600px){.mt-btn{left:14px;bottom:14px;height:42px}}
@media (prefers-reduced-motion:reduce){.is-on .mt-bars i,.mt-btn.is-wait{animation:none}}
`;

export default function MusicToggle({ start }: { start: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(true); // the visitor wants music
  const [playing, setPlaying] = useState(false); // it is actually audible

  const audio = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<number | null>(null);
  const resume = useRef(false);

  const ramp = useCallback((to: number, done?: () => void) => {
    const a = audio.current;
    if (!a) return;
    if (fade.current) window.clearInterval(fade.current);
    fade.current = window.setInterval(() => {
      const diff = to - a.volume;
      if (Math.abs(diff) < 0.02) {
        a.volume = to;
        if (fade.current) window.clearInterval(fade.current);
        fade.current = null;
        done?.();
        return;
      }
      a.volume = Math.min(1, Math.max(0, a.volume + Math.sign(diff) * 0.02));
    }, 40);
  }, []);

  const play = useCallback(async () => {
    const a = audio.current;
    if (!a) return false;
    try {
      if (a.paused) a.volume = 0;
      await a.play();
      setPlaying(true);
      ramp(VOLUME);
      return true;
    } catch {
      return false; // blocked until the first gesture
    }
  }, [ramp]);

  const pause = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    setPlaying(false);
    ramp(0, () => a.pause());
  }, [ramp]);

  // create the audio element once
  useEffect(() => {
    const a = new Audio(SRC);
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    audio.current = a;

    try {
      if (localStorage.getItem(KEY) === "off") setOn(false);
    } catch {
      /* ignore */
    }
    setMounted(true);

    return () => {
      if (fade.current) window.clearInterval(fade.current);
      a.pause();
      audio.current = null;
    };
  }, []);

  // start after the loader; if the browser blocks it, start on the first gesture
  useEffect(() => {
    if (!mounted || !start || !on || playing) return;

    let cancelled = false;
    const events = ["pointerdown", "keydown", "touchend", "click"] as const;

    const unlock = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-music-toggle]")) return; // the button handles itself
      if (e.type === "keydown" && (e as KeyboardEvent).key === "Escape") return;
      play().then((ok) => {
        if (ok) events.forEach((n) => window.removeEventListener(n, unlock, true));
      });
    };

    play().then((ok) => {
      if (ok || cancelled) return;
      events.forEach((n) => window.addEventListener(n, unlock, true));
    });

    return () => {
      cancelled = true;
      events.forEach((n) => window.removeEventListener(n, unlock, true));
    };
  }, [mounted, start, on, playing, play]);

  // pause while the tab is hidden
  useEffect(() => {
    const onVis = () => {
      const a = audio.current;
      if (!a) return;
      if (document.hidden) {
        resume.current = !a.paused;
        a.pause();
      } else if (resume.current) {
        resume.current = false;
        a.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const toggle = () => {
    if (playing) {
      setOn(false);
      try {
        localStorage.setItem(KEY, "off");
      } catch {
        /* ignore */
      }
      pause();
    } else {
      setOn(true);
      try {
        localStorage.setItem(KEY, "on");
      } catch {
        /* ignore */
      }
      play();
    }
  };

  if (!mounted || !start) return null;

  const cls = playing ? "is-on" : on ? "is-wait" : "is-off";
  const label = playing ? "SOUND ON" : on ? "TAP TO PLAY" : "SOUND OFF";

  return createPortal(
    <>
      <style>{CSS}</style>
      <button
        type="button"
        data-music-toggle
        className={`mt-btn ${cls}`}
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? "Turn music off" : "Turn music on"}
      >
        <span className="mt-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="mt-label">{label}</span>
      </button>
    </>,
    document.body,
  );
}