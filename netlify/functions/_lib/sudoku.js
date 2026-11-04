"use strict";

const { jsPDF } = require("jspdf");

// =============================================================================
// 1. Seedable RNG
// =============================================================================
class SeededRandom {
  constructor(seed) {
    this.state = (Number(seed) >>> 0) || 1;
  }
  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  randint(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// =============================================================================
// 2. Variants
// =============================================================================
const VARIANTS = {
  kids4: {
    size: 4, boxRows: 2, boxCols: 2, symbols: "numbers",
    constraints: ["standard"], label: "Mini Kids 4×4",
    removal: { Gentle: [6, 8], Standard: [8, 10], Fiendish: [10, 12] },
  },
  kids6: {
    size: 6, boxRows: 2, boxCols: 3, symbols: "numbers",
    constraints: ["standard"], label: "Kids 6×6",
    removal: { Gentle: [14, 16], Standard: [16, 19], Fiendish: [19, 22] },
  },
  standard: {
    size: 9, boxRows: 3, boxCols: 3, symbols: "numbers",
    constraints: ["standard"], label: "Standard 9×9",
    removal: { Gentle: [35, 40], Standard: [41, 48], Fiendish: [49, 54] },
  },
  diagonal: {
    size: 9, boxRows: 3, boxCols: 3, symbols: "numbers",
    constraints: ["standard", "diagonal"], label: "Diagonal (X-Sudoku)",
    removal: { Gentle: [32, 37], Standard: [37, 43], Fiendish: [43, 48] },
  },
  letters: {
    size: 9, boxRows: 3, boxCols: 3, symbols: "letters",
    constraints: ["standard"], label: "Letter Sudoku",
    removal: { Gentle: [35, 40], Standard: [41, 48], Fiendish: [49, 54] },
  },
  shapes4: {
    size: 4, boxRows: 2, boxCols: 2, symbols: "shapes",
    constraints: ["standard"], label: "Shape Sudoku 4×4",
    removal: { Gentle: [6, 8], Standard: [8, 10], Fiendish: [10, 12] },
  },
  windoku: {
    size: 9, boxRows: 3, boxCols: 3, symbols: "numbers",
    constraints: ["standard", "windoku"], label: "Windoku 9×9",
    removal: { Gentle: [30, 35], Standard: [35, 41], Fiendish: [41, 46] },
  },
};

const WINDOKU_WINDOWS = [
  [1, 1, 3, 3], [1, 5, 3, 3],
  [5, 1, 3, 3], [5, 5, 3, 3],
];

const SHAPE_NAMES = [
  "circle", "square", "triangle", "star",
  "diamond", "heart", "spade", "club",
  "moon", "sun", "cloud", "umbrella",
  "yin-yang", "flag", "scissors", "plane",
];

function getSymbols(variant) {
  const v = VARIANTS[variant];
  const n = v.size;
  if (v.symbols === "numbers") {
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }
  if (v.symbols === "letters") {
    return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  }
  if (v.symbols === "shapes") {
    return SHAPE_NAMES.slice(0, n);
  }
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

// =============================================================================
// 3. Solver & Generator
// =============================================================================
function isValid(grid, row, col, num, config) {
  const size = config.size;
  const boxRows = config.boxRows;
  const boxCols = config.boxCols;
  const constraints = config.constraints;

  for (let c = 0; c < size; c++) if (grid[row][c] === num) return false;
  for (let r = 0; r < size; r++) if (grid[r][col] === num) return false;

  const br = Math.floor(row / boxRows) * boxRows;
  const bc = Math.floor(col / boxCols) * boxCols;
  for (let r = br; r < br + boxRows; r++) {
    for (let c = bc; c < bc + boxCols; c++) {
      if (grid[r][c] === num) return false;
    }
  }

  if (constraints.includes("diagonal")) {
    if (row === col) {
      for (let i = 0; i < size; i++) if (grid[i][i] === num) return false;
    }
    if (row + col === size - 1) {
      for (let i = 0; i < size; i++) {
        if (grid[i][size - 1 - i] === num) return false;
      }
    }
  }

  if (constraints.includes("windoku")) {
    for (const [r0, c0, h, w] of WINDOKU_WINDOWS) {
      if (row >= r0 && row < r0 + h && col >= c0 && col < c0 + w) {
        for (let r = r0; r < r0 + h; r++) {
          for (let c = c0; c < c0 + w; c++) {
            if (grid[r][c] === num) return false;
          }
        }
      }
    }
  }
  return true;
}

function solve(grid, config, rng) {
  const size = config.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 0) {
        const nums = Array.from({ length: size }, (_, i) => i + 1);
        rng.shuffle(nums);
        for (const n of nums) {
          if (isValid(grid, r, c, n, config)) {
            grid[r][c] = n;
            if (solve(grid, config, rng)) return true;
            grid[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

function countSolutions(grid, config, limit = 2) {
  const size = config.size;
  let count = 0;
  function backtrack() {
    if (count >= limit) return;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 0) {
          for (let n = 1; n <= size; n++) {
            if (isValid(grid, r, c, n, config)) {
              grid[r][c] = n;
              backtrack();
              grid[r][c] = 0;
              if (count >= limit) return;
            }
          }
          return;
        }
      }
    }
    count++;
  }
  backtrack();
  return count;
}

function generateFullGrid(config, rng) {
  const size = config.size;
  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  solve(grid, config, rng);
  return grid;
}

function removeCells(fullGrid, removalRange, config, rng) {
  const size = fullGrid.length;
  const target = rng.randint(removalRange[0], removalRange[1]);
  const puzzle = fullGrid.map((row) => row.slice());

  const cells = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) cells.push([r, c]);
  }
  rng.shuffle(cells);

  let removed = 0;
  for (const [r, c] of cells) {
    if (removed >= target) break;
    const backup = puzzle[r][c];
    puzzle[r][c] = 0;
    const test = puzzle.map((row) => row.slice());
    if (countSolutions(test, config, 2) !== 1) {
      puzzle[r][c] = backup;
    } else {
      removed++;
    }
  }
  return puzzle;
}

function buildSingleSudokuPuzzle(difficulty, variant, rng, maxAttempts = 20) {
  if (!VARIANTS[variant]) throw new Error("Unknown variant: " + variant);
  const config = VARIANTS[variant];
  const removalRange = config.removal[difficulty] || config.removal.Standard;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const full = generateFullGrid(config, rng);
      const puzzle = removeCells(full, removalRange, config, rng);
      return {
        kind: "sudoku",
        variant,
        variantLabel: config.label,
        size: config.size,
        boxRows: config.boxRows,
        boxCols: config.boxCols,
        constraints: config.constraints,
        symbolsType: config.symbols,
        symbols: getSymbols(variant),
        puzzle,
        solution: full,
        difficulty,
      };
    } catch (e) {
      // retry
    }
  }
  throw new Error(`Failed to generate ${variant} / ${difficulty}`);
}

