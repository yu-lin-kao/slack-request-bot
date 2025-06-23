// firebase.js
const { initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./firebaseServiceAccount.json");

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

module.exports = db;