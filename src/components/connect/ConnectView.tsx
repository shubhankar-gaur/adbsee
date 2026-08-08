import { useEffect, useState } from "react";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import { getKnownDevices } from "../../lib/adb/connection";
import { forgetSavedKey } from "../../lib/adb/credentialStore";
import { useAdbStore } from "../../state/useAdbStore";

export function ConnectView() {
  const connectionState = useAdbStore((s) => s.connectionState);
  const connect = useAdbStore((s) => s.connect);
  const connectToKnownDevice = useAdbStore((s) => s.connectToKnownDevice);
  const [knownDevices, setKnownDevices] = useState<AdbDaemonWebUsbDevice[]>([]);
  const [forgetStatus, setForgetStatus] = useState<"idle" | "done">("idle");

  const busy =
    connectionState === "requesting" ||
    connectionState === "authenticating" ||
    connectionState === "reconnecting";

  useEffect(() => {
    if (connectionState === "idle" || connectionState === "disconnected") {
      void getKnownDevices().then(setKnownDevices);
    }
  }, [connectionState]);

  // Refreshes the list the moment a previously-authorized device is plugged back in, rather than
  // only when this view happens to re-render for some other reason — otherwise a device plugged
  // in while already sitting on this screen wouldn't show up until something else triggered a
  // re-fetch.
  useEffect(() => {
    const usb = navigator.usb;
    if (!usb) return;
    const refresh = () => void getKnownDevices().then(setKnownDevices);
    usb.addEventListener("connect", refresh);
    return () => usb.removeEventListener("connect", refresh);
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-neutral-100">Connect an Android device</h1>
        <p className="mt-2 text-neutral-400">
          Requires USB debugging enabled on the device, a data-capable USB cable, and Chrome or
          Edge.
        </p>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-6 py-2.5 font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connectionState === "requesting"
            ? "Waiting for device selection…"
            : connectionState === "authenticating"
              ? "Waiting for on-device confirmation…"
              : connectionState === "reconnecting"
                ? "Reconnecting…"
                : "Connect device"}
        </button>
      </div>

      {connectionState === "authenticating" && (
        <p className="text-center text-sm text-amber-300">
          Check your phone for the "Allow USB debugging?" dialog and tap Allow.
        </p>
      )}

      {knownDevices.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-400">Previously used devices</h2>
          <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {knownDevices.map((device) => (
              <li key={device.serial} className="flex items-center justify-between px-4 py-2">
                <span className="text-neutral-200">{device.name || device.serial}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void connectToKnownDevice(device)}
                  className="rounded border border-neutral-700 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Reconnect
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-lg border border-neutral-800 p-4 text-sm text-neutral-400">
        <summary className="cursor-pointer text-neutral-300">Troubleshooting</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            The picker didn't show your device? Enable Developer Options → USB debugging on the
            device, and use a USB cable that supports data transfer.
          </li>
          <li>
            Connection fails with "unable to claim interface"? The OS's native adb server (or
            Android Studio) is holding the device. Run <code>adb kill-server</code> and try again.
          </li>
          <li>
            On Linux, this can also be a udev permissions issue — check that your user has access
            to the device's USB node.
          </li>
          <li>
            Device won't show the auth prompt anymore, or rejects a previously trusted key?{" "}
            <button
              type="button"
              onClick={() => {
                void forgetSavedKey().then(() => setForgetStatus("done"));
              }}
              className="text-emerald-400 underline hover:text-emerald-300"
            >
              Forget saved key
            </button>{" "}
            and reconnect.
            {forgetStatus === "done" && (
              <span className="ml-2 text-emerald-300">Done — reconnect to re-pair.</span>
            )}
          </li>
        </ul>
      </details>
    </div>
  );
}
