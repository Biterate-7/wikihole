// A local stand-in for the Anthropic Messages API, for exercising the reader's AI
// features without a key or cost. It builds schema-shaped answers from the request
// and copies real words from the supplied text, so the grounding checks still run.
// It says nothing about the quality of a real model's explanations.
//
//   node tests/support/stub-anthropic.mjs 4599
//   ANTHROPIC_BASE_URL=http://localhost:4599 AI_API_KEY=stub npm run start -- --port 3101
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4599);
let calls = 0;

function between(text, tag) {
  const match = text.match(new RegExp(`<${tag}[^>]*>\\n?([\\s\\S]*?)\\n?</${tag}>`));
  return match ? match[1] : "";
}

function quote(text) {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 8).join(" ");
}

function answer(body) {
  const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system);
  const content = body.messages[0].content;
  const source = between(content, "passage") || between(content, "selected_passage") || between(content, "section") || content;
  const properties = body.output_config?.format?.schema?.properties ?? {};
  const level = system.includes("twelve-year-old") ? "simple" : system.includes("student of this field") ? "advanced" : "standard";
  const deeper = system.includes("three to five sentences");

  if (properties.connections) {
    const titles = between(content, "linked_articles").split("\n").filter(Boolean).slice(0, 2);
    return { connections: titles.map((title) => ({ title, reason: `Stub reason linking the passage to ${title}.` })) };
  }
  if (properties.points) return { points: [{ point: "Stub summary point.", evidence: quote(source) }] };
  if (properties.summary) return { summary: "Stub description of this change." };
  if (properties.simpler) {
    return { explanation: `Stub ${level} ${deeper ? "deeper " : ""}explanation.`, simpler: "Stub simpler wording.", evidence: quote(source) };
  }
  if (properties.evidence) return { explanation: "Stub passage explanation.", evidence: quote(source) };
  if (properties.text) return { text: "Stub simplified passage." };
  throw new Error(`No stub answer for schema: ${Object.keys(properties).join(", ")}`);
}

createServer((req, res) => {
  const reply = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.url === "/__calls") return reply(200, { calls });
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    try {
      calls++;
      const body = JSON.parse(raw);
      reply(200, {
        id: `msg_stub_${calls}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(answer(body)) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    } catch (error) {
      reply(400, { type: "error", error: { type: "invalid_request_error", message: String(error) } });
    }
  });
}).listen(port, () => console.log(`Anthropic stub listening on ${port}`));
