require("dotenv").config();
const { DateTime } = require("luxon");
const { App, ExpressReceiver } = require("@slack/bolt");
const config = require("./config");

function msToHuman(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const totalMinutes = totalSeconds / 60;
  const totalHours = totalMinutes / 60;
  if (totalHours >= 1) return `${Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1)}hr`;
  if (totalMinutes >= 1) return `${Number.isInteger(totalMinutes) ? totalMinutes : totalMinutes.toFixed(1)} min`;
  return `${totalSeconds} sec`;
}

// Use ExpressReceiver so we can attach custom HTTP endpoints alongside Slack handlers
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const appExpress = receiver.app;

// Root endpoint — used by Render to verify the service is up
appExpress.get("/", (_req, res) => {
  res.status(200).send("🛰️ Change Request Bot is running.");
});

// Detailed health check — exposes uptime and timestamp for monitoring
appExpress.get("/healthcheck", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const { logToSheet } = require('./googleSheet');
const { saveRequestToFirestore, updateStatusInFirestore } = require('./firestoreLog');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver: receiver
});

app.shortcut("new_change_request", async ({ shortcut, ack, client }) => {
  await ack();
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "change_request_submit",
      private_metadata: shortcut.user.id,
      title: { type: "plain_text", text: "New Change Request" },
      submit: { type: "plain_text", text: "Submit" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: ":memo: Please fill out all *required* fields carefully. Submission will notify relevant parties and initiate the approval process. Thank you! \n (Noted: If the robot isn't in the target posting channel, please kindly invite it in first.)"
            }
          ]
        },

        {
          type: "input",
          block_id: "robot_model",
          element: {
            type: "multi_static_select",
            action_id: "value",
            options: config.ROBOT_MODELS.map(m => ({ text: { type: "plain_text", text: m }, value: m }))
          },
          label: { type: "plain_text", text: "Robot model" },
        },

        {
          type: "input",
          block_id: "robot_id",
          element: { 
            type: "plain_text_input", 
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g., TPV001, TPr002" }
          },
          label: { type: "plain_text", text: "Specific robot number" },
          optional: true
        },
        {
          type: "input",
          block_id: "classification",
          element: {
            type: "static_select",
            action_id: "value",
            options: config.CLASSIFICATIONS.map(c => ({ text: { type: "plain_text", text: c }, value: c }))
          },
          label: { type: "plain_text", text: "Change Classification" },
        },
        {
          type: "input",
          block_id: "content",
          element: { 
            type: "plain_text_input", 
            action_id: "value", 
            placeholder: {
              type: "plain_text",
              text: "What exactly is changing? Kindly include scope, timeline, resources, and budget perspective if possible."
            },
            multiline: true },
          label: { type: "plain_text", text: "Change Content" },
        },
        {
          type: "input",
          block_id: "why",
          element: { 
            type: "plain_text_input", 
            action_id: "value", 
            placeholder: {
              type: "plain_text",
              text: "Why is this important now? What risk or opportunity does it address?"
            },
            multiline: true },
          label: { type: "plain_text", text: "Why is this change needed?" },
        },
        {
          type: "input",
          block_id: "docs",
          element: { 
            type: "plain_text_input", 
            action_id: "value",
            placeholder: { type: "plain_text", text: "Please put the link(s) here." }
          },
          label: { type: "plain_text", text: "What are the related documentation? (Reference or To Update)" },
          optional: true
        },
        {
          type: "input",
          block_id: "approvers",
          element: {
            type: "multi_users_select",
            action_id: "value",
            placeholder: {
              type: "plain_text",
              text: "Select users who must approve"
            }
          },
          label: { type: "plain_text", text: "Who should confirm/decide/accountable?" }
        },
        {
          type: "input",
          block_id: "inform",
          element: {
            type: "multi_users_select",
            action_id: "value",
            placeholder: {
              type: "plain_text",
              text: "Select users that should be informed"
            }
          },
          label: { type: "plain_text", text: "Who should be informed?" },
          optional: true
        },
        {
          type: "input",
          block_id: "channel",
          element: {
            type: "conversations_select",
            action_id: "value",
            default_to_current_conversation: true,
            response_url_enabled: true
          },
          label: { type: "plain_text", text: "Which Slack channel should this discussion happen?" }
        },
        { type: "divider" },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: ":bell: *Notification Timing* (optional — leave blank to use defaults)" }]
        },
        {
          type: "input",
          block_id: "reminder_delay",
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "hours, e.g. 24 (default: 24)" }
          },
          label: { type: "plain_text", text: "Remind approvers after (hr)" }
        },
        {
          type: "input",
          block_id: "no_response_delay",
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "hours, e.g. 48 (default: 48)" }
          },
          label: { type: "plain_text", text: "Mark as no-response after (hr)" }
        },
        {
          type: "input",
          block_id: "doc_update_reminder",
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "hours, e.g. 24 (default: 24)" }
          },
          label: { type: "plain_text", text: "Remind submitter to update docs after (hr)" }
        }
      ]
    }
  });
});

