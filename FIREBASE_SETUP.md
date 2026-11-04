# Firebase setup — RuPay Benefits

This app uses Firebase Authentication (email/password) and Cloud Firestore. It runs as a static site and does not require the Oracle VM, Docker, Node server or PostgreSQL.

## Existing project

- Firebase project: `rupay-benefits`
- Authentication provider: Email/Password
- Firestore path: `users/{uid}/workspace/main`

## Publish the current Firestore rules

This application update adds card variants, cardholders, benefit usage and a reusable Benefits List. The rules must allow the added arrays or Firestore will reject saves.

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Select the **rupay-benefits** project.
3. Open **Firestore Database → Rules**.
4. Replace the rules with the exact contents of the repository file **firestore.rules**.
5. Tap **Publish**.

The current rules permit only the signed-in user to read/write their own workspace and validate the workspace arrays. They do not enable public access.

## Services already used

1. Authentication → Sign-in method → Email/Password must remain enabled.
2. Firestore Database must remain created in production mode.
3. Keep the Firebase web app configuration in `firebase-config.js`. It is public browser configuration, not a service-account key.

## Data migration and app usage

- The workspace is still stored at `users/{uid}/workspace/main`.
- Existing `cards` and `vouchers` are retained when the new app loads.
- Existing cards with old benefit-note text are converted to individual legacy variants so the note text remains available. Their cycle is set to Manual and the usage cap is left unlimited because the old notes did not define reliable limits.
- Create or edit a card variant first. Then add cards and assign each card to its variant and optional cardholder.
- Each card gets its own usage counter for the benefits defined by its assigned variant.
- Export a JSON backup from Data & settings before bulk imports or major changes.

## Workspace fields accepted by Firestore rules

- `cards`: card records and variant assignments
- `vouchers`: voucher records and supplier details
- `variants`: reusable card benefit definitions
- `holders`: cardholder records
- `benefitUsages`: card-specific benefit usage entries
- `benefitCatalog`: reusable benefit definitions selected by card variants
- `updatedAt`: last cloud save timestamp

## Important

- Never store full card numbers, CVVs, PINs, OTPs, banking passwords or payment credentials. Only the last four digits should be saved.
- A configured limit of 0 means no fixed cap is enforced by the app. Verify all actual benefit terms with the issuing bank.
- Monthly/quarterly/semi-annual/annual counters use calendar periods. Issuer-specific benefit cycles may differ; use Manual or adjust the cycle where the bank's terms require it.
- Firestore workspace is one document per account and therefore has a 1 MiB document limit. Keep backups and modest inventories. A larger deployment should move records to per-record subcollections.
- Firebase free quotas are limited. Monitor usage and configure a budget alert.
