import { getIssue, addComment, setLabels, setState, triggerRoutine } from "../../../lib/linear";

export const dynamic = "force-dynamic";

const BUCKETS = ["for-me", "delegate", "autonomous", "park"];
const TAB_LABELS = ["buddy-awaiting", "buddy-parked", "buddy-proposed-drop", "buddy-unsure", "buddy-proposal", "buddy-done"];

/* Four actions, all of them plain Linear writes. Nothing here decides
   anything — it records what Kunal chose. The routines do the judging,
   Routine 2 does the sending, Routine 4 does the learning.

   Label handling rule: we keep the ids of everything we are not
   deliberately changing, and add new labels by name. That way workspace
   labels the app knows nothing about are never lost. */
export async function POST(req) {
  try {
    const { id, action, payload } = await req.json();
    if (!id) return Response.json({ error: "No issue id supplied" }, { status: 400 });

    const issue = await getIssue(id);
    if (!issue) return Response.json({ error: "Issue not found" }, { status: 404 });

    // ids of labels that survive a bucket change
    const keepIds = issue.labels
      .filter((name) => !BUCKETS.includes(name) && !TAB_LABELS.includes(name))
      .map((name) => issue.labelIds[name]);

    // ids of everything currently on the issue
    const allIds = Object.values(issue.labelIds);

    if (action === "note") {
      if (!payload?.text?.trim()) return Response.json({ error: "Empty note" }, { status: 400 });
      await addComment(issue.id, `FEEDBACK: ${payload.text.trim()}`);
      return Response.json({ ok: true, message: "Note saved. Routine 4 turns it into a rule tonight." });
    }

    // The "snooze" action used to live here, called by a standalone
    // "Park until…" button. That button was folded into the magic box —
    // "park this until Monday" typed there now hits its quiet shape, which
    // does its own direct Linear writes in app/api/magic/route.js rather
    // than routing through this action. Removed rather than left as dead,
    // unreachable code, since that's exactly the kind of leftover that's
    // caused real confusion in this codebase before.

    if (action === "bucket") {
      const b = payload.bucket;

      if (b === "keep-dropped") {
        await addComment(
          issue.id,
          `FEEDBACK: Confirmed — right to drop.${payload.text ? `\n\n${payload.text}` : ""}`
        );
        return Response.json({ ok: true, message: "Confirmed. It keeps dropping these." });
      }

      if (!BUCKETS.includes(b)) return Response.json({ error: `Unknown bucket "${b}"` }, { status: 400 });

      await setLabels(issue.id, keepIds, [b, b === "park" ? "buddy-parked" : "buddy-awaiting"]);
      await addComment(
        issue.id,
        `FEEDBACK: Wrong bucket. The correct one is "${b}".${payload.text ? `\n\n${payload.text}` : ""}`
      );
      return Response.json({ ok: true, message: `Moved to ${b}.` });
    }

    if (action === "choose") {
      // Routine 2 looks for buddy-awaiting plus a newer comment from Kunal,
      // so the label must stay on. We only add buddy-edited when he rewrote
      // the draft, and change nothing else.
      const body =
        `EXEC: ${payload.n}` +
        (payload.draft ? `\n\nUse this wording exactly:\n\n${payload.draft}` : "") +
        (payload.text ? `\n\nNote: ${payload.text}` : "");

      await addComment(issue.id, body);

      if (payload.draft) {
        await setLabels(issue.id, allIds, ["buddy-edited"]);
      }

      const t = await triggerRoutine();
      // Gmail is draft-only for now, so say so rather than implying it was sent.
      return Response.json({
        ok: true,
        message: t.triggered
          ? "Recorded. Routine 2 is running now. Emails are drafted in Gmail for you to send; Slack and Linear actions go out directly."
          : "Recorded. Routine 2 picks it up within the hour. Emails are drafted in Gmail for you to send; Slack and Linear actions go out directly.",
      });
    }

    if (action === "handled") {
      // The missing affordance. Kunal has dealt with this outside the system —
      // replied in Gmail, spoke to the person, decided it is moot. Without this
      // he says so in a note, nothing acts, and the ticket sits forever.
      await addComment(
        issue.id,
        `FEEDBACK: Already handled outside the system.${payload?.text ? `\n\n${payload.text}` : ""}`
      );
      const keepHandled = issue.labels
        .filter((name) => name !== "buddy-awaiting")
        .map((name) => issue.labelIds[name]);
      await setLabels(issue.id, keepHandled, ["buddy-done"]);
      await setState(issue.id, "In Review");
      return Response.json({
        ok: true,
        message: "Cleared. Routine 4 will look at why it surfaced.",
      });
    }

    if (action === "proposal") {
      const approve = payload.approve;
      await addComment(
        issue.id,
        approve
          ? `FEEDBACK: Approved — promote this category and make it silent.${payload.text ? `\n\n${payload.text}` : ""}`
          : `FEEDBACK: Declined for now. Keep showing these and reset the counter.${payload.text ? `\n\n${payload.text}` : ""}`
      );
      // Drop buddy-awaiting so Routine 2 never tries to execute a proposal.
      // Add buddy-done so it actually leaves the Proposals tab once decided —
      // "done" here means the PROPOSAL was decided, either way, not that it
      // was approved. Keep buddy-proposal too, so Routine 4 can still find
      // it tonight; tabOf() checks buddy-done first, so the two labels
      // coexisting is fine and no longer causes it to stick in Proposals.
      const resolved = issue.labels
        .filter((name) => name !== "buddy-awaiting")
        .map((name) => issue.labelIds[name]);
      await setLabels(issue.id, resolved, ["buddy-done"]);
      await setState(issue.id, "In Review");
      return Response.json({
        ok: true,
        message: approve ? "Approved. Routine 4 promotes it tonight." : "Declined. Counter resets tonight.",
      });
    }

    return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
