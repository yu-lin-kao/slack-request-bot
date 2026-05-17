const db = require('./firebase');

// Creates a new document for the given requestId with the full request payload.
async function saveRequestToFirestore(requestId, data) {
  await db.collection('change_requests').doc(String(requestId)).set(data);
  console.log(`📥 Firestore: created request ${requestId}`);
}

// Merges the provided fields into an existing request document.
async function updateStatusInFirestore(requestId, update) {
  await db.collection('change_requests').doc(String(requestId)).update(update);
  console.log(`✏️ Firestore: updated request ${requestId}`);
}

module.exports = { saveRequestToFirestore, updateStatusInFirestore };
