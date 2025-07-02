require("dotenv").config();
const { DateTime } = require("luxon");
const { App, ExpressReceiver } = require("@slack/bolt");

// ✅ 先定義 receiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// ✅ 再從 receiver 取得 express app
const appExpress = receiver.app;

// ✅ 加入 Render ping 用的 endpoint
appExpress.get("/", (req, res) => {
  res.status(200).send("🛰️ Change Request Bot is running.");
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
          type: "input",
          block_id: "robot_model",
          element: {
            type: "multi_static_select",
            action_id: "value",
            options: [
              { text: { type: "plain_text", text: "TPV" }, value: "TPV" },
              { text: { type: "plain_text", text: "TPr" }, value: "TPr" },
              { text: { type: "plain_text", text: "TMx" }, value: "TMx" },
              { text: { type: "plain_text", text: "TSP" }, value: "TSP" },
              { text: { type: "plain_text", text: "TS" }, value: "TS" },
              { text: { type: "plain_text", text: "Other" }, value: "Other" }
            ]
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
            options: [
              { text: { type: "plain_text", text: "Scope" }, value: "Scope" },
              { text: { type: "plain_text", text: "Design-Mech" }, value: "Design-Mech" },
              { text: { type: "plain_text", text: "Design-Elec" }, value: "Design-Elec" }
            ]
          },
          label: { type: "plain_text", text: "Change Classification" },
        },
        {
          type: "input",
          block_id: "content",
          element: { type: "plain_text_input", action_id: "value", multiline: true },
          label: { type: "plain_text", text: "Change Content" },
        },
        {
          type: "input",
          block_id: "why",
          element: { type: "plain_text_input", action_id: "value", multiline: true },
          label: { type: "plain_text", text: "Why is this change needed?" },
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
              text: "Select users to be informed"
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
          label: { type: "plain_text", text: "Discussion should happen in which Slack channel?" }
        },
        {
          type: "input",
          block_id: "docs",
          element: { 
            type: "plain_text_input", 
            action_id: "value",
            placeholder: { type: "plain_text", text: "https://drive.google.com/..." }
          },
          label: { type: "plain_text", text: "Related documentation (Google Drive link)" },
          optional: true
        }
      ]
    }
  });
});

// 這個物件會記錄誰還沒回，什麼時候送出的
const pendingApprovals = {}; // { requestId: { approvers, submitter, submittedAt, remindedUsers: {} } }

