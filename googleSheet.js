const fs = require("fs");
const { google } = require("googleapis");
const { DateTime } = require("luxon");

const path = process.env.CREDENTIALS_JSON || "/etc/secrets/CREDENTIALS_JSON";

if (!fs.existsSync(path)) {
  console.error("❌ CREDENTIALS_JSON file not found at", path);
  process.exit(1);
}

const raw = fs.readFileSync(path, "utf8");
const credentials = JSON.parse(raw);

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

  if (cachedRowMap[requestId]) {
    const rowIndex = cachedRowMap[requestId];
    const updateRange = `${SHEET_NAME}!M${rowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[status]] }
    });
    console.log(`✅ Status updated in row ${rowIndex + 1}`);
    return;
  }

  const readRange = `${SHEET_NAME}!A2:A`;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: readRange,
  });

  const rows = result.data.values || [];
  let foundRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === requestId.toString()) {
      foundRow = i + 1;
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
    const date = DateTime.now().setZone("America/Chicago").toFormat("yyyy-MM-dd HH:mm:ss");
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
