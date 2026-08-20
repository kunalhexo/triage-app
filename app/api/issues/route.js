import { listIssues } from "../../../lib/linear";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const issues = await listIssues();
    return Response.json({ issues });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