// =============================================================================
// 4. Shapes
// =============================================================================
function drawStar(doc, cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.4;
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad]);
  }
  const deltas = [];
  for (let i = 1; i < pts.length; i++) {
    deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  }
  deltas.push([
    pts[0][0] - pts[pts.length - 1][0],
    pts[0][1] - pts[pts.length - 1][1],
  ]);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], "F", true);
}

function drawShape(doc, shapeName, cx, cy, size) {
  const r = size / 2;
  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);

  switch (shapeName) {
    case "circle":
      doc.circle(cx, cy, r, "F");
      break;
    case "square":
      doc.rect(cx - r, cy - r, size, size, "F");
      break;
    case "triangle":
      doc.triangle(cx, cy - r, cx - r, cy + r, cx + r, cy + r, "F");
      break;
    case "star":
      drawStar(doc, cx, cy, r);
      break;
    case "diamond":
      doc.triangle(cx, cy - r, cx + r, cy, cx, cy + r, "F");
      doc.triangle(cx, cy - r, cx - r, cy, cx, cy + r, "F");
      break;
    case "heart":
      doc.circle(cx - r * 0.3, cy - r * 0.15, r * 0.4, "F");
      doc.circle(cx + r * 0.3, cy - r * 0.15, r * 0.4, "F");
      doc.triangle(
        cx - r * 0.7, cy + r * 0.05,
        cx + r * 0.7, cy + r * 0.05,
        cx, cy + r, "F"
      );
      break;
    case "spade":
      doc.circle(cx - r * 0.35, cy - r * 0.15, r * 0.4, "F");
      doc.circle(cx + r * 0.35, cy - r * 0.15, r * 0.4, "F");
      doc.triangle(
        cx - r * 0.7, cy - r * 0.1,
        cx + r * 0.7, cy - r * 0.1,
        cx, cy - r * 0.9, "F"
      );
      doc.triangle(
        cx - r * 0.15, cy + r * 0.1,
        cx + r * 0.15, cy + r * 0.1,
        cx, cy + r, "F"
      );
      break;
    case "club":
      doc.circle(cx, cy - r * 0.35, r * 0.4, "F");
      doc.circle(cx - r * 0.35, cy + r * 0.15, r * 0.4, "F");
      doc.circle(cx + r * 0.35, cy + r * 0.15, r * 0.4, "F");
      doc.triangle(
        cx - r * 0.15, cy + r * 0.2,
        cx + r * 0.15, cy + r * 0.2,
        cx, cy + r, "F"
      );
      break;
    case "moon":
      doc.circle(cx, cy, r, "F");
      doc.setFillColor(255, 255, 255);
      doc.circle(cx + r * 0.3, cy, r * 0.75, "F");
      doc.setFillColor(0, 0, 0);
      break;
    case "sun":
      doc.circle(cx, cy, r * 0.5, "F");
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const x1 = cx + Math.cos(a) * r * 0.6;
        const y1 = cy + Math.sin(a) * r * 0.6;
        const x2 = cx + Math.cos(a) * r;
        const y2 = cy + Math.sin(a) * r;
        doc.setLineWidth(size * 0.1);
        doc.line(x1, y1, x2, y2);
      }
      break;
    default:
      doc.setFontSize(size * 0.6);
      doc.setFont("helvetica", "bold");
      doc.text("?", cx, cy + size * 0.2, { align: "center" });
  }
}