// In-memory store of active requests pending approval.
// Lost on server restart — Firestore is the persistent source of truth.
const pendingApprovals = {}; // { requestId: { approvers, submitter, submittedAt, remindedUsers, ... } }

app.view("change_request_submit", async ({ ack, view, client }) => {
  await ack();
  const vals = view.state.values;
  const approvers = vals.approvers.value.selected_users;
  const inform = vals.inform?.value?.selected_users || [];
  const channel = vals.channel.value.selected_conversation;
  const docs = vals.docs?.value?.value || "";
  const submitter = view.private_metadata;

  // Join multi-select values into a comma-separated string
  const robotModel = vals.robot_model.value.selected_options.map(opt => opt.value).join(", ");

  // Normalize robot ID to uppercase for consistency
  const robotId = (vals.robot_id.value.value || "").toUpperCase();

  const classification = vals.classification.value.selected_option.value;
  const content = vals.content.value.value;
  const why = vals.why.value.value;

  const hrToMs = hr => hr * 60 * 60 * 1000;
  const parseHrInput = (raw, fallback) => {
    const hr = parseFloat(raw);
    return (raw && !isNaN(hr) && hr > 0) ? hrToMs(hr) : fallback;
  };
  const reminderDelayMs     = parseHrInput(vals.reminder_delay?.value?.value,     config.REMINDER_DELAY_MS);
  const noResponseDelayMs   = parseHrInput(vals.no_response_delay?.value?.value,  config.NO_RESPONSE_DELAY_MS);
  const docUpdateReminderMs = parseHrInput(vals.doc_update_reminder?.value?.value, config.DOC_UPDATE_REMINDER_MS);

  if (!robotModel) {
    console.error("Robot model is required but empty.");
    return;
  }

  const requestId = Date.now();

  // 1. Post the request summary to the selected channel (read-only, no buttons)
  const posted = await client.chat.postMessage({
    channel: channel,
    text: `*🔧 New Change Request Submitted*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hi! Here's a request submitted by <@${submitter}>! 
${[...approvers, ...inform].map(u => `<@${u}>`).join(", ")} *Please kindly look through it and respond accordingly.*

 •  *Robot Model (with ID)*: ${robotModel}${robotId ? ` (${robotId})` : ""}
 •  *Request Classification*: ${classification}
 •  *Request Content*: ${content}
 •  *Why this change is needed*: ${why}
 •  *People to Approve*: ${approvers.map(u => `<@${u}>`).join(", ")}
 •  *Related Documentation*: ${docs || "None"}

Result and updates will be recorded in this thread. Please also feel free to discuss in thread. Thank you!!`
        }
      }
    ]
  });

  const thread_ts = posted.ts;


  // 2. DM each approver with approve / decline buttons
  for (const user of approvers) {
    const im = await client.conversations.open({ users: user });
    await client.chat.postMessage({
      channel: im.channel.id,
      text: `📝 You have a new change request to review`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hi! You have a request from <@${submitter}> to review! 

 •  *Robot Model (with ID)*: ${robotModel}${robotId ? ` (${robotId})` : ""}
 •  *Request Classification*: ${classification}
 •  *Request Content*: ${content}
 •  *Why this change is needed*: ${why}
 •  *Related Documentation*: ${docs || "None"}

Please kindly approve or decline. If there's any further discussion or points you would like to raise, please feel free to reply in the channel thread. Thank you!!

_Noted: A reminder will be sent after ${msToHuman(reminderDelayMs)} and this will be mark as "no reponse" after ${msToHuman(noResponseDelayMs)} without actions._`
          }
        },
        {
          type: "actions",
          block_id: `actions_block_${requestId}`,
          elements: [
            {
              type: "button",
              action_id: "approve_action",
              text: { type: "plain_text", text: "✅ Approve" },
              style: "primary",
              value: JSON.stringify({ approvers, requestId })
            },
            {
              type: "button",
              action_id: "decline_action",
              text: { type: "plain_text", text: "❌ Decline" },
              style: "danger",
              value: JSON.stringify({ approvers, requestId })
            }
          ]
        }
      ]
    });
  }

  // Store full request context for use in later callbacks and reminders
  pendingApprovals[requestId] = {
    approvers,
    submitter,
    submittedAt: Date.now(),
    remindedUsers: {},
    channel,
    inform,
    robotModel,
    robotId,
    classification,
    content,
    why,
    docs,
    thread_ts,
    reminderDelayMs,
    noResponseDelayMs,
    docUpdateReminderMs
  };

  const dtChicago = DateTime.now().setZone(config.TIMEZONE);

  // Persist the initial request state to Firestore
  await saveRequestToFirestore(requestId, {
    robotModel,
    robotId,
    classification,
    content,
    why,
    approvers,
    approverStatus: [],
    inform,
    docs,
    submitter,
    channel,
    submittedAt: dtChicago.toFormat("yyyy-MM-dd HH:mm:ss"),
    submittedAt_raw: dtChicago.toISO(), // optional for spreadsheet sort/filter
    status: "🕒 Pending Approval",
    thread_ts
  });


  // Schedule reminder DM to approvers who haven't responded yet
  setTimeout(async () => {
    try {
      const record = pendingApprovals[requestId];
      if (!record) return;
      
      for (const userId of record.approvers) {
        if (!approvals[requestId]?.[userId]) {
          const im = await client.conversations.open({ users: userId });
          await client.chat.postMessage({
            channel: im.channel.id,
            text: `⏰ Reminder: You have a pending change request to review.`
          });
          record.remindedUsers[userId] = true;
          console.log(`✅ Reminder sent to ${userId}`);
        }
      }
    } catch (err) {
      console.error("⚠️ Reminder task failed:", err);
    }
  }, reminderDelayMs);

  // Auto-mark non-responders and finalize the decision after the deadline
  setTimeout(async () => {
    try {
      const record = pendingApprovals[requestId];
      if (!record) return;

      for (const userId of record.approvers) {
        if (!approvals[requestId]?.[userId]) {
          approvals[requestId] = approvals[requestId] || {};
          approvals[requestId][userId] = "no_response";
          console.log(`❌ [Auto] Marked ${userId} as no_response for request ${requestId}`);

          // Notify the approver via DM that they were marked as no-response
          const im = await client.conversations.open({ users: userId });
          await client.chat.postMessage({
            channel: im.channel.id,
            text: `⚠️ Since you didn't respond to the request within ${msToHuman(noResponseDelayMs)}, it is now marked as *No Response*.`
          });
        }
      }

      await checkFinalDecision(requestId, client);
      await updateStatusInFirestore(requestId, {
        approverStatus: record.approvers.map(uid => ({
          uid,
          decision: approvals[requestId][uid] || 'no_response',
          updatedAt: DateTime.now().setZone(config.TIMEZONE).toISO()
        }))
      });

    } catch (err) {
      console.error(`❌ Error during ${msToHuman(noResponseDelayMs)} no response check:`, err);
    }
  }, noResponseDelayMs);
});


