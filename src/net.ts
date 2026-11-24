// Сеть для кооператива: игроки соединяются напрямую (WebRTC через PeerJS), своего сервера не нужно.
// Хозяин (host) считает монстров, волны, попадания; гости присылают свои движения и выстрелы,
// хозяин рассылает всем снимок мира ~15 раз в секунду и события (убийства, взрывы, выстрелы).
import Peer, { type DataConnection } from "peerjs";

export type Role = "solo" | "host" | "client";
type Msg = { t: string; [k: string]: unknown };

const Q = new URLSearchParams(location.search);
/** ?broker=localhost:9000 — свой сервер-«знакомилка» (для проверки); по умолчанию бесплатный публичный PeerJS */
const BROKER = Q.get("broker");
const opts = () => {
  if (!BROKER) return { debug: 0 };
  const [host, port] = BROKER.split(":");
  return { host, port: Number(port) || 9000, path: "/", secure: false, debug: 0 };
};
const PREFIX = "myzombika-";

export const NET = (window as any).NET = {
  role: "solo" as Role,
  code: "",
  /** id этого игрока (у хозяина — "host") */
  me: "host",
  status: "",
  peer: null as Peer | null,
  conns: new Map<string, DataConnection>(),
  onMsg: (_from: string, _m: Msg) => {},
  onJoin: (_id: string) => {},
  onLeave: (_id: string) => {},
};

function wire(c: DataConnection) {
  c.on("data", (d) => NET.onMsg(c.peer, d as Msg));
  c.on("close", () => { NET.conns.delete(c.peer); NET.onLeave(c.peer); });
  c.on("error", () => { NET.conns.delete(c.peer); NET.onLeave(c.peer); });
}

/** стать хозяином: вернёт код комнаты. code — занять прежний код (после обновления страницы) */
export function host(want?: string, tries = 8): Promise<string> {
  return new Promise((res, rej) => {
    const code = want ?? Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const peer = new Peer(PREFIX + code, opts());
    NET.peer = peer;
    NET.status = "Подключаюсь…";
    peer.on("open", () => {
      NET.role = "host"; NET.code = code; NET.me = "host"; NET.status = "";
      res(code);
    });
    peer.on("connection", (c) => {
      if (NET.conns.size >= 3) { c.on("open", () => c.close()); return; } // до 4 игроков
      c.on("open", () => { NET.conns.set(c.peer, c); wire(c); NET.onJoin(c.peer); });
    });
    peer.on("error", (e) => {
      // прежний код ещё числится за закрытой вкладкой — подождать и занять снова
      if (want && e.type === "unavailable-id" && tries > 0) {
        peer.destroy();
        setTimeout(() => host(want, tries - 1).then(res, rej), 2000);
        return;
      }
      if (NET.role === "host") { NET.status = "Ошибка сети: " + e.type; return; } // после старта — не роняем игру
      peer.destroy(); if (NET.peer === peer) NET.peer = null;
      NET.status = "Ошибка сети: " + e.type; rej(e);
    });
  });
}

/** войти к хозяину по коду */
export function join(code: string): Promise<void> {
  return new Promise((res, rej) => {
    const peer = new Peer(opts());
    NET.peer = peer;
    NET.status = "Подключаюсь…";
    peer.on("open", (id) => {
      const c = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true, serialization: "json" });
      c.on("open", () => {
        NET.role = "client"; NET.code = code.toUpperCase(); NET.me = id; NET.status = "";
        NET.conns.set("host", c);
        c.on("data", (d) => NET.onMsg("host", d as Msg));
        c.on("close", () => { NET.conns.delete("host"); NET.onLeave("host"); });
        res();
      });
      c.on("error", (e) => { peer.destroy(); if (NET.peer === peer) NET.peer = null; rej(e); });
      // хозяин не ответил за 8 с — неудача (иначе ожидание может зависнуть)
      setTimeout(() => { if (NET.role !== "client" && !peer.destroyed) { NET.status = NET.status || "Игра не отвечает"; peer.destroy(); if (NET.peer === peer) NET.peer = null; rej(new Error("timeout")); } }, 8000);
    });
    peer.on("error", (e) => {
      if (NET.role === "client") return;
      NET.status = e.type === "peer-unavailable" ? "Игра с таким кодом не найдена" : "Ошибка сети: " + e.type;
      peer.destroy(); if (NET.peer === peer) NET.peer = null;
      rej(e);
    });
  });
}

export function send(m: Msg, to?: string, except?: string) {
  if (to) { NET.conns.get(to)?.send(m); return; }
  for (const [id, c] of NET.conns) if (id !== except && c.open) c.send(m);
}

/** закрыть одно соединение (гость пропал) */
export function drop(id: string) {
  NET.conns.get(id)?.close();
  NET.conns.delete(id);
}

export function leave() {
  for (const c of NET.conns.values()) c.close();
  NET.conns.clear();
  NET.peer?.destroy();
  NET.peer = null;
  NET.role = "solo"; NET.code = ""; NET.me = "host";
}