// =============================================================================
// 5. Grid Rendering
// =============================================================================
function drawGrid(doc, puzzle, x, y, gridSize, showSolution) {
  const n = puzzle.size;
  const cellSize = gridSize / n;
  const source = showSolution ? puzzle.solution : puzzle.puzzle;
  const symbols = puzzle.symbols;
  const symbolType = puzzle.symbolsType;

  if (puzzle.constraints.includes("diagonal")) {
    doc.setFillColor(255, 248, 220);
    for (let i = 0; i < n; i++) {
      doc.rect(x + i * cellSize, y + i * cellSize, cellSize, cellSize, "F");
      doc.rect(
        x + (n - 1 - i) * cellSize,
        y + i * cellSize,
        cellSize,
        cellSize,
        "F"
      );
    }
  }
  if (puzzle.constraints.includes("windoku")) {
    doc.setFillColor(240, 248, 255);
    for (const [r0, c0, h, w] of WINDOKU_WINDOWS) {
      doc.rect(x + c0 * cellSize, y + r0 * cellSize, w * cellSize, h * cellSize, "F");
    }
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const val = source[r][c];
      if (val === 0) continue;
      const cx = x + c * cellSize + cellSize / 2;
      const cy = y + r * cellSize + cellSize / 2;

      if (symbolType === "shapes") {
        drawShape(doc, symbols[val - 1], cx, cy, cellSize * 0.6);
      } else {
        const fontSize = Math.min(cellSize * 0.6, 26);
        doc.setFontSize(fontSize);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text(String(symbols[val - 1]), cx, cy + fontSize * 0.3, {
          align: "center",
        });
      }
    }
  }

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  for (let i = 1; i < n; i++) {
    doc.line(x + i * cellSize, y, x + i * cellSize, y + gridSize);
    doc.line(x, y + i * cellSize, x + gridSize, y + i * cellSize);
  }

  doc.setLineWidth(1.6);
  for (let i = 0; i <= n; i += puzzle.boxCols) {
    doc.line(x + i * cellSize, y, x + i * cellSize, y + gridSize);
  }
  for (let i = 0; i <= n; i += puzzle.boxRows) {
    doc.line(x, y + i * cellSize, x + gridSize, y + i * cellSize);
  }

  doc.setLineWidth(2.2);
  doc.rect(x, y, gridSize, gridSize, "S");
}