// In-memory approval decisions. Lost on restart; Firestore holds the authoritative state.
const approvals = {}; // { requestId: { userId: "approved" | "declined" | "no_response" } }
// Guards against checkFinalDecision running more than once per request
const finalizedRequests = new Set();

app.action(/^(approve_action|decline_action)$/, async ({ body, ack, action, client }) => {
  await ack();

  const userId = body.user.id;
  const { approvers, requestId } = JSON.parse(action.value);

  if (!approvals[requestId]) approvals[requestId] = {};

  // Reject duplicate submissions from the same approver
  if (approvals[requestId][userId]) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: `⚠️ You have already responded (${approvals[requestId][userId]}).`
    });
    return;
  }

  const decision = action.action_id === "approve_action" ? "approved" : "declined";
  approvals[requestId][userId] = decision;
  await updateStatusInFirestore(requestId, {
    approverStatus: approvers.map(uid => ({
      uid,
      decision: approvals[requestId][uid] || null,
      updatedAt: DateTime.now().setZone(config.TIMEZONE).toISO()
    }))
  });
  await checkFinalDecision(requestId, client);

  // Update the DM message to show which button was pressed
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: body.message.text,
    blocks: body.message.blocks.map(block => {
      if (block.type === "actions") {
        block.elements = block.elements.map(btn => {
          if (
            (decision === "approved" && btn.action_id === "approve_action") ||
            (decision === "declined" && btn.action_id === "decline_action")
          ) {
            return {
              type: "button",
              action_id: btn.action_id,
              text: {
                type: "plain_text",
                text: decision === "approved" ? "✅ Approved" : "❌ Declined"
              },
              value: btn.value
            };
          }
          return btn;
        });
      }
      return block;
    })
  });

  // Confirm the decision to the approver via ephemeral message
  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: userId,
    text: `You have *${decision}* this change request.`
  });

  console.log("✅ Current approval state:", approvals[requestId]);
});

