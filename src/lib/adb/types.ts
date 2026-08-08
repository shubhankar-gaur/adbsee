export type ConnectionState =
  | "idle"
  | "requesting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";