// =============================================================================
// 6. PDF Building
// =============================================================================
const PAGE_SIZES = {
  "8.5 x 11 inches": [612, 792],
  "6 x 9 inches": [432, 648],
  "5.5 x 8.5 inches": [396, 612],
  "7 x 10 inches": [504, 720],
};

const PAGE_LAYOUTS = {
  1: [1, 1],
  2: [1, 2],
  4: [2, 2],
  6: [2, 3],
};

function computePageMap(puzzles, ppp) {
  const puzzlePages = Math.ceil(puzzles.length / ppp);
  const puzzleStartPage = 4;
  const solutionStartPage = puzzleStartPage + puzzlePages;
  const map = { puzzles: {}, solutions: {} };
  puzzles.forEach((p, i) => {
    const batch = Math.floor(i / ppp);
    map.puzzles[p.index] = puzzleStartPage + batch;
    map.solutions[p.index] = solutionStartPage + batch;
  });
  return map;
}

function drawTitlePage(doc, options, pageW, pageH) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(0, 0, 0);
  doc.text(options.title || "The Ultimate Sudoku Book", pageW / 2, pageH * 0.35, {
    align: "center",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(15);
  doc.setTextColor(136, 136, 136);
  doc.text(options.subtitle || "Puzzles for All Ages", pageW / 2, pageH * 0.42, {
    align: "center",
  });

  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text(
    "Compiled & Published by " + (options.author || "Your Name"),
    pageW / 2,
    pageH * 0.68,
    { align: "center" }
  );

  doc.setFontSize(9);
  doc.setTextColor(136, 136, 136);
  const year = new Date().getFullYear();
  doc.text(
    `© ${year} ${options.author || "Your Name"}. All rights reserved.`,
    pageW / 2,
    pageH * 0.74,
    { align: "center" }
  );
}

function drawInstructionsPage(doc, options, x, y, w) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(0, 0, 0);
  doc.text("How to Play Sudoku", x + w / 2, y + 40, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    `Welcome to the Sudoku puzzle book! Type: ${options.variantLabel}.`,
    x,
    y + 80,
    { maxWidth: w }
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("The Rules", x, y + 120);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const rules = [
    "1. Every row must contain each symbol exactly once.",
    "2. Every column must contain each symbol exactly once.",
    "3. Every small box must contain each symbol exactly once.",
    "4. Some symbols are already given to help you start.",
    "5. Full solutions are at the back of the book.",
  ];
  rules.forEach((r, i) => doc.text(r, x, y + 145 + i * 18));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("This Book", x, y + 270);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Type: ${options.variantLabel}`, x, y + 295);
  doc.text(`Difficulty: ${options.difficulty}`, x, y + 313);
  doc.text(`Grid: ${options.gridSize}×${options.gridSize}`, x, y + 331);
  doc.text(`Puzzles: ${options.puzzleCount}`, x, y + 349);
  doc.text(`Seed: ${options.seed}`, x, y + 367);
}

function drawIndexPage(doc, puzzles, pageMap, x, y, w) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(0, 0, 0);
  doc.text("Index", x + w / 2, y + 40, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(136, 136, 136);
  doc.text("Click any number to jump to that puzzle.", x + w / 2, y + 60, {
    align: "center",
  });

  const columns = 6;
  const rows = Math.ceil(puzzles.length / columns);
  const colW = w / columns;
  const rowH = Math.min(20, (y + 700 - (y + 90)) / Math.max(rows, 1));
  const startY = y + 90;

  doc.setFontSize(11);
  doc.setTextColor(124, 92, 255);
  puzzles.forEach((p, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const px = x + col * colW + colW / 2;
    const py = startY + row * rowH;
    if (py > y + 700) return;
    doc.textWithLink(`#${String(p.index).padStart(3, "0")}`, px, py, {
      align: "center",
      pageNumber: pageMap.puzzles[p.index],
    });
  });
}

