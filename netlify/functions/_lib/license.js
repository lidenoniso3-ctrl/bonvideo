async function verifyLicense(licenseKey, options = {}) {
  const { increment = false } = options;
  const productId = process.env.GUMROAD_PRODUCT_ID;
  const maxUses = parseInt(process.env.MAX_USES_PER_LICENSE || "5", 10);

  if (!productId) return { ok: false, reason: "server_config" };
  if (!licenseKey) return { ok: false, reason: "missing_key" };

  try {
    const response = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: productId,
        license_key: licenseKey,
        increment_uses_count: increment ? "true" : "false",
      }),
    });

    const data = await response.json();
    const purchase = data.purchase || {};

    if (data.success !== true) return { ok: false, reason: "invalid_key" };
    if (purchase.refunded) return { ok: false, reason: "refunded" };
    if (purchase.chargebacked) return { ok: false, reason: "chargebacked" };
    if (purchase.disputed && !purchase.dispute_won) return { ok: false, reason: "disputed" };

    const uses = data.uses || 0;
    if (increment && uses > maxUses) return { ok: false, reason: "too_many_devices", uses };

    return { ok: true, uses };
  } catch (err) {
    return { ok: false, reason: "network", error: err.message };
  }
}

module.exports = { verifyLicense };