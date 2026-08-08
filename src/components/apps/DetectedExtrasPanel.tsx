import type { DetectedExtra } from "../../lib/dex/extraKeyScanner";
import type { IntentExtra } from "../../lib/adb/quickLaunch";

export interface DetectedExtrasPanelProps {
  results: DetectedExtra[];
  onAddToExtras: (extra: IntentExtra) => void;
}

function ExtraRow({ extra, onAddToExtras }: { extra: DetectedExtra; onAddToExtras: (extra: IntentExtra) => void }) {
  const editableAs = extra.editableAs;
  const key = extra.key;
  return (
    <div className="flex items-center justify-between gap-2 pl-2">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-neutral-300">{key ?? "(key unknown)"}</span>
        <span className="ml-2 text-neutral-600">{extra.detectedType}</span>
        {extra.confidence === "unknown-key" && (
          <span className="ml-2 text-amber-300" title="Key wasn't a plain string literal at the call site">
            unconfirmed
          </span>
        )}
        {editableAs === null && (
          <span className="ml-2 text-neutral-600" title="No am start --e* flag can construct this type">
            not launchable from here
          </span>
        )}
      </div>
      {editableAs !== null && key !== null && (
        <button
          type="button"
          onClick={() => onAddToExtras({ type: editableAs, key, value: "" })}
          className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800"
        >
          + Add to extras
        </button>
      )}
    </div>
  );
}

/** Results of the best-effort DEX scan for a component's Intent/Bundle extras (see
 * `src/lib/dex/extraKeyScanner.ts` for what it can and can't find). `Intent.get*Extra` matches
 * are shown as confident findings; `Bundle`/`BaseBundle` matches are shown separately and
 * labeled as possibly unrelated, since `onCreate(Bundle savedInstanceState)` produces
 * identical-looking calls this scan can't distinguish from real intent extras. */
export function DetectedExtrasPanel({ results, onAddToExtras }: DetectedExtrasPanelProps) {
  const intentExtras = results.filter((r) => r.tier === "intent");
  const bundleExtras = results.filter((r) => r.tier === "bundle");

  if (results.length === 0) {
    return (
      <p className="pl-2 text-neutral-600">
        No Intent/Bundle getter calls found in this component's own class or its superclass
        chain — it may build the key dynamically (concatenation, a constant field, a resource),
        the key string may be obfuscated, or it simply doesn't read any.
      </p>
    );
  }

  return (
    <div className="space-y-2 pl-2">
      {intentExtras.length > 0 && (
        <div className="space-y-1">
          <div className="font-semibold text-neutral-500">Intent extras</div>
          {intentExtras.map((extra, i) => (
            <ExtraRow key={i} extra={extra} onAddToExtras={onAddToExtras} />
          ))}
        </div>
      )}
      {bundleExtras.length > 0 && (
        <div className="space-y-1">
          <div className="font-semibold text-neutral-500" title="onCreate(Bundle savedInstanceState) looks identical to this scan — these may not be intent extras at all">
            Possibly extras (Bundle — unconfirmed source)
          </div>
          {bundleExtras.map((extra, i) => (
            <ExtraRow key={i} extra={extra} onAddToExtras={onAddToExtras} />
          ))}
        </div>
      )}
    </div>
  );
}
