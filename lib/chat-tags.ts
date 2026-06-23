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
  "Timezone",
  // Channel-issue subtypes — merged into Chat Drivers so the table needs one less column.
  "Playback Error",
  "Buffering",
  "No Audio",
  "Freezing",
  "Channel Owner has Expired",
  "Language",
  "None",
];

// Kept for backward compatibility: the chat_tags.channel_issue column and the
// /api/chat-tags PATCH validation still reference these. The Chats table no
// longer surfaces a separate Channel Issue selector (options live in CHAT_DRIVER_OPTIONS).
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
