# Operation Manual

A list of operation manuals.

## Setting User Admin

ReapBid uses Firebase Admin SDK to set user admin claims. This is required only for the operation of the cloud functions.

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

## Setting User Admin ReapBid UI roles

The rule for ReapBid realtime database access.

```json
/users
   /{UID}
      /roles
         /admin:true
```

Replace UID with the firebase user UID you want to set as admin in the UI.

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "games": {
      "$sessionId": {
        "gameState": {
          ".indexOn": "isActive"
        }
      }
    },
    "users": {
      "$uid": {
        "roles": {
          ".read": "auth != null",
          ".write": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('roles').child('admin').val() === true)"
        }
      }
    },
    "gameState": {
      ".indexOn": "isActive",
      ".read": "auth != null",
      ".write": "auth != null",
      "players": {
        "$playerId": {
          ".read": "auth != null",
          ".write": "auth != null",
          ".validate": "newData.hasChildren(['name', 'currentBid', 'hasSubmittedBid', 'lastBidTime', 'isTimedOut'])",
          "name": {
            ".validate": "newData.isString()"
          },
          "currentBid": {
            ".validate": "newData.isNumber() || newData.val() == null"
          },
          "hasSubmittedBid": {
            ".validate": "newData.isBoolean()"
          },
          "lastBidTime": {
            ".validate": "newData.val() == null || newData.isNumber()"
          },
          "isTimedOut": {
            ".validate": "newData.isBoolean()"
          }
        }
      },
      "roundHistory": {
        "$roundId": {
          ".validate": "newData.hasChildren(['roundNumber', 'bids', 'profits', 'marketShares'])"
        }
      }
    }
  }
}
```