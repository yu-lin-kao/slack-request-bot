const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.error("🚨 FIREBASE_SERVICE_ACCOUNT_JSON is undefined");
  process.exit(1);
}

// 🔁 從環境變數中讀取並轉成 JSON
const fs = require("fs");
const firebasePath = "/etc/secrets/FIREBASE_SERVICE_ACCOUNT_JSON";

if (!fs.existsSync(firebasePath)) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON not found");
  process.exit(1);
}

const rawFirebase = fs.readFileSync(firebasePath, "utf8");
const serviceAccount = JSON.parse(rawFirebase);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

module.exports = db;
