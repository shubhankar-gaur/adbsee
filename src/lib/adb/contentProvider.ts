import { escapeArg, type Adb } from "@yume-chan/adb";

export type ContentOperation = "query" | "insert" | "update" | "delete";

/** Matches the `content` shell tool's `--bind col:type:value` syntax. */
export type ContentBindType = "s" | "i" | "l" | "f" | "b" | "null";

export const CONTENT_BIND_TYPE_LABELS: Record<ContentBindType, string> = {
  s: "String",
  i: "Int",
  l: "Long",
  f: "Float",
  b: "Boolean",
  null: "Null",
};

export interface ContentBind {
  column: string;
  type: ContentBindType;
  value: string;
}

export interface ContentRequest {
  uri: string;
  projection?: string;
  where?: string;
  sort?: string;
  binds?: ContentBind[];
}

export function buildContentArgs(op: ContentOperation, req: ContentRequest): string[] {
  const args = ["content", op, "--uri", escapeArg(req.uri)];
  if (req.projection) args.push("--projection", escapeArg(req.projection));
  if (req.where) args.push("--where", escapeArg(req.where));
  if (req.sort) args.push("--sort", escapeArg(req.sort));
  for (const bind of req.binds ?? []) {
    if (!bind.column) continue;
    args.push("--bind", escapeArg(`${bind.column}:${bind.type}:${bind.value}`));
  }
  return args;
}

export async function runContentCommand(
  adb: Adb,
  op: ContentOperation,
  req: ContentRequest,
): Promise<string> {
  return adb.subprocess.noneProtocol.spawnWaitText(buildContentArgs(op, req));
}
