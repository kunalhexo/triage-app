"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const INK = "#101822";
const INK_2 = "#18222F";
const INK_3 = "#22303F";
const PAPER = "#EDE8DF";
const MUTE = "#8798A8";
const SIGNAL = "#F2A03D";
const LIVE = "#5FC9A3";
const ALERT = "#E3644F";
const COOL = "#7BA7D4";

const FACTORS = [
  { key: "delay", label: "DELAY", weight: 30, color: "#E3644F" },
  { key: "waiting", label: "WAITING", weight: 25, color: "#F2A03D" },
  { key: "blocking", label: "BLOCKING", weight: 20, color: "#C9A0DC" },
  { key: "committed", label: "COMMITTED", weight: 15, color: "#7BA7D4" },
  { key: "effort", label: "QUICK", weight: 10, color: "#5FC9A3" },
];

const TABS = [
  { id: "queue", label: "Queue", hint: "Needs a decision from you" },
  { id: "proposals", label: "Proposals", hint: "Decisions about the system, not your work" },
  { id: "unsure", label: "Unsure", hint: "It could not classify these" },
  { id: "drops", label: "Drops", hint: "It wants to ignore these" },
  { id: "parked", label: "Parked", hint: "Not now, not never" },
  { id: "done", label: "Done", hint: "Already carried out" },
];

const BUCKETS = [
  { id: "for-me", label: "Mine", color: LIVE },
  { id: "delegate", label: "Delegate", color: "#C9A0DC" },
  { id: "park", label: "Park", color: MUTE },
  { id: "keep-dropped", label: "Keep dropped", color: INK_3 },
];

function tabOf(labels = []) {
  const has = (l) => labels.includes(l);
  // buddy-done is terminal and checked first, deliberately. A resolved
  // proposal (buddy-proposal + buddy-done) or a closed drop must not keep
  // showing in its original tab forever just because that label was never
  // stripped. Whatever else a ticket carries, "done" wins.
  if (has("buddy-done")) return "done";
  if (has("buddy-proposal")) return "proposals";
  if (has("buddy-unsure")) return "unsure";
  if (has("buddy-proposed-drop")) return "drops";
  if (has("buddy-parked")) return "parked";
  if (has("for-me") || has("delegate") || has("autonomous")) return "queue";
  return null;
}

/* Discovers which scoring/ranking systems actually appear in the loaded
   tickets, rather than assuming a fixed set. A future second scorer or
   ranker starts showing up here automatically the moment it writes its
   first tagged comment — no UI change needed. "Newest first" always exists,
   even before any system has ever scored anything. */
function discoverLenses(issues) {
  const rankSystems = new Set();
  const scoreSystems = new Set();
  for (const i of issues) {
    if (i.ranks) Object.keys(i.ranks).forEach((s) => rankSystems.add(s));
    if (i.scores) Object.keys(i.scores).forEach((s) => scoreSystems.add(s));
  }
  const lenses = [];
  for (const s of rankSystems) lenses.push({ id: `rank:${s}`, label: `Ranking (${s})`, type: "rank", system: s });
  for (const s of scoreSystems) lenses.push({ id: `score:${s}`, label: `Score (${s})`, type: "score", system: s });
  lenses.push({ id: "recency", label: "Newest first", type: "recency" });
  return lenses;
}

/* Within-band tiebreak only — band itself is always the outer sort and this
   function never touches it. A ticket the chosen lens has no data for falls
   after ones it does have data for; an explicit judgment beats a guess. */
