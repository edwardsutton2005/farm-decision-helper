import "./style.css";

type Crop = "corn" | "soy" | "vegetables" | "orchard" | "other";
type Soil = "sand" | "loam" | "clay";
type Slope = "flat" | "gentle" | "steep";
type Rain = "low" | "medium" | "high";
type Irrigation = "none" | "light" | "medium" | "heavy";

type RiskLabel = "Low" | "Medium" | "High";

interface Inputs {
  crop: Crop;
  acres: number;
  soil: Soil;
  slope: Slope;
  rain: Rain;
  nRate: number | null; // lb/acre
  irrigation: Irrigation;
}

interface Scores {
  runoff: number; // 0..100
  leaching: number; // 0..100
}

const STORAGE_KEY = "farmDecisionHelper:v1"; // read up on what storage key does and how its used

const el = {
  form: document.getElementById("farmForm") as HTMLFormElement,
  crop: document.getElementById("crop") as HTMLSelectElement,
  acres: document.getElementById("acres") as HTMLInputElement,
  soil: document.getElementById("soil") as HTMLSelectElement,
  slope: document.getElementById("slope") as HTMLSelectElement,
  rain: document.getElementById("rain") as HTMLSelectElement,
  nRate: document.getElementById("nRate") as HTMLInputElement,
  irrigation: document.getElementById("irrigation") as HTMLSelectElement,

  runoffScore: document.getElementById("runoffScore") as HTMLSpanElement,
  runoffLabel: document.getElementById("runoffLabel") as HTMLSpanElement,
  runoffBar: document.getElementById("runoffBar") as HTMLDivElement,
  runoffWhy: document.getElementById("runoffWhy") as HTMLParagraphElement,

  leachScore: document.getElementById("leachScore") as HTMLSpanElement,
  leachLabel: document.getElementById("leachLabel") as HTMLSpanElement,
  leachBar: document.getElementById("leachBar") as HTMLDivElement,
  leachWhy: document.getElementById("leachWhy") as HTMLParagraphElement,

  actions: document.getElementById("actions") as HTMLUListElement,
  note: document.getElementById("note") as HTMLParagraphElement,

  themeToggle: document.getElementById("themeToggle") as HTMLButtonElement,
  resetBtn: document.getElementById("resetBtn") as HTMLButtonElement
};

// keep numbers bounded between min and max
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null; // isFinite checks if a value is not NaN or +-Infinity
  return n;
}

function getInputsFromForm(): Inputs {
  const acres = Number(el.acres.value || 0);
  const nRate = toIntOrNull(el.nRate.value);

  return {
    crop: el.crop.value as Crop,
    acres: Number.isFinite(acres) ? clamp(acres, 0, Infinity) : 0,
    soil: el.soil.value as Soil,
    slope: el.slope.value as Slope,
    rain: el.rain.value as Rain,
    nRate: nRate !== null ? Math.max(0, nRate) : null,
    irrigation: el.irrigation.value as Irrigation,
  };
}

function computeScores(i: Inputs): { scores: Scores; why: { runoff: string; leaching: string } } {
  // Runoff Weights
  const slopeRunoff = ({ flat: 10, gentle: 25, steep: 45 } as const)[i.slope];
  const rainRunoff = ({ low: 10, medium: 25, high: 45 } as const)[i.rain];
  const soilRunoff = ({ sand: 10, loam: 20, clay: 35} as const)[i.soil];

  // N effect (caps at 30)
  const nImpact = i.nRate === null ? 0 : clamp(i.nRate / 10, 0, 30); // if i.nRate === Null, nImpact = 0, else nImpact = clamp...

  // Leaching Weights
  const rainLeach = ({ low: 10, medium: 25, high: 45 } as const)[i.rain];
  const soilLeach = ({ sand: 40, loam: 20, clay: 10} as const)[i.soil];
  const irrigationLeach = ({ none: 0, light: 10, medium: 20, heavy : 25} as const)[i.irrigation];
  
  // Crop tweak (tiny nudges)
  const cropRunoff = ({ corn: 5, soy: 3, vegetables: 8, orchard: 4, other: 4} as const)[i.crop];
  const cropLeach = ({ corn: 8, soy: 3, vegetables: 10, orchard: 5, other: 5} as const)[i.crop];

  const runoff = clamp(slopeRunoff + rainRunoff + soilRunoff + nImpact + cropRunoff, 0, 100);
  const leaching = clamp(soilLeach + rainLeach + irrigationLeach + cropLeach + (i.nRate ? clamp(i.nRate / 20, 0, 20) : 0), 0, 100)

  const runoffWhy = 
    `Driven by slope (${i.slope}), rain forecast (${i.rain}), soil (${i.soil})` + 
    (i.nRate !== null ? `, and N rate (${i.nRate} lb/ac).` : ".");

  const leachWhy = 
    `Driven by soil permeability (${i.soil}), rain (${i.rain})` + 
    (i.irrigation !== "none" ? `, irrigation (${i.irrigation})` : "") +
    (i.nRate !== null ? `, and N rate (${i.nRate}) lb/ac.` : ".");

  return { 
    scores : { runoff, leaching },
    why: { runoff: runoffWhy, leaching: leachWhy}
  };
}

function labelForScore(score: number): RiskLabel {
  if (score >= 67) return "High";
  if (score >= 34) return "Medium";
  return "Low";
}

function pillText(label: RiskLabel): string {
  return label;
}

