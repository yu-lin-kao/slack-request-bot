# Development Notes & Troubleshooting qwq

This file records the main technical issues, bugs, and lessons learned while building the Slack Change Request Bot.

## 1. Render / Deployment

### Render Free Plan Sleep

Render Free Plan may sleep after inactivity.  
When Slack triggers a shortcut, modal, or button action after the app has been idle, the service may not wake up fast enough and Slack may timeout.

Current workaround:

```js
appExpress.get("/", (_req, res) => {
  res.status(200).send("🛰️ Change Request Bot is running.");
});
```

An external ping service such as UptimeRobot can periodically ping:

```txt
https://slack-request-bot.onrender.com/
```

Lesson learned:

Use Render Free Plan only for MVP/testing. For production use, use an always-on service or paid deployment plan.

---

### Port Binding

Port (and all other configurable values) are centralized in `config.js`:

```js
// config.js
PORT: 3000,
```

```js
// index.js
const config = require("./config");

(async () => {
  await app.start(config.PORT);
})();
```

To change the port, edit `config.js` — no need to touch `index.js`.

---

## 2. Centralized Configuration (`config.js`)

All hardcoded values are extracted into `config.js` to avoid scattering magic numbers and strings across the codebase.

```js
// config.js covers:
PORT, TIMEZONE, SLACK_WORKSPACE_URL,
REMINDER_DELAY_MS, NO_RESPONSE_DELAY_MS, DOC_UPDATE_REMINDER_MS,
ROBOT_MODELS, CLASSIFICATIONS,
SPREADSHEET_ID, SHEET_NAME, STATUS_COLUMN,
FIREBASE_CREDENTIALS_PATH, GOOGLE_CREDENTIALS_PATH
```

All other files import it with `require("./config")`. To change any setting, only `config.js` needs to be edited.

For testing with short timeouts (e.g. 30 seconds), change the `*_DELAY_MS` values in `config.js`. The DM messages automatically reflect the real time via `msToHuman()` — no need to touch message strings.

---

## 3. ExpressReceiver Setup

To add health check endpoints, the app should use `ExpressReceiver`.

Correct setup order:

```js
const { App, ExpressReceiver } = require("@slack/bolt");

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const appExpress = receiver.app;

appExpress.get("/", (_req, res) => {
  res.status(200).send("🛰️ Change Request Bot is running.");
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});
```

Common mistakes:

- Using `receiver.app` before `receiver` is declared.
- Creating `ExpressReceiver` but forgetting to pass it into `new App()`.
- Confusing the health check endpoint `/` with Slack’s event endpoint `/slack/events`.

Slack Interactivity Request URL should point to:

```txt
https://slack-request-bot.onrender.com/slack/events
```

The root URL is only for health check / uptime ping.

---

## 4. Slack App Configuration

Several Slack settings must match the code exactly.

Important items:

- Interactivity Request URL should point to `/slack/events`.
- Shortcut callback ID must match `app.shortcut(...)`.
- Modal callback ID must match `app.view(...)`.
- Slash command requires a separate `app.command(...)` handler.
- New OAuth scopes require reinstalling the app.

Example:

```js
app.shortcut("new_change_request", async ({ shortcut, ack, client }) => {
  await ack();
});
```

Shortcut and Slash Command are separate entry points.  
Having one does not automatically enable the other.

---

## 5. Slack Client Cache

Some Slack UI changes did not appear immediately.

Examples:

- Global Shortcut not showing.
- App sidebar name not updating.
- Bot display name still showing the old value.

Possible fixes:

- Restart Slack desktop app.
- Try Slack web.
- Reinstall app to workspace.
- Wait for Slack cache to refresh.

Lesson learned:

Not every Slack UI issue is a code issue.

---

## 6. Slack Block Kit Constraints

Slack Block Kit is strict.

Issues encountered:

- Placeholder text was too long.
- Button style `"default"` is invalid.
- `rich_text` does not use normal `mrkdwn`.
- Template string indentation appears in Slack messages.
- `multi_static_select` and `static_select` return different payload structures.

Example error:

```txt
must be less than 151 characters
/view/blocks/3/element/placeholder/text
```

Better placeholder:

```js
placeholder: {
  type: "plain_text",
  text: "Describe the change. Consider scope, timeline, resources, and cost."
}
```

Button style note:

```js
// Invalid
style: "default"

// Valid options
style: "primary"
style: "danger"

// For default gray button, omit style
```

Lesson learned:

Keep modal text short and test Block Kit payloads carefully.

---

## 7. Slack API Errors

Common Slack API errors encountered:

```txt
channel_not_found
cannot_dm_bot
missing_scope
invalid_arguments
```

Main causes:

- Bot was not invited to the selected channel.
- Selected user was a bot.
- Missing OAuth scope such as `reactions:write`.
- Modal block format was invalid.

Common fix for channel posting:

```txt
/invite @Request Bot
```

After adding a new scope, always reinstall the Slack app to the workspace.

Recommended improvement:

Wrap high-risk Slack API calls in `try/catch`, especially:

```js
client.chat.postMessage(...)
client.conversations.open(...)
client.views.open(...)
client.reactions.add(...)
```

---

## 8. `ack()` and Async Errors

Slack requires `ack()` to be called quickly.

However, errors can still happen after `ack()`:

```txt
An unhandled error occurred after ack() called in a listener
```

Safer pattern:

```js
app.shortcut("new_change_request", async ({ shortcut, ack, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        // modal view
      }
    });
  } catch (err) {
    console.error("❌ Failed to open modal:", err);
  }
});
```

