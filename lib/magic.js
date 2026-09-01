// This is the one deliberate exception to "no AI in the app's core path" in
// the whole system. Every other AI decision lives in a routine; this one
// lives here because the whole point of the magic box is fast, in-app
// judgment — routing to a routine for every keystroke would recreate the
// exact latency problem this was built to solve.
//
// Deliberately scoped: no tool access, no research. Just the ticket's own
// context, its existing options, and Entities — everything a human glancing
// at the card would already have. When that isn't enough, the classifier
// says so honestly (shape: "needs_research") rather than guessing; a real
// routine handoff for that case is a deliberate v2, not built here.
//
// Haiku, not Sonnet — this is fast structured classification with a fixed
// small schema, exactly the shape of task it's suited for. Using a larger
// model here would work against the entire reason this exists.

const MODEL = "claude-haiku-4-5-20251001";

const SHAPES = ["new_option", "modifier", "quiet", "question", "resolution", "needs_research"];

function buildPrompt({ ticket, entities, entitiesError, userText }) {
  const optionsList = (ticket.options || [])
    .map((o) => `${o.n} - ${o.text}${o.manual ? " (MANUAL)" : ""}`)
    .join("\n") || "(none yet)";

  const entitiesList = entities
    .map((e) => `- ${e.name} (${e.type}${e.aliases ? `, aliases: ${e.aliases}` : ""})${e.recentContext ? `\n  recent: ${e.recentContext.split("\n").slice(-3).join(" | ")}` : ""}`)
    .join("\n");
  const entitiesSection = entitiesError
    ? `(Entities could not be loaded this run — ${entitiesError}. If this request needs a person or company lookup, you genuinely cannot do it right now; use "question" and say so honestly rather than guessing.)`
    : entitiesList || "(none)";

  return `You are classifying one thing Kunal typed into a ticket's input box, so a
deterministic system can act on it correctly. You do not execute anything
yourself — you only decide what should happen and supply the exact text
needed, as JSON.

TICKET
Title: ${ticket.title}
Context: ${ticket.context || "(none)"}
Score breakdown: ${ticket.breakdown ? JSON.stringify(ticket.breakdown) : "(none)"}
Existing options:
${optionsList}

ENTITIES ON FILE
${entitiesSection}

WHAT KUNAL TYPED
"${userText}"

Classify into exactly one shape:

- "new_option" — a genuinely new action not covered by an existing option
  (delegate to someone, reply with new content). Resolve the medium from the
  ticket's own source or the person's Entities aliases — Slack handle present
  means Slack, only an email means Gmail. If the medium or the person can't
  be resolved confidently, use "question" instead — never guess a recipient.
- "modifier" — this matches an EXISTING option's intent, just with different
  or additional wording. Name which option number it modifies.
- "quiet" — covers two real cases, both landing here because neither has an
  option or draft to show:
  1. Feedback, a lesson, or a correction. If it implies you should check
     back later (a promise to have a conversation, waiting to hear back),
     set impliesFollowUp and propose a sensible date.
  2. An EXPLICIT park or remind-me request — "park this until Monday",
     "remind me next week", "check back on this in two weeks". This is not
     implicit at all; it's a direct instruction. Always set impliesFollowUp
     and resolve a real followUpDate for these — there is no separate park
     button anymore, this is the only path, so do not miss one because it
     reads as an instruction rather than a passing comment.
- "question" — you cannot proceed confidently. State the specific ambiguity.
  If it's a choice between a small number of known candidates (two people
  with the same first name, for instance), list them in candidateChoices
  instead of asking a free-text question.
- "resolution" — this ticket is done. If it clearly implies separate future
  work — not a continuation of this same ask, but a genuinely new obligation
  — set spawnsFollowUp with a title and enough context for a new ticket. Only
  set spawnsFollowUp when it's clearly a different task, not this one
  continuing.
- "needs_research" — this is a genuine question ("what is this about", "does
  this matter to me", "what happened on the call"), or anything else that
  would need real research to do correctly. You have no tool access — you
  cannot look anything up, so a question is exactly as unanswerable to you as
  a research task is. Never attempt an explanation from your own reasoning
  alone here; hand it off honestly instead.

Respond with ONLY this JSON, nothing else, no markdown fences:

{
  "shape": "one of the six above",
  "acknowledgment": "one short sentence, specific to what you understood — never a generic 'Noted'",
  "optionText": "for new_option only — the option's label",
  "draftText": "for new_option, if it involves sending words — the actual message",
  "medium": "gmail | slack | null — for new_option",
  "recipient": "resolved name — for new_option",
  "matchedOptionNumber": 0,
  "modifiedDraftText": "for modifier only",
  "isLesson": false,
  "impliesFollowUp": false,
  "followUpDate": "YYYY-MM-DD or null",
  "followUpNote": "what to check on, for the resurfaced ticket",
  "questionText": "for question only",
  "candidateChoices": [],
  "resolutionSummary": "for resolution only",
  "spawnsFollowUp": false,
  "followUpTitle": "",
  "followUpContext": "",
  "entityUpdates": [{"pageId": "", "fact": ""}]
}`;
}

export async function classify({ ticket, entities, entitiesError, userText }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in the environment.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: buildPrompt({ ticket, entities, entitiesError, userText }) }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude API error (HTTP ${res.status})`);

  const text = (data.content || []).map((b) => b.text || "").join("");
  let parsed;
  try {
    // Strip markdown fences defensively, even though the prompt asks for none.
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
  } catch (e) {
    throw new Error("The classifier's response wasn't valid JSON — falling back to a question is safer than guessing at broken output.");
  }

  if (!SHAPES.includes(parsed.shape)) {
    throw new Error(`Classifier returned an unrecognized shape: "${parsed.shape}"`);
  }
  return parsed;
}
