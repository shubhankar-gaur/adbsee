// Android's own "dangerous" protection-level permissions, plus a handful of signature/system
// permissions that are routinely worth a second look during app pentesting even though they
// aren't in the official "dangerous" group (accessibility services, overlay windows, install-
// from-unknown-sources, etc.).
const DANGEROUS_PERMISSIONS = new Set([
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.CAMERA",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.GET_ACCOUNTS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.CALL_PHONE",
  "android.permission.ANSWER_PHONE_CALLS",
  "android.permission.READ_CALL_LOG",
  "android.permission.WRITE_CALL_LOG",
  "android.permission.ADD_VOICEMAIL",
  "android.permission.USE_SIP",
  "android.permission.PROCESS_OUTGOING_CALLS",
  "android.permission.BODY_SENSORS",
  "android.permission.SEND_SMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.READ_SMS",
  "android.permission.RECEIVE_WAP_PUSH",
  "android.permission.RECEIVE_MMS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.BIND_ACCESSIBILITY_SERVICE",
  "android.permission.BIND_DEVICE_ADMIN",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.WRITE_SETTINGS",
  "android.permission.QUERY_ALL_PACKAGES",
  "android.permission.PACKAGE_USAGE_STATS",
]);

export function isDangerousPermission(permission: string): boolean {
  return DANGEROUS_PERMISSIONS.has(permission);
}
