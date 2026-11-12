
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM accounts ORDER BY created_at DESC"
    ).all();

    const accounts = (result.results || []).map(account => ({
      ...account,
      platforms: JSON.parse(account.platforms || "[]"),
      active: Boolean(account.active)
    }));

    return json({ success: true, accounts });
  } catch (error) {
    return json({ success: false, error: error.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const niche = String(body.niche || "").trim();
    const platforms = body.platforms;
    const interval = Number(body.interval_minutes || 240);

    if (!name || !niche || !Array.isArray(platforms)) {
      return json({
        success: false,
        error: "Name, niche and platforms are required."
      }, 400);
    }

    if (!Number.isInteger(interval) || interval < 15 || interval > 10080) {
      return json({
        success: false,
        error: "Interval must be between 15 and 10080 minutes."
      }, 400);
    }

    const id = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO accounts
       (id, name, niche, platforms, interval_minutes, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(
      id,
      name,
      niche,
      JSON.stringify(platforms),
      interval
    ).run();

    return json({ success: true, id }, 201);
  } catch (error) {
    return json({ success: false, error: error.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return json({ success: false, error: "Account ID required." }, 400);
    }

    await env.DB.prepare(
      "DELETE FROM accounts WHERE id = ?"
    ).bind(id).run();

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: error.message }, 500);
  }
}

