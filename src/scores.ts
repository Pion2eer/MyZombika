// Таблица рекордов: маленький сервис на сервере сайта (server/score.mjs, за Caddy по адресу /api).
// На сайте — тот же адрес, из файла с диска (file://) — полный адрес сайта.
export interface TopRow { name: string; score: number; wave: number; kills: number; time: number; date: number; co: number }
export interface Result { score: number; wave: number; kills: number; time: number; co: number }

const API = new URLSearchParams(location.search).get("api") || (location.protocol.startsWith("http") && /myzombika|localhost|127\.0\.0\.1/.test(location.hostname)
  ? "/api" : "https://myzombika.pion.ltd/api"); // ?api=… — свой сервер для проверки
const BEST = "myzombika-best";

let run: Promise<string | null> = Promise.resolve(null);

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(API + path, { ...init, signal: ctl.signal });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.err || String(r.status));
    return body as T;
  } finally { clearTimeout(tm); }
}

/** новый забег: сервер выдаёт подписанный жетон (без него результат не примут) */
export function startRun() {
  run = j<{ run: string }>("/start").then((r) => r.run).catch(() => null);
}

/** отправить результат; ответ — место в таблице */
export async function submitScore(name: string, r: Result, mode = "waves"): Promise<{ place: number; total: number; best: number }> {
  const token = await run;
  if (!token) throw new Error("offline");
  run = Promise.resolve(null); // жетон одноразовый
  return j("/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: token, name, mode, ...r }) });
}

export const fetchTop = (mode = "waves") => j<{ top: TopRow[]; total: number }>(`/top?mode=${mode}&n=50`);

/** личный рекорд на этом устройстве; возвращает прошлый рекорд */
export function localBest(score: number): number {
  let old = 0;
  try { old = Number(localStorage.getItem(BEST)) || 0; if (score > old) localStorage.setItem(BEST, String(score)); } catch { /* нет хранилища */ }
  return old;
}

export const fmtTime = (s: number) => { s = Math.floor(s); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };
