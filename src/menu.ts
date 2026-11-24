// Главный экран: выбор режима, игра с другом, настройки, «как играть». Обычный HTML поверх игры
// (за ним видно живой мир). Настройки хранятся в localStorage.
import { LANGS, deviceLang, setLang, getLang, t, type Lang } from "./i18n";

export type Quality = "low" | "med" | "high";
export type DayNight = "cycle" | "day" | "night";
const KEY = "myzombika-settings";
declare const __VERSION__: string, __BUILT__: string;
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches);

export const settings = {
  lang: deviceLang() as Lang,
  name: "",
  volume: 0.9,
  mute: false,
  quality: (mobile ? "med" : "high") as Quality,
  daynight: "cycle" as DayNight,
  shake: true,
  aim: true,
  fs: true,
  save() {
    const { save: _s, ...data } = settings; void _s;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* нет хранилища */ }
  },
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* испорчено — по умолчанию */ }
if (!(settings.lang in LANGS)) settings.lang = deviceLang();
setLang(settings.lang);

export interface MenuActions { waves(): void; host(): void; join(code: string): void; changed(): void }

let root: HTMLDivElement | null = null;
let page: "main" | "coop" | "settings" | "howto" = "main";
let acts: MenuActions | null = null;
let joinCode = "";

export const menuOpen = () => !!root && root.style.display !== "none";

