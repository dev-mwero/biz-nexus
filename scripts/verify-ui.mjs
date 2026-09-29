/**
 * Computed-style verification for the design system.
 *
 * This exists because of a specific bug that type checking, linting, and unit
 * tests all passed straight through: dark-mode backgrounds were built from the
 * `ink` ramp, which inverts, so a control specified as "near-black ink" came
 * out near-white on a dark card. Nothing complained. A screenshot review caught
 * it in seconds; this makes it a failing check instead of a lucky catch.
 *
 * The rule being enforced: in dark mode, a background is a `surface-*` token or
 * an intentionally inverted `ink`; a background must never be lighter than the
 * surface it sits on unless inversion is the explicit intent.
 *
 * Usage: next start, then `node scripts/verify-ui.mjs`
 */

const CDP_HTTP = "http://127.0.0.1:9222";
const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:3000/dev/ui";

/* ── Colour maths ─────────────────────────────────────────────────────────── */

function parseRgb(value) {
  const match = value?.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a] = match[1]
    .split(",")
    .map((part) => Number.parseFloat(part));
  return { r, g, b, a: a ?? 1 };
}

/** Relative luminance per WCAG 2.1. */
function luminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const a = luminance(parseRgb(fg) ?? { r: 0, g: 0, b: 0 });
  const b = luminance(parseRgb(bg) ?? { r: 255, g: 255, b: 255 });
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── CDP plumbing ─────────────────────────────────────────────────────────── */

async function connect() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) {
    throw new Error(
      `No page target. Start Chrome with --remote-debugging-port=9222 and load ${TARGET_URL}.`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error
      ? entry.reject(new Error(JSON.stringify(msg.error)))
      : entry.resolve(msg.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => ws.close() };
}

/* ── Probe ────────────────────────────────────────────────────────────────── */

const PROBE = `(() => {
  const sample = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor, color: s.color, border: s.borderColor,
      font: s.fontFamily, size: s.fontSize, height: s.height,
      radius: s.borderRadius, align: s.textAlign, transform: s.textTransform,
      variant: s.fontVariantNumeric,
    };
  };
  const first = (sel) => sample(document.querySelector(sel));
  return {
    htmlClass: document.documentElement.className,
    darkApplied: document.documentElement.classList.contains('dark'),
    body: first('body'),
    heading: first('h1'),
    primary: first('[data-slot="button"]'),
    input: first('[data-slot="input"]'),
    card: first('[data-slot="card"]'),
    badge: first('[data-slot="badge"]'),
    tableHead: first('th'),
    numeric: first('.tabular-nums'),
    nodes: document.querySelectorAll('*').length,
  };
})()`;

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: Boolean(pass), detail });

function assertLight(sample) {
  const label = "light";
  check(
    `${label}: body background is opaque`,
    sample.body?.bg !== "rgba(0, 0, 0, 0)",
    sample.body?.bg,
  );
  check(
    `${label}: body font is Geist`,
    /Geist/i.test(sample.body?.font ?? ""),
    sample.body?.font,
  );
  check(
    `${label}: heading uses the display face`,
    /Instrument/i.test(sample.heading?.font ?? ""),
    sample.heading?.font,
  );
  check(
    `${label}: primary button is ink, not a brand blue`,
    sample.primary?.bg === "rgb(11, 14, 20)",
    sample.primary?.bg,
  );
  check(
    `${label}: primary button text is white`,
    sample.primary?.color === "rgb(255, 255, 255)",
    sample.primary?.color,
  );
  check(
    `${label}: body text meets AA on the canvas`,
    contrast(sample.body?.color, sample.body?.bg) >= 4.5,
    `${contrast(sample.body?.color, sample.body?.bg).toFixed(2)}:1`,
  );
  check(
    `${label}: input is a raised surface, not transparent`,
    sample.input?.bg !== "rgba(0, 0, 0, 0)",
    sample.input?.bg,
  );
  check(
    `${label}: input height matches the button height`,
    sample.input?.height === sample.primary?.height,
    `${sample.input?.height} vs ${sample.primary?.height}`,
  );
  check(
    `${label}: input text meets AA on its own background`,
    contrast(sample.input?.color, sample.input?.bg) >= 4.5,
    `${contrast(sample.input?.color, sample.input?.bg).toFixed(2)}:1`,
  );
  check(
    `${label}: numeric cell uses the mono face`,
    /Plex Mono/i.test(sample.numeric?.font ?? ""),
    sample.numeric?.font,
  );
  check(
    `${label}: numeric cell uses tabular figures`,
    (sample.numeric?.variant ?? "").includes("tabular-nums"),
    sample.numeric?.variant,
  );
  check(
    `${label}: table headers are uppercase and small`,
    sample.tableHead?.size === "12px" &&
      sample.tableHead?.transform === "uppercase",
    `${sample.tableHead?.size} / ${sample.tableHead?.transform}`,
  );
}

