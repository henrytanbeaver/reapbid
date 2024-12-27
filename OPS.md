# Operation Manual

A list of operation manuals.

## Setting User Admin

ReapBid uses Firebase Admin SDK to set user admin claims.

```bash
npm install firebase-admin
```

Get the service account file from Firebase console and place it in the same directory as the setAdmin.js file.

```javascript
const admin = require('firebase-admin');

var serviceAccount = require("path-to-service-account-file.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://reapbid-default-rtdb.firebaseio.com"
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
setAdminClaim('qPnSTQqCZnTwUpDj30M6IFxjA993');

```

```bash
node setAdmin.js
```