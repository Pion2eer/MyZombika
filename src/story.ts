// Сюжетный режим: данные главы и сохранение в браузере.
// Глава — вертикальная полоса: старт внизу у дома, три участка, между ними заслоны и лагеря, выход наверху.

import type { Kind } from "./main";

export const STORY_W = 1600, STORY_H = 7200;

/** заслоны: y и лагерь сразу за ним (выше по карте) */
export const GATES = [STORY_H - 2350, STORY_H - 4650];
export const CAMPS = [{ x: STORY_W / 2 - 40, y: GATES[0] - 230 }, { x: STORY_W / 2 + 60, y: GATES[1] - 230 }];
/** точка старта главы (у дома) и выход */
export const START = { x: STORY_W / 2 - 80, y: STORY_H - 330 };
export const EXIT_Y = 520;

/** группы врагов: участок, место, кто. Просыпаются, когда герой подходит снизу */
export interface Group { seg: number; x: number; y: number; kinds: Kind[] }
const z = (n: number, k: Kind = "zombie") => Array<Kind>(n).fill(k);
export const GROUPS: Group[] = [
  // участок 1: двор и опушка — зомби и крысы
  { seg: 0, x: 600, y: STORY_H - 900, kinds: z(3) },
  { seg: 0, x: 1050, y: STORY_H - 1250, kinds: [...z(3), ...z(3, "rat")] },
  { seg: 0, x: 500, y: STORY_H - 1650, kinds: z(5) },
  { seg: 0, x: 900, y: STORY_H - 2050, kinds: [...z(4), "runner", "runner"] },
  // участок 2: лес — бегуны, крысы, первая гиена
  { seg: 1, x: 800, y: STORY_H - 2900, kinds: [...z(4), "runner"] },
  { seg: 1, x: 450, y: STORY_H - 3300, kinds: [...z(5, "rat"), "runner", "runner"] },
  { seg: 1, x: 1150, y: STORY_H - 3700, kinds: [...z(4), "hyena"] },
  { seg: 1, x: 700, y: STORY_H - 4250, kinds: [...z(5), "runner", "runner", "spitter"] },
  // участок 3: у сгоревшего моста — засада
  { seg: 2, x: 600, y: STORY_H - 5200, kinds: [...z(5), "runner", "runner"] },
  { seg: 2, x: 1100, y: STORY_H - 5650, kinds: [...z(3), "hyena", "hyena", "spitter"] },
  { seg: 2, x: 800, y: STORY_H - 6150, kinds: [...z(6), ...z(3, "runner"), "spitter"] },
  { seg: 2, x: 800, y: STORY_H - 6600, kinds: [...z(8), ...z(3, "runner"), "hyena", "spitter", "spitter"] },
];
/** ящик с оружием: участок 1 — дробовик */
export const WEAPON_CRATES = [{ x: 1180, y: STORY_H - 1500, slot: 1 }];

export interface StorySave {
  ch: number; camp: number; hp: number; armor: number; medkits: number; grenades: number;
  owned: boolean[]; clip: Record<string, number>; weapon: number; kills: number; score: number; time: number;
  /** прокачка (с 0.12) */
  level?: number; xp?: number; parts?: number; up?: Record<string, number>;
}
const KEY = "myzombika-story";
export function loadStory(): StorySave | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s && typeof s.camp === "number" ? s : null; } catch { return null; }
}
export function saveStory(s: StorySave | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* приватный режим */ }
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
