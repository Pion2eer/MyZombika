import { defineConfig, type Plugin } from "vite";

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
  build: {
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
  plugins: [singleFile()],
  server: { port: 5174 },
});
