const { verifyLicense } = require("./_lib/license");
const {
  runPipeline, LIMITS, LANGUAGES, DEFAULT_MODEL,
} = require("./_lib/moroccan");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return respond(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON" }); }

  const {
    licenseKey, topic, scenes, lang, voice_label, rate,
    image_source, groq_key, model,
  } = body;

  // التحقق من الترخيص (بدون زيادة العداد)
  const auth = await verifyLicense(licenseKey, { increment: false });
  if (!auth.ok) return respond(401, { error: auth.reason || "unauthorized" });

  if (!topic)             return respond(400, { error: "missing_topic" });
  if (!groq_key)          return respond(400, { error: "missing_groq_key" });
  if (!LANGUAGES[lang])   return respond(400, { error: "invalid_language" });

  const voice = voice_label && LANGUAGES[lang].voices[voice_label]
              ? voice_label
              : Object.keys(LANGUAGES[lang].voices)[0];

  const safeScenes = Math.max(
    LIMITS.scenes.min,
    Math.min(LIMITS.scenes.max, parseInt(scenes, 10) || LIMITS.scenes.min)
  );

  const logs = [];
  const log = (m) => { logs.push(m); console.log(m); };

  try {
    const result = await runPipeline({
      topic: topic.trim(),
      scenes: safeScenes,
      lang,
      voice_label: voice,
      rate: rate || "عادي",
      image_source: image_source || "DuckDuckGo",
      groq_key,
      // ← الموديل الافتراضي الجديد + أي موديل يمرره العميل
      model: model || DEFAULT_MODEL,
      log,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition":
          `attachment; filename="moroccan-${Date.now()}.mp4"`,
        "X-Video-Title":    encodeURIComponent(result.title),
        "X-Video-Scenes":   String(result.scenes),
        "X-Video-Duration": String(result.duration),
        "X-Video-Model":    result.model,
      },
      body: result.video.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("Pipeline error:", err);
    return respond(500, {
      error: "generation_failed",
      message: err.message,
      logs,
    });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}