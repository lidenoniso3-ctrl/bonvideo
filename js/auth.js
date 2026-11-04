const overlay   = document.getElementById("license-overlay");
const dashboard = document.getElementById("dashboard");
const input     = document.getElementById("license-key-input");
const message   = document.getElementById("status-message");
const btn       = document.getElementById("activate-btn");

const STORAGE_KEY = "puzzle_license_key";

function showLock(msg = "") {
  if (overlay) overlay.style.display = "flex";
  if (dashboard) dashboard.style.display = "none";
  if (message) { message.className = ""; message.textContent = msg; }
}

function showApp() {
  if (overlay) overlay.style.display = "none";
  if (dashboard) dashboard.style.display = "block";
}

async function verifyLicense(key, increment) {
  const response = await fetch("/.netlify/functions/verify-license", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key, increment }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Server error");
  return data;
}

async function activateLicense() {
  const key = input.value.trim();
  if (!key) {
    message.className = "error";
    message.textContent = "Please enter your license key.";
    return;
  }

  btn.disabled = true;
  message.className = "";
  message.textContent = "Verifying with Gumroad...";

  try {
    const data = await verifyLicense(key, true); // increment = true (لتسجيل جهاز جديد)
    if (data.ok) {
      localStorage.setItem(STORAGE_KEY, key);
      message.className = "success";
      message.textContent = "Activation successful.";
      setTimeout(showApp, 600);
      return;
    }

    const reasons = {
      invalid_key: "Invalid license key.",
      refunded: "This purchase has been refunded.",
      chargebacked: "This purchase is under chargeback.",
      disputed: "This purchase is currently disputed.",
      too_many_devices: "This key has been activated on too many devices.",
    };
    message.className = "error";
    message.textContent = reasons[data.reason] || "Invalid key.";
  } catch (err) {
    message.className = "error";
    message.textContent = "Verification failed: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

function logoutLicense() {
  localStorage.removeItem(STORAGE_KEY);
  if (input) input.value = "";
  showLock("Logged out successfully.");
}

document.addEventListener("DOMContentLoaded", async () => {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (!savedKey) { showLock(); return; }

  try {
    const data = await verifyLicense(savedKey, false); // increment = false (لا نزيد العداد في كل مرة)
    if (data.ok) showApp();
    else { localStorage.removeItem(STORAGE_KEY); showLock("License expired or invalid. Please enter your key again."); }
  } catch {
    showLock("Could not verify. Check your internet connection.");
  }
});