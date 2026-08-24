import { listIssues } from "../../../lib/linear";

export const dynamic = "force-dynamic";

/* ?team=<key> views a sandbox Linear team instead of the real Triage team,
   for testing. Omit it and you get the real team, same as always. This is
   the app-side half of the same override the routines accept as TEAM: in
   their trigger text — same pattern, same purpose, on both sides. */
export async function GET(req) {
  try {
    const team = new URL(req.url).searchParams.get("team") || undefined;
    const issues = await listIssues(team);
    return Response.json({ issues, team: team || null });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
