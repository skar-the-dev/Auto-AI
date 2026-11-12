
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function getPlatforms(value) {
  try {
    const result = typeof value === "string"
      ? JSON.parse(value)
      : value;

    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function formatAccount(account) {
  return {
    ...account,
    platforms: getPlatforms(account.platforms),
    active: Boolean(account.active)
  };
}

export async function onRequest({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        error: "Database binding DB is missing."
      }, 500);
    }

    const method = request.method;
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    // GET: Load all accounts
    if (method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM accounts ORDER BY created_at DESC"
      ).all();

      return json({
        success: true,
        accounts: (result.results || []).map(formatAccount)
      });
    }

    // POST: Create a new account
    if (method === "POST") {
      const body = await request.json();

      const name = String(body.name || "").trim();
      const niche = String(body.niche || "").trim();
      const interval = Number(body.interval_minutes || 240);
      const platforms = getPlatforms(body.platforms);

      if (!name || !niche) {
        return json({
          success: false,
          error: "Account name and niche are required."
        }, 400);
      }

      if (
        !Number.isInteger(interval) ||
        interval < 60 ||
        interval > 10080
      ) {
        return json({
          success: false,
          error: "Interval must be between 60 and 10080 minutes."
        }, 400);
      }

      if (
        !platforms.length ||
        platforms.some(p => !["youtube", "tiktok"].includes(p))
      ) {
        return json({
          success: false,
          error: "Choose YouTube Shorts, TikTok, or both."
        }, 400);
      }

      const newId = crypto.randomUUID();

      await env.DB.prepare(`
        INSERT INTO accounts
        (id, name, niche, platforms, interval_minutes, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(
        newId,
        name,
        niche,
        JSON.stringify(platforms),
        interval
      ).run();

      return json({
        success: true,
        id: newId,
        message: "Account created."
      }, 201);
    }

    // PATCH: Edit, pause or resume an account
    if (method === "PATCH") {
      if (!id) {
        return json({
          success: false,
          error: "Account ID is required."
        }, 400);
      }

      const body = await request.json();

      const existing = await env.DB.prepare(
        "SELECT * FROM accounts WHERE id = ?"
      ).bind(id).first();

      if (!existing) {
        return json({
          success: false,
          error: "Account not found."
        }, 404);
      }

      const name = body.name !== undefined
        ? String(body.name).trim()
        : existing.name;

      const niche = body.niche !== undefined
        ? String(body.niche).trim()
        : existing.niche;

      const interval = body.interval_minutes !== undefined
        ? Number(body.interval_minutes)
        : existing.interval_minutes;

      const platforms = body.platforms !== undefined
        ? getPlatforms(body.platforms)
        : getPlatforms(existing.platforms);

      const active = body.active !== undefined
        ? (body.active ? 1 : 0)
        : existing.active;

      if (!name || !niche) {
        return json({
          success: false,
          error: "Account name and niche are required."
        }, 400);
      }

      if (
        !Number.isInteger(interval) ||
        interval < 60 ||
        interval > 10080
      ) {
        return json({
          success: false,
          error: "Invalid publishing interval."
        }, 400);
      }

      if (
        !platforms.length ||
        platforms.some(p => !["youtube", "tiktok"].includes(p))
      ) {
        return json({
          success: false,
          error: "Invalid platform selection."
        }, 400);
      }

      await env.DB.prepare(`
        UPDATE accounts
        SET name = ?,
            niche = ?,
            platforms = ?,
            interval_minutes = ?,
            active = ?
        WHERE id = ?
      `).bind(
        name,
        niche,
        JSON.stringify(platforms),
        interval,
        active,
        id
      ).run();

      return json({
        success: true,
        message: "Account updated."
      });
    }

    // DELETE: Remove an account
    if (method === "DELETE") {
      if (!id) {
        return json({
          success: false,
          error: "Account ID is required."
        }, 400);
      }

      const result = await env.DB.prepare(
        "DELETE FROM accounts WHERE id = ?"
      ).bind(id).run();

      if (!result.meta?.changes) {
        return json({
          success: false,
          error: "Account not found."
        }, 404);
      }

      return json({
        success: true,
        message: "Account deleted."
      });
    }

    return json({
      success: false,
      error: "Method not allowed."
    }, 405);

  } catch (error) {
    return json({
      success: false,
      error: error.message || "Server error."
    }, 500);
  }
}
