import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ProxyOptions } from "vite";

export function validateLocalRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (host !== "127.0.0.1:3889" && host !== "localhost:3889") return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return ["GET", "HEAD", "OPTIONS"].includes(req.method ?? "") || origin === `http://${host}`;
}

// Local dev/preview BFF, never an arbitrary URL proxy. Production uses Atlas's
// own /api reverse proxy and serves dist alongside the web application.
export const atlasProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: "http://127.0.0.1:3001", changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (request) => {
        // The middleware has already validated the browser's actual origin.
        request.setHeader("origin", "http://127.0.0.1:3001");
      });
    },
  },
};

export function localAtlasGuard(): Plugin {
  const guard = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api")) { next(); return; }
    if (!validateLocalRequest(req)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ message: "不允许跨站访问 Atlas 本地加载项接口" }));
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  return { name: "atlas-local-api-guard", configureServer(server) { server.middlewares.use(guard); }, configurePreviewServer(server) { server.middlewares.use(guard); } };
}
