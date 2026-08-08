import { useEffect } from "react";
import { useAdbStore } from "../state/useAdbStore";

/**
 * Two jobs, both about making the connection resilient rather than requiring the user to notice
 * and manually recover:
 *
 * 1. Backstop for `adb.disconnected` (the primary path, handled inside `useAdbStore`'s
 *    `attachSession`): also listens for the browser-level WebUSB disconnect event in case a
 *    stream never gets an error/close signal to surface through. Routes through the same silent
 *    reconnect-retry path rather than a hard disconnect, so this edge case gets the same
 *    ride-out-a-cable-wiggle behavior as the primary path — gated on still being `"connected"` so
 *    it never double-fires if the primary path already caught it first.
 * 2. Once per page load, tries to resume a session with whatever device is already both
 *    previously-authorized and currently attached — so refreshing the tab (or reopening it)
 *    doesn't force the picker dialog again for a device you were already using.
 */
export function useUsbConnectionWatcher(): void {
  useEffect(() => {
    void useAdbStore.getState().autoConnectOnLoad();
  }, []);

  useEffect(() => {
    const usb = navigator.usb;
    if (!usb) return;

    const handleDisconnect = (event: USBConnectionEvent) => {
      const { device, connectionState, beginReconnect } = useAdbStore.getState();
      if (device && event.device === device.raw && connectionState === "connected") {
        beginReconnect(device);
      }
    };

    usb.addEventListener("disconnect", handleDisconnect);
    return () => usb.removeEventListener("disconnect", handleDisconnect);
  }, []);
}
