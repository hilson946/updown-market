import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const file = path.resolve(process.cwd(), "../../packages/shared/src/deployments/localhost.json");
    const deployment = JSON.parse(await readFile(file, "utf8"));
    return NextResponse.json(deployment);
  } catch {
    return NextResponse.json(
      {
        error: "LOCAL_DEPLOYMENT_NOT_FOUND",
        message: "Run pnpm deploy:local after starting Anvil.",
      },
      { status: 404 },
    );
  }
}
