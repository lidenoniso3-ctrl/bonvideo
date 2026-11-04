"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");

const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

// =============================================================================
// 1. الثوابت
// =============================================================================
const LANGUAGES = {
  "العربية": {
    code: "ar",
    llm: "Modern Standard Arabic (simple, clear, easy to speak aloud)",
    voices: {
      "🇸🇦 حامد (رجل)":   "ar-SA-HamedNeural",
      "🇸🇦 زارية (امرأة)": "ar-SA-ZariyahNeural",
      "🇲🇦 جمال (رجل)":   "ar-MA-JamalNeural",
      "🇲🇦 منى (امرأة)":   "ar-MA-MounaNeural",
      "🇪🇬 شاكر (رجل)":   "ar-EG-ShakirNeural",
      "🇪🇬 سلمى (امرأة)": "ar-EG-SalmaNeural",
    },
  },
  "Français": {
    code: "fr", llm: "French",
    voices: { "Henri (homme)": "fr-FR-HenriNeural",
              "Denise (femme)": "fr-FR-DeniseNeural" },
  },
  "English": {
    code: "en", llm: "English",
    voices: { "Guy (male)":   "en-US-GuyNeural",
              "Jenny (female)": "en-US-JennyNeural" },
  },
};

const RATES = { "بطيء": "-10%", "عادي": "+0%", "سريع": "+10%" };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

// حدود ملائمة لمهلة Netlify المتزامنة (نفس فكرة "Max 20 puzzles" في Sudoku)
const LIMITS = {
  scenes: { min: 2, max: 3 },     // ← هنا الضبط
  resolution: [640, 360],          // 480p آمن
  fps: 24,
  maxSecondsPerScene: 5,
  crf: 28,
  preset: "ultrafast",
};

// =============================================================================
// 2. أدوات نصية
// =============================================================================
function cleanText(t) {
  t = (t || "").replace(/[\*#_`~>\[\]{}|]/g, "");
  t = t.replace(/[\u{10000}-\u{10FFFF}\u2600-\u27BF]/gu, "");
  return t.replace(/\s+/g, " ").trim();
}

function hasArabic(t) { return /[\u0600-\u06ff]/.test(t); }

// =============================================================================
// 3. Groq — كتابة السكريبت
// =============================================================================
async function generateScript(apiKey, model, topic, langName, nScenes, log) {
  const system =
    "You are an expert Moroccan pastry chef and scriptwriter.\n" +
    'Return ONLY JSON: {"title": "...", "scenes": [{"narration": "...", ' +
    '"search_query": "...", "media": "photo"}]}\n' +
    `- Write title & narration in ${langName}.\n` +
    `- Exactly ${nScenes} scenes.\n` +
    "- Each narration 1-2 short sentences, max 35 words.\n" +
    "- search_query MUST be in English, 3-6 words, specific.\n" +
    "- Never use generic words alone.";

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: `Topic: ${topic}` },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Groq: (${r.status}) ${txt.slice(0, 200)}`);
  }
  const j = await r.json();
  const raw = j.choices[0].message.content;
  const m = raw.match(/\{[\s\S]*\}/);
  const data = JSON.parse(m ? m[0] : raw);

  const scenes = [];
  for (const sc of data.scenes || []) {
    const n = cleanText(sc.narration);
    if (!n) continue;
    const q = cleanText(sc.search_query) || "moroccan sweets";
    scenes.push({ narration: n, search_query: q });
  }
  if (scenes.length < 2) throw new Error("السكريبت قصير جداً.");
  return {
    title: cleanText(data.title) || topic.slice(0, 60),
    scenes: scenes.slice(0, LIMITS.scenes.max),
  };
}

// =============================================================================
// 4. جلب الصور (HTML scraping — لا مكتبات إضافية)
// =============================================================================
async function downloadImage(url, savePath) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Referer": url },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 8000) return false;
    fs.writeFileSync(savePath, buf);
    return true;
  } catch { return false; }
}

async function tryDuckDuckGo(query, savePath) {
  try {
    const r = await fetch(
      "https://duckduckgo.com/?q=" + encodeURIComponent(query) + "&iax=images&ia=images",
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!r.ok) return false;
    const html = await r.text();
    // استخرج vqd token
    const vqdMatch = html.match(/vqd=["']?([\d-]+)["']?/);
    if (!vqdMatch) return false;
    const vqd = vqdMatch[1];
    const imgR = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,`,
      { headers: { "User-Agent": USER_AGENT, "Referer": "https://duckduckgo.com/" } }
    );
    if (!imgR.ok) return false;
    const j = await imgR.json();
    for (const item of (j.results || []).slice(0, 6)) {
      const u = item.image || item.thumbnail;
      if (u && await downloadImage(u, savePath)) return true;
    }
  } catch {}
  return false;
}

