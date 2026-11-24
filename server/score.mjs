// Сервер рекордов MyZombika: один файл, без зависимостей, Node 18+.
// Слушает 127.0.0.1:8787, наружу его отдаёт Caddy по адресу https://myzombika.pion.ltd/api/...
//
//   GET  /api/start            → { run }            жетон забега (выдаётся при старте игры)
//   POST /api/score  {run, name, score, wave, kills, time, mode, co}
//                              → { ok, place, total, best }
//   GET  /api/top?mode=waves   → { top: [{ name, score, wave, kills, time, date, co }] }
//
// Защита от накрутки (простая, но отсекает правку запроса руками):
//  - жетон забега подписан секретом сервера и помнит время выдачи; результат принимается один раз на жетон,
//    а заявленное время игры не может быть больше, чем прошло с выдачи жетона;
//  - очки, убийства, волна и время должны сходиться между собой (за убийство 5..100 очков, не больше 4 убийств
//    в секунду, волна не быстрее 6 секунд и т. п.);
//  - не чаще одного результата в 10 секунд и 60 в час с одного адреса;
//  - имя — до 16 символов, без управляющих символов и угловых скобок.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 8787);
const DIR = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), "data");
const FILE = path.join(DIR, "scores.json");
const SECRET_FILE = path.join(DIR, "secret");
const MODES = new Set(["waves", "story"]);
const KEEP = 1000; // сколько лучших результатов хранить на режим

fs.mkdirSync(DIR, { recursive: true });
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim(); } catch { /* нет — создадим */ }
if (!SECRET) { SECRET = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

/** @type {Record<string, {name:string,score:number,wave:number,kills:number,time:number,date:number,co:number}[]>} */
let db = { waves: [], story: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* первый запуск */ }
let saveT = null;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  }, 500);
};

const sign = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url").slice(0, 22);
const used = new Map(); // жетон → когда использован (чистится раз в час)
const hits = new Map(); // адрес → [время запросов]
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of used) if (now - t > 26 * 3600e3) used.delete(k);
  for (const [k, a] of hits) { const b = a.filter((t) => now - t < 3600e3); b.length ? hits.set(k, b) : hits.delete(k); }
}, 3600e3).unref();

function cleanName(s) {
  s = String(s ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f<>&"]/g, "").replace(/\s+/g, " ").trim();
  return [...s].slice(0, 16).join("") || "Player";
}
const int = (v) => (Number.isFinite(+v) ? Math.floor(+v) : NaN);

function check(b, runAge) {
  const score = int(b.score), wave = int(b.wave), kills = int(b.kills), time = int(b.time), co = Math.min(4, Math.max(1, int(b.co) || 1));
  if ([score, wave, kills, time].some((n) => !Number.isFinite(n) || n < 0)) return "bad numbers";
  if (score > 10_000_000 || kills > 100_000 || wave > 1000 || time > 24 * 3600) return "too big";
  if (time > runAge + 20) return "time > run";
  if (score < kills * 5 || score > kills * 100) return "score/kills";
  if (kills > time * 4 + 10) return "kills/time";
  if (wave > time / 6 + 2) return "wave/time";
  // убить можно только тех, кто уже вышел: за волны 1..n выходит не больше ~(5+3k)+2k+... ≤ 12k+5 монстров
  let cap = 0; for (let k = 1; k <= wave; k++) cap += 12 * k + 5;
  if (kills > cap * co + 5) return "kills/wave";
  return { score, wave, kills, time, co };
}

function place(list, score) { let p = 1; for (const e of list) if (e.score > score) p++; return p; }

function send(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && url.pathname === "/api/start") {
    const t = Date.now().toString(36), r = crypto.randomBytes(6).toString("base64url");
    return send(res, 200, { run: `${t}.${r}.${sign(t + "." + r)}` });
  }
  if (req.method === "GET" && url.pathname === "/api/top") {
    const mode = MODES.has(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "waves";
    const n = Math.min(100, Math.max(1, int(url.searchParams.get("n")) || 50));
    return send(res, 200, { top: db[mode].slice(0, n), total: db[mode].length });
  }
  if (req.method === "POST" && url.pathname === "/api/score") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => {
      let b;
      try { b = JSON.parse(body); } catch { return send(res, 400, { ok: false, err: "json" }); }
      const now = Date.now();
      const h = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
      if ((h.length && now - h[h.length - 1] < 10e3) || h.length >= 60) return send(res, 429, { ok: false, err: "slow down" });
      h.push(now); hits.set(ip, h);
      const [t, r, s] = String(b.run || "").split(".");
      if (!t || !r || s !== sign(t + "." + r)) return send(res, 400, { ok: false, err: "run" });
      if (used.has(b.run)) return send(res, 409, { ok: false, err: "run used" });
      const runAge = (now - parseInt(t, 36)) / 1000;
      if (!(runAge >= 0 && runAge < 24 * 3600)) return send(res, 400, { ok: false, err: "run age" });
      const mode = MODES.has(b.mode) ? b.mode : "waves";
      const v = check(b, runAge);
      if (typeof v === "string") { console.log(new Date().toISOString(), "reject", ip, v, JSON.stringify(b).slice(0, 300)); return send(res, 422, { ok: false, err: v }); }
      used.set(b.run, now);
      const name = cleanName(b.name), list = db[mode];
      // в таблице — лучший результат каждого имени
      const old = list.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
      const best = old >= 0 ? list[old].score : 0;
      if (v.score > best && v.score > 0) {
        if (old >= 0) list.splice(old, 1);
        list.push({ name, ...v, date: now });
        list.sort((a, b2) => b2.score - a.score || a.date - b2.date);
        if (list.length > KEEP) list.length = KEEP;
        save();
      }
      return send(res, 200, { ok: true, place: place(list, v.score), total: list.length, best: Math.max(best, v.score) });
    });
    return;
  }
  send(res, 404, { ok: false, err: "not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log(`MyZombika scores on 127.0.0.1:${PORT}, data in ${DIR}`));
