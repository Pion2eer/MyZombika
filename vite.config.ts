import { defineConfig, type Plugin } from "vite";
// @ts-ignore — типов Node в проекте нет, а в сборке модуль есть
import { readFileSync } from "node:fs";

// номер версии (package.json) и дата сборки — показываются под главным меню
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0");
const BUILT = `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;

// Сборка в один файл MyZombika.html: скрипт и картинки внутри, без type="module",
// чтобы игра открывалась двойным кликом прямо с диска (file://), без Node и сервера.
function singleFile(): Plugin {
  return {
    name: "single-file",
    enforce: "post",
    generateBundle(_o, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let src = String(html.source);
      for (const [name, f] of Object.entries(bundle)) {
        if (f.type !== "chunk") continue;
        const tag = new RegExp(`<script[^>]*src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
        src = src.replace(tag, "");
        // скрипт в конец body, обычный (не модуль)
        src = src.replace("</body>", () => `<script>\n${f.code.replace(/<\/script/g, "<\\/script")}\n</script>\n</body>`);
        delete bundle[name];
      }
      html.source = src;
      html.fileName = "MyZombika.html";
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __VERSION__: JSON.stringify(VERSION), __BUILT__: JSON.stringify(BUILT) },
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
  plugins: [singleFile()],
  server: { port: 5174 },
});
