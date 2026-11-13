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
      CREATE TABLE IF NOT EXISTS production_jobs (
        id TEXT PRIMARY KEY,
        script_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Waiting for renderer',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    if (request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT production_jobs.id, production_jobs.script_id,
               production_jobs.status, production_jobs.created_at,
               scripts.title, scripts.niche, scripts.topic
        FROM production_jobs
        LEFT JOIN scripts ON scripts.id = production_jobs.script_id
        ORDER BY production_jobs.created_at DESC
      `).all();
      return json({ success: true, jobs: result.results || [] });
    }

    if (request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ success: false, error: "Production job ID is required." }, 400);
      const result = await env.DB.prepare(
        "DELETE FROM production_jobs WHERE id = ?"
      ).bind(id).run();
      if (!result.meta?.changes) return json({ success: false, error: "Queue item not found." }, 404);
      return json({ success: true, message: "Removed from production progress. The saved script remains in Video Library." });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const scriptId = String(body.script_id || "").trim();
      if (!scriptId) return json({ success: false, error: "Script ID is required." }, 400);

      const script = await env.DB.prepare(
        "SELECT id FROM scripts WHERE id = ?"
      ).bind(scriptId).first();
      if (!script) return json({ success: false, error: "Saved script not found." }, 404);

      const duplicate = await env.DB.prepare(
        "SELECT id FROM production_jobs WHERE script_id = ? AND status = 'Waiting for renderer'"
      ).bind(scriptId).first();
      if (duplicate) return json({ success: true, id: duplicate.id, message: "This script is already waiting in the production queue." });

      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO production_jobs (id, script_id, status) VALUES (?, ?, 'Waiting for renderer')"
      ).bind(id, scriptId).run();

      return json({
        success: true,
        id,
        status: "Waiting for renderer",
        message: "Added to the production queue. Video rendering is not connected yet."
      }, 201);
    }

    return json({ success: false, error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ success: false, error: error.message || "Server error." }, 500);
  }
}
