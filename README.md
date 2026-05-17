# slack-change-request

Hello~! This is **Request Bot**, a Slack app that manages requests through an approval workflow from submission to documentation confirmation \o/

**TL;DR:** 
A Slack shortcut (/Change Request) opens a modal → 
submitter fills in change details and picks approvers → 
approvers get DMs with Approve/Decline buttons → 
result is posted back to the channel and logged to Firestore + Google Sheets. 

Start with:
```bash
npm install
node index.js
```

The bot is deployed on **Render** + **UptimeRobot** and listens on port `3000`. All configurable values (timeouts, options, spreadsheet ID, etc.) live in `config.js`.

---

## Table of Contents

1. [Notes & Requirements](#1-notes--requirements)
2. [Structure](#2-structure)
3. [Configuration](#3-configuration)
4. [Approval Workflow](#4-approval-workflow)
5. [Render Operations](#5-render-operations)
6. [Known Limitations & Future Improvements](#6-known-limitations--future-improvements)
7. [Experience for references qwq](#7-experience-for-references-qwq)

---

## 1. Notes & Requirements

### Before running...

- **Node.js 18+** recommended
- Install dependencies: `npm install`
- A `.env` file (or Render environment variables) must contain:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
FIREBASE_SERVICE_ACCOUNT_JSON=/path/to/firebase-key.json
CREDENTIALS_JSON=/path/to/google-credentials.json
```

- On Render, secrets are injected as **Secret Files** at `/etc/secrets/`. The default paths in `config.js` point there automatically.
- The Slack app must have the following **Bot Token Scopes**: `chat:write`, `im:write`, `users:read`, `reactions:add`, `channels:join`, `conversations:open`
- The bot must be added to the target channel before posting (or it will auto-join public channels)

### Slack App Setup

- Create a **Global Shortcut** with Callback ID: `new_change_request`
- Enable **Interactivity** and set the Request URL to `https://<your-render-url>/slack/events`
- The bot uses `@slack/bolt` with an `ExpressReceiver` so custom HTTP endpoints (`/`, `/healthcheck`) can coexist with Slack event handling

### Data & Tracking Notes

- **Approval state** (`approvals`, `pendingApprovals`) is stored **in memory** — it is lost on server restart
- **Firestore** is the persistent source of truth for all request records
- **Google Sheets** is the human-readable log, written at key decision points (approved / rejected / doc confirmed)
- `requestId` is generated from `Date.now()` — theoretically could collide if two requests are submitted in the same millisecond, but practically safe for current usage volume

---

## 2. Structure

### Files

```
slack-change-request/
├─ index.js              # Main bot logic: modal, approval flow, reminders, decisions
├─ firebase.js           # Firebase Admin SDK initialization
├─ firestoreLog.js       # Firestore read/write helpers
├─ googleSheet.js        # Google Sheets append/update logic
├─ config.js             # All configurable values in one place
├─ .env                  # Local environment variables (not committed)
├─ package.json
└─ README.md
```

### index.js structure

```
index.js
├─ msToHuman(ms)                    # Convert milliseconds to human-readable string (e.g. "24hr", "30 min")
│
├─ app.shortcut("new_change_request")
│  └─ Opens the change request modal
│
├─ app.view("change_request_submit")
│  ├─ Parse form values
│  ├─ Post summary to channel                        [1]
│  ├─ DM each approver with Approve/Decline buttons  [2]
│  ├─ Save to pendingApprovals (in-memory)
│  ├─ Save to Firestore
│  ├─ setTimeout → reminder DM to non-responders     [after reminderDelayMs]
│  └─ setTimeout → auto mark no-response + finalize  [after noResponseDelayMs]
│
├─ app.action("approve_action" | "decline_action")
│  ├─ Record decision in approvals{}
│  ├─ Update Firestore
│  ├─ Update DM button state
│  └─ Call checkFinalDecision()
│
├─ app.action("confirm_docs_updated")
│  ├─ Mark docConfirmed in pendingApprovals
│  ├─ Log to Google Sheets (final status)
│  └─ Post confirmation to channel thread
│
├─ checkFinalDecision(requestId, client)
│  ├─ Wait until all approvers have responded
│  ├─ If all approved → DM submitter, post to channel, log to Sheets, schedule doc reminder
│  └─ If any declined/no_response → DM submitter, post to channel, log to Sheets
│
└─ getUsernamesFromIds(userIds, client)   # Resolve Slack user IDs → display names
```

### Interaction flow

```
User triggers shortcut
        ↓
  [Modal opens]
        ↓ Submit
  app.view handler
    ├─ POST summary to channel
    ├─ DM each approver (with buttons)
    ├─ Save to Firestore
    └─ Start timers
        ↓ (approver clicks button)
  app.action handler
    ├─ Record decision
    └─ checkFinalDecision()
          ├─ Still waiting? → return
          └─ All responded?
                ├─ All approved →
                │    DM submitter + post to channel + log Sheets
                │    Start doc-update reminder timer
                │    Submitter clicks "Confirm Docs Updated"
                │         └─ Log final status to Sheets + post to thread
                └─ Any declined/no_response →
                     DM submitter + post to channel + log Sheets
```

### Google Sheets column layout

| Col | Field |
|-----|-------|
| A | requestId |
| B | robotModel |
| C | robotId |
| D | classification |
| E | content (change description) |
| F | why |
| G | approvers (display names) |
| H | approverStatus (name: decision) |
| I | inform (display names) |
| J | docs (links) |
| K | submitter (display name) |
| L | submittedAt |
| M | **status** ← `STATUS_COLUMN` in config |
| N | threadLink |

-> Google Sheet lives here: https://docs.google.com/spreadsheets/d/1JR0r4esk6C8Z4uqah3lIabdIEViZdqQNzf457lMADjw/edit

---

## 3. Configuration

Everything you'd ever want to tweak is in `config.js`. No need to dig through the logic code.

> When testing with short timeouts (e.g. `1000 * 60 * 0.5` = 30 sec), the bot's DM messages will automatically reflect the actual time — so you'll see "30 sec" instead of "24hr". No need to edit message strings manually.

> Submitters can also override the timing per-request directly in the modal (optional fields at the bottom). If left blank, the config defaults apply.

---

## 4. Approval Workflow

### Happy path
1. User triggers `new_change_request` shortcut
2. Fills out the modal (robot model, classification, content, why, approvers, channel, optional timing)
3. Summary is posted to the selected channel
4. Each approver receives a DM with **Approve / Decline** buttons
5. All approvers click Approve → submitter gets DM to confirm documentation update
6. Submitter clicks **"Confirm Documentation Updated"** → final log written to Sheets

### Rejection / no-response
- If any approver **Declines** → decision is finalized immediately after all have responded
- If an approver **doesn't respond** within the configured deadline → auto-marked as `no_response`
- Either case → submitter gets notified and the request is logged as `❌ Needs Resubmission`

### Reminder behavior
- **Reminder DM**: sent to non-responders after `REMINDER_DELAY_MS`
- **No-response deadline**: after `NO_RESPONSE_DELAY_MS`, non-responders are auto-marked and the request is finalized
- **Doc update reminder**: if submitter hasn't confirmed within `DOC_UPDATE_REMINDER_MS` after approval, they get a nudge

> All timers are `setTimeout`-based and do **not** survive a server restart. If Render restarts mid-approval, pending reminders are lost. Firestore still holds the request data, but the timers won't fire.

---

## 5. Render Operations

### Endpoints

| Path | Purpose |
|------|---------|
| `GET /` | Keep-alive ping (used by Render health checks) |
| `GET /healthcheck` | Returns `{ status, uptime, timestamp }` |
| `POST /slack/events` | Main Slack event handler (managed by Bolt) |

### Viewing logs

From the Render dashboard → your service → **Logs** tab.

Or if you have the Render CLI:
```bash
render logs --service <service-id> --tail
```

### Redeploying

Push to `main` — Render auto-deploys on every push.

```bash
git add .
git commit -m "your message"
git push origin main
```

---

## 6. Known Limitations & Future Improvements
This app is currently an MVP for Slack-based change request submission, approval, notification, and logging.

Known limitations:

1. **Render Free Plan may sleep**  
   If the app is idle for a while, Slack interactions may timeout before Render wakes up.

2. **Workflow state is partly stored in memory**  
   Approval status, reminder status, and finalized request tracking may be lost after restart, redeploy, or crash.

3. **Reminder logic uses `setTimeout()`**  
   The 24hr / 48hr reminder and no-response logic may not survive server restarts.

4. **Firestore is not yet the full source of truth**  
   Initial requests are saved, but some later workflow updates still need stronger Firestore syncing.

5. **Google Sheet logging should remain one row per request**  
   Future updates should update existing rows instead of appending duplicate records.

6. **Slack API calls may fail depending on channel/user permissions**  
   Common cases include bot not being invited to a channel, selected user being a bot, or missing OAuth scopes.

7. **Change Content currently supports text/link input only**  
   Slack modal does not directly support image upload inside the form.

Future improvements:
- Move workflow state fully into Firestore.
- Replace long `setTimeout()` reminders with scheduled jobs.
- Improve Google Sheet update logic.
- Add stronger Slack API error handling.
- Add image/file support.
- Add user validation before sending DMs.
- Improve production deployment reliability.

--- 

## 7. Experience for References qwq

During development, this app ran into several practical integration issues across Slack, Render, Firestore, Google Sheets, and GitHub.

Detailed notes are documented here:
[Development Notes & Troubleshooting](development-notes.md)

---

End of README, time to receive the requests! May your requests be awared and approved, and all the decisions be properly dealt with and documentated qwq
If you spot a bug or have ideas, drop a message in #topic-automation — this little bot is always happy to become better o/