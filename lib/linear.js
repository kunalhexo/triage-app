import { extractRankAndScore } from "./comments";

// Everything the app shows or changes goes through Linear's GraphQL API.
// No model is involved in reading or writing. That is deliberate: this is
// database work, and every failure in the earlier version came from asking
// a language model to do it.

const ENDPOINT = "https://api.linear.app/graphql";

async function gql(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error("LINEAR_API_KEY is not set in the environment.");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const TEAM_KEY = process.env.LINEAR_TEAM_KEY || "TRI";

/* Cached for the life of the serverless instance. Label ids rarely change
   and we need names to ids on every write. */
let labelCache = null;
let stateCache = null;

export async function getLabels() {
  if (labelCache) return labelCache;
  const d = await gql(
    `query($key:String!){ teams(filter:{key:{eq:$key}}){ nodes{ id labels(first:100){ nodes{ id name } } } } }`,
    { key: TEAM_KEY }
  );
  const team = d.teams.nodes[0];
  if (!team) throw new Error(`No Linear team with key ${TEAM_KEY}.`);
  labelCache = { teamId: team.id, byName: Object.fromEntries(team.labels.nodes.map((l) => [l.name, l.id])) };
  return labelCache;
}

export async function getStates() {
  if (stateCache) return stateCache;
  const d = await gql(
    `query($key:String!){ teams(filter:{key:{eq:$key}}){ nodes{ states(first:50){ nodes{ id name } } } } }`,
    { key: TEAM_KEY }
  );
  stateCache = Object.fromEntries(d.teams.nodes[0].states.nodes.map((s) => [s.name, s.id]));
  return stateCache;
}

/* One call, up to 250 issues, everything the list needs — including enough
   of each issue's comments to sort by rank and score, not just priority
   band. This is a plain GraphQL query with no AI in the path, so fetching a
   few extra comments per issue costs network size, not judgment or tokens.

   No sandbox-team override here. There was one — `?team=` selected which
   team this function read — but it only ever touched the read path.
   getIssue, addComment, setLabels and setState all still hardcoded the real
   Triage team regardless, so a sandbox test could show sandbox tickets in
   the list while every click and every write silently landed on real
   Triage. Partial protection that looks complete is worse than none.
   Removed rather than left half-built; a real sandbox capability would need
   every write path covered, not just this one. */
export async function listIssues() {
  // Two real bugs, found live: (1) this fetched a flat first:250 with no
  // pagination at all, so once the team genuinely had more than 250 matching
  // tickets — which happens after a few weeks — the query silently
  // truncated and the app's "N open" header reported the cap forever,
  // never the truth. (2) the state filter excluded canceled/duplicate but
  // not completed, so Done tickets were being counted as "open" too,
  // independent of the cap. Fixed: real cursor pagination (bounded at 20
  // pages / 5000 issues as a sanity ceiling, not a silent one), and Done
  // tickets older than 60 days drop out of the fetch entirely — old history
  // nobody's looking at shouldn't cost a page load forever. Recent Done
  // tickets still come through, so the Done tab keeps working.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  let all = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const d = await gql(
      `query($key:String!,$after:String){
        issues(
          filter:{
            team:{ key:{ eq:$key } }
            state:{ type:{ nin:["canceled","duplicate"] } }
            or:[
              { state:{ type:{ neq:"completed" } } }
              { updatedAt:{ gt:"${sixtyDaysAgo}" } }
            ]
          }
          first:250
          after:$after
          orderBy:createdAt
        ){
          nodes{
            id identifier title priority createdAt url
            state{ name type }
            labels(first:20){ nodes{ name } }
            comments(first:10){ nodes{ body createdAt } }
          }
          pageInfo{ hasNextPage endCursor }
        }
      }`,
      { key: TEAM_KEY, after: cursor }
    );
    all = all.concat(d.issues.nodes);
    if (!d.issues.pageInfo.hasNextPage) break;
    cursor = d.issues.pageInfo.endCursor;
  }
  return all.map((n) => {
    const { score, rank, scores, ranks } = extractRankAndScore(n.comments.nodes);
    return {
      id: n.id,
      key: n.identifier,
      title: n.title,
      priority: n.priority,
      createdAt: n.createdAt,
      url: n.url,
      state: n.state.name,
      labels: n.labels.nodes.map((l) => l.name),
      score,
      rank,
      scores,
      ranks,
    };
  });
}

