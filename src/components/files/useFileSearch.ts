import { useRef, useState } from "react";
import { escapeArg, type Adb } from "@yume-chan/adb";
import { TextDecoderStream } from "@yume-chan/stream-extra";
import { suShellCommand } from "../../lib/adb/suCommand";

export interface FileSearchOptions {
  regex: boolean;
  rootMode: boolean;
}

/** Recursively searches from a directory downward via `find`, matching results client-side
 * (plain substring or regex) as they stream in — so a search over a big tree shows results
 * progressively instead of blocking until the whole thing finishes, and can be cancelled. */
export function useFileSearch(adb: Adb | null) {
  const [results, setResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const killRef = useRef<(() => void) | null>(null);

  const cancel = () => {
    killRef.current?.();
    killRef.current = null;
    setSearching(false);
  };

  const clear = () => {
    setResults([]);
    setError(null);
  };

  const search = async (
    rootPath: string,
    pattern: string,
    options: FileSearchOptions,
  ): Promise<void> => {
    if (!adb || !pattern) return;

    let matcher: (path: string) => boolean;
    if (options.regex) {
      try {
        const re = new RegExp(pattern, "i");
        matcher = (path) => re.test(path);
      } catch (err) {
        setError(err instanceof Error ? `Invalid regex: ${err.message}` : "Invalid regex");
        return;
      }
    } else {
      const needle = pattern.toLowerCase();
      matcher = (path) => path.toLowerCase().includes(needle);
    }

    setSearching(true);
    setError(null);
    setResults([]);

    // `2>/dev/null` silences "Permission denied" spam from directories the search can't descend
    // into — those just get skipped rather than cluttering results with noise.
    const command = options.rootMode
      ? suShellCommand(`find ${escapeArg(rootPath)} 2>/dev/null`)
      : ["find", escapeArg(rootPath), "2>/dev/null"];

    let buffer = "";
    const consume = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      const matched = lines.filter((line) => line && matcher(line));
      if (matched.length > 0) setResults((prev) => [...prev, ...matched]);
    };

    try {
      const shellProtocol = adb.subprocess.shellProtocol;
      if (shellProtocol) {
        const process = await shellProtocol.spawn(command);
        killRef.current = () => void process.kill();
        const reader = process.stdout.pipeThrough(new TextDecoderStream()).getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            consume(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        consume(await adb.subprocess.noneProtocol.spawnWaitText(command));
      }
      if (buffer && matcher(buffer)) setResults((prev) => [...prev, buffer]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      killRef.current = null;
      setSearching(false);
    }
  };

  return { results, searching, error, search, cancel, clear };
}
