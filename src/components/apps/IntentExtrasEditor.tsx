import type { IntentExtra, IntentExtraType } from "../../lib/adb/quickLaunch";

const TYPE_OPTIONS: { value: IntentExtraType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "boolean", label: "Boolean" },
  { value: "int", label: "Int" },
  { value: "long", label: "Long" },
];

export interface IntentExtrasEditorProps {
  extras: IntentExtra[];
  onChange: (extras: IntentExtra[]) => void;
}

/** Inline key/type/value editor for `am`'s typed extras (`--es`/`--ez`/`--ei`/`--el`) — many
 * deep links and broadcast/service intents expect specific extras set, not just data in a URI. */
export function IntentExtrasEditor({ extras, onChange }: IntentExtrasEditorProps) {
  const update = (index: number, patch: Partial<IntentExtra>) => {
    onChange(extras.map((extra, i) => (i === index ? { ...extra, ...patch } : extra)));
  };
  const remove = (index: number) => onChange(extras.filter((_, i) => i !== index));
  const add = () => onChange([...extras, { type: "string", key: "", value: "" }]);

  return (
    <div className="space-y-1">
      {extras.map((extra, index) => (
        <div key={index} className="flex items-center gap-1">
          <select
            value={extra.type}
            onChange={(e) => update(index, { type: e.target.value as IntentExtraType })}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-300"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={extra.key}
            onChange={(e) => update(index, { key: e.target.value })}
            placeholder="key"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-neutral-200 placeholder:text-neutral-600"
          />
          <input
            value={extra.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder="value"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-neutral-200 placeholder:text-neutral-600"
          />
          <button
            type="button"
            onClick={() => remove(index)}
            aria-label="Remove extra"
            className="shrink-0 text-neutral-600 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
      >
        + Add extra
      </button>
    </div>
  );
}
