// ─────────────────────────────────────────────────────────────────────────
// Per-chat/ticket manual tagging taxonomies for the Chats list view.
// Both are multi-select. These chat-level Chat Drivers are the intended source
// for the Chat Drivers / Common Issues reporting.
// ─────────────────────────────────────────────────────────────────────────

export const CHAT_DRIVER_OPTIONS = [
  "New Account / Customer",
  "Renewal Inquiry",
  "Password Reset to Process Payment",
  "Device Activation",
  "App Installation",
  "Channels Buffering",
  "TV Series Not Working",
  "Renewal",
  "Renewal Issue / Unable to Process Renewal Due to Website Issue",
  "Payment Confirmation",
  "VOD Not Working",
  "Maximum Devices",
  "Channel Issue",
  "Channel, Movie & TV Series Request",
  "Blank / No Issue Recorded",
  "None",
];

export const CHANNEL_ISSUE_OPTIONS = [
  "Playback Error",
  "Buffering",
  "No Audio",
  "Freezing",
  "Channel Owner has Expired",
  "Language",
  "None",
];

export const CHAT_DRIVER_SET = new Set(CHAT_DRIVER_OPTIONS);
export const CHANNEL_ISSUE_SET = new Set(CHANNEL_ISSUE_OPTIONS);
