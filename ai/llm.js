// Optional plain-English audit summary via OpenRouter. Graceful fallback to a deterministic template
// if no OPENROUTER_API_KEY, timeout, or API error. The LLM only explains; it never changes the score/decision.
function template(ai) {
  const bad = ai.findings.filter(f => f.severity !== "ok").map(f => f.msg);
  return `Decision: ${ai.decision} (risk ${ai.riskScore}/100). ` + (bad.length ? `Main concerns: ${bad.slice(0, 3).join("; ")}.` : "No material concerns: meter data, satellite sunlight and the ML model all agree.") +
    (ai.expectedTonnes != null ? ` Data supports about ${ai.expectedTonnes} tCO2e.` : "");
}
const cache = new Map();
async function summarize(ai, { key = process.env.OPENROUTER_API_KEY, model = process.env.LLM_MODEL || "deepseek/deepseek-chat", timeoutMs = 15000 } = {}) {
  const fallback = { source: "template", text: template(ai) };
  if (!key) return fallback;
  const facts = JSON.stringify({ decision: ai.decision, riskScore: ai.riskScore, expectedTonnes: ai.expectedTonnes, findings: ai.findings.map(f => `${f.severity}: ${f.msg}`), ml: ai.ml && { score: ai.ml.score, threshold: ai.ml.threshold, outside: ai.ml.reasons.filter(r => r.outside).map(r => r.label) } });
  if (cache.has(facts)) return cache.get(facts);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 220, temperature: 0.2, messages: [
        { role: "system", content: "You are a carbon-credit auditor. Write a 3-4 sentence plain-English audit summary for a non-expert buyer. Use ONLY the facts given; do not invent numbers; do not change the decision." },
        { role: "user", content: facts }] }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = (await r.json()).choices?.[0]?.message?.content?.trim(); if (!text) throw new Error("empty");
    const out = { source: `LLM (${model} via OpenRouter)`, text }; cache.set(facts, out); return out;
  } catch (e) { return { ...fallback, note: "LLM unavailable: " + e.message }; }
}
module.exports = { summarize, template };
