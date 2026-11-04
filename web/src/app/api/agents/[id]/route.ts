import { NextResponse } from "next/server";
import { deployment } from "@/lib/config";
import { getBusiness, getJobs } from "@/lib/near/rpc";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id.endsWith(`.${deployment.registry}`)) {
    return NextResponse.json({ error: "Not a Lien business on this deployment." }, { status: 404 });
  }
  try {
    const [agent, jobs] = await Promise.all([getBusiness(id), getJobs(id, 20)]);
    return NextResponse.json({ agent, jobs }, { headers: { "access-control-allow-origin": "*" } });
  } catch {
    return NextResponse.json({ error: "That business could not be read." }, { status: 404 });
  }
}
