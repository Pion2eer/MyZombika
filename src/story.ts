// Сюжетный режим: данные главы и сохранение в браузере.
// Глава — вертикальная полоса: старт внизу у дома, 4–5 участков, между ними заслоны и лагеря (автосохранение), выход наверху.

import type { Kind } from "./main";

/** Восемь глав «Дорога на север». Каждая — своя местность (земля, деревья, предметы), длина и враги. */
export type Theme = "farm" | "road" | "waste" | "town" | "junk" | "factory" | "tunnel" | "dam";
/** weapons — ящики с оружием: номер ячейки (0 автомат, 1 дробовик, 4 базука, 5 огнемёт, 6 пила) и участок */
export interface ChapterDef { theme: Theme; segs: number; tint: number; weapons?: { slot: number; seg: number }[]; boss?: boolean }
export const CHAPTERS: ChapterDef[] = [
  { theme: "farm", segs: 4, tint: 0xffffff, weapons: [{ slot: 1, seg: 1 }, { slot: 6, seg: 3 }] }, // дробовик, бензопила
  { theme: "road", segs: 4, tint: 0xe6dcc0, weapons: [{ slot: 0, seg: 0 }] }, // автомат
  { theme: "waste", segs: 4, tint: 0xe8d8b0 }, // пустырь
  { theme: "town", segs: 5, tint: 0xc8ccc4, weapons: [{ slot: 4, seg: 2 }] }, // базука
  { theme: "junk", segs: 4, tint: 0xd0c4a8 }, // свалка
  { theme: "factory", segs: 5, tint: 0xb8b0a0, weapons: [{ slot: 5, seg: 1 }] }, // огнемёт
  { theme: "tunnel", segs: 4, tint: 0x9a9aa4 }, // туннель: темно, разбитые машины
  { theme: "dam", segs: 5, tint: 0xb8ccd0, boss: true },
];
const SEGL = 2300;

/** группы врагов: участок, место, кто. Просыпаются, когда кто-то из отряда подходит снизу */
export interface Group { seg: number; x: number; y: number; kinds: Kind[]; boss?: boolean }
const z = (n: number, k: Kind = "zombie") => Array<Kind>(Math.max(0, Math.round(n))).fill(k);

// раскладка текущей главы (живые привязки: main видит новые значения после setChapter)
export let CH = 0;
export let STORY_W = 1600, STORY_H = 7200;
export let GATES: number[] = [];
export let CAMPS: { x: number; y: number }[] = [];
export let START = { x: 0, y: 0 };
export const EXIT_Y = 520;
export let GROUPS: Group[] = [];
export let WEAPON_CRATES: { x: number; y: number; slot: number }[] = [];
export let SEGS = 3;
/** туннель: проход между стенами (x от LANE[0] до LANE[1]) выше TUNNEL_Y; снаружи — сплошная скала */
export let LANE: [number, number] | null = null;
export let TUNNEL_Y = 0;
/** где по ширине можно ставить врагов и бродячих */
export const laneX = (): [number, number] => LANE ? [LANE[0] + 70, LANE[1] - 70] : [380, STORY_W - 380];
/** старые сохранения (5 глав) → номер главы из 8 */
const OLD_CH = [1, 2, 4, 6, 8];

