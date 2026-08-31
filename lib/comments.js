// The marker-parsing logic used to be duplicated between the list and detail
// routes. That duplication is exactly how the two drifted out of sync before
// (RANK: existing in one place and not the other, ordering fixed in one and
// not the other). Everything that reads a ticket's structured comments goes
// through here now, once.
//
// As of 23 Aug, SCORE and RANK carry a system name in brackets —
// SCORE[weighted]:, RANK[listwise]: — so that more than one scoring or
// ranking approach can write to the same ticket without overwriting each
// other. The marker below matches the opening bracket, not a fixed tag, so a
// future SCORE[wsjf]: or RANK[bandit]: is recognized automatically.

const MARKER = /^(CONTEXT|SCORE\[|OPTIONS|DRAFT|EVIDENCE|FEEDBACK:|ASK:|ANSWER:|DONE:|HELD:|RANK\[|SNOOZE:)/im;

/* Linear returns comments newest-first. Every parser here sorts oldest-first
   before scanning, so when a field appears more than once (a re-scored SCORE
   comment, for instance) the newest one naturally wins by being processed
   last. Getting this backwards was a real, live bug once — see TRI-178 in the
   Change Log, 20-22 Aug: a two-day-stale score sat at the top of the queue
   because the oldest comment was winning instead of the newest. */
export function oldestFirst(comments) {
  return [...comments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/* Splits one comment body into marker-led sections. The routines sometimes
   write CONTEXT/SCORE/OPTIONS/DRAFT as four separate comments and sometimes
   as one comment containing all four — this handles both. */
export function sections(body) {
  const lines = (body || "").split("\n");
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (MARKER.test(line.trim())) {
      if (cur) out.push(cur);
      cur = { lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) out.push(cur);
  return out.map((sec) => sec.lines.join("\n").trim());
}

/* Default system names, used when nothing else is displaying a chooser yet.
   Kept in one place so the eventual lens-selector UI reads from here rather
   than duplicating these strings. */
export const DEFAULT_SCORE_SYSTEM = "weighted";
export const DEFAULT_RANK_SYSTEM = "listwise";

/* Lightweight parse for the LIST view: just enough to sort by. Cheaper than
   the full per-ticket parse the detail view does, since the list view reads
   every open ticket in one call and must stay small.

   Extracts EVERY tagged system found, not just the default one — a small
   amount of forward-compatible work now, so that adding a second scoring or
   ranking system later does not mean rewriting this parser again. Today,
   with exactly one of each, `score`/`rank` (the defaults) are all any
   caller needs; `scores`/`ranks` are the full maps for whenever a lens
   selector actually lets Kunal choose between systems. */
export function extractRankAndScore(comments) {
  const scores = {}; // { systemName: { total, breakdown } }
  const ranks = {}; // { systemName: { position, of, band } }

  for (const c of oldestFirst(comments || [])) {
    for (const b of sections(c.body)) {
      const s = b.match(/^SCORE\[([\w-]+)\]:\s*(\d+)/im);
      if (s) scores[s[1]] = { total: parseInt(s[2], 10) };

      const r = b.match(/^RANK\[([\w-]+)\]:\s*(\d+)\s*of\s*(\d+)\s*in\s*(\w+)/im);
      if (r) ranks[r[1]] = { position: parseInt(r[2], 10), of: parseInt(r[3], 10), band: r[4] };
    }
  }

  return {
    score: scores[DEFAULT_SCORE_SYSTEM]?.total ?? null,
    rank: ranks[DEFAULT_RANK_SYSTEM] ?? null,
    scores,
    ranks,
  };
}
