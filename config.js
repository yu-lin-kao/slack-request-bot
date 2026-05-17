module.exports = {
  // ─── Server ───────────────────────────────────────────────
  PORT: 3000,

  // ─── Timezone ─────────────────────────────────────────────
  TIMEZONE: "America/Chicago",

  // ─── Slack ────────────────────────────────────────────────
  SLACK_WORKSPACE_URL: "https://earthsense.slack.com",

  // ─── Timeouts (milliseconds) ──────────────────────────────
  REMINDER_DELAY_MS:          1000 * 60 * 60 * 24,  // 24h: remind approver
  NO_RESPONSE_DELAY_MS:       1000 * 60 * 60 * 48,  // 48h: auto mark no-response
  DOC_UPDATE_REMINDER_MS:     1000 * 60 * 60 * 24,  // 24h: remind submitter to update docs

  // ─── Form options ─────────────────────────────────────────
  ROBOT_MODELS: ["TPV", "TPr", "TMx", "TSP", "TS", "Other"],
  CLASSIFICATIONS: ["Scope", "Design-Mech", "Design-Elec", "Integration", "Software", "Other"],

  // ─── Google Sheets ────────────────────────────────────────
  SPREADSHEET_ID: "1JR0r4esk6C8Z4uqah3lIabdIEViZdqQNzf457lMADjw",
  SHEET_NAME: "Sheet1",
  STATUS_COLUMN: "M",  // column for the status field (currently column 13)

  // ─── File paths (secrets) ─────────────────────────────────
  FIREBASE_CREDENTIALS_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "/etc/secrets/FIREBASE_SERVICE_ACCOUNT_JSON",
  GOOGLE_CREDENTIALS_PATH:   process.env.CREDENTIALS_JSON              || "/etc/secrets/CREDENTIALS_JSON",
};
