"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* BAT-SNAKE: Batman is the snake, the Joker is the target. */

const COLS = 22;
const ROWS = 15;

type Pt = { x: number; y: number };
type Status = "ready" | "playing" | "over";

const DIRS: Record<string, Pt> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  W: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  A: { x: -1, y: 0 },
  D: { x: 1, y: 0 },
};

const LAUGHS = ["HA HA HA!", "HAHAHA!", "WHY SO SERIOUS?", "GOTCHA!"];

// Small bat silhouette (half, mirrored when drawn)
const BAT_HALF: [number, number][] = [
  [0, -0.35], [0.15, -0.7], [0.28, -0.4], [0.9, -0.5], [1, -0.1],
  [0.7, 0], [0.55, 0.3], [0.35, 0.1], [0.15, 0.45], [0, 0.7],
];

function drawBat(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  BAT_HALF.forEach(([x, y], i) =>
    i === 0 ? ctx.moveTo(cx + x * s, cy + y * s) : ctx.lineTo(cx + x * s, cy + y * s),
  );
  [...BAT_HALF].reverse().forEach(([x, y]) => ctx.lineTo(cx - x * s, cy + y * s));
  ctx.closePath();
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: number, dir: Pt) {
  const ang = Math.atan2(dir.y, dir.x) + Math.PI / 2;
  const r = c * 0.46;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);

  ctx.shadowColor = "rgba(130,185,255,0.95)";
  ctx.shadowBlur = c * 0.55;
  ctx.fillStyle = "#05080d";

  // ears (point in the direction of travel)
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.8, -r * 0.3);
    ctx.lineTo(s * r * 0.6, -r * 1.4);
    ctx.lineTo(s * r * 0.1, -r * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  // cowl
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.95, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // jaw
  ctx.fillStyle = "#2c394d";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.5, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = c * 0.3;
  ctx.fillStyle = "#ffffff";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.15, r * 0.02);
    ctx.lineTo(s * r * 0.62, -r * 0.22);
    ctx.lineTo(s * r * 0.55, r * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawJoker(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: number, t: number) {
  const r = c * 0.44;
  ctx.save();
  ctx.translate(cx, cy + Math.sin(t * 7) * c * 0.04);

  // collar
  ctx.shadowColor = "rgba(160,70,255,0.95)";
  ctx.shadowBlur = c * 0.7;
  ctx.fillStyle = "#5b21b6";
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, r * 1.05);
  ctx.lineTo(0, r * 0.45);
  ctx.lineTo(r * 0.95, r * 1.05);
  ctx.closePath();
  ctx.fill();

  // face
  ctx.fillStyle = "#f3f0e4";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // hair
  ctx.fillStyle = "#22c55e";
  const hair: [number, number][] = [
    [-0.9, -0.1], [-0.95, -0.8], [-0.5, -0.55], [-0.3, -1.15], [0, -0.65],
    [0.3, -1.15], [0.5, -0.55], [0.95, -0.8], [0.9, -0.1], [0.55, -0.4],
    [0, -0.5], [-0.55, -0.4],
  ];
  ctx.beginPath();
  hair.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * r, y * r) : ctx.lineTo(x * r, y * r)));
  ctx.closePath();
  ctx.fill();

  // eyes
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#2b1b52";
    ctx.beginPath();
    ctx.ellipse(s * r * 0.33, -r * 0.1, r * 0.22, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s * r * 0.33, -r * 0.1, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // grin
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = r * 0.17;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, r * 0.22);
  ctx.quadraticCurveTo(0, r * 0.95, r * 0.6, r * 0.22);
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = r * 0.05;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.2, r * (0.42 - Math.abs(i) * 0.06));
    ctx.lineTo(i * r * 0.2, r * (0.58 - Math.abs(i) * 0.06));
    ctx.stroke();
  }
  ctx.restore();
}

