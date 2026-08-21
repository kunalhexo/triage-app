import { getIssue, addComment, triggerRoutine } from "../../../lib/linear";

export const dynamic = "force-dynamic";

/* "Tell me more" and every follow-up question land here.

   The app cannot answer these itself — Gmail, Slack, Drive and Notion are
   authorised to Claude, not to this app. So the question is written to the
   ticket and Routine 5 is woken to answer it with full tool access. The app
   then polls the ticket until the answer appears. */
export async function POST(req) {
  try {
    const { id, question } = await req.json();
    const issue = await getIssue(id);
    if (!issue) return Response.json({ error: "Issue not found" }, { status: 404 });

    const q = (question || "").trim() || "What is this actually about, and does it matter to me?";

    await addComment(issue.id, `ASK: ${q}`);

    const t = await triggerRoutine(
      "explain",
      `Answer a question about Linear issue ${issue.key} in team Triage: "${q}"`
    );

    if (t.rateLimited) {
      return Response.json({
        ok: true,
        pending: false,
        message: `Question saved, but the daily routine allowance is spent${
          t.retryAfter ? ` — try again in about ${Math.ceil(Number(t.retryAfter) / 60)} minutes` : ""
        }. It will be answered on the next scheduled run.`,
      });
    }

    return Response.json({
      ok: true,
      pending: t.triggered,
      message: t.triggered
        ? "Looking into it…"
        : "Question saved. It will be answered on the next scheduled run.",
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