app.action("confirm_docs_updated", async ({ ack, body, client, action }) => {

  await ack();

  const userId = body.user.id;
  const requestId = action.value;
  const record = pendingApprovals[requestId];
  const decisions = approvals[requestId];

  if (record.docConfirmed) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: `⚠️ This request has already been confirmed as completed.`
    });
    return;
  }

  if (!record) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: `⚠️ Cannot find original request info. Please contact admin.`
    });
    return;
  }

  const dateConfirmed = DateTime.now().setZone(config.TIMEZONE).toFormat("yyyy-MM-dd");

  const { robotModel, robotId, classification, content, why, docs, inform, approvers } = record;

  if (pendingApprovals[requestId]) {
    pendingApprovals[requestId].docConfirmed = true;
  }

  // Resolve the confirming user's display name for the log
  const userNames = await getUsernamesFromIds([userId], client);
  const userDisplayName = userNames[userId] || userId;

  // Log the completed request to Google Sheets
  await logToSheet({
    requestId,
    robotModel,
    robotId,
    classification,
    content,
    why,
    approvers: approvers,
    approverStatus: approvers.map(u => `${u}: ${decisions[u]}`),
    inform: inform,
    docs,
    submitter: userDisplayName,
    status: `✅ Final Documentation Updated (by ${userDisplayName}, ${dateConfirmed})`,
  });

  // Confirm to the user that their documentation confirmation was received
  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: userId,
    text: `✅ Thank you for confirming the documentation update!`
  });

  await updateStatusInFirestore(requestId, { docConfirmed: true });

  await client.chat.postMessage({
    channel: record.channel,
    thread_ts: record.thread_ts,
    text: `📄 <@${userId}> confirmed that the related documentations are updated for this request on ${dateConfirmed}.
This change request is now fully executed and logged.`
  });

  console.log(`📄 Documentation update confirmed for request ${requestId}`);
});


