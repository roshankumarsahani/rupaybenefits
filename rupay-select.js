(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const root = $("#view-rupay-select");
  const nav = $("[data-rupay-select-nav]");
  if (!root || !nav || !window.firebase?.auth) return;
  const TOKEN_KEY = "rupay-local-agent-token";
  let currentUser = null, accounts = [], cards = [], variants = [], holders = [], database = null;
  let localToken = sessionStorage.getItem(TOKEN_KEY) || "";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function onLocalHost() { return location.hostname === "127.0.0.1" || location.hostname === "localhost"; }
  function setMessage(message, kind = "info") {
    const el = $("#rsMessage");
    if (el) { el.textContent = message; el.className = "rs-message " + kind; }
  }
  function activateView() {
    document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === "view-rupay-select"));
    document.querySelectorAll(".side-nav .nav-link").forEach(item => item.classList.toggle("active", item === nav));
    const crumb = $("#pageCrumb");
    if (crumb) crumb.textContent = "RuPay Select";
    window.scrollTo({top:0,behavior:"smooth"});
  }
  nav.addEventListener("click", event => {
    event.preventDefault(); activateView();
    refreshAll().catch(error => setMessage(error.message || "Unable to load accounts.", "error"));
  });
  document.addEventListener("click", event => {
    if (event.target.closest("[data-view]")) nav.classList.remove("active");
  }, true);

  function cardTitle(card) {
    const variant = variants.find(v => v.id === card.variantId);
    const holder = holders.find(h => h.id === card.holderId);
    const last = String(card.last5 || card.last4 || "").replace(/\D/g, "").slice(-4);
    return [holder?.name || "Self",card.bank || "Bank not set",variant?.name || card.name || "RuPay card",last ? "•••• " + last : "last four not recorded"].join(" · ");
  }
  function renderCardChoices(target, selected = []) {
    if (!target) return;
    if (!cards.length) { target.innerHTML = '<p class="rs-muted">No cards found. Add cards in the Cards tab first.</p>'; return; }
    target.innerHTML = cards.map(card =>
      '<label class="rs-card-choice"><input type="checkbox" data-rs-card-id="' + esc(card.id) + '" ' +
      (selected.includes(card.id) ? "checked" : "") + '><span>' + esc(cardTitle(card)) + '</span></label>'
    ).join("");
  }
  function selectedCardIds(container) {
    return [...container.querySelectorAll("[data-rs-card-id]:checked")].map(input => input.dataset.rsCardId);
  }
  function renderAccounts() {
    const list = $("#rsAccountsList");
    const count = $("#rsAccountCount");
    if (count) count.textContent = accounts.length + " account" + (accounts.length === 1 ? "" : "s");
    if (!list) return;
    if (!accounts.length) {
      list.innerHTML = '<div class="rs-empty"><strong>No RuPay Select accounts added</strong><p>Add each registered portal login separately, then link its cards.</p></div>';
      return;
    }
    list.innerHTML = accounts.map(account => {
      const linked = cards.filter(card => (account.cardIds || []).includes(card.id));
      return '<article class="rs-account-card"><div class="rs-account-head"><div><span class="rs-eyebrow">PORTAL ACCOUNT</span><h3>' +
        esc(account.label || account.email) + '</h3><p>' + esc(account.email) + '</p></div><span class="rs-count">' +
        linked.length + ' linked card' + (linked.length === 1 ? "" : "s") + '</span></div>' +
        '<div class="rs-linked-cards">' + (linked.length ? linked.map(card => '<span>' + esc(cardTitle(card)) + '</span>').join("") : '<span class="rs-muted">No cards linked yet</span>') + '</div>' +
        '<div class="rs-actions"><button class="button primary small" type="button" data-rs-action="open" data-id="' + esc(account.id) + '">Open saved browser</button>' +
        '<button class="button secondary small" type="button" data-rs-action="inspect" data-id="' + esc(account.id) + '">Inspect portal page</button>' +
        '<button class="button quiet small" type="button" data-rs-action="delete" data-id="' + esc(account.id) + '">Remove</button></div>' +
        '<details class="rs-edit"><summary>Edit account and linked cards</summary><form data-rs-edit-form data-id="' + esc(account.id) + '">' +
        '<div class="rs-fields"><label>Account label<input name="label" required maxlength="80" value="' + esc(account.label || "") + '"></label>' +
        '<label>Registered portal email<input name="email" type="email" required maxlength="254" value="' + esc(account.email || "") + '"></label></div>' +
        '<div class="rs-card-choices" data-rs-edit-cards="' + esc(account.id) + '"></div><div class="rs-actions"><button class="button secondary small" type="submit">Save changes</button></div></form></details>' +
        '<p class="rs-account-note">Portal password, full card number, CVV and OTP are not saved here.</p></article>';
    }).join("");
    accounts.forEach(account => renderCardChoices($('[data-rs-edit-cards="' + account.id + '"]'), account.cardIds || []));
  }
  async function refreshAll() {
    if (!currentUser || !database) return;
    setMessage("Refreshing account and card data…");
    const base = "users/" + currentUser.uid;
    const [accountSnap, workspaceSnap] = await Promise.all([
      database.collection(base + "/rupaySelectAccounts").get(),
      database.doc(base + "/workspace/main").get()
    ]);
    accounts = accountSnap.docs.map(doc => ({id:doc.id,...doc.data()}))
      .sort((a,b) => String(a.label || a.email).localeCompare(String(b.label || b.email)));
    const data = workspaceSnap.exists ? workspaceSnap.data() : {};
    cards = Array.isArray(data.cards) ? data.cards : [];
    variants = Array.isArray(data.variants) ? data.variants : [];
    holders = Array.isArray(data.holders) ? data.holders : [];
    renderCardChoices($("#rsNewCardChoices")); renderAccounts();
    await checkAgent();
    setMessage("Loaded " + accounts.length + " portal account" + (accounts.length === 1 ? "" : "s") +
      " and " + cards.length + " workspace card" + (cards.length === 1 ? "" : "s") + ".", "success");
  }
  async function saveNewAccount(form) {
    const data = new FormData(form);
    const label = String(data.get("label") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const cardIds = selectedCardIds($("#rsNewCardChoices"));
    if (!label || !email) return setMessage("Enter an account label and registered portal email.", "error");
    if (accounts.some(a => String(a.email || "").toLowerCase() === email)) return setMessage("That portal email is already in this workspace.", "error");
    const now = new Date().toISOString();
    await database.collection("users/" + currentUser.uid + "/rupaySelectAccounts").add({label,email,cardIds,createdAt:now,updatedAt:now});
    form.reset(); await refreshAll();
    setMessage("Account added. Sign in to its portal manually in its own local browser profile.", "success");
  }
  async function saveEditedAccount(form) {
    const id = form.dataset.id, data = new FormData(form);
    const label = String(data.get("label") || "").trim(), email = String(data.get("email") || "").trim().toLowerCase();
    const cardIds = selectedCardIds(form);
    if (!label || !email) return setMessage("Enter an account label and portal email.", "error");
    if (accounts.some(a => a.id !== id && String(a.email || "").toLowerCase() === email)) return setMessage("Another account already uses that portal email.", "error");
    await database.doc("users/" + currentUser.uid + "/rupaySelectAccounts/" + id).update({label,email,cardIds,updatedAt:new Date().toISOString()});
    await refreshAll(); setMessage("Account updated.", "success");
  }
  async function deleteAccount(id) {
    const account = accounts.find(a => a.id === id);
    if (!account || !window.confirm("Remove " + (account.label || account.email) + " from this workspace? Its local browser profile will remain on this device.")) return;
    await database.doc("users/" + currentUser.uid + "/rupaySelectAccounts/" + id).delete();
    accounts = accounts.filter(a => a.id !== id); renderAccounts();
    setMessage("Account removed. Its browser profile was not deleted.", "success");
  }
  async function agentFetch(path, options = {}) {
    const headers = {"Content-Type":"application/json",...(options.headers || {})};
    if (onLocalHost()) {
      if (!localToken) throw new Error("Paste the pairing code printed in the local-agent terminal, then tap Connect.");
      headers["X-Local-Agent-Token"] = localToken;
    } else {
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("Sign in to your RuPay Benefits workspace first.");
      headers.Authorization = "Bearer " + await user.getIdToken();
    }
    const response = await fetch(path,{...options,headers,cache:"no-store"});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Browser agent request failed (" + response.status + ").");
    return data;
  }
  async function checkAgent() {
    const status = $("#rsAgentStatus"), tokenInput = $("#rsAgentToken");
    if (tokenInput) tokenInput.value = localToken;
    try {
      const response = await fetch("/api/agent/health",{cache:"no-store"});
      if (!response.ok) throw new Error("offline");
      const data = await response.json();
      if (status) status.textContent = data.mode === "firebase"
        ? "Oracle Cloud browser agent online · remote browser is private to your signed-in account"
        : "Local companion online · " + data.version + (localToken ? " · pairing code saved for this tab" : " · enter its pairing code below");
      if (tokenInput) tokenInput.closest(".rs-agent-controls").hidden = data.mode === "firebase";
      return true;
    } catch {
      if (status) status.textContent = onLocalHost()
        ? "Local companion not running. Start it from local-agent."
        : "Oracle browser agent is not connected. Deploy the Oracle service and open this app on its HTTPS domain.";
      return false;
    }
  }
  function renderRemoteBrowser(id, screen) {
    const viewer = $("#rsBrowserViewer");
    if (!viewer) return;
    const paymentWarning = screen.likelyPaymentPage
      ? '<p class="rs-warning">Payment / bank verification page detected. Review the ₹1 amount and card details yourself, then tap the final payment controls and complete any OTP / 3-D Secure approval manually.</p>'
      : "";
    viewer.innerHTML = '<div class="rs-inspection-card"><div class="rs-section-head"><div><strong>Remote RuPay browser</strong><small class="rs-muted">' + esc(screen.host || "RuPay portal") + '</small></div>' +
      '<button class="button secondary small" type="button" data-rs-action="refresh-screen" data-id="' + esc(id) + '">↻ Refresh screen</button></div>' + paymentWarning +
      '<div class="rs-remote-screen-wrap"><img class="rs-remote-screen" data-rs-screenshot data-id="' + esc(id) + '" src="data:image/jpeg;base64,' + screen.image + '" alt="Live RuPay Select browser screen" draggable="false"></div>' +
      '<p class="rs-muted">Tap the browser image to click. Text entered below is sent directly to the focused portal field and is not saved in this workspace.</p>' +
      '<form id="rsRemoteTypeForm" data-id="' + esc(id) + '" class="rs-remote-type"><input name="text" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="2000" placeholder="Type into the focused browser field" aria-label="Text to send to browser"><button class="button primary small" type="submit">Send text</button></form>' +
      '<div class="rs-actions rs-key-actions">' + ["Tab","Enter","Backspace","Escape","PageDown","PageUp","ArrowDown","ArrowUp"].map(key => '<button class="button secondary small" type="button" data-rs-action="press-key" data-id="' + esc(id) + '" data-key="' + key + '">' + key + '</button>').join("") +
      '<button class="button quiet small" type="button" data-rs-action="close-browser" data-id="' + esc(id) + '">Close browser session</button></div></div>';
  }
  async function refreshBrowserScreen(id) {
    try {
      const screen = await agentFetch("/api/agent/accounts/" + encodeURIComponent(id) + "/screenshot",{method:"POST",body:"{}"});
      renderRemoteBrowser(id,screen);
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function openAccountBrowser(id) {
    const account=accounts.find(a=>a.id===id);
    if (!account) return;
    try {
      setMessage("Opening the saved browser profile…");
      const result=await agentFetch("/api/agent/accounts/" + encodeURIComponent(id) + "/open",{method:"POST",body:JSON.stringify({label:account.label || account.email})});
      renderRemoteBrowser(id,result);
      setMessage("Browser opened for " + (account.label || account.email) + ". Sign in directly in the remote browser screen.", "success");
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function clickRemoteScreen(image,event) {
    const rect=image.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width*Number(image.naturalWidth || 1280);
    const y=(event.clientY-rect.top)/rect.height*Number(image.naturalHeight || 800);
    try {
      const screen=await agentFetch("/api/agent/accounts/" + encodeURIComponent(image.dataset.id) + "/click",{method:"POST",body:JSON.stringify({x,y})});
      renderRemoteBrowser(image.dataset.id,screen);
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function pressRemoteKey(id,key) {
    try {
      const screen=await agentFetch("/api/agent/accounts/" + encodeURIComponent(id) + "/press",{method:"POST",body:JSON.stringify({key})});
      renderRemoteBrowser(id,screen);
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function typeRemoteText(form) {
    const input=form.elements.namedItem("text");
    const value=String(input?.value || "");
    if (!value) return;
    try {
      const screen=await agentFetch("/api/agent/accounts/" + encodeURIComponent(form.dataset.id) + "/type",{method:"POST",body:JSON.stringify({text:value})});
      input.value="";
      renderRemoteBrowser(form.dataset.id,screen);
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function closeRemoteBrowser(id) {
    try {
      await agentFetch("/api/agent/accounts/" + encodeURIComponent(id) + "/close",{method:"POST",body:"{}"});
      $("#rsBrowserViewer").innerHTML="";
      setMessage("Remote browser closed. Its saved session profile remains on Oracle Cloud.", "success");
    } catch(error) { setMessage(error.message,"error"); }
  }
  async function inspectAccount(id) {
    try {
      const result = await agentFetch("/api/agent/accounts/" + encodeURIComponent(id) + "/inspect",{method:"POST",body:"{}"});
      const headings = (result.headings || []).map(v => "<li>" + esc(v) + "</li>").join("") || "<li>No visible headings.</li>";
      const buttons = (result.buttons || []).map(v => "<li>" + esc(v) + "</li>").join("") || "<li>No visible action labels.</li>";
      const paymentNote = result.likelyPaymentPage ? '<p class="rs-warning">This looks like a payment or verification page. Complete the ₹1 payment and bank OTP / 3-D Secure approval yourself in the browser.</p>' : "";
      $("#rsInspection").innerHTML = '<div class="rs-inspection-card"><div><strong>' + esc(result.title || "RuPay portal") + '</strong><small>' + esc(result.host || "") + '</small></div>' + paymentNote +
        '<div class="rs-inspection-grid"><section><b>Visible headings</b><ul>' + headings + '</ul></section><section><b>Visible buttons</b><ul>' + buttons + '</ul></section></div>' +
        '<p class="rs-muted">The local scan reads visible headings and button labels only. It does not collect page body text, card data, passwords or payment fields.</p></div>';
      setMessage("Portal page inspected locally.","success");
    } catch(error) { setMessage(error.message,"error"); }
  }
  root.addEventListener("submit",event => {
    const form = event.target.closest("#rsAccountForm,[data-rs-edit-form],#rsRemoteTypeForm");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    (form.id === "rsAccountForm" ? saveNewAccount(form) : saveEditedAccount(form))
      .catch(error => setMessage(error.message || "Could not save account.","error"));
  });
  root.addEventListener("click",event => {
    const button = event.target.closest("[data-rs-action]");
    if (!button) return;
    const action = button.dataset.rsAction, id = button.dataset.id;
    if (action === "refresh") refreshAll().catch(error => setMessage(error.message,"error"));
    if (action === "delete") deleteAccount(id).catch(error => setMessage(error.message,"error"));
    if (action === "open") openAccountBrowser(id);
    if (action === "inspect") inspectAccount(id);\n    if (action === "refresh-screen") refreshBrowserScreen(id);\n    if (action === "press-key") pressRemoteKey(id,button.dataset.key);\n    if (action === "close-browser") closeRemoteBrowser(id);
    if (action === "connect-agent") {
      localToken = String($("#rsAgentToken")?.value || "").trim();
      if (!localToken) return setMessage("Paste the pairing code from the desktop terminal.","error");
      sessionStorage.setItem(TOKEN_KEY,localToken);
      checkAgent().then(ok => setMessage(ok ? "Local companion connected for this browser tab." : "Local companion is not reachable.",ok ? "success" : "error"));
    }
  });
  try {
    firebase.auth().onAuthStateChanged(async user => {
      currentUser = user || null;
      if (!user) {
        accounts=[]; cards=[]; variants=[]; holders=[];
        $("#rsAccountsList").innerHTML = '<p class="rs-muted">Sign in to load your RuPay Select account records.</p>';
        return;
      }
      database=firebase.firestore();
      try { await refreshAll(); }
      catch(error) { setMessage("Could not load accounts. Publish the updated Firestore rules first. " + (error.message || ""),"error"); }
    });
  } catch(error) { setMessage("Firebase is not ready. Sign in to your RuPay Benefits workspace first.","error"); }
  checkAgent();
})();