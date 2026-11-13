function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function parseModelJson(result) {
  const candidates = [
    result?.choices?.[0]?.message?.content,
    result?.result?.choices?.[0]?.message?.content,
    result?.response,
    result?.result?.response,
    result?.output_text,
    result?.text,
    result?.content
  ];
  let raw = candidates.find(value => typeof value === "string" && value.trim()) || "";
  if (!raw && result && typeof result === "object") {
    const queue = [result];
    const seen = new Set();
    while (queue.length && !raw) {
      const item = queue.shift();
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      for (const value of Object.values(item)) {
        if (typeof value === "string" && value.trim()) { raw = value; break; }
        if (value && typeof value === "object") queue.push(value);
      }
    }
  }
  const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  throw new Error("The video script response was not valid JSON.");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) return json({ success: false, error: "Workers AI binding is not available." }, 500);
    const body = await request.json();
    const question = String(body.question || "").trim().slice(0, 500);
    const answer = String(body.answer || "").trim().slice(0, 10000);
    const sources = Array.isArray(body.sources) ? body.sources.slice(0, 12).map((source, i) => ({
      number: Number(source.number) || i + 1,
      title: String(source.title || "").slice(0, 240),
      url: String(source.url || "").slice(0, 1000),
      extract: String(source.extract || "").slice(0, 1800)
    })) : [];
    const confidence = ["high", "medium", "low"].includes(body.confidence) ? body.confidence : "low";
    if (!question || !answer) return json({ success: false, error: "A research question and answer are required." }, 400);

    const sourceText = sources.map(source =>
      "[" + source.number + "] " + source.title + "\n" + source.url + "\n" + source.extract
    ).join("\n\n");
    const prompt = `Turn the supplied research answer into an engaging 25–35 second vertical short-form video script.
QUESTION: ${question}
RESEARCH CONFIDENCE: ${confidence}
RESEARCH ANSWER (the only factual basis):
${answer}
SOURCES:
${sourceText || "No source details supplied."}

Rules:
- Keep every factual claim faithful to the research answer. Do not add facts, dates, names, numbers, rankings, quotes or events.
- If confidence is LOW, clearly frame the clip as a provisional summary and include a brief on-screen/voiceover caveat. Do not present disputed claims as verified.
- Make a strong first-2-second hook, a clear middle, and a memorable ending.
- Create exactly five scenes with time, visual, text. Times: 0–3 sec, 3–10 sec, 10–20 sec, 20–27 sec, 27–30 sec.
- Voiceover should be natural spoken English, about 65–85 words.
- Make visuals practical descriptions for a vertical video; do not imply licensed footage exists. Suggest original generated visuals or simple motion graphics.
- Caption should include a concise summary and a note to check sources where appropriate.
- Return ONLY JSON with keys title, hook, voiceover, scenes, caption, production_notes.
`;
    const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [
        { role: "system", content: "You are Auto AI's research-to-video scriptwriter. Preserve evidence exactly and never invent factual details. Return valid JSON only." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: 1800,
      temperature: 0.15,
      response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false }
    });
    const script = parseModelJson(result);
    if (!script.title || !script.voiceover || !Array.isArray(script.scenes) || !script.scenes.length) {
      throw new Error("The generated video script is incomplete.");
    }
    script.scenes = script.scenes.slice(0, 5).map((scene, index) => ({
      time: String(scene.time || ["0–3 sec", "3–10 sec", "10–20 sec", "20–27 sec", "27–30 sec"][index]),
      visual: String(scene.visual || "Original motion graphic").slice(0, 500),
      text: String(scene.text || "").slice(0, 240)
    }));
    script.sources = sources.map(({number,title,url}) => ({number,title,url}));
    script.research_question = question;
    script.research_confidence = confidence;
    script.fact_check_status = confidence === "low" ? "needs_review" : "research_linked_unverified";
    script.disclosure = "Generated from the linked research answer. Claims still require checking against the original sources before publication.";
    script.video_style = "research";
    return json({ success: true, script, message: "Research-based video script created. Review it before rendering or publishing." });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not create a video script from this research." }, 500);
  }
}
