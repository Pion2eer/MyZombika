// Картинки объектов от ChatGPT (стиль деревьев, угол камеры игры). Положи PNG — и он заменит модель из срезов:
//   src/obj/<имя>.png    — предмет (имена как у моделей: hay_round, cone, bench…; машины: car_red_h — боком, нос вправо;
//                          car_red_v — вдоль; без _h/_v — один ракурс). Размер в мире = размер файла / 3.
//   src/house/<имя>.png  — полуразрушенный дом (любое имя): ставится сплошным препятствием, по 1–2 на участок сюжета.
import Phaser from "phaser";

const OBJ = import.meta.glob("./obj/*.png", { eager: true, import: "default" }) as Record<string, string>;
const HOUSE = import.meta.glob("./house/*.png", { eager: true, import: "default" }) as Record<string, string>;
const nameOf = (p: string) => p.replace(/^.*\//, "").replace(/\.png$/, "");
export const OBJ_NAMES = new Set(Object.keys(OBJ).map(nameOf));
export const HOUSE_NAMES = Object.keys(HOUSE).map(nameOf).sort();
/** во сколько раз файл крупнее мира */
export const ART_K = 3;

export function loadArtFiles(scene: Phaser.Scene) {
  for (const [p, f] of Object.entries(OBJ)) scene.load.image("ob_" + nameOf(p), f);
  for (const [p, f] of Object.entries(HOUSE)) scene.load.image("hs_" + nameOf(p), f);
}
/** есть ли картинка для предмета (с ракурсом: «_h» / «_v» или без) */
export function objArt(name: string, view?: "h" | "v"): string | null {
  if (view && OBJ_NAMES.has(`${name}_${view}`)) return `ob_${name}_${view}`;
  if (OBJ_NAMES.has(name)) return "ob_" + name;
  return null;
}
