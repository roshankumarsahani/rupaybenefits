# RuPay Benefits local companion

This companion launches a separate, visible Chromium profile for each RuPay Select portal account. It runs only on your desktop computer and stores browser cookies/session data locally.

## Requirements

- Windows, macOS or Linux desktop/laptop
- Node.js 20 or newer
- Internet connection
- A local copy of the RuPay Benefits project

This companion is not compatible with iPhone/iPad Safari. iOS does not allow this Node.js + Playwright browser worker to run locally.

## Install and start

Open Terminal or PowerShell in the local-agent folder and run:

1. npm install
2. npx playwright install chromium
3. npm start

Then open http://127.0.0.1:3939 on the same computer. The local server serves the existing RuPay Benefits app and its browser companion together.

The terminal prints a one-time pairing code. In the app's RuPay Select tab, paste that code and tap Connect local companion. The code stays in the current browser tab's session storage and is recreated when the companion restarts.

If Firebase Authentication refuses localhost sign-in, add 127.0.0.1 and localhost to Firebase Console → Authentication → Settings → Authorized domains.

## Use multiple portal accounts

1. Sign in to the RuPay Benefits workspace.
2. Open RuPay Select.
3. Add each registered RuPay Select portal email as a separate account.
4. Link the cards already recorded in your Cards tab.
5. Tap Open saved browser for an account. A separate persistent Chromium profile opens at the RuPay booking portal.
6. Sign in to that portal yourself. Complete any OTP, CAPTCHA or other verification directly in the visible browser.
7. Repeat for each account. Each account has an independent profile and keeps its own portal session on this computer.
8. Use Inspect portal page to view visible headings and action labels. The inspection is local and does not collect page body text or payment form values.

## Important payment and security limits

- The helper does not request or store a RuPay portal password.
- It does not store full card numbers, CVV, PIN, OTP, bank login details or payment credentials.
- It does not bypass CAPTCHA, OTP or 3-D Secure.
- It does not automatically submit a card payment or click a final Pay, Confirm or Authorize control. Complete the Re.1 validation transaction and bank approval yourself in the visible browser.
- The helper only reads visible page headings and button labels; it does not scrape account pages or collect payment fields.
- Portal page structure may change. Benefit-specific navigation is not enabled until tested against the live authenticated portal.
- Browser profile folders contain authenticated session cookies. Keep this computer account private. To remove a profile, close the companion and delete its folder under local-agent/.data/profiles/.

RuPay's published redemption flow sends coupon details to the registered email address after a successful Re.1 validation transaction. Add received codes to the existing Vouchers inventory in the main workspace.

## Firestore rules

This feature stores only account label, registered email, linked internal card IDs and timestamps in a separate account subcollection. It does not store portal credentials. Publish the updated root firestore.rules in Firebase Console before using the account list. See FIREBASE_SETUP.md.

## Local-only design

- Listens on 127.0.0.1 only; it is not exposed to the LAN or Internet.
- Uses a random pairing code on each start.
- Requires the pairing code for browser-control endpoints.
- Stores browser profiles under local-agent/.data/, which is ignored by Git.
- Does not change your live hosted website until you merge and deploy the feature branch.
