import { getIssue, addComment, setLabels, setState, createIssue } from "../../../lib/linear";
import { getEntities, appendEntityContext } from "../../../lib/notion";
import { classify } from "../../../lib/magic";
import { sections, oldestFirst } from "../../../lib/comments";

export const dynamic = "force-dynamic";

/* Every shape below writes using markers that already existed before this
   feature — FEEDBACK:, OPTIONS, DRAFT <n>, SNOOZE:, HELD:, EVIDENCE. No new
   marker was invented for this. That was a deliberate correction mid-design
   — an earlier draft proposed a MAGIC: tag, and every case it was meant to
   cover turned out to already have a real home. */

/* Reuses the same shared sections()/oldestFirst() helpers the detail route
   already uses — a first version of this duplicated the marker-splitting
   logic ad hoc here instead, which is exactly the mistake that caused real
   drift once before (list vs. detail routes silently disagreeing). It also
   had a real, confirmed bug: a /m-flagged $ matches the end of every line,
   not the end of the string, so it only ever captured the first option.
   Caught by an actual test against realistic multi-option data, not by
   reading the code. */
function parseOptions(comments) {
  let options = [];
  for (const c of oldestFirst(comments)) {
    for (const b of sections(c.body)) {
      if (/^OPTIONS/i.test(b)) {
        options = b
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
    }
  }
  return options;
}

export async function POST(req) {
  try {
    const { issueId, text } = await req.json();
    if (!issueId || !text?.trim()) {
      return Response.json({ error: "issueId and text are both required." }, { status: 400 });
    }

    const issue = await getIssue(issueId);
    if (!issue) return Response.json({ error: "Issue not found." }, { status: 404 });

    // Always record what was actually typed, first, regardless of what
    // happens next — this is the same FEEDBACK: the plain note box always
    // wrote, so Routine 4 reads it exactly as it always has.
    await addComment(issueId, `FEEDBACK: ${text.trim()}`);

    // Both scans go oldest-to-newest and let a later match overwrite an
    // earlier one — the same pattern extractRankAndScore already uses. Not
    // guessing at Linear's raw comment order (an assumption that has been
    // wrong before in this project — see TRI-178 in the Change Log) and not
    // trusting a .reverse() to encode that guess correctly either.
    let contextText = null;
    let scoreLine = null;
    for (const c of oldestFirst(issue.comments)) {
      for (const b of sections(c.body)) {
        if (/^CONTEXT/i.test(b)) contextText = b.replace(/^CONTEXT\s*\|?\s*/i, "").trim();
        const m = b.match(/^SCORE\[weighted\]:\s*\d+\s*-\s*(.+)/im);
        if (m) scoreLine = m[1];
      }
    }
    const breakdown = {};
    if (scoreLine) {
      for (const m of scoreLine.matchAll(/(delay|waiting|blocking|committed|effort)\s*(\d+)\s*x/gi)) {
        breakdown[m[1].toLowerCase()] = parseInt(m[2], 10);
      }
    }
    const options = parseOptions(issue.comments);
    const entities = await getEntities();

    const result = await classify({
      ticket: { title: issue.title, context: contextText, breakdown, options },
      entities,
      userText: text.trim(),
    });

    const today = new Date().toISOString().slice(0, 10);

    if (result.shape === "new_option") {
      const nextN = (options.length ? Math.max(...options.map((o) => o.n)) : 0) + 1;
      const allOptions = [...options, { n: nextN, text: result.optionText, manual: false }];
      const optionsBlock = allOptions.map((o) => `${o.n} - ${o.text}${o.manual ? " (MANUAL)" : ""}`).join("\n");
      await addComment(issueId, `OPTIONS\n${optionsBlock}\nReply with a number.`);
      if (result.draftText) {
        await addComment(issueId, `DRAFT ${nextN} (${today})\n${result.draftText}`);
      }
      // Tags this ticket for Routine 4 — a sixth correction source, evidence
      // 1B should have predicted this option itself. Requires the label
      // "buddy-added-option" to already exist in Linear; see setup.
      await setLabels(issueId, issue.labels.map((n) => issue.labelIds[n]).filter(Boolean), ["buddy-added-option"]);
      return Response.json({
        ok: true,
        shape: "new_option",
        acknowledgment: result.acknowledgment,
        newOptionNumber: nextN,
      });
    }

    if (result.shape === "modifier") {
      await addComment(issueId, `DRAFT ${result.matchedOptionNumber} (${today})\n${result.modifiedDraftText}`);
      return Response.json({
        ok: true,
        shape: "modifier",
        acknowledgment: result.acknowledgment,
        modifiedOptionNumber: result.matchedOptionNumber,
      });
    }

    if (result.shape === "quiet") {
      if (result.impliesFollowUp && result.followUpDate) {
        const wasBucket = ["for-me", "delegate", "autonomous"].find((b) => issue.labels.includes(b)) || "for-me";
        const keepIds = issue.labels
          .filter((n) => !["for-me", "delegate", "autonomous", "park", "buddy-awaiting"].includes(n))
          .map((n) => issue.labelIds[n])
          .filter(Boolean);
        await setLabels(issueId, keepIds, ["park", "buddy-parked"]);
        await addComment(issueId, `SNOOZE: ${result.followUpDate} | was: ${wasBucket}`);
      }
      return Response.json({ ok: true, shape: "quiet", acknowledgment: result.acknowledgment });
    }

    if (result.shape === "question") {
      const choices = (result.candidateChoices || []).length
        ? `\n${result.candidateChoices.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
        : "";
      await addComment(issueId, `HELD: ${result.questionText}${choices}`);
      return Response.json({
        ok: true,
        shape: "question",
        acknowledgment: result.acknowledgment,
        candidateChoices: result.candidateChoices || [],
      });
    }

    if (result.shape === "resolution") {
      await addComment(issueId, `EVIDENCE — ${result.resolutionSummary}`);
      await setState(issueId, "In Review");
      const keepIds = issue.labels
        .filter((n) => !["buddy-awaiting", "buddy-parked", "park"].includes(n))
        .map((n) => issue.labelIds[n])
        .filter(Boolean);
      await setLabels(issueId, keepIds, ["buddy-done"]);

      let followUp = null;
      if (result.spawnsFollowUp && result.followUpTitle) {
        followUp = await createIssue({
          title: result.followUpTitle,
          description: result.followUpContext || "",
          labelNames: [], // deliberately unlabeled — 1B triages it normally next cycle, not this route
        });
        await addComment(issueId, `EVIDENCE — Spawned follow-up: ${followUp.key}`);
        await addComment(followUp.id, `EVIDENCE — Spawned from ${issue.key}, which closed first.`);
      }

      for (const upd of result.entityUpdates || []) {
        if (upd.pageId && upd.fact) {
          await appendEntityContext(upd.pageId, upd.fact, today).catch(() => {
            // A failed Entities write should never fail the whole resolution
            // — the ticket closing correctly matters more than the side
            // note about it. Silently skipped here; worth a look if this
            // becomes a pattern rather than a one-off.
          });
        }
      }

      return Response.json({ ok: true, shape: "resolution", acknowledgment: result.acknowledgment, followUp });
    }

    // needs_research — v1 is honest about not having a research handoff yet
    // rather than silently building one under pressure.
    await addComment(
      issueId,
      `HELD: This needs more digging than I can do from here — try "Tell me more" first, or give me a bit more detail.`
    );
    return Response.json({ ok: true, shape: "needs_research", acknowledgment: result.acknowledgment });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
