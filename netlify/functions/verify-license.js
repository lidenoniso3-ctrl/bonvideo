exports.handler = async (event) => {
  // 1. التأكد من أن الطلب من نوع POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const licenseKey = (body.licenseKey || "").trim();
  const increment = body.increment === true;
  const productId = process.env.GUMROAD_PRODUCT_ID;

  // 2. التأكد من وجود معرف المنتج في إعدادات الخادم
  if (!productId) {
    console.error("CRITICAL: GUMROAD_PRODUCT_ID is missing in Netlify.");
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Server configuration error" })
    };
  }

  // 3. التأكد من أن المستخدم أدخل مفتاحاً
  if (!licenseKey) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, reason: "invalid_key" })
    };
  }

  try {
    // 4. الاتصال بجومرود (يتم على الخادم، لا يمكن للمستخدم رؤيته أو التلاعب به)
    const response = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: productId,
        license_key: licenseKey,
        increment_uses_count: increment ? "true" : "false"
      })
    });

    const data = await response.json();
    const purchase = data.purchase || {};

    // 5. الفحص الأمني الصارم (إذا فشل أي شرط، يتم الرفض)
    if (data.success !== true) {
      console.log("Gumroad Rejected: Invalid Key");
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "invalid_key" }) };
    }
    
    // فحص الاسترداد (Refund)
    if (purchase.refunded) {
      console.log("Gumroad Rejected: Refunded Purchase");
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "refunded" }) };
    }

    // فحص الاعتراض البنكي (Chargeback)
    if (purchase.chargebacked) {
      console.log("Gumroad Rejected: Chargeback");
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "chargebacked" }) };
    }

    // فحص النزاع (Dispute)
    if (purchase.disputed && !purchase.dispute_won) {
      console.log("Gumroad Rejected: Disputed");
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "disputed" }) };
    }

    // 6. فحص عدد الأجهزة (إذا حاول المستخدم تفعيل المفتاح على أجهزة كثيرة)
    const uses = data.uses || 0;
    const maxUses = parseInt(process.env.MAX_USES_PER_LICENSE || "5", 10);
    
    // إذا طلب تفعيل جهاز جديد (increment=true)، وتجاوز الحد المسموح
    if (increment && uses > maxUses) {
      console.log("Gumroad Rejected: Too Many Devices");
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "too_many_devices" }) };
    }

    // 7. إذا اجتاز كل الفحوصات، نسمح بالدخول
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, uses: uses })
    };

  } catch (err) {
    // إخفاء تفاصيل الخطأ عن المستخدم وتسجيله في خادم Netlify فقط
    console.error("Server Error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Verification failed. Please try again later." })
    };
  }
};