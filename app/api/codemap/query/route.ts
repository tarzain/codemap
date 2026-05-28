import { NextResponse } from "next/server";
import type { CodemapAssistantResult, CodemapData, SuggestedBranchPayload } from "@/lib/types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const EMPTY_SUGGESTED_BRANCH: SuggestedBranchPayload = {
  name: "",
  region: "",
  position: [0, 0],
  icon: "tent",
  author: "—",
  commits: 0,
  ahead: 0,
  behind: 0,
  lastCommit: "—",
  message: "",
  reviewers: [],
};

const ASSISTANT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["link_existing", "create_suggested", "answer"] },
    message: { type: "string" },
    targetName: { type: "string" },
    suggestedBranch: {
      type: "object",
      properties: {
        name: { type: "string" },
        region: { type: "string" },
        position: {
          type: "array",
          items: { type: "number" },
        },
        icon: { type: "string" },
        author: { type: "string" },
        commits: { type: "integer" },
        ahead: { type: "integer" },
        behind: { type: "integer" },
        lastCommit: { type: "string" },
        message: { type: "string" },
        reviewers: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "name",
        "region",
        "position",
        "icon",
        "author",
        "commits",
        "ahead",
        "behind",
        "lastCommit",
        "message",
        "reviewers",
      ],
      additionalProperties: false,
    },
  },
  required: ["action", "message", "targetName", "suggestedBranch"],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Claude is not configured. Set ANTHROPIC_API_KEY on the server." },
      { status: 503 }
    );
  }

  let body: { command?: unknown; codemap?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const command = typeof body.command === "string" ? body.command.trim() : "";
  const codemap = body.codemap as CodemapData | undefined;
  if (!command) return NextResponse.json({ error: "Missing command." }, { status: 400 });
  if (!isCodemapData(codemap)) {
    return NextResponse.json({ error: "Missing or invalid codemap." }, { status: 400 });
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 1600,
      system: systemPrompt(codemap),
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              command,
              codemap,
            },
            null,
            2
          ),
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: ASSISTANT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `Claude request failed (${response.status}): ${text.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const json = await response.json();
  if (json.stop_reason === "refusal") {
    return NextResponse.json({ error: "Claude refused this request." }, { status: 422 });
  }
  if (json.stop_reason === "max_tokens") {
    return NextResponse.json(
      { error: "Claude response was truncated. Try a narrower command." },
      { status: 502 }
    );
  }

  const text = json.content?.find((part: { type?: string }) => part.type === "text")?.text;
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Claude returned no structured text." }, { status: 502 });
  }

  try {
    const result = normalizeResult(JSON.parse(text), codemap);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid Claude response: ${(error as Error).message}` },
      { status: 502 }
    );
  }
}

function systemPrompt(codemap: CodemapData): string {
  const regionIds = Object.keys(codemap.regions).join(", ");
  return [
    "You help users search and extend a visual codemap.",
    "Prefer linking an existing branch, milestone, hotpatch, or suggested entry when it reasonably satisfies the command.",
    "Only create a new suggested branch when no existing entry fits.",
    `Use only these existing region IDs for new suggestions: ${regionIds}.`,
    "Place new suggestions near related existing entries. Avoid duplicate names and exact duplicate positions.",
    "Return concise UI-facing text in message.",
    "For action=link_existing, set targetName to an exact existing entry name and use an empty suggestedBranch object with default values.",
    "For action=answer, set targetName to an empty string and use an empty suggestedBranch object with default values.",
    "For action=create_suggested, fill every suggestedBranch field. Use author and lastCommit as em dash when unknown.",
  ].join("\n");
}

function normalizeResult(raw: unknown, codemap: CodemapData): CodemapAssistantResult {
  if (!raw || typeof raw !== "object") throw new Error("Result is not an object.");
  const result = raw as CodemapAssistantResult;
  const entries = new Set(codemap.branches.map((branch) => branch.name));
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : "Claude returned a result.";

  if (result.action === "link_existing") {
    if (entries.has(result.targetName)) {
      return { ...result, message, suggestedBranch: EMPTY_SUGGESTED_BRANCH };
    }
    return {
      action: "answer",
      message: `Claude referenced "${result.targetName}", but that entry does not exist in this codemap.`,
      targetName: "",
      suggestedBranch: EMPTY_SUGGESTED_BRANCH,
    };
  }

  if (result.action === "create_suggested") {
    const branch = normalizeSuggestedBranch(result.suggestedBranch);
    if (!branch.name) throw new Error("Suggested branch is missing a name.");
    if (entries.has(branch.name)) {
      return {
        action: "link_existing",
        message,
        targetName: branch.name,
        suggestedBranch: EMPTY_SUGGESTED_BRANCH,
      };
    }
    if (!codemap.regions[branch.region]) {
      return {
        action: "answer",
        message: `Claude suggested region "${branch.region}", but that region does not exist in this codemap.`,
        targetName: "",
        suggestedBranch: EMPTY_SUGGESTED_BRANCH,
      };
    }
    return {
      action: "create_suggested",
      message,
      targetName: branch.name,
      suggestedBranch: branch,
    };
  }

  if (result.action === "answer") {
    return {
      action: "answer",
      message,
      targetName: "",
      suggestedBranch: EMPTY_SUGGESTED_BRANCH,
    };
  }

  throw new Error(`Unknown action "${String(result.action)}".`);
}

function normalizeSuggestedBranch(branch: SuggestedBranchPayload): SuggestedBranchPayload {
  if (!branch || typeof branch !== "object") throw new Error("Missing suggested branch.");
  const position = Array.isArray(branch.position) && branch.position.length >= 2
    ? [Number(branch.position[0]) || 0, Number(branch.position[1]) || 0]
    : [0, 0];

  return {
    name: String(branch.name || "").trim(),
    region: String(branch.region || "").trim(),
    position: position as [number, number],
    icon: String(branch.icon || "tent").trim() || "tent",
    author: String(branch.author || "—").trim() || "—",
    commits: Number.isFinite(branch.commits) ? branch.commits : 0,
    ahead: Number.isFinite(branch.ahead) ? branch.ahead : 0,
    behind: Number.isFinite(branch.behind) ? branch.behind : 0,
    lastCommit: String(branch.lastCommit || "—").trim() || "—",
    message: String(branch.message || "").trim(),
    reviewers: Array.isArray(branch.reviewers) ? branch.reviewers.map(String) : [],
  };
}

function isCodemapData(value: unknown): value is CodemapData {
  if (!value || typeof value !== "object") return false;
  const codemap = value as CodemapData;
  return (
    typeof codemap.name === "string" &&
    !!codemap.regions &&
    typeof codemap.regions === "object" &&
    Array.isArray(codemap.branches)
  );
}
