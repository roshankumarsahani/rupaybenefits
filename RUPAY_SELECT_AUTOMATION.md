# RuPay Select local automation companion

The existing RuPay Benefits workspace can optionally run with a desktop-only local browser companion.

## Start the local app and companion

See local-agent/README.md. The companion serves the current app from http://127.0.0.1:3939 and launches a visible Chromium browser for each separately registered RuPay Select portal account. The current implementation deliberately leaves portal sign-in, CAPTCHA, OTP, card payment and final bank authorization to the cardholder.

## Firestore rules for RuPay Select account records

Publish the root firestore.rules file in Firebase Console → Firestore Database → Rules. The new rules allow each signed-in user to read and manage only their own account records at users/{uid}/rupaySelectAccounts/{accountId}.

Account documents contain only:
- A user-chosen label
- Registered RuPay portal email
- IDs of cards already in the user's private workspace
- Created/updated timestamps

They must not contain portal passwords, full card numbers, CVV, PIN, OTP or bank credentials.
