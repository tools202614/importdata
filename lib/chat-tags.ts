// ─────────────────────────────────────────────────────────────────────────
// Per-chat/ticket manual tagging taxonomies for the Chats list view.
// Both are multi-select. These chat-level Chat Drivers are the intended source
// for the Chat Drivers / Common Issues reporting.
// ─────────────────────────────────────────────────────────────────────────

export const CHAT_DRIVER_OPTIONS = [
  "Website Access Issues",
  "TV Series Playback Issues",
  "Time Zone Configuration Issues",
  "Subscription Status Concerns",
  "Server Outage / Service Downtime",
  "Roku Device Support & Troubleshooting",
  "Renewal Processing Issues (Website-Related)",
  "Subscription Renewal Inquiries",
  "Device Removal Requests",
  "Refund Requests",
  "Playback Errors (Channels, Movies, and TV Series)",
  "Payment Confirmation Requests",
  "Password Reset for Payment Processing",
  "Order-Related Concerns",
  "New Customer / Account Inquiries",
  "Maximum Device Limit Reached",
  "Login Credential Assistance",
  "Invalid Website Login Issues",
  "Free Trial Inquiries",
  "Device Compatibility Questions",
  "Device Activation Assistance",
  "Channel, Movie, and TV Series Buffering Issues",
  "Audio Issues (Channels, Movies, and TV Series)",
  "Application Installation Assistance",
  "Adult Channel PIN Code Requests",
  "Electronic Program Guide (EPG) Issues and Inquiries",

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
