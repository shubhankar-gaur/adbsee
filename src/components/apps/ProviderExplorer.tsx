import { useState } from "react";
import type { Adb } from "@yume-chan/adb";
import {
  CONTENT_BIND_TYPE_LABELS,
  runContentCommand,
  type ContentBind,
  type ContentBindType,
  type ContentOperation,
} from "../../lib/adb/contentProvider";

const OPERATIONS: ContentOperation[] = ["query", "insert", "update", "delete"];
const BIND_TYPES = Object.keys(CONTENT_BIND_TYPE_LABELS) as ContentBindType[];

export function ProviderExplorer({
  adb,
  suggestedAuthorities,
}: {
  adb: Adb | null;
  suggestedAuthorities: string[];
}) {
  const [operation, setOperation] = useState<ContentOperation>("query");
  const [uri, setUri] = useState("");
  const [projection, setProjection] = useState("");
  const [where, setWhere] = useState("");
  const [sort, setSort] = useState("");
  const [binds, setBinds] = useState<ContentBind[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addBind = () => setBinds([...binds, { column: "", type: "s", value: "" }]);
  const updateBind = (i: number, patch: Partial<ContentBind>) => {
    const next = binds.slice();
    next[i] = { ...next[i], ...patch };
    setBinds(next);
  };
  const removeBind = (i: number) => setBinds(binds.filter((_, idx) => idx !== i));

  const run = async () => {
    if (!adb || !uri) return;
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const result = await runContentCommand(adb, operation, {
        uri,
        projection: projection || undefined,
        where: where || undefined,
        sort: sort || undefined,
        binds,
      });
      setOutput(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded border border-neutral-800 p-3">
      <div className="text-xs font-semibold text-neutral-500">Content Provider Explorer</div>

      {suggestedAuthorities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestedAuthorities.map((authority) => (
            <button
              key={authority}
              type="button"
              onClick={() => setUri(`content://${authority}/`)}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              {authority}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as ContentOperation)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
        >
          {OPERATIONS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <input
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="content://authority/path"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-600"
        />
      </div>

      {operation === "query" && (
        <div className="flex gap-1.5">
          <input
            value={projection}
            onChange={(e) => setProjection(e.target.value)}
            placeholder="Projection (col1,col2)"
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
          />
          <input
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            placeholder="Sort order"
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
          />
        </div>
      )}

      {(operation === "query" || operation === "update" || operation === "delete") && (
        <input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Where clause (e.g. _id=1)"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
        />
      )}

      {(operation === "insert" || operation === "update") && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Values</span>
            <button
              type="button"
              onClick={addBind}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Add value
            </button>
          </div>
          {binds.map((bind, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={bind.column}
                onChange={(e) => updateBind(i, { column: e.target.value })}
                placeholder="column"
                className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
              />
              <select
                value={bind.type}
                onChange={(e) => updateBind(i, { type: e.target.value as ContentBindType })}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
              >
                {BIND_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CONTENT_BIND_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <input
                value={bind.value}
                onChange={(e) => updateBind(i, { value: e.target.value })}
                placeholder="value"
                className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={() => removeBind(i)}
                className="text-neutral-500 hover:text-red-300"
                aria-label="Remove value"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={busy || !adb || !uri}
        onClick={() => void run()}
        className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>

      {error && <div className="rounded border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">{error}</div>}

      {output !== null && (
        <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs whitespace-pre-wrap text-neutral-300">
          {output || "(no output)"}
        </pre>
      )}
    </div>
  );
}
