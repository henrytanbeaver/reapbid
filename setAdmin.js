const admin = require('firebase-admin');

var serviceAccount = require("./your-firebase-adminsdk-12wim-c4a4195deb.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://<project-id>-default-rtdb.firebaseio.com"
});


// Set the custom claim
const setAdminClaim = async (uid) => {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    console.log(`Admin claim set for user: ${uid}`);
  } catch (error) {
    console.error("Error setting admin claim:", error);
  }
};

// Replace 'USER_UID' with the UID of the user you want to update
setAdminClaim(YOUR_USER_ID);