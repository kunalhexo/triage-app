"use client";

import { useState, useEffect, useCallback } from "react";

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
  if (has("buddy-proposal")) return "proposals";
  if (has("buddy-unsure")) return "unsure";
  if (has("buddy-proposed-drop")) return "drops";
  if (has("buddy-parked")) return "parked";
  if (has("buddy-done")) return "done";
  if (has("for-me") || has("delegate") || has("autonomous")) return "queue";
  return null;
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
  const [note, setNote] = useState("");

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
    if (!sel) return setDetail(null);
    setDetail(null);
    setMsg(null);
    setNote("");
    fetch(`/api/issue/${sel.id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d);
        setDraft(d.parsed?.draft || "");
      })
      .catch((e) => setDetail({ error: e.message }));
  }, [sel?.id]);

  const inTab = issues
    .filter((i) => tabOf(i.labels) === tab)
    .sort((a, b) => (a.priority || 9) - (b.priority || 9) || new Date(b.createdAt) - new Date(a.createdAt));

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
      setNote("");
      load();
      // Re-read the open issue so labels and comments on screen match Linear.
      fetch(`/api/issue/${sel.id}`)
        .then((r) => r.json())
        .then((fresh) => {
          setDetail(fresh);
          setDraft(fresh.parsed?.draft || "");
        })
        .catch(() => {});
    } catch (e) {
      setMsg({ ok: false, text: `${e.message}. Nothing was changed.` });
    } finally {
      setBusy(false);
    }
  }

  const p = detail?.parsed;
  const edited = p?.draft && draft.trim() && draft.trim() !== p.draft.trim();
  const accent =
    tab === "proposals" || tab === "unsure" ? COOL : tab === "drops" ? INK_3 : detail?.issue?.priority === 1 ? ALERT : detail?.issue?.priority === 2 ? SIGNAL : LIVE;

  return (
    <main style={{ background: INK, color: PAPER, minHeight: "100vh", padding: "24px 20px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 13, letterSpacing: ".28em", fontWeight: 700 }}>TRIAGE</h1>
          <span style={{ fontSize: 11.5, color: MUTE }}>{loading ? "Reading Linear…" : `${issues.length} open`}</span>
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
        <p style={{ fontSize: 11.5, color: MUTE, margin: "6px 0 16px", paddingLeft: 12 }}>
          {TABS.find((t) => t.id === tab)?.hint}
        </p>

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
                          <button key={b.id} disabled={busy} onClick={() => act("bucket", { bucket: b.id, text: note })} style={btn("transparent", b.id === "keep-dropped" ? MUTE : b.color, `1px solid ${b.color}`)}>
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {tab !== "proposals" && tab !== "drops" && tab !== "unsure" && p?.options?.length > 0 && (
                    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 5 }}>
                      {p.options.map((o) => (
                        <button
                          key={o.n}
                          disabled={busy}
                          onClick={() => act("choose", { n: o.n, draft: edited ? draft : null, text: note })}
                          style={{ ...btn("transparent", o.manual ? MUTE : PAPER, `1px solid ${INK_3}`), textAlign: "left", fontWeight: 400, padding: "9px 12px", fontSize: 13 }}
                        >
                          <span style={{ color: accent, fontWeight: 700, marginRight: 8 }}>{o.n}</span>
                          {o.text}
                          {o.manual && <span style={{ fontSize: 9, letterSpacing: ".1em", marginLeft: 8, color: SIGNAL }}>YOU DO THIS</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {p?.draft && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 6 }}>
                        DRAFT {edited && <span style={{ color: SIGNAL }}>· EDITED</span>}
                        {p.stale && <span style={{ color: ALERT }}> · OVER 48H OLD</span>}
                      </div>
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} style={box} />
                    </div>
                  )}

                  <div style={{ marginTop: 16, borderTop: `1px solid ${INK_3}`, paddingTop: 13 }}>
                    <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 6 }}>YOUR NOTE</div>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Why this is wrong, what you'd rather it did, or anything else. Plain words."
                      style={box}
                    />
                    {note.trim() && (
                      <button disabled={busy} onClick={() => act("note", { text: note })} style={{ ...btn(SIGNAL, INK), marginTop: 7, fontWeight: 700 }}>
                        Save note
                      </button>
                    )}
                  </div>

                  {p?.feedback?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 9, letterSpacing: ".12em", color: MUTE, fontWeight: 700, marginBottom: 6 }}>EARLIER NOTES</div>
                      {p.feedback.map((f, k) => (
                        <p key={k} style={{ fontSize: 12, color: MUTE, lineHeight: 1.5, margin: "0 0 6px" }}>
                          {f.body}
                        </p>
                      ))}
                    </div>
                  )}

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
