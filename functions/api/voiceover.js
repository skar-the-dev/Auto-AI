function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

const SPEAKERS = new Set([
  "amalthea", "andromeda", "apollo", "arcas", "aries", "asteria",
  "athena", "atlas", "aurora", "callista", "cora", "cordelia",
  "delia", "draco", "electra", "harmonia", "helena", "hera",
  "hermes", "hyperion", "iris", "janus", "juno", "jupiter",
  "luna", "mars", "minerva", "neptune", "odysseus", "ophelia",
  "orion", "orpheus", "pandora", "phoebe", "pluto", "saturn",
  "thalia", "theia", "vesta", "zeus"
]);

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI || typeof env.AI.run !== "function") {
      return json({ success: false, error: "Workers AI binding AI is missing. Check the Cloudflare Pages AI binding and redeploy." }, 503);
    }

    const body = await request.json();
    const text = String(body.text || "").trim();
    const speaker = String(body.speaker || "luna").toLowerCase();

    if (text.length < 10) return json({ success: false, error: "Choose a saved script with at least 10 characters of voiceover text." }, 400);
    if (text.length > 4000) return json({ success: false, error: "Voiceover text is too long. Keep it under 4,000 characters." }, 400);
    if (!SPEAKERS.has(speaker)) return json({ success: false, error: "Choose a supported voice." }, 400);

    const audio = await env.AI.run("@cf/deepgram/aura-2-en", {
      text,
      speaker,
      encoding: "mp3"
    });

    if (!audio) return json({ success: false, error: "The voice model returned no audio. Please try again." }, 502);

    if (audio instanceof ReadableStream) {
      return new Response(audio, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": 'inline; filename="auto-ai-voiceover.mp3"',
          "Cache-Control": "no-store"
        }
      });
    }

    if (audio.audio instanceof ReadableStream) {
      return new Response(audio.audio, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
      });
    }

    if (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) {
      return new Response(audio, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
      });
    }

    return json({ success: false, error: "The voice model returned an unsupported audio format." }, 502);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not generate the AI voiceover." }, 500);
  }
}