function assertDark(sample) {
  const label = "dark";
  const canvasLum = luminance(
    parseRgb(sample.body?.bg) ?? { r: 0, g: 0, b: 0 },
  );
  const cardLum = luminance(parseRgb(sample.card?.bg) ?? { r: 0, g: 0, b: 0 });
  const inputLum = luminance(
    parseRgb(sample.input?.bg) ?? { r: 0, g: 0, b: 0 },
  );

  check(
    `${label}: canvas is actually dark`,
    canvasLum < 0.05,
    `${sample.body?.bg} (lum ${canvasLum.toFixed(4)})`,
  );
  check(
    `${label}: body text inverted to light`,
    contrast(sample.body?.color, sample.body?.bg) >= 4.5,
    `${sample.body?.color} on ${sample.body?.bg} = ${contrast(sample.body?.color, sample.body?.bg).toFixed(2)}:1`,
  );
  // The regression this script exists for.
  check(
    `${label}: input is not a light box on a dark card`,
    inputLum <= cardLum + 0.02,
    `input lum ${inputLum.toFixed(4)} vs card ${cardLum.toFixed(4)}`,
  );
  check(
    `${label}: input text meets AA on the input background`,
    contrast(sample.input?.color, sample.input?.bg) >= 4.5,
    `${contrast(sample.input?.color, sample.input?.bg).toFixed(2)}:1`,
  );
  check(
    `${label}: primary button inverted to a dark fill`,
    sample.primary?.bg === "rgb(26, 31, 39)",
    sample.primary?.bg,
  );
  check(
    `${label}: primary button text inverted to light`,
    contrast(sample.primary?.color, sample.primary?.bg) >= 4.5,
    `${contrast(sample.primary?.color, sample.primary?.bg).toFixed(2)}:1`,
  );
  check(
    `${label}: badge meets AA`,
    contrast(sample.badge?.color, sample.badge?.bg) >= 4.5,
    `${contrast(sample.badge?.color, sample.badge?.bg).toFixed(2)}:1`,
  );
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

const { send, close } = await connect();
await send("Page.enable");
// Without this the check silently validates the previous build's stylesheet.
// A verification script that reports stale CSS as a pass is worse than none.
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: TARGET_URL });
await new Promise((r) => setTimeout(r, 2500));

const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result
    .value;

const lightSample = await evaluate(PROBE);
check("page rendered", lightSample.nodes > 200, `${lightSample.nodes} nodes`);
assertLight(lightSample);

await evaluate(
  `document.documentElement.classList.remove('light','dark');
   document.documentElement.classList.add('dark'); 'ok'`,
);
// Let the style recalc and a frame settle. Reading computed styles in the same
// tick as the class swap samples a document that is mid-change, which reports
// a stale value and looks like a product bug that is not there.
await new Promise((r) => setTimeout(r, 400));
const darkSample = await evaluate(PROBE);
check(
  "dark mode class applied for the dark assertions",
  darkSample.darkApplied,
  darkSample.htmlClass,
);
assertDark(darkSample);
close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  const detail = r.detail && r.detail !== "undefined" ? `  → ${r.detail}` : "";
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
