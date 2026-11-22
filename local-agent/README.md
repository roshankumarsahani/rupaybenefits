# RuPay Select browser companion — Oracle Cloud

The Oracle deployment runs the Playwright browser on the VM and provides a signed-in screen viewer in the RuPay Benefits dashboard. You can operate the remote portal browser from an iPhone through HTTPS.

## Target

- Oracle Linux 9 on Oracle Cloud Infrastructure
- A1 Flex / Ampere ARM64 VM (the Containerfile pins the official ARM64 Playwright image)
- Podman
- A DNS hostname pointing to the VM public IP

Microsoft publishes ARM64 Playwright container images; this build pins Playwright 1.65.0 so the Node package and image browser versions stay aligned. Oracle Linux 9 provides Podman through the container-tools package.

## Deployment prerequisites

1. Use the feature branch that contains this companion code.
2. Create a DNS A record, for example benefits.example.com, pointing to the Oracle VM public IPv4 address.
3. In the OCI VCN subnet Security List or Network Security Group, allow inbound TCP 80 and TCP 443 to this VM. Do not open TCP 3939.
4. In Firebase Console → Authentication → Settings → Authorized domains, add the hostname.
5. Publish the root firestore.rules file from this branch in Firebase Console → Firestore Database → Rules. It permits account metadata at users/{uid}/rupaySelectAccounts without storing portal passwords or payment credentials.

## Install

SSH into Oracle Linux 9 and run:

    sudo dnf install -y git
    git clone --branch feature/rupay-select-local-companion https://github.com/roshankumarsahani/rupaybenefits.git
    cd rupaybenefits
    sudo bash local-agent/deploy-oracle.sh benefits.example.com

Replace benefits.example.com with the hostname you configured. The script installs Podman, builds the ARM64 browser container, creates systemd services and starts Caddy for HTTPS.

Caddy requests and renews the HTTPS certificate after DNS is correct and ports 80/443 are reachable. If firewalld is active, allow HTTP and HTTPS with the commands below. Preserve existing firewall rules, especially WireGuard rules:

    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    sudo firewall-cmd --reload

Also add the same ingress rules in OCI VCN Security Lists or NSGs. Oracle notes that both OCI network rules and the instance OS firewall must permit traffic. Never open 3939 to the public internet; the installer binds the agent to 127.0.0.1 and exposes only Caddy on ports 80/443.

## Use from iPhone

1. Open https://benefits.example.com.
2. Sign in to your existing RuPay Benefits Firebase account.
3. Open the RuPay Select tab and add each authorized portal login email.
4. Link the corresponding cards already recorded in your Cards workspace.
5. Tap Open saved browser. The browser runs headlessly on Oracle and its screenshot appears in the dashboard.
6. Tap the screenshot to click. Use the text field to type into the focused portal field; Tab, Enter, Backspace and Escape are supported.
7. Complete portal login and any CAPTCHA/OTP manually. Review every benefit and booking detail yourself. Final Re.1 payment and bank OTP/3-D Secure authorization remain manual.

Each Firebase user and portal account has a separate browser profile under /opt/rupay-select-agent/data. Those profiles contain login cookies and must be treated as sensitive. Do not share or back up that folder to an untrusted location.

## Service management

    sudo systemctl status rupay-select-agent rupay-select-caddy
    sudo journalctl -u rupay-select-agent -f
    sudo journalctl -u rupay-select-caddy -f
    sudo systemctl restart rupay-select-agent rupay-select-caddy

## Limits and security

- The server verifies Firebase ID tokens; only the signed-in Firebase user can access their own browser profiles.
- A same-origin HTTPS request is required for remote browser control.
- The Playwright agent binds to host loopback only. Caddy is the only public listener.
- Chromium runs headlessly in an unprivileged container using the upstream Playwright seccomp profile.
- The agent does not log typed text or save passwords, CVV, PIN or OTP values to the RuPay Benefits workspace. The browser profile stores its portal session cookies.
- Browser screenshots are returned to the authenticated dashboard on demand and are not stored by the app.
- The current build provides remote manual browser control and page inspection. It does not yet auto-select an offer, automatically submit a payment, or read coupon email inboxes. Those require a separately tested, authorized integration.
- The official Playwright image is intended primarily for trusted automation/testing; the browser is restricted to the authenticated user's session but still visits third-party payment pages. Keep it updated and the VM private.