function actionsFor(i: Inputs, s: Scores): string[] {
  const runoffLabel = labelForScore(s.runoff);
  const leachLabel = labelForScore(s.leaching);

  const actions: string[] = [];

  if (runoffLabel === "High") {
    actions.push("Avoid fertilizer application right before storms; consider delaying or splitting applications.");
    actions.push("Add/expand vegetated buffer strips and reduce bare soil (mulch/cover crops).");
    actions.push("Reduce tillage / keep residue to improve infiltration and reduce erosion.");
  } else if (runoffLabel === "Medium") {
    actions.push("Time applications away from heavy rainfall windows when possible.");
    actions.push("Consider cover crops or residue retention to protect soil and reduce runoff.");
  } else {
    actions.push("Keep current soil cover practices; monitor forecast before applications.");
  }

  if (leachLabel === "High") {
    actions.push("Split N applications (smaller, more frequent) to reduce losses.");
    actions.push("Consider nitrification inhibitors / slow-release forms where appropriate.");
    actions.push("Use cover crops (e.g., rye) to capture residual N after harvest.");
  } else if (leachLabel === "Medium") {
    actions.push("If feasible, split N or reduce peak application rates.");
    if (i.irrigation !== "none") actions.push("Avoid over-irrigation; use shorter sets and monitor soil moisture.");
  } else {
    actions.push("Maintain good nutrient timing; keep an eye on irrigation/rain totals.");
  }

  // Small extra, only if user gave a high N rate:
  if (i.nRate !== null && i.nRate >= 150) {
    actions.push("Your N rate is relatively high — double-check target yield assumptions and consider soil tests.");
  }

  // Deduplicate while preserving order
  return Array.from(new Set(actions));
}

function render(i: Inputs): void {
  const { scores, why } = computeScores(i);

  const runoffLabel = labelForScore(scores.runoff);
  const leachLabel = labelForScore(scores.leaching);

  el.runoffScore.textContent = String(Math.round(scores.runoff));
  el.runoffLabel.textContent = pillText(runoffLabel);
  el.runoffBar.style.width = `${Math.round(scores.runoff)}%`;
  el.runoffWhy.textContent = why.runoff;

  el.leachScore.textContent = String(Math.round(scores.leaching));
  el.leachLabel.textContent = pillText(leachLabel);
  el.leachBar.style.width = `${Math.round(scores.leaching)}%`;
  el.leachWhy.textContent = why.leaching;

  // Actions list
  el.actions.innerHTML = "";
  for (const a of actionsFor(i, scores)) {
    const li = document.createElement("li");
    li.textContent = a;
    el.actions.appendChild(li);
  }

  const acresMsg = i.acres > 0 ? `For ~${i.acres} acres, ` : "";
  el.note.textContent = 
    `${acresMsg}focus first on decisions that are low-cost and timing-based: forecast-aware application , split N, and maintaining soil cover.`;

  saveInputs(i);
}

// saves inputs onto local storage as strings
function saveInputs(i: Inputs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(i));
}

function loadInputs(): Inputs | null {
  const raw = localStorage.getItem(STORAGE_KEY); // returns string if key exists, null if doesnt
  if (!raw) return null; // bail if string doesnt exist
  try{
    const parsed = JSON.parse(raw) as Partial<Inputs>; // converts stores string back into object - oartial<INputs> means object might not have all Input fields
    // Minimal validation
    if (!parsed || typeof parsed !== "object") return null; // protects against corrupted/invalid data - ensures object type
    return {
      // if parsed type exists, use. otherwise, default to second option
      crop: (parsed.crop ?? "corn") as Crop,
      acres: typeof parsed.acres === "number" ? parsed.acres : 10,
      soil: (parsed.soil ?? "loam") as Soil,
      slope: (parsed.slope ?? "gentle") as Slope,
      rain: (parsed.rain ?? "medium") as Rain,
      nRate: typeof parsed.nRate === "number" ? parsed.nRate : null,
      irrigation: (parsed.irrigation ?? "none") as Irrigation,
    };
  } catch {
    return null; // if JSON.parse fails, return null - fails instead of breaking.
  }
}

function applyInputsToForm(i: Inputs): void {
  el.crop.value = i.crop;
  el.acres.value = String(i.acres);
  el.soil.value = i.soil;
  el.slope.value = i.slope;
  el.rain.value = i.rain;
  el.nRate.value = i.nRate === null ? "" : String(i.nRate);
  el.irrigation.value = i.irrigation;
}

function setTheme(mode: "dark" | "light"): void {
  document.body.classList.toggle("light", mode === "light");
  localStorage.setItem("farmDecisionHelper:theme", mode);
  el.themeToggle.setAttribute("aria-pressed", String(mode === "light"));
}

function initTheme(): void {
  const saved = localStorage.getItem("farmDecisionHelper:theme");
  setTheme(saved === "light" ? "light" : "dark");
}

function init(): void {
  initTheme();

  const saved = loadInputs();
  if (saved) applyInputsToForm(saved);

  // Render initial
  render(getInputsFromForm());

  // Update on any input change (nice for learning event listeners)
  el.form.addEventListener("input", () => render(getInputsFromForm()));
  el.form.addEventListener("change", () => render(getInputsFromForm()));

  // Prevent page reload on submit
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    render(getInputsFromForm());
  });

  el.resetBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    const defaults: Inputs = {
      crop: "corn",
      acres: 10,
      soil: "loam",
      slope: "gentle",
      rain: "medium",
      nRate: null,
      irrigation: "none",
    };
    applyInputsToForm(defaults);
    render(defaults);
  });

  el.themeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.contains("light");
    setTheme(isLight ? "dark" : "light");
  });
}

init();