async function checkFinalDecision(requestId, client) {
  if (finalizedRequests.has(requestId)) {
    console.log(`🛑 Request ${requestId} already finalized. Skipping duplicate actions.`);
    return;
  }
  
  const record = pendingApprovals[requestId];
  if (!record) {
    console.error(`❌ No record found for requestId: ${requestId}`);
    return;
  }

  const {
    robotModel,
    robotId,
    classification,
    content,
    docs,
    approvers,
    inform = [],
    submitter,
    channel,
    thread_ts,
    noResponseDelayMs = config.NO_RESPONSE_DELAY_MS,
    docUpdateReminderMs = config.DOC_UPDATE_REMINDER_MS
  } = record;

  // 1. Check whether all approvers have responded (including auto no-response)
  const current = approvals[requestId];
  if (!current) {
    console.log(`⏸️ No approvals recorded yet for request ${requestId}`);
    return;
  }

  const allResponded = approvers.every(uid => current[uid]);
  if (!allResponded) {
    console.log(`⏸️ Not all approvers responded for request ${requestId}:`, current);
    return; // still waiting on some approvers
  }

  finalizedRequests.add(requestId);
  console.log("🎯 All approvers responded:", current);

  // 2. Determine the overall outcome
  const anyDeclined = Object.values(current).includes("declined");
  const anyNoResponse = Object.values(current).includes("no_response");

  try {
    // Resolve all user IDs to display names for messages and log entries
    const allUserIds = [...new Set([...approvers, ...record.inform, submitter])];
    const userNames = await getUsernamesFromIds(allUserIds, client);

    if (!anyDeclined && !anyNoResponse) {
      // All approved — notify submitter and post approval notice to the channel
      console.log(`✅ Request ${requestId} approved by all`);
      
      const im = await client.conversations.open({ users: submitter });
      await client.chat.postMessage({
        channel: im.channel.id,
        text: `✅ Your change request has been *approved by all approvers*.\n\nA final change notice has been posted in channel.\n\nYou may now proceed with the change.\n\nPlease update the documentation accordingly. Once done, click the button below to confirm.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hi! *Your change request has been approved by all approvers! ✅*
You may now proceed with implementing the changes and updating the documentation.
*When you're done, please kindly confirm below:*`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: "confirm_docs_updated",
                text: { type: "plain_text", text: "📄 Confirm Documentation Updated" },
                style: "primary",
                value: requestId.toString()
              }
            ]
          }
        ]
      });

      await client.reactions.add({
        name: "white_check_mark",
        channel: channel,
        timestamp: thread_ts
      });

      await client.chat.postMessage({
        channel: record.channel,
        thread_ts: record.thread_ts,
        text: `✅ *Change Request Approved*: ${record.robotModel} (${record.robotId})\nAll approvers have approved this change.\nDocumentation update is now required.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hi ${[...approvers, ...inform].map(u => `<@${u}>`).join(", ")}! This request has been approved by all deciders ✅

 •  *Robot Model (with ID)*: ${robotModel}${robotId ? ` (${robotId})` : ""}
 •  *Request Classification*: ${classification}
 •  *Request Content*: ${content}
 •  *Approved by:* ${approvers.map(u => `<@${u}>`).join(", ")}
 •  *Related Documentation*: ${docs || "None"}

 Please kindly adjust accordingly and let <@${submitter}> know if you have any thoughts or suggestion! Thank you!`
            }
          }
        ]
      });

      // Remind submitter to confirm the doc update if they haven't done so yet
      setTimeout(async () => {
        try {
          const recordStillExists = pendingApprovals[requestId];
          if (!recordStillExists) return;
          if (recordStillExists.docConfirmed) return; // already confirmed, skip

          const imReminder = await client.conversations.open({ users: submitter });
          await client.chat.postMessage({
            channel: imReminder.channel.id,
            text: `⏰ Reminder: Please kindly confirm if the documentation has been updated for your approved change request. Click the button in the previous message if you have already updated. Thank you!`
          });

          console.log(`⏰ Reminder sent to submitter <@${submitter}> for doc update (requestId: ${requestId})`);
        } catch (err) {
          console.error(`❌ Doc update reminder failed for requestId ${requestId}:`, err);
        }
      }, docUpdateReminderMs);

      // Log the approved request to Google Sheets
      await logToSheet({
        requestId,
        robotModel: record.robotModel,
        robotId: record.robotId,
        classification: record.classification,
        content: record.content,
        why: record.why,
        approvers: approvers.map(u => userNames[u] || u),
        approverStatus: approvers.map(u => `${userNames[u] || u}: ${current[u]}`),
        inform: record.inform.map(u => userNames[u] || u),
        docs: record.docs,
        submitter: userNames[submitter] || submitter,
        status: " ✅ -> Pending Doc Update",
        threadLink: `${config.SLACK_WORKSPACE_URL}/archives/${channel}/p${thread_ts.replace(".", "")}`
      });

      console.log(`✅ Request ${requestId} logged to spreadsheet as approved`);

    } else {
      // Rejected or timed out — notify submitter to coordinate and resubmit
      console.log(`❌ Request ${requestId} rejected or timed out`);
      
      const declined = Object.entries(current).filter(([_, v]) => v === "declined").map(([u]) => `<@${u}>`);
      const noResp = Object.entries(current).filter(([_, v]) => v === "no_response").map(([u]) => `<@${u}>`);
      
      const im = await client.conversations.open({ users: submitter });
      await client.chat.postMessage({
        channel: im.channel.id,
        text: `Your change request was rejected ❌.

Some deciders have declined or did not respond within ${msToHuman(noResponseDelayMs)}.
 •  *Declined:* ${declined.join(", ") || "None"}
 •  *No Response:* ${noResp.join(", ") || "None"}

Please coordinate and submit again if needed. Thank you!`
      });

      await client.reactions.add({
        name: "x",
        channel: channel,
        timestamp: thread_ts
      });

      await client.chat.postMessage({
        channel: record.channel,
        thread_ts: record.thread_ts,
        text: `Hi! This request has been rejected. ❌

 •  *Declined by:* ${declined.join(", ") || "None"}
 •  *No Response:* ${noResp.join(", ") || "None"}
 
 <@${submitter}> Please kindly coordinate and resubmit if needed. Thank you!`
      });

      // Log the rejected request to Google Sheets
      await logToSheet({
        requestId,
        robotModel: record.robotModel,
        robotId: record.robotId,
        classification: record.classification,
        content: record.content,
        why: record.why,
        approvers: approvers.map(u => userNames[u] || u),
        approverStatus: approvers.map(u => `${userNames[u] || u}: ${current[u]}`),
        inform: record.inform.map(u => userNames[u] || u),
        docs: record.docs,
        submitter: userNames[submitter] || submitter,
        status: " ❌ Needs Resubmission",
        threadLink: `${config.SLACK_WORKSPACE_URL}/archives/${channel}/p${thread_ts.replace(".", "")}`
      });

      console.log(`❌ Request ${requestId} logged to spreadsheet as rejected`);
    }
  } catch (error) {
    console.error(`❌ Error in checkFinalDecision for request ${requestId}:`, error);
  }
}

// Returns a map of { userId: displayName } for the given list of user IDs.
// Falls back to the raw user ID if the API call fails.
async function getUsernamesFromIds(userIds, client) {
  const nameMap = {};
  for (const userId of userIds) {
    try {
      const res = await client.users.info({ user: userId });
      nameMap[userId] = res.user.profile.display_name || res.user.real_name || userId;
    } catch (err) {
      console.error(`❌ Failed to get name for ${userId}:`, err);
      nameMap[userId] = userId;
    }
  }
  return nameMap;
}

(async () => {
  await app.start(config.PORT);
  console.log("⚡️ Slack Bot is running");
  console.log("🛰️ Started at " + new Date());
})();