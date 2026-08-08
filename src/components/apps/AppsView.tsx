import { useMemo, useRef, type ChangeEvent } from "react";
import { useAdbStore } from "../../state/useAdbStore";
import { useAppsStore } from "../../state/useAppsStore";
import { useAppManager } from "./useAppManager";
import { usePackageComponents } from "./usePackageComponents";
import { AppDetailPanel } from "./AppDetailPanel";

export function AppsView() {
  const adb = useAdbStore((s) => s.adb);
  const {
    packages,
    thirdPartyOnly,
    setThirdPartyOnly,
    loading,
    error,
    busyPackage,
    refresh,
    install,
    uninstall,
    forceStop,
    clearData,
    pullApk,
  } = useAppManager(adb);
  const {
    cache: componentCache,
    loadingPkg,
    error: componentError,
    fetchComponents,
    rescan,
  } = usePackageComponents(adb);

  const search = useAppsStore((s) => s.search);
  const setSearch = useAppsStore((s) => s.setSearch);
  const selectedPackage = useAppsStore((s) => s.selectedPackage);
  const setSelectedPackage = useAppsStore((s) => s.setSelectedPackage);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => packages.filter((p) => p.packageName.toLowerCase().includes(search.toLowerCase())),
    [packages, search],
  );

  const selectedEntry = useMemo(
    () => (selectedPackage ? packages.find((p) => p.packageName === selectedPackage) : undefined),
    [packages, selectedPackage],
  );

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void install(file);
  };

  const handleUninstall = (pkg: string) => {
    if (window.confirm(`Uninstall "${pkg}"?`)) void uninstall(pkg);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search packages"
          className="w-56 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200 placeholder:text-neutral-600"
        />
        <label className="flex items-center gap-1.5 text-neutral-400">
          <input
            type="checkbox"
            checked={thirdPartyOnly}
            onChange={(e) => {
              setThirdPartyOnly(e.target.checked);
              refresh();
            }}
          />
          Third-party only
        </label>
        <button
          type="button"
          onClick={refresh}
          className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded bg-emerald-500 px-2 py-1 font-medium text-black hover:bg-emerald-400"
        >
          Install APK
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".apk"
          className="hidden"
          onChange={handleFileSelected}
        />
        {loading && <span className="text-neutral-500">Loading…</span>}
        <span className="text-neutral-500">{filtered.length.toLocaleString()} packages</span>
      </div>

      {(error ?? componentError) && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error ?? componentError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-auto border-r border-neutral-800">
          {filtered.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-neutral-600">No packages found.</div>
          ) : (
            filtered.map((pkg) => {
              const isSelected = pkg.packageName === selectedPackage;
              const scanned = componentCache.has(pkg.packageName);
              return (
                <button
                  key={pkg.packageName}
                  type="button"
                  onClick={() => setSelectedPackage(pkg.packageName)}
                  className={`flex w-full items-center gap-2 border-b border-neutral-900 px-3 py-1.5 text-left text-sm ${
                    isSelected ? "bg-neutral-800" : "hover:bg-neutral-900"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${scanned ? "bg-emerald-500" : "bg-transparent"}`}
                    title={scanned ? "Already scanned this session" : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-neutral-100">{pkg.packageName}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selectedEntry ? (
          <AppDetailPanel
            pkg={selectedEntry}
            adb={adb}
            busy={busyPackage === selectedEntry.packageName}
            scanning={loadingPkg === selectedEntry.packageName}
            components={componentCache.get(selectedEntry.packageName)}
            onClose={() => setSelectedPackage(null)}
            onForceStop={() => void forceStop(selectedEntry.packageName)}
            onClearData={() => void clearData(selectedEntry.packageName)}
            onPullApk={() => void pullApk(selectedEntry.packageName)}
            onUninstall={() => handleUninstall(selectedEntry.packageName)}
            onRunScan={() => void fetchComponents(selectedEntry.packageName)}
            onRescan={() => void rescan(selectedEntry.packageName)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-600">
            Select a package to inspect it.
          </div>
        )}
      </div>
    </div>
  );
}
