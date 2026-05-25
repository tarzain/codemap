import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const dir = path.join(process.cwd(), "public", "samples");
  const files = await readdir(dir);
  const samples = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        const raw = await readFile(path.join(dir, f), "utf-8");
        const json = JSON.parse(raw);
        return {
          path: `samples/${f}`,
          name: json.name || f.replace(".json", ""),
          branches: Array.isArray(json.branches) ? json.branches.length : 0,
        };
      })
  );
  return NextResponse.json(samples);
}