const CSS = /* css */ `
.bs-root{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  background:rgba(2,5,10,.9);backdrop-filter:blur(6px);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfe8ff;
  touch-action:none;user-select:none}
.bs-panel{display:flex;flex-direction:column;gap:12px;padding:18px 20px 16px;
  background:linear-gradient(180deg,#07121f,#03080f);
  border:2px solid rgba(124,200,255,.6);box-shadow:0 0 80px rgba(40,110,200,.35);max-width:98vw}
.bs-top{display:flex;justify-content:space-between;align-items:center;gap:16px}
.bs-title{font-size:clamp(14px,2vw,22px);font-weight:700;letter-spacing:.22em;color:#7cc8ff;
  text-shadow:0 0 18px rgba(124,200,255,.6)}
.bs-hud{display:flex;gap:clamp(12px,2.4vw,30px);font-size:clamp(11px,1.4vw,16px);letter-spacing:.18em}
.bs-hud b{color:#fff;font-size:1.25em;margin-left:6px}
.bs-btn{all:unset;cursor:pointer;box-sizing:border-box;padding:9px 18px;font-size:14px;font-weight:700;
  letter-spacing:.2em;color:#cfe8ff;border:2px solid rgba(124,200,255,.65);background:rgba(124,200,255,.08);
  transition:background .15s,transform .15s}
.bs-btn:hover{background:rgba(124,200,255,.28);transform:translateY(-1px)}
.bs-btn.hot{background:#7cc8ff;color:#02101e}
.bs-btn.hot:hover{background:#bfe4ff}
.bs-wrap{position:relative;line-height:0;border:2px solid rgba(124,200,255,.4)}
.bs-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;text-align:center;line-height:1.4;background:rgba(2,5,10,.74);padding:16px}
.bs-big{font-size:clamp(22px,4vw,46px);font-weight:800;letter-spacing:.16em;color:#fff;
  text-shadow:0 0 28px rgba(150,80,255,.85)}
.bs-sm{font-size:clamp(11px,1.3vw,15px);letter-spacing:.18em;color:rgba(190,220,250,.8)}
.bs-row{display:flex;gap:14px;margin-top:6px}
.bs-pad{display:none;grid-template-columns:repeat(3,56px);grid-template-rows:repeat(2,56px);gap:8px;justify-content:center}
.bs-pad button{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;
  border:2px solid rgba(124,200,255,.55);background:rgba(124,200,255,.1);color:#cfe8ff}
.bs-pad button:active{background:rgba(124,200,255,.35)}
.bs-hint{font-size:11px;letter-spacing:.2em;text-align:center;color:rgba(124,200,255,.6)}
@media (pointer:coarse),(max-width:800px){.bs-pad{display:grid}}
`;

