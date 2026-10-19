/* Shared state for the Batcave landing / arsenal / screen stages. */

// 0..1 : hero landing in the chamber (fall -> impact -> settle at eye level)
export const landProgress = { current: 0 };
// 0..1 : pan across the hanging arsenal
export const armoryProgress = { current: 0 };
// 0..1 : camera rises and pushes in to the giant screen
export const screenProgress = { current: 0 };

// The DOM overlay that is stuck onto the 3D giant screen.
export const caveUI: { screenEl: HTMLElement | null } = { screenEl: null };

export const CAVE_EVENTS = { openGame: "batcave:open-game" } as const;

// Giant screen (world space) + design size of the DOM overlay (2:1)
export const SCREEN = { x: 3, y: 24, z: -447, w: 54, h: 27 };
export const SCREEN_UI = { w: 1600, h: 800 };

export const RACK_X = [-22.5, -8.1, 8.1, 22.5];

const ss = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where the camera is looking along x while at eye level (landing = centre). */
export function armLookX() {
  const p = armoryProgress.current;
  return -20 * ss(p, 0, 0.14) + 40 * ss(p, 0.12, 1);
}

/** 0..1 how strongly a rack is "in focus" (drives glow + lights). */
export function rackFocus(i: number) {
  const f = Math.max(0, 1 - Math.abs(armLookX() - RACK_X[i]) / 16);
  return f * (1 - ss(screenProgress.current, 0, 0.5));
}

/** Arsenal power-on, driven by the landing. */
export function arsenalPower() {
  return ss(landProgress.current, 0.35, 1);
}

export const ACHIEVEMENTS = [
  {
    year: "2023",
    tag: "CORE TRAINING",
    title: "Core training",
    text: "Built strong fundamentals in C, C++, Python, and algorithmic problem-solving. Established the programming base that everything else runs on.",
  },
  {
    year: "2024",
    tag: "FIELD EXPOSURE",
    title: "First field exposure",
    text: "Completed an AI internship at Inters Tech, converting academic AI interest into real project and workplace context.",
  },
  {
    year: "2024",
    tag: "VALIDATION",
    title: "HackerRank stars",
    text: "Earned multi-star ratings in Python and problem-solving on HackerRank, validating core coding ability.",
  },
  {
    year: "2026",
    tag: "ENTERPRISE",
    title: "Enterprise field work",
    text: "ServiceNow internship — enterprise SaaS platform, workflow automation, and team delivery practices at scale.",
  },
];

export const INTERNSHIPS = [
  {
    company: "ServiceNow",
    period: "May 2026 – July 2026",
    role: "AI / Software Development Intern",
    bullets: [
      "Built and improved workflow automation features on the ServiceNow platform.",
      "Used JavaScript / GlideScript to extend platform modules and integrate REST APIs.",
      "Hands-on with ServiceNow AI capabilities — Now Assist, AI Search, AI UX, AICT (Agentic AI Control Tower), OTTO AI, and more.",
      "Collaborated in an Agile team with daily standups and sprint reviews.",
      "Gained hands-on exposure to enterprise AI/automation tooling and large-scale SaaS development.",
    ],
    stack: [
      "ServiceNow Platform",
      "JavaScript",
      "GlideScript",
      "REST APIs",
      "Agile",
      "Now Assist",
      "AI Search",
      "AI UX",
      "AICT",
      "OTTO AI",
    ],
  },
  {
    company: "Inters Tech",
    period: "2024",
    role: "Artificial Intelligence Intern",
    bullets: [
      "Assisted in data collection, preprocessing, and model experimentation for an AI project.",
      "Worked with Python AI/ML libraries including pandas and scikit-learn.",
      "Contributed a deliverable script/tool under mentor guidance.",
    ],
    stack: ["Python", "pandas", "scikit-learn", "Data preprocessing"],
  },
];

// ---- FINALE ----
// 0..1 : camera leaves the screen, rises through the ceiling hatch
export const endProgress = { current: 0 };
// 0..1 : rooftop wide shot with the hero looking at the bat signal
export const roofProgress = { current: 0 };

// Hero yaw for the finale (radians). Hero is turned sideways, facing screen-right.
// If he faces the wrong way, try -1.85 or 1.85 + Math.PI.
export const HERO_END_YAW = 1.85;

// Rooftop camera: starts wide on the right, drifts slowly toward the hero.
export const ROOF_SHOT = {
  from: { pos: [10.5, 1.7, 9.5], look: [1.5, 6.0, -30], fov: 76 },
  to: { pos: [8.4, 2.2, 6.0], look: [2.5, 6.4, -30], fov: 68 },
} as const;