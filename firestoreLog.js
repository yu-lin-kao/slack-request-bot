const db = require('./firebase');

db.collection('test').add({ hello: "world" })
  .then(() => console.log("✅ Firestore test write succeeded"))
  .catch(err => console.error("❌ Firestore test write failed", err));

async function saveRequestToFirestore(requestId, data) {
  await db.collection('change_requests').doc(String(requestId)).set(data);
  console.log(`📥 Firestore: created request ${requestId}`);
}

async function updateStatusInFirestore(requestId, update) {
  await db.collection('change_requests').doc(String(requestId)).update(update);
  console.log(`✏️ Firestore: updated request ${requestId}`);
}

module.exports = { saveRequestToFirestore, updateStatusInFirestore };
