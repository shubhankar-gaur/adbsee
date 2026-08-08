import type { ReactNode } from "react";
import { isWebUsbSupported } from "../../lib/adb/connection";

export function BrowserSupportGate({ children }: { children: ReactNode }) {
  if (isWebUsbSupported()) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold text-neutral-100">WebUSB not available</h1>
        <p className="text-neutral-400">
          ADBSee needs the WebUSB API, which only works in Chromium-based browsers (Chrome, Edge)
          over HTTPS or on <code className="text-neutral-300">localhost</code>.
        </p>
        <p className="text-neutral-400">Open this page in Chrome or Edge to continue.</p>
      </div>
    </div>
  );
}
