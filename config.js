module.exports = {
  // ─── Server ───────────────────────────────────────────────
  PORT: 3000,

  // ─── Timezone ─────────────────────────────────────────────
  TIMEZONE: "America/Chicago",

  // ─── Slack ────────────────────────────────────────────────
  SLACK_WORKSPACE_URL: "https://earthsense.slack.com",

  // ─── Timeouts (milliseconds) ──────────────────────────────
  REMINDER_DELAY_MS:          1000 * 60 * 1,  // remind approver (default: 24hr = 1000 * 60 * 60 * 24)
  NO_RESPONSE_DELAY_MS:       1000 * 60 * 2,  // auto mark no-response (default: 48hr = 1000 * 60 * 60 * 48)
  DOC_UPDATE_REMINDER_MS:     1000 * 60 * 0.5,  // remind submitter to update docs (default: 24hr = 1000 * 60 * 60 * 24)

  // ─── Form options ─────────────────────────────────────────
  ROBOT_MODELS: ["TPV", "TPr", "TMx", "TSP", "TS", "TEST", "Other"],
  CLASSIFICATIONS: ["Scope", "Design-Mech", "Design-Elec", "Integration", "Software", "Timeline", "Other"],

  // ─── Google Sheets ────────────────────────────────────────
  SPREADSHEET_ID: "1JR0r4esk6C8Z4uqah3lIabdIEViZdqQNzf457lMADjw",
  SHEET_NAME: "Sheet1",
  STATUS_COLUMN: "M",  // column for the status field (currently column 13)

  // ─── File paths (secrets) ─────────────────────────────────
  FIREBASE_CREDENTIALS_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "/etc/secrets/FIREBASE_SERVICE_ACCOUNT_JSON",
  GOOGLE_CREDENTIALS_PATH:   process.env.CREDENTIALS_JSON              || "/etc/secrets/CREDENTIALS_JSON",
};
