import { Container, getContainer } from "@cloudflare/containers";

export class VideoRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "auto-ai-renderer" });
    if (url.pathname !== "/render" || request.method !== "POST") return Response.json({ error: "Not found" }, { status: 404 });
    const expected = env.RENDERER_API_KEY || "";
    const supplied = request.headers.get("x-renderer-key") || "";
    if (!expected || supplied !== expected) return Response.json({ error: "Renderer access denied." }, { status: 401 });
    const instance = getContainer(env.VIDEO_RENDERER, "auto-ai-shared-renderer");
    return instance.fetch(request);
  }
};
