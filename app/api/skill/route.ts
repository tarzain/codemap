import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const skill = await readFile(path.join(process.cwd(), "SKILL.md"), "utf-8");
  return new NextResponse(skill, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="SKILL.md"',
    },
  });
}
