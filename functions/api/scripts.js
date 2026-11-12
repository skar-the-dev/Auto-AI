function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequest({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        niche TEXT NOT NULL,
        topic TEXT NOT NULL,
        content_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM scripts ORDER BY created_at DESC"
      ).all();
      return json({
        success: true,
        scripts: (result.results || []).map(row => ({
          ...row,
          script: JSON.parse(row.content_json)
        }))
      });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const script = body.script;
      const title = String(body.title || "").trim().slice(0, 240);
      const niche = String(body.niche || "").trim().slice(0, 160);
      const topic = String(body.topic || "").trim().slice(0, 240);

      if (!script || !title || !niche || !topic) {
        return json({ success: false, error: "A complete script, title, niche and topic are required." }, 400);
      }

      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO scripts (id, title, niche, topic, content_json, status)
        VALUES (?, ?, ?, ?, ?, 'Draft')
      `).bind(newId, title, niche, topic, JSON.stringify(script)).run();

      return json({ success: true, id: newId, message: "Script saved to your library." }, 201);
    }

    if (request.method === "PATCH") {
      if (!id) return json({ success: false, error: "Script ID is required." }, 400);
      const body = await request.json();
      const status = String(body.status || "");
      if (!["Draft", "Ready for production", "Completed"].includes(status)) {
        return json({ success: false, error: "Choose a valid script status." }, 400);
      }
      const result = await env.DB.prepare(
        "UPDATE scripts SET status = ? WHERE id = ?"
      ).bind(status, id).run();
      if (!result.meta?.changes) return json({ success: false, error: "Script not found." }, 404);
      return json({ success: true, message: "Script status updated." });
    }

    if (request.method === "DELETE") {
      if (!id) return json({ success: false, error: "Script ID is required." }, 400);
      const result = await env.DB.prepare(
        "DELETE FROM scripts WHERE id = ?"
      ).bind(id).run();
      if (!result.meta?.changes) return json({ success: false, error: "Script not found." }, 404);
      return json({ success: true, message: "Script deleted." });
    }

    return json({ success: false, error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ success: false, error: error.message || "Server error." }, 500);
  }
}
