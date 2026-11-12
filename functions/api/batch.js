import { buildScript } from "./ideas.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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

    const created = [];
    for (let i = 0; i < count; i++) {
      const angle = angles[i];
      const scriptTopic = count === 1 ? topic : topic + " — " + angle;
      const script = buildScript(account.niche, scriptTopic, i % 2 === 0 ? "curiosity" : "facts");
      const id = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO scripts (id, title, niche, topic, content_json, status)
        VALUES (?, ?, ?, ?, ?, 'Draft')
      `).bind(id, script.title, account.niche, scriptTopic, JSON.stringify({
        ...script,
        disclosure: "Template-based draft only. This is not AI research or a rendered video. Verify factual claims and replace generic lines before publishing."
      })).run();
      created.push({ id, title: script.title, topic: scriptTopic });
    }

    return json({
      success: true,
      account: account.name,
      created,
      count: created.length,
      message: created.length + " script drafts saved. Video rendering is not connected yet."
    }, 201);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not create batch." }, 500);
  }
}