function drawPuzzleBatch(doc, batch, pageMap, options, x, y, w, h) {
  const ppp = options.puzzlesPerPage;
  const [cols, rows] = PAGE_LAYOUTS[ppp];
  const cellW = w / cols;
  const cellH = h / rows;

  batch.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = x + col * cellW;
    const cellY = y + row * cellH;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(ppp === 1 ? 18 : 11);
    doc.setTextColor(0, 0, 0);
    const titleY = cellY + (ppp === 1 ? 40 : 18);
    doc.text(`Puzzle #${p.index}`, cellX + cellW / 2, titleY, {
      align: "center",
    });

    const maxGridW = cellW * 0.85;
    const maxGridH = cellH - (ppp === 1 ? 130 : 50);
    const gridSize = Math.min(maxGridW, maxGridH);
    const gridX = cellX + (cellW - gridSize) / 2;
    const gridY = titleY + (ppp === 1 ? 20 : 12);

    drawGrid(doc, p, gridX, gridY, gridSize, false);

    if (ppp === 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(136, 136, 136);
      doc.text(
        `Difficulty: ${p.difficulty}`,
        cellX + cellW / 2,
        gridY + gridSize + 22,
        { align: "center" }
      );

      doc.setFontSize(10);
      doc.setTextColor(124, 92, 255);
      doc.textWithLink(
        "Solution →",
        cellX + cellW / 2,
        gridY + gridSize + 45,
        { align: "center", pageNumber: pageMap.solutions[p.index] }
      );
    }
  });
}

function drawSolutionBatch(doc, batch, pageMap, options, x, y, w, h) {
  const ppp = options.puzzlesPerPage;
  const [cols, rows] = PAGE_LAYOUTS[ppp];
  const cellW = w / cols;
  const cellH = h / rows;

  batch.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = x + col * cellW;
    const cellY = y + row * cellH;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(ppp === 1 ? 18 : 11);
    doc.setTextColor(0, 0, 0);
    const titleY = cellY + (ppp === 1 ? 40 : 18);
    doc.text(`Solution #${p.index}`, cellX + cellW / 2, titleY, {
      align: "center",
    });

    const maxGridW = cellW * 0.85;
    const maxGridH = cellH - (ppp === 1 ? 100 : 50);
    const gridSize = Math.min(maxGridW, maxGridH);
    const gridX = cellX + (cellW - gridSize) / 2;
    const gridY = titleY + (ppp === 1 ? 20 : 12);

    drawGrid(doc, p, gridX, gridY, gridSize, true);

    if (ppp === 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(124, 92, 255);
      doc.textWithLink(
        "← Back to Puzzle",
        cellX + cellW / 2,
        gridY + gridSize + 22,
        { align: "center", pageNumber: pageMap.puzzles[p.index] }
      );
    }
  });
}

function exportPDF(puzzles, options) {
  const size = PAGE_SIZES[options.bookSize] || PAGE_SIZES["8.5 x 11 inches"];
  const [pageW, pageH] = size;

  const innerMargin = 54;
  const outerMargin = 27;
  const topMargin = 36;
  const bottomMargin = 36;
  const frameX = innerMargin;
  const frameY = topMargin;
  const frameW = pageW - innerMargin - outerMargin;
  const frameH = pageH - topMargin - bottomMargin;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [pageW, pageH],
  });

  const ppp = options.puzzlesPerPage || 1;
  const pageMap = computePageMap(puzzles, ppp);

  drawTitlePage(doc, options, pageW, pageH);

  doc.addPage([pageW, pageH]);
  drawInstructionsPage(
    doc,
    { ...options, gridSize: puzzles[0].size, puzzleCount: puzzles.length },
    frameX,
    frameY,
    frameW
  );

  doc.addPage([pageW, pageH]);
  drawIndexPage(doc, puzzles, pageMap, frameX, frameY, frameW);

  for (let i = 0; i < puzzles.length; i += ppp) {
    doc.addPage([pageW, pageH]);
    drawPuzzleBatch(
      doc,
      puzzles.slice(i, i + ppp),
      pageMap,
      options,
      frameX,
      frameY,
      frameW,
      frameH
    );
  }

  for (let i = 0; i < puzzles.length; i += ppp) {
    doc.addPage([pageW, pageH]);
    drawSolutionBatch(
      doc,
      puzzles.slice(i, i + ppp),
      pageMap,
      options,
      frameX,
      frameY,
      frameW,
      frameH
    );
  }

  return Buffer.from(doc.output("arraybuffer"));
}

// =============================================================================
// Exports
// =============================================================================
module.exports = {
  VARIANTS,
  PAGE_SIZES,
  PAGE_LAYOUTS,
  SeededRandom,
  getSymbols,
  buildSingleSudokuPuzzle,
  exportPDF,
};