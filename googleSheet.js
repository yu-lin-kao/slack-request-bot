const { google } = require("googleapis");
const credentials = require("./credentials.json");

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = "1JR0r4esk6C8Z4uqah3lIabdIEViZdqQNzf457lMADjw";
const SHEET_NAME = "Sheet1";

let cachedRowMap = {}; // { requestId: rowIndex }

async function logToSheet({
  requestId,
  robotModel,
  robotId,
  classification,
  content,
  why,
  approvers,
  approverStatus,
  inform,
  docs,
  submitter,
  status
}) {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });

  // 1️⃣ 如果已知 rowIndex → 直接更新
  if (cachedRowMap[requestId]) {
    const rowIndex = cachedRowMap[requestId];
    const updateRange = `${SHEET_NAME}!M${rowIndex + 1}`; // Status is column M (13th)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] }
    });
    console.log(`✅ Status updated in row ${rowIndex + 1}`);
    return;
  }

  // 2️⃣ 嘗試尋找相同 requestId
  const readRange = `${SHEET_NAME}!A2:A`;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: readRange,
  });

  const rows = result.data.values || [];
  let foundRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === requestId.toString()) {
      foundRow = i + 1; // offset for header
      break;
    }
  }

  if (foundRow) {
    cachedRowMap[requestId] = foundRow;
    const updateRange = `${SHEET_NAME}!M${foundRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] }
    });
    console.log(`🔄 Status updated for existing requestId in row ${foundRow}`);
  } else {
    const date = new Date().toLocaleString();
    const row = [
      requestId,
      robotModel,
      robotId,
      classification,
      content,
      why,
      approvers.join(", "),
      approverStatus.join(", "),
      inform.join(", "),
      docs,
      submitter,
      date,
      status
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    cachedRowMap[requestId] = rows.length + 1;
    console.log(`🆕 New row logged for request ${requestId}`);
  }
}

module.exports = { logToSheet };