export default function SnakeGame({ onExit }: { onExit: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [level, setLevel] = useState(1);
  const [dims, setDims] = useState({ w: 660, h: 450 });

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellRef = useRef(30);
  const dprRef = useRef(1);
  const statusRef = useRef<Status>("ready");
  const bestRef = useRef(0);
  const touchRef = useRef<Pt | null>(null);

  const G = useRef({
    snake: [] as Pt[],
    dir: { x: 1, y: 0 } as Pt,
    queue: [] as Pt[],
    joker: { x: 15, y: 7 } as Pt,
    score: 0,
    eaten: 0,
    acc: 0,
    t: 0,
    shake: 0,
    flash: 0,
    parts: [] as { x: number; y: number; vx: number; vy: number; life: number; color: string }[],
    floats: [] as { x: number; y: number; text: string; life: number; color: string }[],
  });

  const setStat = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const spawnJoker = useCallback(() => {
    const g = G.current;
    for (let i = 0; i < 400; i++) {
      const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!g.snake.some((s) => s.x === p.x && s.y === p.y)) {
        g.joker = p;
        return;
      }
    }
  }, []);

  const reset = useCallback(() => {
    const g = G.current;
    g.snake = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
    g.dir = { x: 1, y: 0 };
    g.queue = [];
    g.score = 0;
    g.eaten = 0;
    g.acc = 0;
    g.shake = 0;
    g.flash = 0;
    g.parts = [];
    g.floats = [];
    spawnJoker();
    setScore(0);
    setLevel(1);
  }, [spawnJoker]);

  const begin = useCallback(() => {
    reset();
    setStat("playing");
  }, [reset, setStat]);

  const queueDir = useCallback(
    (d: Pt) => {
      if (statusRef.current === "ready") begin();
      const g = G.current;
      const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
      if (d.x === -last.x && d.y === -last.y) return;
      if (d.x === last.x && d.y === last.y) return;
      if (g.queue.length < 3) g.queue.push(d);
    },
    [begin],
  );

  const die = useCallback(() => {
    const g = G.current;
    g.shake = 14;
    g.flash = 1;
    if (g.score > bestRef.current) {
      bestRef.current = g.score;
      setBest(g.score);
      try {
        localStorage.setItem("batsnake-best", String(g.score));
      } catch {
        /* ignore */
      }
    }
    setStat("over");
  }, [setStat]);

  const step = useCallback(() => {
    const g = G.current;
    const d = g.queue.shift() ?? g.dir;
    g.dir = d;
    const head = { x: g.snake[0].x + d.x, y: g.snake[0].y + d.y };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      die();
      return;
    }
    const body = g.snake.slice(0, -1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) {
      die();
      return;
    }

    g.snake.unshift(head);

    if (head.x === g.joker.x && head.y === g.joker.y) {
      g.eaten += 1;
      const gain = 10 + Math.floor(g.eaten / 5) * 5;
      g.score += gain;
      setScore(g.score);
      setLevel(1 + Math.floor(g.eaten / 5));
      g.shake = 5;

      const c = cellRef.current;
      const px = (head.x + 0.5) * c;
      const py = (head.y + 0.5) * c;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 40 + Math.random() * 170;
        g.parts.push({
          x: px,
          y: py,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0.6 + Math.random() * 0.4,
          color: Math.random() > 0.5 ? "#a855f7" : "#22c55e",
        });
      }
      g.floats.push({ x: px, y: py - c * 0.6, text: `+${gain}`, life: 0.9, color: "#ffd24d" });
      g.floats.push({
        x: px,
        y: py - c * 1.3,
        text: LAUGHS[Math.floor(Math.random() * LAUGHS.length)],
        life: 1.1,
        color: "#c084fc",
      });
      spawnJoker();
    } else {
      g.snake.pop();
    }
  }, [die, spawnJoker]);

  /* ---------------- sizing ---------------- */
  useEffect(() => {
    setMounted(true);
    try {
      const b = Number(localStorage.getItem("batsnake-best") || 0);
      bestRef.current = b;
      setBest(b);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const fit = () => {
      const maxW = Math.min(window.innerWidth * 0.92, 960);
      const maxH = window.innerHeight * 0.56;
      const c = Math.max(14, Math.floor(Math.min(maxW / COLS, maxH / ROWS)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cellRef.current = c;
      dprRef.current = dpr;
      const cv = canvasRef.current;
      if (cv) {
        cv.width = COLS * c * dpr;
        cv.height = ROWS * c * dpr;
      }
      setDims({ w: COLS * c, h: ROWS * c });
    };
    fit();
    reset();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mounted, reset]);

  /* ---------------- input ---------------- */
  useEffect(() => {
    if (!mounted) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
        return;
      }
      const d = DIRS[e.key];
      if (d) {
        e.preventDefault();
        e.stopPropagation();
        queueDir(d);
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (statusRef.current !== "playing") begin();
      }
    };
    window.addEventListener("keydown", onKey, true);

    const root = rootRef.current;
    const block = (e: Event) => e.preventDefault();
    root?.addEventListener("wheel", block, { passive: false });
    root?.addEventListener("touchmove", block, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKey, true);
      root?.removeEventListener("wheel", block);
      root?.removeEventListener("touchmove", block);
    };
  }, [mounted, onExit, queueDir, begin]);

  /* ---------------- loop + draw ---------------- */
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let last = performance.now();

    // deterministic skyline
    const skyline = Array.from({ length: 16 }, (_, i) => ({
      x: i / 16,
      w: 0.04 + ((i * 37) % 5) * 0.012,
      h: 0.1 + ((i * 53) % 9) * 0.04,
    }));

    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      const c = cellRef.current;
      const dpr = dprRef.current;
      const W = COLS * c;
      const H = ROWS * c;
      const g = G.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (g.shake > 0.1) {
        ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
      }

      // background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#06101c");
      bg.addColorStop(1, "#02050a");
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, W + 40, H + 40);

      const sig = ctx.createRadialGradient(W * 0.5, H * 0.16, 0, W * 0.5, H * 0.16, H * 0.75);
      sig.addColorStop(0, "rgba(120,180,255,0.17)");
      sig.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sig;
      ctx.fillRect(0, 0, W, H);

      // skyline
      ctx.fillStyle = "rgba(10,20,34,0.95)";
      skyline.forEach((b) => ctx.fillRect(b.x * W, H - b.h * H, b.w * W, b.h * H));

      // grid
      ctx.strokeStyle = "rgba(90,160,240,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        ctx.moveTo(i * c, 0);
        ctx.lineTo(i * c, H);
      }
      for (let j = 0; j <= ROWS; j++) {
        ctx.moveTo(0, j * c);
        ctx.lineTo(W, j * c);
      }
      ctx.stroke();

      // Joker (target)
      drawJoker(ctx, (g.joker.x + 0.5) * c, (g.joker.y + 0.5) * c, c, g.t);

      // Batman (snake): tail -> head
      const n = g.snake.length;
      for (let i = n - 1; i >= 1; i--) {
        const s = g.snake[i];
        const k = 1 - (i / n) * 0.35;
        const size = c * 0.84 * k;
        const x = (s.x + 0.5) * c - size / 2;
        const y = (s.y + 0.5) * c - size / 2;
        ctx.shadowColor = "rgba(110,170,255,0.6)";
        ctx.shadowBlur = c * 0.3;
        ctx.fillStyle = i % 2 ? "#18222f" : "#101926";
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, c * 0.2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(130,190,255,0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (i % 3 === 1) {
          ctx.fillStyle = "rgba(255,210,77,0.9)";
          drawBat(ctx, (s.x + 0.5) * c, (s.y + 0.5) * c, size * 0.32);
        }
      }
      if (n > 0) {
        drawHead(ctx, (g.snake[0].x + 0.5) * c, (g.snake[0].y + 0.5) * c, c, g.dir);
      }

      // particles
      g.parts.forEach((p) => {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });
      ctx.globalAlpha = 1;

      // floating text
      ctx.textAlign = "center";
      g.floats.forEach((f) => {
        ctx.globalAlpha = Math.min(1, f.life * 1.4);
        ctx.fillStyle = f.color;
        ctx.font = `800 ${Math.round(c * 0.5)}px ui-monospace, monospace`;
        ctx.fillText(f.text, f.x, f.y);
      });
      ctx.globalAlpha = 1;

      // death flash
      if (g.flash > 0.01) {
        ctx.fillStyle = `rgba(190,120,255,${g.flash * 0.35})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const g = G.current;
      g.t += dt;

      if (statusRef.current === "playing") {
        g.acc += dt;
        const interval = 1 / Math.min(7 + g.eaten * 0.4, 16);
        while (g.acc >= interval) {
          g.acc -= interval;
          step();
          if (statusRef.current !== "playing") break;
        }
      }

      g.parts.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      });
      g.parts = g.parts.filter((p) => p.life > 0);
      g.floats.forEach((f) => {
        f.y -= 34 * dt;
        f.life -= dt;
      });
      g.floats = g.floats.filter((f) => f.life > 0);
      g.shake *= 0.9;
      g.flash *= 0.92;

      draw();
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mounted, step]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchRef.current;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir({ x: dx > 0 ? 1 : -1, y: 0 });
    else queueDir({ x: 0, y: dy > 0 ? 1 : -1 });
  };

  if (!mounted) return null;

  return createPortal(
    <div ref={rootRef} className="bs-root">
      <style>{CSS}</style>

      <div className="bs-panel">
        <div className="bs-top">
          <div className="bs-title">BAT-SNAKE // GOTHAM PURSUIT</div>
          <div className="bs-hud">
            <span>
              SCORE<b>{score}</b>
            </span>
            <span>
              LEVEL<b>{level}</b>
            </span>
            <span>
              BEST<b>{best}</b>
            </span>
          </div>
          <button type="button" className="bs-btn" onClick={onExit}>
            EXIT ✕
          </button>
        </div>

        <div
          className="bs-wrap"
          style={{ width: dims.w, height: dims.h }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <canvas ref={canvasRef} style={{ width: dims.w, height: dims.h }} />

          {status === "ready" && (
            <div className="bs-over">
              <div className="bs-big">CATCH THE JOKER</div>
              <div className="bs-sm">
                GUIDE BATMAN · AVOID THE WALLS · DON&apos;T BITE YOUR OWN TAIL
              </div>
              <div className="bs-sm">ARROWS / WASD / SWIPE</div>
              <div className="bs-row">
                <button type="button" className="bs-btn hot" onClick={begin}>
                  ▶ START
                </button>
                <button type="button" className="bs-btn" onClick={onExit}>
                  EXIT
                </button>
              </div>
            </div>
          )}

          {status === "over" && (
            <div className="bs-over">
              <div className="bs-big">THE JOKER LAUGHS LAST</div>
              <div className="bs-sm">
                FINAL SCORE <b style={{ color: "#fff" }}>{score}</b> · BEST{" "}
                <b style={{ color: "#ffd24d" }}>{best}</b>
              </div>
              <div className="bs-row">
                <button type="button" className="bs-btn hot" onClick={begin}>
                  ↻ TRY AGAIN
                </button>
                <button type="button" className="bs-btn" onClick={onExit}>
                  EXIT
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bs-pad">
          <span />
          <button type="button" onPointerDown={() => queueDir({ x: 0, y: -1 })}>▲</button>
          <span />
          <button type="button" onPointerDown={() => queueDir({ x: -1, y: 0 })}>◀</button>
          <button type="button" onPointerDown={() => queueDir({ x: 0, y: 1 })}>▼</button>
          <button type="button" onPointerDown={() => queueDir({ x: 1, y: 0 })}>▶</button>
        </div>

        <div className="bs-hint">ESC = EXIT · ENTER / SPACE = RESTART</div>
      </div>
    </div>,
    document.body,
  );
}