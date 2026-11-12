import { generateScript } from "./ideas.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const angles = [
  "The surprising basics",
  "What beginners often miss",
  "Three things worth knowing",
  "A common myth explained",
  "The detail that changes everything",
  "A quick beginner's guide"
];

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.AI) return json({ success: false, error: "Workers AI binding AI is missing. Check the binding and redeploy." }, 500);

    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    const topic = String(body.topic || "").trim().slice(0, 180);
    const count = Number(body.count);

    if (!accountId) return json({ success: false, error: "Choose an account." }, 400);
    if (!topic) return json({ success: false, error: "Enter a batch topic." }, 400);
    if (!Number.isInteger(count) || count < 1 || count > 6) {
      return json({ success: false, error: "Batch size must be between 1 and 6." }, 400);
    }

    const account = await env.DB.prepare(
      "SELECT id, name, niche FROM accounts WHERE id = ? AND active = 1"
    ).bind(accountId).first();
    if (!account) return json({ success: false, error: "Active account not found. Resume it and try again." }, 404);

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

    // Generate the complete batch before saving, so a model error does not leave a half-finished batch.
    const drafts = [];
    for (let i = 0; i < count; i++) {
      const scriptTopic = count === 1 ? topic : `${topic} — ${angles[i]}`;
      const allowedStyles = new Set(["curiosity", "facts", "story", "list", "gaming", "reddit_story", "motivation", "cinematic", "mystery"]);
      const requestedStyle = Array.isArray(body.styles) ? String(body.styles[i] || "") : "";
      const style = allowedStyles.has(requestedStyle) ? requestedStyle : (i % 2 === 0 ? "curiosity" : "facts");
      const script = await generateScript(env, account.niche, scriptTopic, style);
      script.video_style = style;
      drafts.push({ id: crypto.randomUUID(), topic: scriptTopic, script });
    }

    const created = [];
    for (const draft of drafts) {
      await env.DB.prepare(`
        INSERT INTO scripts (id, title, niche, topic, content_json, status)
        VALUES (?, ?, ?, ?, ?, 'Draft')
      `).bind(draft.id, draft.script.title, account.niche, draft.topic, JSON.stringify(draft.script)).run();
      created.push({ id: draft.id, title: draft.script.title, topic: draft.topic });
    }

    return json({
      success: true,
      account: account.name,
      created,
      count: created.length,
      generated_by: "Cloudflare Workers AI",
      message: created.length + " AI-generated script drafts saved. Review factual claims before publishing."
    }, 201);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not create AI batch." }, 500);
  }
}
