import { json, requireAdmin } from "../_shared/youtube.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.VIDEO_RENDERER_URL || !env.VIDEO_RENDERER_KEY) {
      return json({ success: false, error: "Cloud renderer is not deployed or its VIDEO_RENDERER_URL / VIDEO_RENDERER_KEY secrets are missing." }, 503);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 22 * 1024 * 1024) return json({ success: false, error: "Render request is too large. Keep voiceover audio and generated scene images within the 22 MB limit." }, 413);
    const body = await request.json();
    if (!Array.isArray(body.scenes) || !body.scenes.length || typeof body.audio_base64 !== "string") {
      return json({ success: false, error: "A scene list and generated voiceover audio are required." }, 400);
    }
    const url = new URL("/render", env.VIDEO_RENDERER_URL).toString();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-renderer-key": env.VIDEO_RENDERER_KEY },
      body: JSON.stringify({
        title: String(body.title || "Auto AI video").slice(0, 100),
        scenes: body.scenes.slice(0, 8).map(scene => typeof scene === "string" ? scene.slice(0, 260) : ({ visual: String(scene.visual || "").slice(0, 260), text: String(scene.text || "").slice(0, 180) })),
        scene_images: Array.isArray(body.scene_images) ? body.scene_images.slice(0, 8).map(image => String(image).slice(0, 6000000)) : [],
        audio_base64: body.audio_base64
      })
    });
    if (!response.ok) {
      const raw = await response.text();
      let message = raw;
      try { message = JSON.parse(raw).error || raw; } catch {}
      return json({ success: false, error: message.slice(0, 1200) || "Cloud renderer failed." }, response.status);
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="auto-ai-render.mp4"',
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return json({ success: false, error: error.message || "Cloud rendering failed." }, 500);
  }
}
