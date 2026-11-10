import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const project = "https://tfuiwogiwbvqxfqktnwe.supabase.co";
const properties = await readFile(new URL("../local.properties", import.meta.url), "utf8")
  .catch(() => "");
const configuredKey = process.env.SUPABASE_PUBLISHABLE_KEY
  || properties.match(/^SUPABASE_PUBLISHABLE_KEY\s*=\s*(\S+)\s*$/m)?.[1];
const key = /^sb_publishable_[\w-]+$/.test(configuredKey || "") ? configuredKey : null;
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.mjs": ["app.mjs", "text/javascript; charset=utf-8"],
  "/survey.mjs": ["survey.mjs", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/field-theme.css": ["../app/src/main/assets/field-theme.css", "text/css; charset=utf-8"],
};

const server = createServer(async (request, response) => {
  if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${project}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`);
  const pathname = request.url?.split("?")[0];
  if (request.method !== "GET" || !pathname) {
    response.writeHead(405).end();
    return;
  }
  if (pathname === "/config.json") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ project, key }));
    return;
  }
  if (!Object.hasOwn(files, pathname)) {
    response.writeHead(404).end();
    return;
  }
  const [file, type] = files[pathname];
  try {
    const body = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    response.writeHead(500).end("Arquivo do painel indisponível.");
  }
});

const port = Number(process.env.LANDMENSURE_DESKTOP_PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Painel Landmensure: ${url}`);
  if (process.platform === "win32" && process.argv.includes("--open")) {
    const browser = spawn("explorer.exe", [url], { stdio: "ignore", windowsHide: true });
    browser.on("error", () => console.log("Abra o endereço acima no navegador."));
  }
});
