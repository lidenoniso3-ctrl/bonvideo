const { verifyLicense } = require("./_lib/license");
const { SeededRandom, buildSingleSudokuPuzzle, exportPDF, VARIANTS } = require("./_lib/sudoku");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { licenseKey, variant, difficulty, count, seed, ppp, bookSize, title, author } = body;

  // التحقق من الترخيص قبل التوليد (بدون زيادة العداد)
  const auth = await verifyLicense(licenseKey, { increment: false });
  if (!auth.ok) return respond(401, { error: auth.reason || "unauthorized" });

  if (!VARIANTS[variant]) return respond(400, { error: "Invalid variant" });

  try {
    const rng = new SeededRandom(parseInt(seed || Date.now(), 10));
    const puzzles = [];
    for (let i = 0; i < Math.min(count, 200); i++) {
      const p = buildSingleSudokuPuzzle(difficulty, variant, rng);
      p.index = i + 1;
      puzzles.push(p);
    }

    const pdfBuffer = exportPDF(puzzles, {
      variant, difficulty, variantLabel: puzzles[0].variantLabel,
      puzzlesPerPage: ppp || 6, seed: seed || "auto",
      title, author, bookSize: bookSize || "8.5 x 11 inches"
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="sudoku.pdf"` },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return respond(500, { error: "generation_failed", message: err.message });
  }
};

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}