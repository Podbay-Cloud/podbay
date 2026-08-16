import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { search, seedDemoIfEmpty, logQuestion } from "../../rag";

// pg (doc retrieval) needs the Node runtime.
export const runtime = "nodejs";
// Allow streamed responses up to 30s.
export const maxDuration = 30;

// The bot's persona — the friendly part, safe to make your own (name, tone, who
// it's for). The GROUNDING rules below are the product's integrity and should stay.
const PERSONA =
  "You are a helpful assistant that answers questions strictly from a specific set of documents.";

// Grounding rules — the whole value of the product. Keep these even as you tune the
// persona: answer ONLY from the docs, CITE, and refuse gracefully when unsupported.
const GROUNDING_RULES = [
  "Answer the user's question using ONLY the document excerpts below.",
  "Do NOT use outside knowledge. If the excerpts do not contain the answer, say you don't know",
  "and suggest the owner add a document that covers it — never guess or fill from general knowledge.",
  "CITE every claim: put the source document's name in square brackets right after it, e.g. [Handbook.md].",
  "Be concise; quote the docs when exact wording matters.",
].join(" ");

// Used when retrieval found nothing relevant — refuse cleanly, don't fall back to
// the model's own knowledge.
const NO_CONTEXT = [
  PERSONA,
  "The library has NO excerpt relevant to this question.",
  "Tell the user, briefly and politely, that you couldn't find it in the documents.",
  "Do NOT answer from general knowledge. Invite them to rephrase, or to add a document that covers it.",
].join(" ");

/** The plain text of the newest user message (for retrieval). */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return (m.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .trim();
  }
  return "";
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // First boot: seed the demo corpus so the bot answers immediately (no-op once
  // the owner has real docs). Best-effort — never block answering.
  await seedDemoIfEmpty().catch(() => {});

  // Retrieve the relevant document excerpts. Grounding is mandatory: with hits we
  // answer + cite from them; with none we refuse rather than invent.
  const query = lastUserText(messages);
  const hits = query ? await search(query, 6).catch(() => []) : [];
  const sources = [...new Set(hits.map((h) => h.doc))];

  // Log the question + whether the docs could ground it — the unanswered ones are
  // the owner's roadmap. Best-effort; never block the answer.
  if (query) await logQuestion(query, hits.length > 0, sources).catch(() => {});

  const system =
    hits.length > 0
      ? `${PERSONA} ${GROUNDING_RULES}\n\nDOCUMENT EXCERPTS:\n\n` +
        hits.map((h) => `[${h.doc}]\n${h.content}`).join("\n\n---\n\n")
      : NO_CONTEXT;

  // The model key comes from ANTHROPIC_API_KEY in the pod's environment (set in
  // the dashboard). The Anthropic provider reads it automatically.
  const result = streamText({
    model: anthropic("claude-sonnet-5"),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