function compareByLens(a, b, lens) {
  if (!lens || lens.type === "recency") {
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  if (lens.type === "rank") {
    const ar = a.ranks?.[lens.system];
    const br = b.ranks?.[lens.system];
    if (ar && br) return ar.position - br.position;
    if (ar && !br) return -1;
    if (!ar && br) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  if (lens.type === "score") {
    const as = a.scores?.[lens.system]?.total;
    const bs = b.scores?.[lens.system]?.total;
    if (as != null && bs != null) return bs - as;
    if (as != null && bs == null) return -1;
    if (as == null && bs != null) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  return 0;
}

const btn = (bg, fg, border) => ({
  background: bg,
  border: border || "none",
  borderRadius: 3,
  color: fg,
  padding: "8px 15px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
});

const box = {
  width: "100%",
  background: INK,
  border: `1px solid ${INK_3}`,
  borderRadius: 3,
  color: PAPER,
  padding: 10,
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "inherit",
  resize: "vertical",
  boxSizing: "border-box",
};

function Spine({ breakdown, total }) {
  if (!breakdown || !total) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", background: INK_3 }}>
        {FACTORS.map((f) => (
          <div
            key={f.key}
            style={{ width: `${(((breakdown[f.key] ?? 0) * f.weight) / 500) * 100}%`, background: f.color }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 7 }}>
        {FACTORS.map((f) => (
          <span key={f.key} style={{ fontSize: 9, letterSpacing: ".09em", color: MUTE, fontWeight: 600 }}>
            <span style={{ color: f.color }}>■</span> {f.label} {breakdown[f.key] ?? 0}
          </span>
        ))}
        <span style={{ fontSize: 9, letterSpacing: ".09em", color: PAPER, fontWeight: 700, marginLeft: "auto" }}>
          {total}/500
        </span>
      </div>
    </div>
  );
}

export default function Page() {
  const [issues, setIssues] = useState([]);
  const [tab, setTab] = useState("queue");
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [listErr, setListErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [draft, setDraft] = useState("");
  const [magicText, setMagicText] = useState("");
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicAck, setMagicAck] = useState(null); // { text, shape } — shown immediately, before the thread refresh lands
  const [asking, setAsking] = useState(false);
  // An option he has clicked but not yet confirmed. The second step lives
  // under it, so the wording being edited is tied to the choice being made.
  const [pending, setPending] = useState(null);
  // Which ticket is open right now. Async work started for one ticket must
  // never write its result into another — switching cards mid-poll is normal.
  const openId = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    try {
      const r = await fetch("/api/issues");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setIssues(d.issues);
    } catch (e) {
      setListErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    openId.current = sel?.id || null;
    setDetail(null);
    setMsg(null);
    setAsking(false);
    setPending(null);
    setMagicText("");
    setMagicAck(null);
    setDraft(""); // per-option now, not per-ticket — set correctly when an option is opened, not here
    if (!sel) return;
    const id = sel.id;
    fetch(`/api/issue/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (openId.current !== id) return; // he moved on
        setDetail(d);
      })
      .catch((e) => {
        if (openId.current === id) setDetail({ error: e.message });
      });
  }, [sel?.id]);

  /* The lens selector — which system's output decides within-band order.
     Band is never part of this choice; it stays the fixed outer sort no
     matter what, because that is the layer that makes the queue predictable
     (Urgent always above High). The lens only changes how ties within a band
     are broken: by Routine 6's relative judgment, by 1B's raw weighted total,
     or by plain recency if neither exists yet.

     Options are discovered from the actual loaded data, not hardcoded, so a
     future second scoring or ranking system needs no UI change here — it
     just starts appearing as another option once it starts writing tagged
     comments. */
  const lenses = useMemo(() => discoverLenses(issues), [issues]);
  // Fixed initial value, never read from localStorage here — this page can
  // be statically prerendered at build time, when window does not exist.
  // Reading localStorage inside a useState initializer would make the
  // server-rendered HTML and the client's first paint disagree, which React
  // treats as a hydration error. Syncing after mount, in the effect below,
  // is the safe pattern for browser-only state in a page that isn't forced
  // dynamic.
  const [lensId, setLensId] = useState(null);
  useEffect(() => {
    const saved = window.localStorage.getItem("triage-lens");
    if (saved) setLensId(saved);
  }, []);
  const activeLens =
    lenses.find((l) => l.id === lensId) || lenses.find((l) => l.type === "rank") || lenses[0];

  function chooseLens(id) {
    setLensId(id);
    window.localStorage.setItem("triage-lens", id);
  }

  const inTab = issues
    .filter((i) => tabOf(i.labels) === tab)
    .sort((a, b) => {
      const band = (a.priority || 9) - (b.priority || 9);
      if (band !== 0) return band;
      return compareByLens(a, b, activeLens);
    });

  async function act(action, payload) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, action, payload }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg({ ok: true, text: d.message });
      load();
      // Re-read the open issue so labels and comments on screen match Linear.
      refreshDetail(sel.id).catch(() => {});
    } catch (e) {
      setMsg({ ok: false, text: `${e.message}. Nothing was changed.` });
    } finally {
      setBusy(false);
    }
  }

  async function refreshDetail(id) {
    const r = await fetch(`/api/issue/${id}`);
    const fresh = await r.json();
    if (openId.current !== id) return null; // a different card is open now
    setDetail(fresh);
    // Draft is per-option now, not per-ticket. If an option panel is open,
    // re-resolve its draft from the fresh data instead of resetting to the
    // ticket's legacy field — that field belongs to whichever option it
    // belongs to, not necessarily the one currently open.
    if (pending) {
      const fp = fresh.parsed;
      const fd = fp?.drafts?.[String(pending.n)] || (fp?.draft ? { text: fp.draft } : null);
      setDraft(fd?.text || "");
    }
    return fresh;
  }

  /* The magic box. Classify-then-execute already happened server-side by
     the time this returns — this just shows the result and, for a new
     option, lands straight on its editable draft rather than making a
     second click find it. */
  async function submitMagic() {
    const text = magicText.trim();
    if (!text || !sel) return;
    setMagicText("");
    setMagicBusy(true);
    setMagicAck(null);
    try {
      const r = await fetch("/api/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: sel.id, text }),
      });
      const result = await r.json();
      if (result.error) throw new Error(result.error);
      setMagicAck({ text: result.acknowledgment, shape: result.shape });
      const fresh = await refreshDetail(sel.id);
      await load(); // labels may have changed (buddy-added-option, buddy-parked, buddy-done)

      if (result.shape === "new_option" && fresh?.parsed) {
        const n = result.newOptionNumber;
        const d = fresh.parsed.drafts?.[String(n)];
        setPending({ n, text: "" });
        setDraft(d?.text || "");
      }
      if (result.shape === "modifier" && fresh?.parsed) {
        const n = result.modifiedOptionNumber;
        const d = fresh.parsed.drafts?.[String(n)];
        setPending({ n, text: "" });
        setDraft(d?.text || "");
      }
      if (result.shape === "needs_research") {
        // This is the actual fold-in of "Tell me more" into this one box —
        // a genuine question hands off to the real ask()/Routine 5 flow
        // instead of pointing at a separate button. Same polling UI that
        // already existed, just reached from here instead of its own entry
        // point.
        setMagicAck(null);
        ask(text);
      }
    } catch (e) {
      setMagicAck({ text: `Couldn't process that: ${e.message}`, shape: "error" });
    } finally {
      setMagicBusy(false);
    }
  }

  /* Questions are answered by Routine 5, not by this app, so after asking we
     poll the ticket until the ANSWER comment appears. Up to two minutes,
     then we stop and tell the truth rather than spinning forever. */
  async function ask(q) {
    const id = sel.id;
    setAsking(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, question: q }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      await refreshDetail(id);

      if (!d.pending) {
        if (openId.current === id) setMsg({ ok: true, text: d.message });
        return;
      }

      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        if (openId.current !== id) return; // he moved on; stop quietly
        const fresh = await refreshDetail(id);
        if (fresh && !fresh.parsed?.awaitingAnswer) return;
      }
      if (openId.current === id)
        setMsg({ ok: true, text: "Still working. The answer appears on this card when it lands." });
    } catch (e) {
      if (openId.current === id) setMsg({ ok: false, text: e.message });
    } finally {
      if (openId.current === id) setAsking(false);
    }
  }

  const p = detail?.parsed;
  // One real timeline, not two stacked blocks. This is the actual fix for
  // "the order on screen doesn't match when things happened" — p.thread
  // (Q&A) and p.magicThread (everything else) used to render as two
  // separate, fixed-position sections regardless of real timestamps. No
  // overlap between the two sources to worry about: a genuine question
  // only ever lands in p.thread, since needs_research deliberately skips
  // writing to p.magicThread — see the magic route.
  const history = useMemo(() => {
    const rows = [];
    for (const t of p?.thread || []) {
      rows.push({
        at: t.at,
        label: t.role === "you" ? "YOU ASKED" : "ANSWER",
        color: t.role === "you" ? SIGNAL : COOL,
        body: t.body || "What is this about, and does it matter to me?",
        sources: t.sources,
      });
    }
    for (const m of p?.magicThread || []) {
      const style = {
        you: { label: "YOU", color: MUTE },
        question: { label: "ASKING YOU", color: SIGNAL },
        resolved: { label: "RESOLVED", color: LIVE },
        snoozed: { label: "PARKED", color: MUTE },
      }[m.kind] || { label: m.kind.toUpperCase(), color: MUTE };
      rows.push({ at: m.at, label: style.label, color: style.color, body: m.body });
    }
    return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [p?.thread, p?.magicThread]);
  const accent =
    tab === "proposals" || tab === "unsure" ? COOL : tab === "drops" ? INK_3 : detail?.issue?.priority === 1 ? ALERT : detail?.issue?.priority === 2 ? SIGNAL : LIVE;

  return (
    <main style={{ background: INK, color: PAPER, minHeight: "100vh", padding: "24px 20px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 13, letterSpacing: ".28em", fontWeight: 700 }}>TRIAGE</h1>
          <span style={{ fontSize: 11.5, color: MUTE }}>
            {loading
              ? "Reading Linear…"
              : `${issues.filter((i) => ["queue", "unsure", "drops", "proposals"].includes(tabOf(i.labels))).length} open`}
          </span>
          <button onClick={load} style={{ ...btn("none", MUTE, `1px solid ${INK_3}`), marginLeft: "auto", padding: "5px 12px", fontSize: 11.5 }}>
            Refresh
          </button>
        </header>

        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const n = issues.filter((i) => tabOf(i.labels) === t.id).length;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSel(null);
                }}
                style={{
                  background: on ? INK_2 : "transparent",
                  border: `1px solid ${on ? INK_3 : "transparent"}`,
                  borderRadius: 3,
                  color: on ? PAPER : MUTE,
                  padding: "7px 12px",
                  fontSize: 12.5,
                  cursor: "pointer",
                  fontWeight: on ? 600 : 400,
                }}
              >
                {t.label} <span style={{ color: on ? SIGNAL : MUTE, fontWeight: 700 }}>{n}</span>
              </button>
            );
          })}
        </nav>
        <p style={{ fontSize: 11.5, color: MUTE, margin: "6px 0 12px", paddingLeft: 12 }}>
          {TABS.find((t) => t.id === tab)?.hint}
        </p>

        {tab === "queue" && lenses.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingLeft: 12 }}>
            <span style={{ fontSize: 10.5, letterSpacing: ".08em", color: MUTE }}>ORDER WITHIN EACH PRIORITY BY</span>
            <select
              value={activeLens?.id || ""}
              onChange={(e) => chooseLens(e.target.value)}
              style={{
                background: INK_2,
                border: `1px solid ${INK_3}`,
                borderRadius: 3,
                color: PAPER,
                fontSize: 12,
                padding: "4px 8px",
                fontFamily: "inherit",
              }}
            >
              {lenses.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {listErr && (
          <div style={{ padding: 15, borderRadius: 4, background: "rgba(227,100,79,.1)", border: "1px solid rgba(227,100,79,.35)", color: ALERT, fontSize: 13 }}>
            {listErr}
            <div style={{ color: MUTE, marginTop: 6 }}>Check LINEAR_API_KEY and LINEAR_TEAM_KEY in your Vercel environment variables.</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: sel ? "minmax(240px, 360px) 1fr" : "1fr", gap: 14, alignItems: "start" }}>
          <div>
            {inTab.length === 0 && !loading && !listErr && (
              <p style={{ color: MUTE, fontSize: 13 }}>Nothing here. The routines run through the day.</p>
            )}
            {inTab.map((i) => {
              const on = sel?.id === i.id;
              return (
                <button
                  key={i.key}
                  onClick={() => setSel(i)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: on ? INK_3 : INK_2,
                    border: `1px solid ${INK_3}`,
                    borderLeft: `3px solid ${i.priority === 1 ? ALERT : i.priority === 2 ? SIGNAL : INK_3}`,
                    borderRadius: 4,
                    padding: "11px 13px",
                    marginBottom: 7,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: PAPER,
                  }}
                >
                  <span style={{ fontSize: 9.5, letterSpacing: ".1em", color: MUTE, fontWeight: 700 }}>{i.key}</span>
                  {i.rank && (
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: ".05em",
                        color: SIGNAL,
                        border: `1px solid ${SIGNAL}`,
                        borderRadius: 2,
                        padding: "1px 5px",
                        marginLeft: 6,
                      }}
                    >
                      {i.rank.position}/{i.rank.of}
                    </span>
                  )}
                  <div style={{ fontSize: 13, lineHeight: 1.4, marginTop: 4 }}>{i.title}</div>
                </button>
              );
            })}
          </div>

          {sel && (
            <article style={{ background: INK_2, border: `1px solid ${INK_3}`, borderLeft: `3px solid ${accent}`, borderRadius: 4, padding: "18px 20px", position: "sticky", top: 16 }}>
              {!detail && <p style={{ color: MUTE, fontSize: 13, margin: 0 }}>Reading {sel.key}…</p>}
              {detail?.error && <p style={{ color: ALERT, fontSize: 13 }}>{detail.error}</p>}

              {detail?.issue && (
                <>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontSize: 10, letterSpacing: ".12em", color: MUTE, fontWeight: 700 }}>{detail.issue.key}</span>
                    <h2 style={{ margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 600, flex: 1 }}>{detail.issue.title}</h2>
                    <a href={detail.issue.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: MUTE }}>
                      Linear ↗
                    </a>
                  </div>

                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
                    {detail.issue.labels.map((l) => (
                      <span key={l} style={{ fontSize: 9, letterSpacing: ".06em", color: MUTE, border: `1px solid ${INK_3}`, borderRadius: 2, padding: "2px 6px" }}>
                        {l}
                      </span>
                    ))}
                  </div>

                  <Spine breakdown={p?.breakdown} total={p?.score} />

                  {p?.rank && (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: MUTE, lineHeight: 1.5 }}>
                      <span style={{ color: SIGNAL, fontWeight: 700 }}>
                        {p.rank.position} of {p.rank.of} in {p.rank.band}
                      </span>
                      {p.rank.reason ? ` — ${p.rank.reason}` : ""}
                    </p>
                  )}

                  {p?.context && (
                    <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.6, color: "#B9C6D2", whiteSpace: "pre-wrap" }}>{p.context}</p>
                  )}

                  {tab === "proposals" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
                      <button disabled={busy} onClick={() => act("proposal", { approve: true })} style={btn(LIVE, INK)}>
                        Approve
                      </button>
                      <button disabled={busy} onClick={() => act("proposal", { approve: false })} style={btn("transparent", MUTE, `1px solid ${INK_3}`)}>
                        Not yet
                      </button>
                    </div>
                  )}

                  {(tab === "drops" || tab === "unsure") && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 7 }}>
                        {tab === "unsure" ? "WHICH BUCKET" : "WAS THIS RIGHT"}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {BUCKETS.map((b) => (
                          <button key={b.id} disabled={busy} onClick={() => act("bucket", { bucket: b.id })} style={btn("transparent", b.id === "keep-dropped" ? MUTE : b.color, `1px solid ${b.color}`)}>
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The standalone "Park until…" button used to live here.
                      Removed — "park this until Monday" or "remind me next
                      week" typed into the magic box now routes through its
                      quiet shape, which resolves the date and snoozes the
                      same way this button used to, using the exact same
                      snooze action underneath. */}


                  {tab !== "proposals" && tab !== "drops" && tab !== "unsure" && p?.options?.length > 0 && (
                    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 5 }}>
                      {p.options.map((o) => {
                        const open = pending?.n === o.n;
                        // The draft belonging to THIS option — numbered draft
                        // if 1B wrote one, falling back to the legacy single
                        // draft for older tickets. Two options never share
                        // one draft; that was the bug.
                        const optDraft = p.drafts?.[String(o.n)] || (p.draft ? { text: p.draft, at: p.draftAt, stale: p.stale, legacy: true } : null);
                        return (
                          <div key={o.n}>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setPending(open ? null : o);
                                setDraft(optDraft?.text || "");
                              }}
                              style={{
                                ...btn(open ? INK_3 : "transparent", o.manual ? MUTE : PAPER, `1px solid ${open ? accent : INK_3}`),
                                textAlign: "left",
                                fontWeight: 400,
                                padding: "9px 12px",
                                fontSize: 13,
                                width: "100%",
                              }}
                            >
                              <span style={{ color: accent, fontWeight: 700, marginRight: 8 }}>{o.n}</span>
                              {o.text}
                              {o.manual && <span style={{ fontSize: 9, letterSpacing: ".1em", marginLeft: 8, color: SIGNAL }}>YOU DO THIS</span>}
                            </button>

                            {open && (
                              <div style={{ border: `1px solid ${accent}`, borderTop: "none", borderRadius: "0 0 3px 3px", padding: "12px 13px", background: INK }}>
                                {o.manual ? (
                                  <p style={{ margin: "0 0 10px", fontSize: 12.5, color: MUTE, lineHeight: 1.55 }}>
                                    This one is yours to do. Confirming records the choice and closes the
                                    card — it does not do anything on your behalf.
                                  </p>
                                ) : optDraft ? (
                                  <>
                                    <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 6 }}>
                                      WORDING {optDraft.legacy && <span style={{ color: MUTE }}>· SHARED, PRE-FIX</span>}
                                      {draft.trim() !== (optDraft.text || "").trim() && <span style={{ color: SIGNAL }}> · EDITED</span>}
                                      {optDraft.stale && <span style={{ color: ALERT }}> · OVER 48H OLD</span>}
                                    </div>
                                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} style={box} />
                                    <p style={{ margin: "7px 0 10px", fontSize: 11.5, color: MUTE, lineHeight: 1.5 }}>
                                      Emails are prepared as Gmail drafts for you to send. Slack and Linear
                                      actions go out directly.
                                    </p>
                                  </>
                                ) : (
                                  <p style={{ margin: "0 0 10px", fontSize: 12.5, color: MUTE, lineHeight: 1.55 }}>
                                    Nothing to write for this one.
                                  </p>
                                )}

                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    disabled={busy}
                                    onClick={() => {
                                      const edited = optDraft && draft.trim() !== (optDraft.text || "").trim();
                                      const payload = { n: o.n, draft: edited ? draft : null };
                                      setPending(null);
                                      act("choose", payload);
                                    }}
                                    style={btn(LIVE, INK)}
                                  >
                                    {busy ? "Working…" : o.manual ? "Mark done" : optDraft ? "Confirm and prepare" : "Confirm"}
                                  </button>
                                  <button disabled={busy} onClick={() => setPending(null)} style={btn("transparent", MUTE, `1px solid ${INK_3}`)}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ marginTop: 16, borderTop: `1px solid ${INK_3}`, paddingTop: 13 }}>
                    <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 8 }}>
                      TYPE ANYTHING — DELEGATE, REPLY, A NOTE, A QUESTION
                    </div>

                    {/* One real timeline — everything that's happened on
                        this ticket, in the order it actually happened.
                        Sources (for a Routine 5 answer) render as a
                        collapsible detail on that specific row, same as
                        before, just no longer split into a separate block
                        rendered elsewhere on the page. */}
                    {history.length > 0 && (
                      <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                        {history.map((row, i) => (
                          <div key={i} style={{ fontSize: 12, lineHeight: 1.55 }}>
                            <span style={{ fontSize: 9, letterSpacing: ".08em", color: row.color, fontWeight: 700, marginRight: 6 }}>
                              {row.label}
                            </span>
                            <span style={{ color: row.label === "ASKING YOU" || row.label === "ANSWER" ? PAPER : "#B9C6D2", whiteSpace: "pre-wrap" }}>
                              {row.body}
                            </span>
                            {row.sources?.length > 0 && (
                              <details style={{ marginTop: 4 }}>
                                <summary style={{ cursor: "pointer", color: MUTE, fontSize: 11 }}>
                                  Where this came from ({row.sources.length})
                                </summary>
                                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: MUTE, fontSize: 11.5, lineHeight: 1.6 }}>
                                  {row.sources.map((sc, j) => (
                                    <li key={j}>{sc}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {asking && <p style={{ fontSize: 12.5, color: COOL, margin: "0 0 10px" }}>Looking into it…</p>}

                    {/* A question with no answer after a few minutes means the
                        explain routine dropped it — the one piece of
                        standalone retry UI kept, since a silently dropped
                        question is a real problem the timeline alone can't
                        surface. */}
                    {!asking &&
                      p?.awaitingAnswer &&
                      p?.thread?.length > 0 &&
                      Date.now() - new Date(p.thread[p.thread.length - 1].at).getTime() > 5 * 60 * 1000 && (
                        <div style={{ marginBottom: 10 }}>
                          <p style={{ fontSize: 12.5, color: ALERT, margin: "0 0 6px" }}>
                            That question never got answered.
                          </p>
                          <button
                            onClick={() => ask(p.thread[p.thread.length - 1].body)}
                            style={btn("transparent", COOL, `1px solid ${COOL}`)}
                          >
                            Ask again
                          </button>
                        </div>
                      )}

                    {magicAck && (
                      <p
                        style={{
                          fontSize: 12,
                          color: magicAck.shape === "error" ? ALERT : SIGNAL,
                          lineHeight: 1.5,
                          margin: "0 0 8px",
                        }}
                      >
                        {magicAck.text}
                      </p>
                    )}

                    <textarea
                      value={magicText}
                      onChange={(e) => setMagicText(e.target.value)}
                      rows={2}
                      placeholder='"Delegate this to Tehreem" · "Already handled, he replied on WhatsApp" · "Remind me in a week"'
                      style={box}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitMagic();
                      }}
                    />
                    {magicText.trim() && (
                      <button disabled={magicBusy} onClick={submitMagic} style={{ ...btn(SIGNAL, INK), marginTop: 7, fontWeight: 700, opacity: magicBusy ? 0.5 : 1 }}>
                        {magicBusy ? "Working…" : "Send"}
                      </button>
                    )}
                  </div>

                  {msg && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "8px 11px",
                        borderRadius: 3,
                        fontSize: 12.5,
                        background: msg.ok ? "rgba(95,201,163,.1)" : "rgba(227,100,79,.12)",
                        color: msg.ok ? LIVE : ALERT,
                        border: `1px solid ${msg.ok ? "rgba(95,201,163,.3)" : "rgba(227,100,79,.35)"}`,
                      }}
                    >
                      {msg.text}
                    </div>
                  )}
                </>
              )}
            </article>
          )}
        </div>
      </div>
    </main>
  );
}