app.view("change_request_submit", async ({ ack, view, client }) => {
  await ack();
  const vals = view.state.values;
  const approvers = vals.approvers.value.selected_users;
  const inform = vals.inform?.value?.selected_users || []; // optional
  const channel = vals.channel.value.selected_conversation;
  const docs = vals.docs?.value?.value || ""; // optional
  const submitter = view.private_metadata;

  // ✅ 處理 Robot Model (多選)
  const robotModel = vals.robot_model.value.selected_options.map(opt => opt.value).join(", ");

  // ✅ 處理 Robot ID（轉大寫）
  const robotId = (vals.robot_id.value.value || "").toUpperCase();

  const classification = vals.classification.value.selected_option.value;
  const content = vals.content.value.value;
  const why = vals.why.value.value;

  // ❗ 驗證 Robot Model 是否有值
  if (!robotModel) {
    console.error("Robot model is required but empty.");
    return;
  }

  const requestId = Date.now(); // 用於記錄審核狀態

  // 1️⃣ 發 summary 到頻道（沒有按鈕）
  const posted = await client.chat.postMessage({
    channel: channel,
    text: `*🔧 New Change Request Submitted*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hi! Here's a request submitted by <@${submitter}>! ${approvers.concat(inform).map(u => `<@${u}>`).join(", ")} *Please kindly look through it and respond accordingly.*

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

  // 2️⃣ 發審核通知給每位 approver（含按鈕）
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
            text: `*Robot*: ${robotModel}${robotId ? ` (${robotId})` : ""}\n*Classification*: ${classification}\n*Content*: ${content}\n*Why*: ${why}\n*Docs*: ${docs || "None"}`
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

  // 初始化記錄
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
    thread_ts
  };

  const dtChicago = DateTime.now().setZone("America/Chicago");

  // 🔥 Firestore 紀錄初始狀態
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


  // 🕒 設定 24 小時後提醒
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
  }, 1000 * 60 * 0.5); // <-- 開發測試用 0.5分鐘提醒，正式版請設為 1000 * 60 * 60 * 24

  // 🕒 設定 48 小時後自動標記 no response
  setTimeout(async () => {
    try {
      const record = pendingApprovals[requestId];
      if (!record) return;
      
      for (const userId of record.approvers) {
        if (!approvals[requestId]?.[userId]) {
          approvals[requestId] = approvals[requestId] || {};
          approvals[requestId][userId] = "no_response";
          console.log(`❌ [Auto] Marked ${userId} as no_response for request ${requestId}`);

          // 發私訊通知他被標記
          const im = await client.conversations.open({ users: userId });
          await client.chat.postMessage({
            channel: im.channel.id,
            text: `⚠️ You did not respond to the change request within 48 hours and have been marked as *No Response*.`
          });
        }
      }

      // ✅ 加這一行在最後：處理完所有 no_response 之後，判斷整體決策結果
      await checkFinalDecision(requestId, client);

    } catch (err) {
      console.error("❌ Error during 48hr no response check:", err);
    }
  }, 1000 * 60 * 1); // 測試用 1 分鐘，正式版請設為 1000 * 60 * 60 * 48
});


// 暫時用一個 memory 結構儲存每筆審核狀態
const approvals = {}; // { requestId: { userId: "approved"/"declined" } }
const finalizedRequests = new Set(); // ✅ 防止 checkFinalDecision 執行多次

app.action(/^(approve_action|decline_action)$/, async ({ body, ack, action, client }) => {
  await ack();

  const userId = body.user.id;
  const { approvers, requestId } = JSON.parse(action.value);

  // 初始化記錄區
  if (!approvals[requestId]) approvals[requestId] = {};

  // 如果這個 user 已回覆過，就不要再記錄
  if (approvals[requestId][userId]) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: `⚠️ You have already responded (${approvals[requestId][userId]}).`
    });
    return;
  }

  // 記錄使用者回應
  const decision = action.action_id === "approve_action" ? "approved" : "declined";
  approvals[requestId][userId] = decision;
  await checkFinalDecision(requestId, client);
  

  // 更新原始 message（變灰按鈕 or 顯示已選）
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

  // 傳私訊通知使用者
  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: userId,
    text: `You have *${decision}* this change request.`
  });

  // 👉 如果你想印出目前已回覆的人
  console.log("✅ Current approval state:", approvals[requestId]);
});

app.action("confirm_docs_updated", async ({ ack, body, client, action }) => {
  await ack();

  const userId = body.user.id;
  const requestId = action.value;
  const record = pendingApprovals[requestId];
  const decisions = approvals[requestId];

  if (!record) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: `⚠️ Cannot find original request info. Please contact admin.`
    });
    return;
  }

  const { robotModel, robotId, classification, content, why, docs, channel, inform, approvers } = record;

  if (pendingApprovals[requestId]) {
    pendingApprovals[requestId].docConfirmed = true;
  }

  // ✅ 轉換 UserID → Display name
  const userNames = await getUsernamesFromIds([userId], client);
  const userDisplayName = userNames[userId] || userId;

  // ✅ 更新 Spreadsheet 狀態
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
    status: `✅ Final Documentation Updated (by ${userDisplayName}, ${new Date().toLocaleDateString()})`
  });

  // ✅ 私訊回應者
  await client.chat.postEphemeral({
    channel: body.channel.id,
    user: userId,
    text: `✅ You confirmed the documentation update. Thank you!`
  });

  await client.chat.postMessage({
    channel: record.channel,
    thread_ts: record.thread_ts,
    text: `📄 <@${userId}> confirmed documentation updated for request *${requestId}* on ${new Date().toLocaleDateString()}.\n\nChange is now fully executed and logged.`
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
  
  const approvers = record.approvers;
  const submitter = record.submitter;

  // 1️⃣ 確認是否全部回應（包含 no_response）
  const current = approvals[requestId];
  if (!current) {
    console.log(`⏸️ No approvals recorded yet for request ${requestId}`);
    return;
  }

  const allResponded = approvers.every(uid => current[uid]);
  if (!allResponded) {
    console.log(`⏸️ Not all approvers responded for request ${requestId}:`, current);
    return; // 有人尚未回應
  }

  // 防止重複執行
  finalizedRequests.add(requestId);
  
  console.log("🎯 All approvers responded:", current);

  // 2️⃣ 判斷結果
  const anyDeclined = Object.values(current).includes("declined");
  const anyNoResponse = Object.values(current).includes("no_response");

  try {
    // 先獲取所有用戶名稱
    const allUserIds = [...new Set([...approvers, ...record.inform, submitter])];
    const userNames = await getUsernamesFromIds(allUserIds, client);
    
    if (!anyDeclined && !anyNoResponse) {
      // ✅ 全部核准 → 通知申請人可以改變
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
              text: `✅ *Your change request has been approved by all approvers!*\n\nA final change notice has been posted in channel.\n\nYou may now proceed with implementing the change and updating the documentation.\n\nWhen you're done, please confirm below:`
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

      await client.chat.postMessage({
        channel: record.channel,
        thread_ts: record.thread_ts,
        text: `✅ *Change Request Approved*: ${record.robotModel} (${record.robotId})\nAll approvers have approved this change.\nDocumentation update is now required.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Robot:* ${record.robotModel} (${record.robotId})\n*Classification:* ${record.classification}\n*Content:* ${record.content}\n*Why:* ${record.why}\n*Docs:* ${record.docs}\n*Approved by:* ${approvers.map(u => `<@${u}>`).join(", ")}\n*Informed:* ${record.inform.map(u => `<@${u}>`).join(", ")}`
            }
          }
        ]
      });

      // 🕒 24 小時後提醒 submitter 若尚未確認文件更新
      setTimeout(async () => {
        try {
          const recordStillExists = pendingApprovals[requestId];
          if (!recordStillExists) return;
          if (recordStillExists.docConfirmed) return; // 已確認就不提醒

          const imReminder = await client.conversations.open({ users: submitter });
          await client.chat.postMessage({
            channel: imReminder.channel.id,
            text: `⏰ Reminder: Please confirm the documentation has been updated for your approved change request *${requestId}*. Click the button in the previous message if you have already done so.`
          });

          console.log(`⏰ Reminder sent to submitter <@${submitter}> for doc update (requestId: ${requestId})`);
        } catch (err) {
          console.error(`❌ Doc update reminder failed for requestId ${requestId}:`, err);
        }
      }, 1000 * 60 * 0.5); // ⚠️ 測試用 0.5 分鐘，正式請用 1000 * 60 * 60 * 24


      // 記錄到 spreadsheet
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
        status: " ✅ -> Pending Doc Update"
      });

      console.log(`✅ Request ${requestId} logged to spreadsheet as approved`);

    } else {
      // ❌ 有人拒絕或未回覆 → 通知申請人需協調
      console.log(`❌ Request ${requestId} rejected or timed out`);
      
      const declined = Object.entries(current).filter(([_, v]) => v === "declined").map(([u]) => `<@${u}>`);
      const noResp = Object.entries(current).filter(([_, v]) => v === "no_response").map(([u]) => `<@${u}>`);
      
      const im = await client.conversations.open({ users: submitter });
      await client.chat.postMessage({
        channel: im.channel.id,
        text: `:warning: Your change request could not proceed.\nSome approvers have declined or did not respond within 48 hours.\n\n*Declined:* ${declined.join(", ") || "None"}\n*No Response:* ${noResp.join(", ") || "None"}\n\nPlease coordinate and submit again if needed.`
      });

      await client.chat.postMessage({
        channel: record.channel,
        thread_ts: record.thread_ts,
        text: `❌ *Change Request Rejected or Timed Out* for ${record.robotModel} (${record.robotId})\n\n*Declined:* ${declined.join(", ") || "None"}\n*No Response:* ${noResp.join(", ") || "None"}\n\nPlease coordinate and resubmit if needed.`
      });


      // 記錄到 spreadsheet
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
        status: " ❌ Needs Resubmission"
      });

      console.log(`❌ Request ${requestId} logged to spreadsheet as rejected`);
    }
  } catch (error) {
    console.error(`❌ Error in checkFinalDecision for request ${requestId}:`, error);
  }
}

async function getUsernamesFromIds(userIds, client) {
  const nameMap = {};
  for (const userId of userIds) {
    try {
      const res = await client.users.info({ user: userId });
      nameMap[userId] = res.user.profile.display_name || res.user.real_name || userId;
    } catch (err) {
      console.error(`❌ Failed to get name for ${userId}:`, err);
      nameMap[userId] = userId; // fallback
    }
  }
  return nameMap;
}

(async () => {
  await app.start(3000);
  console.log("⚡️ Slack Bot is running");
  console.log("🛰️ Running from Render at " + new Date());
})();



