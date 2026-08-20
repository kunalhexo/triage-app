import { getIssue } from "../../../../lib/linear";

export const dynamic = "force-dynamic";

/* The routines write comments in fixed formats (see the Contract page in
   Notion). Parsing them is plain string work, done here on the server. */
function parse(issue) {
  const out = { context: "", score: null, breakdown: null, options: [], draft: null, draftAt: null, feedback: [] };
  if (!issue) return out;

  for (const c of issue.comments) {
    const b = (c.body || "").trim();

    if (b.startsWith("CONTEXT")) {
      out.context = b.replace(/^CONTEXT\s*/, "").trim();
    }

    const score = b.match(/SCORE:\s*(\d+)\s*-\s*(.+)/i);
    if (score) {
      out.score = parseInt(score[1], 10);
      const bd = {};
      for (const m of score[2].matchAll(/(delay|waiting|blocking|committed|effort)\s*(\d+)\s*x/gi)) {
        bd[m[1].toLowerCase()] = parseInt(m[2], 10);
      }
      out.breakdown = Object.keys(bd).length ? bd : null;
    }

    if (/^OPTIONS/i.test(b)) {
      out.options = b
        .split("\n")
        .map((l) => l.trim())
        .map((l) => l.match(/^(\d+)\s*[-.)]\s*(.+)$/))
        .filter(Boolean)
        .map((m) => ({ n: parseInt(m[1], 10), text: m[2].replace(/\bMANUAL\b/i, "").trim(), manual: /\bMANUAL\b/i.test(m[2]) }));
    }

    if (/^DRAFT/i.test(b)) {
      out.draft = b.replace(/^DRAFT\s*/i, "").trim();
      out.draftAt = c.createdAt;
    }

    if (/^FEEDBACK:/i.test(b)) {
      out.feedback.push({ body: b.replace(/^FEEDBACK:\s*/i, ""), at: c.createdAt });
    }
  }

  if (!out.context) out.context = (issue.description || "").slice(0, 600);
  out.stale = out.draftAt ? Date.now() - new Date(out.draftAt).getTime() > 48 * 3600 * 1000 : false;
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
