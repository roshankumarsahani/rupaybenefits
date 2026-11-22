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


## Oracle Cloud hosting

The Oracle-ready companion uses a headless ARM64 Chromium browser in the official Playwright container. The signed-in dashboard remotely displays its screenshot and forwards direct user taps/typing to that browser.

Deployment guide: local-agent/README.md
Installer: local-agent/deploy-oracle.sh
Container build: local-agent/Containerfile

The intended target is Oracle Linux 9 on an A1/Ampere ARM64 VM. Set up a DNS A record and allow inbound TCP 80 and 443 in OCI's VCN security list or NSG. The companion itself is bound to host loopback at 127.0.0.1:3939; never expose that port publicly. Caddy handles HTTPS on 80/443. Add the host to Firebase Auth authorized domains and publish the updated Firestore rules.

This feature does not run on the iPhone itself. It runs on the Oracle VM, while the iPhone accesses its browser screen through the HTTPS dashboard.
