// The app has never talked to Notion before — everything so far has been
// Linear only. This is a deliberately narrow exception: read Entities so
// the magic box's classifier knows who people are, and write one new field
// ("Recent context") when a resolved ticket implies a durable fact worth
// remembering. Nothing else in Notion is touched from here — not the
// Learning Store, not Signals, not the Backlog. Those stay the routines'
// exclusive domain.

const NOTION_VERSION = "2022-06-28";
const ENTITIES_DB_ID = process.env.NOTION_ENTITIES_DB_ID;

async function notion(path, body, method = "POST") {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set in the environment.");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `Notion API error (HTTP ${res.status})`);
  return json;
}

function plainText(richTextArray) {
  return (richTextArray || []).map((t) => t.plain_text).join("");
}

/* Every Entities row, in a compact shape — this goes straight into the
   classifier's prompt on every call, so it stays lean rather than sending
   full page objects. Entities is a few dozen rows at most; fetching all of
   it every time is cheap and simpler than trying to guess relevance
   client-side without AI. */
export async function getEntities() {
  if (!ENTITIES_DB_ID) throw new Error("NOTION_ENTITIES_DB_ID is not set in the environment.");
  const data = await notion(`/databases/${ENTITIES_DB_ID}/query`, { page_size: 100 });
  return data.results.map((page) => {
    const p = page.properties;
    return {
      pageId: page.id,
      name: plainText(p.Name?.title),
      type: p.Type?.select?.name || "",
      aliases: plainText(p.Aliases?.rich_text),
      workstream: (p.Workstream?.multi_select || []).map((o) => o.name),
      description: plainText(p.Description?.rich_text),
      recentContext: plainText(p["Recent context"]?.rich_text),
    };
  });
}

/* Appends one new fact to an entity's running context, rather than
   overwriting it — this is the accumulation item 15 was always meant to
   build, kept separate from Description (the stable identity summary) so
   the two don't get tangled together over time. */
export async function appendEntityContext(pageId, fact, dateLabel) {
  const existing = await notion(`/pages/${pageId}`, null, "GET");
  const current = plainText(existing.properties?.["Recent context"]?.rich_text);
  const line = `${dateLabel} — ${fact}`;
  const updated = current ? `${current}\n${line}` : line;
  await notion(`/pages/${pageId}`, {
    properties: { "Recent context": { rich_text: [{ text: { content: updated.slice(-1900) } }] } },
  }, "PATCH");
}
