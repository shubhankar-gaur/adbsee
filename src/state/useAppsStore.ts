import { create } from "zustand";
import type { PackageEntry } from "../components/apps/parsePackageList";
import type { PackageComponents } from "../lib/adb/dumpsysPackage";
import type { LaunchResult } from "../lib/adb/quickLaunch";

interface AppsState {
  packages: PackageEntry[];
  thirdPartyOnly: boolean;
  search: string;
  selectedPackage: string | null;
  /** Scan results, keyed by package name — kept here (not local component state) so a scan
   * survives switching to another tab and back, not just re-rendering within the Apps tab. */
  componentsByPackage: Map<string, PackageComponents>;
  /** Most recent launch-attempt result per component (keyed by full `pkg/.Component` name) —
   * same cross-tab-survival reasoning as `componentsByPackage`, so a confirmed-exported badge
   * doesn't disappear just from switching tabs. */
  launchResultsByComponent: Map<string, LaunchResult>;

  setPackages: (packages: PackageEntry[]) => void;
  setThirdPartyOnly: (thirdPartyOnly: boolean) => void;
  setSearch: (search: string) => void;
  setSelectedPackage: (pkg: string | null) => void;
  setComponents: (pkg: string, components: PackageComponents) => void;
  setLaunchResult: (component: string, result: LaunchResult) => void;
  reset: () => void;
}

const DEFAULTS = {
  packages: [] as PackageEntry[],
  thirdPartyOnly: true,
  search: "",
  selectedPackage: null as string | null,
  componentsByPackage: new Map<string, PackageComponents>(),
  launchResultsByComponent: new Map<string, LaunchResult>(),
};

/** Lives outside the Apps tab's component tree, same reasoning as `useFileBrowserStore.ts` —
 * `AppsView` fully unmounts on tab switch, so anything left in local `useState` (the fetched
 * package list, search text, which package is selected, scan results) would otherwise vanish
 * and have to be re-fetched/re-entered/re-scanned every time you come back to this tab. */
export const useAppsStore = create<AppsState>()((set) => ({
  ...DEFAULTS,

  setPackages: (packages) => set({ packages }),
  setThirdPartyOnly: (thirdPartyOnly) => set({ thirdPartyOnly }),
  setSearch: (search) => set({ search }),
  setSelectedPackage: (pkg) => set({ selectedPackage: pkg }),
  setComponents: (pkg, components) =>
    set((s) => ({ componentsByPackage: new Map(s.componentsByPackage).set(pkg, components) })),
  setLaunchResult: (component, result) =>
    set((s) => ({
      launchResultsByComponent: new Map(s.launchResultsByComponent).set(component, result),
    })),
  reset: () =>
    set({
      packages: DEFAULTS.packages,
      thirdPartyOnly: DEFAULTS.thirdPartyOnly,
      search: DEFAULTS.search,
      selectedPackage: DEFAULTS.selectedPackage,
      componentsByPackage: new Map(),
      launchResultsByComponent: new Map(),
    }),
}));
