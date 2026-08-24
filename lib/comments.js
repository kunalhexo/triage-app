// The marker-parsing logic used to be duplicated between the list and detail
// routes. That duplication is exactly how the two drifted out of sync before
// (RANK: existing in one place and not the other, ordering fixed in one and
// not the other). Everything that reads a ticket's structured comments goes
// through here now, once.

const MARKER = /^(CONTEXT|SCORE:|OPTIONS|DRAFT|EVIDENCE|FEEDBACK:|ASK:|ANSWER:|DONE:|HELD:|RANK:)/im;

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

/* Lightweight parse for the LIST view: just enough to sort by. Cheaper than
   the full per-ticket parse the detail view does, since the list view reads
   every open ticket in one call and must stay small. */
export function extractRankAndScore(comments) {
  let score = null;
  let rank = null; // { position, of, band }

  for (const c of oldestFirst(comments || [])) {
    for (const b of sections(c.body)) {
      const s = b.match(/^SCORE:\s*(\d+)/im);
      if (s) score = parseInt(s[1], 10);

      const r = b.match(/^RANK:\s*(\d+)\s*of\s*(\d+)\s*in\s*(\w+)/im);
      if (r) rank = { position: parseInt(r[1], 10), of: parseInt(r[2], 10), band: r[3] };
    }
  }
  return { score, rank };
}