const CSS = `
.mz{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;overflow:auto;padding:16px;box-sizing:border-box;
 background:radial-gradient(ellipse at center,rgba(10,12,8,.35) 0%,rgba(10,12,8,.82) 75%);font:15px system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;color:#f2ead8;cursor:default;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.mz *{box-sizing:border-box}
.mz .box{width:min(440px,100%);margin:auto}
.mz h1{margin:0;text-align:center;font-size:clamp(40px,9vw,64px);font-weight:900;letter-spacing:1px;color:#ffe2a0;text-shadow:0 3px 0 #5a1a10,0 6px 18px rgba(0,0,0,.7)}
.mz h1 b{color:#c8f070;font-weight:900}
.mz .sub{text-align:center;color:#c8bfa8;margin:2px 0 18px;font-size:15px}
.mz h2{margin:0 0 12px;font-size:20px;color:#ffe2a0}
.mz .btn{display:block;width:100%;margin:0 0 10px;padding:13px 16px;border-radius:12px;border:2px solid rgba(255,226,160,.45);background:rgba(28,24,18,.92);color:#f2ead8;
 font:inherit;font-size:18px;font-weight:700;text-align:left;cursor:pointer}
.mz .btn.ico{display:flex;align-items:center;gap:12px}.mz .btn .ic{flex:none;width:30px;height:30px;color:#ffb060}.mz .btn .ic svg{display:block;width:100%;height:100%}.mz .btn.main .ic{color:#ffd8a0}.mz .btn .tx{flex:1;min-width:0}
.mz .btn small{display:block;font-size:13px;font-weight:500;color:#b8ae96;margin-top:2px}
.mz .btn:hover,.mz .btn:focus-visible{border-color:#ffe2a0;background:rgba(58,46,24,.95);outline:none}
.mz .btn.main{background:linear-gradient(#6a2a18,#4a1a10);border-color:#ff9a60}
.mz .btn.main:hover{background:linear-gradient(#7e3420,#5a2014)}
.mz .btn[disabled]{opacity:.55;cursor:default}
.mz .btn .tag{float:right;font-size:12px;font-weight:700;color:#14110d;background:#c8bfa8;border-radius:6px;padding:2px 6px;margin-top:3px}
.mz [dir=rtl] .btn,.mz[dir=rtl] .btn{text-align:right}.mz[dir=rtl] .btn .tag{float:left}
.mz .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mz .row2 .btn{text-align:center}.mz .join .btn.ico{gap:6px}.mz .join .btn .ic{width:20px;height:20px}
.mz .card{background:rgba(28,24,18,.94);border:2px solid rgba(255,226,160,.35);border-radius:14px;padding:16px}
.mz label.f{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.mz label.f:last-of-type{border-bottom:0}
.mz select,.mz input[type=text]{font:inherit;color:#f2ead8;background:#14110d;border:1px solid #5a5040;border-radius:8px;padding:7px 9px;min-width:0;max-width:60%}
.mz input[type=text]{width:100%;max-width:none}
.mz input[type=range]{width:50%;accent-color:#ffb060}
.mz input[type=checkbox]{width:22px;height:22px;accent-color:#ffb060}
.mz .join{display:flex;gap:8px;margin-bottom:10px}.mz .join input{flex:1}.mz .join .btn{width:auto;margin:0;text-align:center}
.mz p{margin:0 0 10px;line-height:1.45;color:#ddd3bc}
.mz .ver{text-align:center;color:#7a705c;font-size:12px;margin-top:8px}
@media (max-height:520px){.mz h1{font-size:38px}.mz .sub{margin-bottom:10px}.mz .btn{padding:9px 12px;font-size:16px;margin-bottom:8px}.mz .btn small{display:none}
 .mz .box.wide{width:min(720px,100%)}.mz .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}
// пиктограммы пунктов меню (линии 24×24, цвет — от кнопки)
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  // череп: волны зомби
  waves: svg('<path d="M12 3c-4.4 0-8 3.1-8 7.2 0 2.4 1.2 4.3 3 5.5V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.3c1.8-1.2 3-3.1 3-5.5C20 6.1 16.4 3 12 3z"/><circle cx="9" cy="11" r="1.6" fill="currentColor"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/><path d="M10 20v-2.5M14 20v-2.5M12 14.5l-.8 1.5h1.6z"/>'),
  // карта с маршрутом: сюжет
  story: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  // двое: игра с другом
  coop: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.1c2.6.3 4.5 2.6 4.5 5.4"/>'),
  // шестерёнка: настройки
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  // вопрос в круге: как играть
  howto: svg('<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/>'),
  // плюс: создать игру
  create: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  // вход в дверь: войти к другу
  join: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l4-4-4-4M14 12H4"/>'),
  // стрелка назад
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
};
type Icon = keyof typeof ICON;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render() {
  if (!root || !acts) return;
  const a = acts;
  root.dir = getLang() === "ar" ? "rtl" : "ltr";
  root.innerHTML = "";
  const box = el("div", { class: "box" + (page === "main" ? " wide" : "") });
  root.appendChild(box);
  const btn = (html: string, fn: () => void, cls = "", ic?: Icon) => {
    const b = el("button", { class: "btn " + cls + (ic ? " ico" : ""), type: "button" }, ic ? `<i class="ic">${ICON[ic]}</i><span class="tx">${html}</span>` : html);
    b.onclick = fn; return b;
  };
  if (page === "main") {
    box.append(el("h1", {}, "My<b>Zombika</b>"), el("div", { class: "sub" }, esc(t("subtitle"))));
    const g = el("div", { class: "grid" });
    box.appendChild(g);
    if (joinCode) g.appendChild(btn(`${esc(t("m_join_friend", { c: joinCode }))}`, () => a.join(joinCode), "main", "join"));
    g.appendChild(btn(`${esc(t("m_waves"))}<small>${esc(t("m_waves_d"))}</small>`, () => a.waves(), joinCode ? "" : "main", "waves"));
    const st = btn(`<span class="tag">${esc(t("m_soon"))}</span>${esc(t("m_story"))}<small>${esc(t("m_story_d"))}</small>`, () => {}, "", "story");
    st.setAttribute("disabled", "");
    g.appendChild(st);
    g.appendChild(btn(esc(t("m_coop")), () => { page = "coop"; render(); }, "", "coop"));
    g.appendChild(btn(esc(t("m_settings")), () => { page = "settings"; render(); }, "", "settings"));
    g.appendChild(btn(esc(t("m_howto")), () => { page = "howto"; render(); }, "", "howto"));
  } else if (page === "coop") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_coop"))));
    c.appendChild(btn(esc(t("m_create")), () => a.host(), "main", "create"));
    const j = el("div", { class: "join" });
    const inp = el("input", { type: "text", placeholder: t("m_code_ph"), maxlength: "200", autocomplete: "off", autocapitalize: "characters" }) as HTMLInputElement;
    inp.value = joinCode;
    const go = () => { const v = inp.value.trim(); if (v) a.join(v); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") go(); };
    j.append(inp, btn(esc(t("m_join")), go, "", "join"));
    c.appendChild(j);
    c.appendChild(btn(esc(t("m_back")), () => { page = "main"; render(); }, "", "back"));
    box.appendChild(c);
  } else if (page === "settings") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_settings"))));
    const field = (label: string, input: HTMLElement) => { const l = el("label", { class: "f" }); l.append(el("span", {}, esc(label)), input); c.appendChild(l); return input; };
    const sel = (opts: [string, string][], val: string, on: (v: string) => void) => {
      const s = el("select") as HTMLSelectElement;
      for (const [v, n] of opts) { const o = el("option", { value: v }, esc(n)) as HTMLOptionElement; if (v === val) o.selected = true; s.appendChild(o); }
      s.onchange = () => { on(s.value); settings.save(); a.changed(); };
      return s;
    };
    const chk = (val: boolean, on: (v: boolean) => void) => { const i = el("input", { type: "checkbox" }) as HTMLInputElement; i.checked = val; i.onchange = () => { on(i.checked); settings.save(); a.changed(); }; return i; };
    const name = el("input", { type: "text", maxlength: "16", placeholder: `${t("player")} 1` }) as HTMLInputElement;
    name.value = settings.name;
    name.onkeydown = (e) => e.stopPropagation();
    name.oninput = () => { settings.name = name.value.replace(/[<>]/g, "").slice(0, 16); settings.save(); a.changed(); };
    field(t("s_name"), name);
    field(t("s_lang"), sel(Object.entries(LANGS), settings.lang, (v) => { settings.lang = v as Lang; setLang(settings.lang); settings.save(); a.changed(); render(); }));
    field(t("s_sound"), chk(!settings.mute, (v) => (settings.mute = !v)));
    const vol = el("input", { type: "range", min: "0", max: "1", step: "0.05" }) as HTMLInputElement;
    vol.value = String(settings.volume);
    vol.oninput = () => { settings.volume = Number(vol.value); settings.save(); a.changed(); };
    field(t("s_volume"), vol);
    field(t("s_quality"), sel([["low", t("q_low")], ["med", t("q_med")], ["high", t("q_high")]], settings.quality, (v) => (settings.quality = v as Quality)));
    field(t("s_daynight"), sel([["cycle", t("dn_cycle")], ["day", t("dn_day")], ["night", t("dn_night")]], settings.daynight, (v) => (settings.daynight = v as DayNight)));
    field(t("s_shake"), chk(settings.shake, (v) => (settings.shake = v)));
    field(t("s_aim"), chk(settings.aim, (v) => (settings.aim = v)));
    if (mobile) field(t("s_fs"), chk(settings.fs, (v) => (settings.fs = v)));
    const back = btn(esc(t("m_back")), () => { page = "main"; render(); }, "", "back");
    back.style.marginTop = "12px";
    c.appendChild(back);
    box.appendChild(c);
  } else {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_howto"))));
    for (const k of (mobile ? ["howto_touch", "howto_items"] : ["howto_pc", "howto_touch", "howto_items"]) as ("howto_pc" | "howto_touch" | "howto_items")[]) c.appendChild(el("p", {}, esc(t(k))));
    c.appendChild(btn(esc(t("m_back")), () => { page = "main"; render(); }, "", "back"));
    box.appendChild(c);
  }
  box.appendChild(el("div", { class: "ver" }, `v${__VERSION__} · ${__BUILT__} · myzombika.pion.ltd`));
}

export function openMenu(actions: MenuActions, code = "") {
  acts = actions; joinCode = code; page = "main";
  if (!root) {
    document.head.appendChild(el("style", {}, CSS));
    root = el("div", { class: "mz" }) as HTMLDivElement;
    // клики по меню не должны доходить до игры
    for (const ev of ["pointerdown", "mousedown", "touchstart", "wheel", "contextmenu"]) root.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(root);
  }
  root.style.display = "flex";
  render();
}
export function closeMenu() { if (root) root.style.display = "none"; }