async function tryBing(query, savePath) {
  try {
    const r = await fetch(
      "https://www.bing.com/images/search?q=" + encodeURIComponent(query) + "&first=1",
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!r.ok) return false;
    const html = await r.text();
    const re = /murl&quot;:&quot;([^&]+?)&quot;/g;
    let m, tries = 0;
    while ((m = re.exec(html)) && tries < 6) {
      tries++;
      const u = m[1].replace(/\\\//g, "/");
      if (await downloadImage(u, savePath)) return true;
    }
  } catch {}
  return false;
}

async function fetchSceneImage(scene, jobDir, idx, preferred, log) {
  const savePath = path.join(jobDir, `scene${idx}_media.jpg`);
  const engines = [["DuckDuckGo", tryDuckDuckGo], ["Bing", tryBing]];
  if (preferred === "Bing") engines.reverse();

  const queries = [scene.search_query];
  if (scene.search_query && !hasArabic(scene.search_query) &&
      !/moroccan/i.test(scene.search_query)) {
    queries.push(scene.search_query + " moroccan");
  }
  queries.push("moroccan sweets", "moroccan pastry");

  for (const q of queries) {
    for (const [name, fn] of engines) {
      try { fs.unlinkSync(savePath); } catch {}
      if (await fn(q, savePath)) {
        log(`🖼️ مشهد ${idx}: ${name} → «${q}»`);
        return savePath;
      }
    }
  }
  return null;
}

// =============================================================================
// 5. TTS
// =============================================================================
async function synthesize(text, voice, rate, outPath, log) {
  // msedge-tts (نفس backend الذي يستخدمه edge-tts في Python)
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(outPath.replace(/\.mp3$/, ""), text);
    if (fs.existsSync(audioFilePath) && fs.statSync(audioFilePath).size > 500) {
      if (audioFilePath !== outPath) fs.renameSync(audioFilePath, outPath);
      return;
    }
  } catch (e) {
    log(`⚠️ edge-tts: ${e.message}`);
  }

  // Fallback: Google Translate TTS (لا يحتاج مفتاحاً)
  const langCode = voice.split("-")[0];
  const chunks = [];
  for (let i = 0; i < text.length; i += 180) chunks.push(text.slice(i, i + 180));
  const buffers = [];
  for (const c of chunks) {
    const url =
      "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
      encodeURIComponent(langCode) + "&q=" + encodeURIComponent(c);
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`TTS: ${r.status}`);
    buffers.push(Buffer.from(await r.arrayBuffer()));
  }
  fs.writeFileSync(outPath, Buffer.concat(buffers));
}

// =============================================================================
// 6. FFmpeg
// =============================================================================
function runFFmpeg(args) {
  if (!FFMPEG) throw new Error("FFmpeg غير متوفر.");
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error("FFmpeg: " + (r.stderr || "").slice(-400));
}

function mediaDuration(filePath) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", filePath], { encoding: "utf8" });
  const m = (r.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) throw new Error(`مدة غير معروفة: ${filePath}`);
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

function buildClip(imagePath, audioPath, outPath, duration) {
  const [W, H] = LIMITS.resolution;
  const fps    = LIMITS.fps;
  const total  = Math.max(1, Math.floor(duration * fps));
  const zoomInc = 0.08 / total;
  const bw = W * 2, bh = H * 2;

  const vf =
    `scale=${bw}:${bh}:force_original_aspect_ratio=increase,` +
    `crop=${bw}:${bh},` +
    `zoompan=z='min(1+${zoomInc.toFixed(8)}*on,1.08)':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=1:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p`;

  runFFmpeg([
    "-loop", "1", "-i", imagePath,
    "-i", audioPath,
    "-vf", vf,
    "-map", "0:v", "-map", "1:a",
    "-t", duration.toFixed(2),
    "-c:v", "libx264",
    "-preset", LIMITS.preset,
    "-crf", String(LIMITS.crf),
    "-c:a", "aac", "-b:a", "96k",
    "-pix_fmt", "yuv420p", "-r", String(fps),
    "-shortest",
    outPath,
  ]);
}

function concatClips(clipPaths, outPath, workDir) {
  const listFile = path.join(workDir, "clips.txt");
  fs.writeFileSync(listFile, clipPaths
    .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n"));
  runFFmpeg([
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-c", "copy", "-movflags", "+faststart", outPath,
  ]);
}

// =============================================================================
// 7. Pipeline
// =============================================================================
async function runPipeline(opts) {
  const log = opts.log || console.log;
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "moroccan_"));
  try {
    const lang  = LANGUAGES[opts.lang];
    const voice = lang.voices[opts.voice_label];

    log("📝 Groq يكتب السكريبت...");
    const script = await generateScript(
      opts.groq_key, opts.model, opts.topic, lang.llm, opts.scenes, log
    );
    log(`✅ ${script.title} (${script.scenes.length} مشاهد)`);

    // صور
    const imagePaths = [];
    for (let i = 0; i < script.scenes.length; i++) {
      log(`🖼️ تحميل صورة مشهد ${i + 1}...`);
      const p = await fetchSceneImage(
        script.scenes[i], jobDir, i + 1, opts.image_source, log
      );
      if (!p) throw new Error(`لم أجد صورة للمشهد ${i + 1}.`);
      imagePaths.push(p);
    }

    // صوت
    const audioPaths = [];
    const durations  = [];
    for (let i = 0; i < script.scenes.length; i++) {
      log(`🔊 صوت مشهد ${i + 1}...`);
      const a = path.join(jobDir, `scene${i + 1}_voice.mp3`);
      await synthesize(
        script.scenes[i].narration, voice,
        RATES[opts.rate] || "+0%", a, log
      );
      const dur = mediaDuration(a);
      audioPaths.push(a);
      durations.push(Math.min(LIMITS.maxSecondsPerScene, Math.max(3.0, dur + 0.4)));
    }

    // مقاطع
    const clips = [];
    for (let i = 0; i < imagePaths.length; i++) {
      log(`🎬 تركيب مشهد ${i + 1}...`);
      const clip = path.join(jobDir, `scene${i + 1}.mp4`);
      buildClip(imagePaths[i], audioPaths[i], clip, durations[i]);
      clips.push(clip);
    }

    // دمج
    log("🔗 دمج المشاهد...");
    const finalPath = path.join(jobDir, "final.mp4");
    concatClips(clips, finalPath, jobDir);

    const buf = fs.readFileSync(finalPath);
    log(`✅ اكتمل (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);

    return {
      title: script.title,
      video: buf,
      scenes: script.scenes.length,
      duration: Math.round(durations.reduce((a, b) => a + b, 0)),
    };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

module.exports = { runPipeline, LIMITS, LANGUAGES, RATES };