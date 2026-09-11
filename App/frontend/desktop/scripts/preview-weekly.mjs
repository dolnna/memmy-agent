import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createServer, loadConfigFromFile } from "vite";
import { generateWeeklyRecap } from "./generate-weekly-recap.mjs";

let generationInFlight = false;

// Serve the interaction preview without the application API proxy or live reload.
const root = fileURLToPath(new URL("../", import.meta.url));
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "test" },
  fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
);
if (!loaded) throw new Error("Could not load the desktop Vite configuration.");
const server = await createServer({
  ...loaded.config,
  configFile: false,
  root,
  mode: "test",
  plugins: [...(loaded.config.plugins?.filter(
    (plugin) => plugin?.name !== "memmy-runtime-config-dev",
  ) ?? []), {
    name: "weekly-private-preview-data",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?")[0];
        if (pathname === "/__weekly_preview/generate") {
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          if (request.method !== "POST") {
            response.statusCode = 405;
            return response.end(JSON.stringify({ error: "method_not_allowed" }));
          }
          if (generationInFlight) {
            response.statusCode = 409;
            return response.end(JSON.stringify({ message: "已有一份回顾正在生成，请稍等。" }));
          }
          generationInFlight = true;
          try {
            const body = await readRequestJson(request, 24_000);
            const result = await generateWeeklyRecap({
              range: body.range,
              prompt: body.prompt,
              reportPath: process.env.MEMMY_WEEKLY_PREVIEW_REPORT_PATH,
              configPath: process.env.MEMMY_WEEKLY_BASE_CONFIG_PATH,
              cliPath: process.env.MEMMY_WEEKLY_CLI_PATH,
            });
            response.end(JSON.stringify(result));
          } catch (error) {
            response.statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
            response.end(JSON.stringify({ message: error instanceof Error ? error.message : "生成失败，请重试。" }));
          } finally {
            generationInFlight = false;
          }
          return;
        }
        if (pathname !== "/__weekly_preview/report") return next();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method !== "GET") {
          response.statusCode = 405;
          return response.end(JSON.stringify({ error: "method_not_allowed" }));
        }
        const reportPath = process.env.MEMMY_WEEKLY_PREVIEW_REPORT_PATH;
        if (!reportPath) {
          response.statusCode = 404;
          return response.end(JSON.stringify({ error: "report_not_configured" }));
        }
        try {
          const content = await readFile(reportPath, "utf8");
          JSON.parse(content);
          response.end(content);
        } catch {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "report_not_ready" }));
        }
      });
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 19030,
    strictPort: true,
    hmr: false,
  },
});
await server.listen();
console.log("Memory weekly preview: http://127.0.0.1:19030/?preview=memory-weekly");

async function readRequestJson(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("请求内容过长。"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求内容格式无效。"), { statusCode: 400 });
  }
}
