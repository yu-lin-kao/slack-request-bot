const fs = require("fs");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const config = require("./config");

const path = config.FIREBASE_CREDENTIALS_PATH;

if (!fs.existsSync(path)) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON file not found at", path);
  process.exit(1);
}

const raw = fs.readFileSync(path, "utf8");
const serviceAccount = JSON.parse(raw);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

module.exports = db;