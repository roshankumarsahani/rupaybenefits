# Firebase setup — RuPay Benefits

This app uses Firebase Authentication (email/password) and one private Cloud Firestore workspace document per account. It does not need the Oracle VM, Docker, Node server, or PostgreSQL.

## 1. Create a separate Firebase project
1. Open https://console.firebase.google.com/ and create a project named `rupay-benefits`.
2. Add a **Web app** to the project and copy its Firebase configuration.
3. In Project settings → General → Your apps, copy the config values into `firebase-config.js`. Replace every placeholder. Do not add a service-account key or private key.

## 2. Enable services
1. Authentication → Sign-in method → enable **Email/Password**.
2. Firestore Database → Create database. Start in production mode and select a nearby region. The database location cannot be changed later.
3. Firestore Rules → paste the contents of `firestore.rules` and publish.

## 3. Deploy
Commit the repository to GitHub Pages (or your existing static hosting). The Firebase SDK is loaded from Google's CDN. Keep `firebase-config.js` in the published site.

## 4. First login and data
Open the site, create an account with email and password, then sign in. Each account gets a private workspace at `users/{uid}/workspace/main`. The app saves cards and vouchers together in that document and syncs them across devices signed into the same account.

The first successful sign-in on a browser migrates any existing local browser records into that account if its cloud workspace is empty. Export a JSON backup first as an extra precaution. Existing local records are not automatically deleted.

## Free-plan notes
Firestore and Authentication have free allowances, not unlimited storage. Firestore charges/limits depend on database location and usage. Set a Google Cloud budget alert and monitor Firebase usage. Phone/SMS authentication is not used.

## Important
- Never store full card numbers, CVVs, OTPs, banking passwords, or payment credentials.
- The Firebase web config is intended to be present in browser code. Firestore Security Rules enforce account-level access.
- Do not enable anonymous/public reads or writes.
- Export periodic JSON backups from Data & settings.
