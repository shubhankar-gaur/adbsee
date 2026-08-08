export class AuthTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for the on-device authorization prompt");
    this.name = "AuthTimeoutError";
  }
}

export type AdbErrorKind =
  | "cancelled"
  | "device-busy"
  | "auth-timeout"
  | "unsupported"
  | "unknown";

export interface ClassifiedAdbError {
  kind: AdbErrorKind;
  message: string;
}

export function classifyAdbError(err: unknown): ClassifiedAdbError {
  if (err instanceof AuthTimeoutError) {
    return {
      kind: "auth-timeout",
      message:
        "Timed out waiting for the on-device 'Allow USB debugging' prompt. Check your phone, then try connecting again.",
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("no device selected") || lower.includes("user gesture")) {
    return { kind: "cancelled", message: "No device selected." };
  }

  if (
    lower.includes("unable to claim interface") ||
    lower.includes("access denied") ||
    lower.includes("open device") ||
    lower.includes("securityerror") ||
    lower.includes("networkerror")
  ) {
    return {
      kind: "device-busy",
      message:
        "Could not open the USB device. It's likely held by the native adb server or another program. " +
        "Run `adb kill-server`, close Android Studio, then unplug and replug the device. " +
        "On Linux, this can also be a udev permissions issue.",
    };
  }

  if (lower.includes("webusb")) {
    return {
      kind: "unsupported",
      message: "WebUSB is not available. Use Chrome or Edge over HTTPS (or localhost).",
    };
  }

  return { kind: "unknown", message };
}