export function setChapter(ch: number) {
  CH = Math.max(0, Math.min(CHAPTERS.length - 1, ch | 0));
  const C = CHAPTERS[CH];
  SEGS = C.segs;
  STORY_W = 1600; STORY_H = C.segs * SEGL + 300;
  GATES = Array.from({ length: C.segs - 1 }, (_, k) => STORY_H - 50 - SEGL * (k + 1));
  CAMPS = GATES.map((g, k) => ({ x: STORY_W / 2 + (k % 2 ? 60 : -40), y: g - 230 }));
  START = { x: STORY_W / 2 - 80, y: STORY_H - 330 };
  LANE = C.theme === "tunnel" ? [STORY_W / 2 - 340, STORY_W / 2 + 340] : null;
  TUNNEL_Y = STORY_H - 950;
  // враги: чем дальше (глава и участок), тем больше и злее
  let s = 1234 + CH * 7919;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  GROUPS = [];
  for (let k = 0; k < C.segs; k++) {
    const y0 = k === 0 ? STORY_H - 650 : GATES[k - 1] - 450, y1 = k < GATES.length ? GATES[k] + 250 : EXIT_Y + 350;
    const d = CH * 0.6 + k * 0.4;
    for (let i = 0; i < 4; i++) {
      const [xa, xb] = laneX(), y = y0 + ((y1 - y0) * (i + 0.5)) / 4, x = xa + rnd() * (xb - xa), last = i === 3;
      const kinds: Kind[] = [...z(4 + d * 1.4 + i), ...(d > 0.3 ? z(1 + d * 0.8, "runner") : [])];
      if (d > 0.4 && rnd() < 0.55) kinds.push(...z(1 + d * 0.3, "bloater"));
      if (d > 0.8 && (last || rnd() < 0.6)) kinds.push(...z(1 + d * 0.45, "armored"));
      if (d > 1.6 && (last || rnd() < 0.35)) kinds.push(...z(d * 0.25, "brute"));
      if ((CH <= 1 || C.theme === "junk" || C.theme === "tunnel") && rnd() < 0.5) kinds.push(...z(2 + rnd() * 3, "rat"));
      if (C.theme === "waste" && rnd() < 0.6) kinds.push(...z(1 + d * 0.3, "hyena"));
      if (d > 0.7 && rnd() < 0.6) kinds.push(...z(1 + d * 0.3, "hyena"));
      if (d > 1.2 && (last || rnd() < 0.4)) kinds.push(...z(1 + d * 0.25, "spitter"));
      if (d > 2.4 && rnd() < 0.5) kinds.push(...z(d * 0.3, "panther"));
      if (d > 3 && last) kinds.push("bear");
      GROUPS.push({ seg: k, x, y, kinds });
    }
  }
  // финал: «Хозяин» у плотины
  if (C.boss) GROUPS.push({ seg: C.segs - 1, x: STORY_W / 2, y: EXIT_Y + 420, kinds: ["bear", "brute", "armored", "armored", "spitter", "spitter", "panther", "bloater"], boss: true });
  WEAPON_CRATES = (C.weapons ?? []).map((w, i) => ({ x: i % 2 ? 420 : 1180, y: w.seg === 0 ? STORY_H - 1500 : GATES[w.seg - 1] - 900, slot: w.slot }));
}
setChapter(0);

export interface StorySave {
  ch: number; camp: number; hp: number; armor: number; medkits: number; grenades: number;
  owned: boolean[]; clip: Record<string, number>; weapon: number; kills: number; score: number; time: number;
  /** прокачка (с 0.12) */
  level?: number; xp?: number; parts?: number; up?: Record<string, number>;
  /** спецпатроны и запас ракет/топлива (с 0.15) */
  ap?: number; inc?: number; stock?: Record<string, number>;
}
const KEY = "myzombika-story";
export function loadStory(): StorySave | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s || typeof s.camp !== "number") return null;
    if (!s.v) { s.ch = OLD_CH[s.ch - 1] ?? s.ch; s.v = 2; }
    return s;
  } catch { return null; }
}
export function saveStory(s: StorySave | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify({ ...s, v: 2 })); else localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}

/** гость в чужом сюжете: его прокачка хранится отдельно и едет с ним в любую игру */
export interface HeroSave { level: number; xp: number; parts: number; up: Record<string, number> }
const HERO = "myzombika-hero";
export function loadHero(): HeroSave | null {
  try { const s = JSON.parse(localStorage.getItem(HERO) || "null"); return s && typeof s.level === "number" ? s : null; } catch { return null; }
}
export function saveHero(s: HeroSave) {
  try { localStorage.setItem(HERO, JSON.stringify(s)); } catch { /* приватный режим */ }
}