export async function getIssue(key) {
  const d = await gql(
    `query($key:String!){
      issue(id:$key){
        id identifier title description priority url
        state{ name }
        labels(first:20){ nodes{ id name } }
        comments(first:50){ nodes{ id body createdAt user{ email name } } }
      }
    }`,
    { key }
  );
  const i = d.issue;
  if (!i) return null;
  return {
    id: i.id,
    key: i.identifier,
    title: i.title,
    description: i.description || "",
    priority: i.priority,
    url: i.url,
    state: i.state.name,
    labels: i.labels.nodes.map((l) => l.name),
    labelIds: Object.fromEntries(i.labels.nodes.map((l) => [l.name, l.id])),
    comments: i.comments.nodes.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: c.user?.email || "routine",
      authorName: c.user?.name || "Buddy",
    })),
  };
}

export async function addComment(issueId, body) {
  await gql(`mutation($id:String!,$body:String!){ commentCreate(input:{issueId:$id,body:$body}){ success } }`, {
    id: issueId,
    body,
  });
}

/* Replaces the full label set.
   `keepIds` are ids already on the issue, passed straight through so that
   workspace-level labels (which are not in the team's label list) survive.
   `addNames` are looked up by name. Unknown names throw rather than being
   dropped silently, because a missing label means a broken workflow. */
export async function setLabels(issueId, keepIds, addNames = []) {
  const { byName } = await getLabels();
  const addIds = addNames.map((n) => {
    const id = byName[n];
    if (!id) throw new Error(`No label called "${n}" on team ${TEAM_KEY}. Create it in Linear first.`);
    return id;
  });
  const ids = [...new Set([...keepIds, ...addIds])];
  await gql(`mutation($id:String!,$ids:[String!]!){ issueUpdate(id:$id,input:{labelIds:$ids}){ success } }`, {
    id: issueId,
    ids,
  });
}

export async function setState(issueId, stateName) {
  const states = await getStates();
  const stateId = states[stateName];
  if (!stateId) throw new Error(`No state called "${stateName}" on this team.`);
  await gql(`mutation($id:String!,$s:String!){ issueUpdate(id:$id,input:{stateId:$s}){ success } }`, {
    id: issueId,
    s: stateId,
  });
}

/* Fires a Claude routine immediately instead of waiting for its schedule.
   Optional — if the env vars are absent the app still works, the routine
   just picks the work up on its next run.

   `which` picks the routine: "execute" for Routine 2, "explain" for Routine 5.
   `text` is passed through to the routine as runtime context, so the question
   arrives with the request rather than the routine having to hunt for it.

   Note: routine runs draw on the same daily allowance as your scheduled
   routines. A 429 here means the allowance is spent, not that anything
   is broken. */
export async function triggerRoutine(which = "execute", text = null) {
  const url =
    which === "explain"
      ? process.env.EXPLAIN_TRIGGER_URL || process.env.ROUTINE_TRIGGER_URL
      : process.env.ROUTINE_TRIGGER_URL;
  const token =
    which === "explain"
      ? process.env.EXPLAIN_TRIGGER_TOKEN || process.env.ROUTINE_TRIGGER_TOKEN
      : process.env.ROUTINE_TRIGGER_TOKEN;

  if (!url || !token) return { triggered: false, reason: "No routine trigger configured." };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(text ? { text } : {}),
  });

  if (res.status === 429) {
    return { triggered: false, rateLimited: true, retryAfter: res.headers.get("retry-after") };
  }
  return { triggered: res.ok, status: res.status };
}
