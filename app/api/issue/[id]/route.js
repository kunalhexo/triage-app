import { getIssue } from "../../../../lib/linear";
import { sections, oldestFirst } from "../../../../lib/comments";

export const dynamic = "force-dynamic";

/* The routines write comments in fixed formats (see the Contract page in
   Notion). Parsing them is plain string work, done here on the server.
   The marker-splitting itself lives in lib/comments.js, shared with the
   list route, so the two cannot drift out of sync with each other again. */
function parse(issue) {
  const out = {
    context: "",
    score: null,
    breakdown: null,
    rank: null,
    options: [],
    draft: null, // legacy single draft, kept for tickets written before per-option drafts
    draftAt: null,
    drafts: {}, // { "1": { text, at }, "2": { text, at } } — per-option drafts
    feedback: [],
    thread: [],
    magicThread: [],
  };
  if (!issue) return out;

  for (const c of oldestFirst(issue.comments)) {
    for (const b of sections(c.body)) {
      if (/^CONTEXT/i.test(b)) {
        out.context = b.replace(/^CONTEXT\s*\|?\s*/i, "").trim();
      }

      const score = b.match(/^SCORE\[([\w-]+)\]:\s*(\d+)\s*-\s*(.+)/im);
      if (score) {
        out.score = parseInt(score[2], 10);
        const bd = {};
        for (const m of score[3].matchAll(/(delay|waiting|blocking|committed|effort)\s*(\d+)\s*x/gi)) {
          bd[m[1].toLowerCase()] = parseInt(m[2], 10);
        }
        out.breakdown = Object.keys(bd).length ? bd : null;
      }

      // RANK[listwise]: 2 of 7 in Urgent - <reason>. Written by Routine 6,
      // never by 1B, so this is layered on top of — and never overwrites —
      // the score. The bracketed name is the ranking system; today there is
      // only one (listwise), but the parser doesn't assume that stays true.
      const rank = b.match(/^RANK\[([\w-]+)\]:\s*(\d+)\s*of\s*(\d+)\s*in\s*(\w+)\s*-?\s*(.*)/im);
      if (rank) {
        out.rank = {
          system: rank[1],
          position: parseInt(rank[2], 10),
          of: parseInt(rank[3], 10),
          band: rank[4],
          reason: rank[5]?.trim() || "",
        };
      }

      if (/^OPTIONS/i.test(b)) {
        out.options = b
          .split("\n")
          .map((l) => l.trim())
          .map((l) => l.match(/^(\d+)\s*[-.)]\s*(.+)$/))
          .filter(Boolean)
          .map((m) => ({
            n: parseInt(m[1], 10),
            text: m[2].replace(/\s*\(MANUAL\)/i, "").trim(),
            manual: /\bMANUAL\b/i.test(m[2]),
          }));
      }

      // DRAFT <n> is tagged to the option it belongs to, since a ticket can
      // carry more than one — different options can need different words.
      // Older tickets may still have a single unnumbered DRAFT from before
      // this was fixed; keep that as a fallback default.
      if (/^DRAFT/i.test(b)) {
        const numbered = b.match(/^DRAFT\s*(\d+)\s*(\([^)]*\))?\s*:?\s*/i);
        const text = b.replace(/^DRAFT\s*(\d+)?\s*(\([^)]*\))?\s*:?\s*/i, "").trim();
        const dated = b.match(/^DRAFT\s*(?:\d+\s*)?\((\d{4}-\d{2}-\d{2})\)/i);
        const at = dated ? dated[1] : c.createdAt;
        if (numbered) {
          out.drafts[numbered[1]] = { text, at };
        } else {
          // Unnumbered legacy draft — keep as the fallback default, and also
          // as out.draft directly for any code that hasn't moved to the map.
          out.draft = text;
          out.draftAt = at;
        }
      }

      if (/^FEEDBACK:/i.test(b)) {
        out.feedback.push({ body: b.replace(/^FEEDBACK:\s*/i, "").trim(), at: c.createdAt });
      }

      if (/^ASK:/i.test(b)) {
        out.thread.push({ role: "you", body: b.replace(/^ASK:\s*/i, "").trim(), at: c.createdAt });
      }

      if (/^ANSWER:/i.test(b)) {
        const whole = b.replace(/^ANSWER:\s*/i, "").trim();
        const cut = whole.search(/^SOURCES\s*$/im);
        out.thread.push({
          role: "buddy",
          body: cut > -1 ? whole.slice(0, cut).trim() : whole,
          sources:
            cut > -1
              ? whole
                  .slice(cut)
                  .replace(/^SOURCES\s*/im, "")
                  .split("\n")
                  .map((l) => l.replace(/^[-*]\s*/, "").trim())
                  .filter(Boolean)
              : [],
          at: c.createdAt,
        });
      }

      // The magic box's thread — everything it can produce, in one place.
      // Kunal's own call: this grows without limit, no collapsing in v1.
      // Every kind reuses a marker that already existed before this feature.
      if (/^FEEDBACK:/i.test(b)) {
        out.magicThread.push({ kind: "you", body: b.replace(/^FEEDBACK:\s*/i, "").trim(), at: c.createdAt });
      }
      if (/^HELD:/i.test(b)) {
        out.magicThread.push({ kind: "question", body: b.replace(/^HELD:\s*/i, "").trim(), at: c.createdAt });
      }
      if (/^EVIDENCE/i.test(b)) {
        out.magicThread.push({ kind: "resolved", body: b.replace(/^EVIDENCE\s*—?\s*/i, "").trim(), at: c.createdAt });
      }
      if (/^SNOOZE:/i.test(b)) {
        const sm = b.match(/^SNOOZE:\s*(\d{4}-\d{2}-\d{2})/i);
        out.magicThread.push({ kind: "snoozed", body: sm ? `Parked until ${sm[1]}` : "Parked", at: c.createdAt });
      }
      // Note: a magic-box-added option doesn't get its own thread entry here
      // — the option itself, appearing in out.options with its own DRAFT,
      // is the persistent record. The app shows an immediate acknowledgment
      // client-side at the moment it's added, from the API response
      // directly, rather than this route trying to reverse-engineer "was
      // this OPTIONS block original or added later" from raw text order.
    }
  }

  // Same note saved twice is a double click, not two corrections.
  out.feedback = out.feedback.filter(
    (f, i, arr) => arr.findIndex((g) => g.body === f.body) === i
  );

  out.thread.sort((a, b2) => new Date(a.at) - new Date(b2.at));
  out.magicThread.sort((a, b2) => new Date(a.at) - new Date(b2.at));
  out.awaitingAnswer = out.thread.length > 0 && out.thread[out.thread.length - 1].role === "you";
  if (!out.context) out.context = (issue.description || "").slice(0, 600);
  out.stale = out.draftAt ? Date.now() - new Date(out.draftAt).getTime() > 48 * 3600 * 1000 : false;
  for (const n of Object.keys(out.drafts)) {
    out.drafts[n].stale = Date.now() - new Date(out.drafts[n].at).getTime() > 48 * 3600 * 1000;
  }
  // No function on this object — it goes through Response.json(), and a
  // function does not survive JSON serialization. The per-option lookup
  // (numbered draft, falling back to the legacy single one) happens
  // client-side in page.js instead, over this same plain data.
  return out;
}

export async function GET(_req, { params }) {
  try {
    const issue = await getIssue(params.id);
    if (!issue) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ issue, parsed: parse(issue) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
