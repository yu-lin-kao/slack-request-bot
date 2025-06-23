const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.error("🚨 FIREBASE_SERVICE_ACCOUNT_JSON is undefined");
  process.exit(1);
}

// 🔁 從環境變數中讀取並轉成 JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

module.exports = db;