Lesson learned:

`ack()` only confirms receipt to Slack.  
It does not mean the rest of the workflow succeeded.

---

## 9. Workflow State Limitation

Some workflow states are currently stored in memory:

```js
const pendingApprovals = {};
const approvals = {};
const finalizedRequests = new Set();
```

This may be lost after:

- Render restart
- redeploy
- crash
- service sleep

Affected workflow data:

- approver decisions
- reminder status
- no-response status
- documentation confirmation
- finalized request status

Future improvement:

Use Firestore as the main source of truth for all request and approval states.

---

## 10. Reminder Logic Limitation

The reminder logic uses `setTimeout()`. Timers disappear if the server restarts, which makes them unreliable in production.

Reminder delays are now configurable in `config.js`:

```js
REMINDER_DELAY_MS:      1000 * 60 * 60 * 24,  // remind approvers
NO_RESPONSE_DELAY_MS:   1000 * 60 * 60 * 48,  // auto mark no-response
DOC_UPDATE_REMINDER_MS: 1000 * 60 * 60 * 24,  // remind submitter to update docs
```

Submitters can also override these per-request via optional input fields in the modal (hours, supports decimals). If left blank, config defaults apply.

Message text (e.g. "A reminder will be sent after 24hr") is generated dynamically from the actual delay value via `msToHuman(ms)`, so it always reflects the real configured time.

Future improvement:

1. Store request status and timestamps in Firestore.
2. Run a scheduled job periodically.
3. Check pending requests.
4. Send reminders or mark `no response` based on stored timestamps.

---

## 11. Timezone Handling

Google Sheet timestamps were incorrect because the server timezone was not Chicago time.

Problem code:

```js
const date = new Date().toLocaleString();
```

Fixed with Luxon, timezone now read from `config.js`:

```js
const { DateTime } = require("luxon");
const config = require("./config");

// config.js
TIMEZONE: "America/Chicago",

// usage
const date = DateTime.now()
  .setZone(config.TIMEZONE)
  .toFormat("yyyy-MM-dd HH:mm:ss");
```

Lesson learned:

For deployment environments, always specify timezone explicitly. Centralizing it in config makes it easy to change for other regions.

---

## 12. Google Credentials and Firestore

Issues encountered:

- Credential file not found.
- Environment variable vs secret file confusion.
- Invalid private key format.
- Firestore API not enabled.
- Firestore authentication failed.

Secret file style:

```js
const fs = require("fs");

const raw = fs.readFileSync("/etc/secrets/CREDENTIALS_JSON", "utf8");
const credentials = JSON.parse(raw);
```

Environment variable style:

```js
const credentials = JSON.parse(process.env.CREDENTIALS_JSON);
```

Lesson learned:

Google credentials should be handled carefully through Render secret files or environment variables.  
Service account JSON files should never be committed.

---

## 13. Google Sheet Logging

The Change Request Log uses one row per request.

`logToSheet()` handles both insert and update in one function:

1. Check `cachedRowMap[requestId]` (in-memory cache) — if found, update that row directly.
2. If cache miss, scan column A for the matching `requestId`.
3. If found in sheet, update status column in place and cache the row.
4. If not found at all, append a new row and cache it.

This avoids duplicate rows across the full lifecycle (submitted → approved/rejected → doc confirmed).

`STATUS_COLUMN` in `config.js` controls which column gets updated for status changes (currently `"M"`).

Lesson learned:

The row-lookup + cache pattern works well for low-volume usage. For high volume or multi-instance deployments, the in-memory cache won't be shared across instances and could cause missed updates.

---

## 14. Git / GitHub Issues

Common Git issues encountered:

```txt
non-fast-forward
GitHub Push Protection
secret detected
no changes added to commit
```

Safer commit flow:

```bash
git status
git diff
git add config.js .gitignore
git diff --cached --name-only
git commit -m "Update config"
git push origin main
```

Avoid broad commands unless staged files are checked carefully:

```bash
git add .
git add *
```

---

## 15. Secret Handling

Sensitive files should never be committed:

```txt
.env
.env.save
Google service account JSON
Firebase service account JSON
.DS_Store
```

Recommended `.gitignore`:

```gitignore
node_modules/
.env
.env.*
.env.save
.DS_Store
*firebase-adminsdk*.json
es-project-management-workflow-*.json
```

If a secret is already committed, simply deleting the file is not enough.  
The commit history may still contain the secret.

Useful command during development:

```bash
git reset HEAD~1
```

Lesson learned:

GitHub Push Protection is helpful. Do not bypass it unless the secret has been properly removed and rotated.

---

## 16. Local, GitHub, and Render Versions Can Differ

One confusing issue was that Render logs pointed to code that did not match the local file.

Root cause:

The local code, GitHub remote branch, and Render deployed commit were not the same.

Debug checklist:

```bash
git status
git log --oneline -5
git remote -v
```

Also check the commit SHA shown in Render deploy logs.

Lesson learned:

Before debugging code, confirm which version is actually deployed.

---

## 17. Final Takeaway

This app looks small, but it connects many systems:

- Slack App settings
- Slack Block Kit
- OAuth scopes
- Render deployment
- environment variables
- Google credentials
- Firestore
- Google Sheets
- GitHub

Most bugs came from integration points between systems, not just JavaScript logic.

Useful debugging order:

```txt
1. Check the Slack error message
2. Check Render runtime logs
3. Check the deployed commit
4. Check local Git status
5. Check Slack App settings and scopes
6. Check environment variables / secret files
7. Check Firestore / Google Sheet permissions
8. Then modify code
```