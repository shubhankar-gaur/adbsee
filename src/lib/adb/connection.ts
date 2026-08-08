import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDeviceManager,
  type AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";
import { credentialStore } from "./credentialStore";
import { AuthTimeoutError } from "./errors";

const AUTH_TIMEOUT_MS = 60_000;

export function isWebUsbSupported(): boolean {
  return AdbDaemonWebUsbDeviceManager.BROWSER !== undefined;
}

/** Must be called synchronously from a user gesture (click handler). */
export async function requestDevice(): Promise<AdbDaemonWebUsbDevice | undefined> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw new Error("WebUSB is not supported in this browser");
  return manager.requestDevice();
}

export async function getKnownDevices(): Promise<AdbDaemonWebUsbDevice[]> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) return [];
  return manager.getDevices();
}

export async function connectToDevice(device: AdbDaemonWebUsbDevice): Promise<Adb> {
  const connection = await device.connect();

  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new AuthTimeoutError());
    }, AUTH_TIMEOUT_MS);
  });

  const authenticate = AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore,
  });
  // If we give up waiting but the device confirms auth later anyway, close the
  // orphaned transport instead of leaking a claimed USB interface.
  authenticate.then(
    (transport) => {
      if (timedOut) void transport.close();
    },
    () => {},
  );

  const transport = await Promise.race([authenticate, timeout]);
  return new Adb(transport);
}
