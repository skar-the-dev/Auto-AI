function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function authorised(request, env) {
  const expected = env.AUTO_AI_ADMIN_KEY || "";
  const supplied = request.headers.get("x-auto-ai-admin-key") || "";
  return Boolean(expected && supplied && supplied === expected);
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS clip_sources (
      id TEXT PRIMARY KEY,
      script_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      creator TEXT,
      title TEXT,
      rights_status TEXT NOT NULL DEFAULT 'Needs permission',
      rights_note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function onRequest({ request, env }) {
  try {
    if (!authorised(request, env)) return json({ success: false, error: "Enter the Auto AI admin key to manage source records." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    await ensureTable(env.DB);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const scriptId = String(url.searchParams.get("script_id") || "").trim();
      if (!scriptId) return json({ success: false, error: "Choose a saved script." }, 400);
      const result = await env.DB.prepare("SELECT * FROM clip_sources WHERE script_id = ? ORDER BY created_at DESC").bind(scriptId).all();
      return json({ success: true, sources: result.results || [] });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const scriptId = String(body.script_id || "").trim();
      const platform = String(body.platform || "").trim().toLowerCase();
      const sourceUrl = String(body.url || "").trim();
      const creator = String(body.creator || "").trim().slice(0, 160);
      const title = String(body.title || "").trim().slice(0, 240);
      const rightsStatus = String(body.rights_status || "Needs permission");
      const rightsNote = String(body.rights_note || "").trim().slice(0, 1000);
      const allowedPlatforms = ["youtube", "tiktok", "twitch", "google", "other"];
      const allowedRights = ["Permission confirmed", "Creative Commons", "Public domain", "Needs permission", "Unknown"];
      if (!scriptId || !allowedPlatforms.includes(platform) || !allowedRights.includes(rightsStatus)) return json({ success: false, error: "Choose a script, valid platform and rights status." }, 400);
      let parsed;
      try { parsed = new URL(sourceUrl); } catch { return json({ success: false, error: "Enter a valid source URL." }, 400); }
      if (!["http:", "https:"].includes(parsed.protocol)) return json({ success: false, error: "Only HTTP and HTTPS source links are accepted." }, 400);
      const script = await env.DB.prepare("SELECT id FROM scripts WHERE id = ?").bind(scriptId).first();
      if (!script) return json({ success: false, error: "Saved script not found." }, 404);
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO clip_sources (id, script_id, platform, url, creator, title, rights_status, rights_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, scriptId, platform, parsed.toString(), creator, title, rightsStatus, rightsNote).run();
      return json({ success: true, id, message: "Source saved. Its credit will be added to the selected video's description." }, 201);
    }

    if (request.method === "DELETE") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return json({ success: false, error: "Source ID is required." }, 400);
      const result = await env.DB.prepare("DELETE FROM clip_sources WHERE id = ?").bind(id).run();
      if (!result.meta?.changes) return json({ success: false, error: "Source not found." }, 404);
      return json({ success: true });
    }
    return json({ success: false, error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not manage clip sources." }, 500);
  }
}
