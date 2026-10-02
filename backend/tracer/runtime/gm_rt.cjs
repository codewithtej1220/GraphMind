// GraphMind trace runtime for JavaScript / TypeScript, preloaded with `node --require`.
// Instrumented code calls the globals below; each step is appended to $GM_TRACE as one JSON line.
"use strict";
const fs = require("fs");

const tracePath = process.env.GM_TRACE;
const counting = process.env.GM_COUNT === "1";
const maxSteps = Number(process.env.GM_MAX || 5000);
const fd = tracePath ? fs.openSync(tracePath, "w") : null;
const stack = ["<main>"];
let steps = 0;
let finished = false;

function encode(value, depth) {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === "number") return Number.isFinite(value) ? value : String(value);
  if (type === "string") return value.length > 200 ? value.slice(0, 200) + "…" : value;
  if (type === "boolean") return value;
  if (type === "bigint") return value.toString();
  if (type === "function" || type === "symbol") return undefined;
  if (depth > 3) return "…";
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value).slice(0, 200).map((item) => {
      const encoded = encode(item, depth + 1);
      return encoded === undefined ? null : encoded;
    });
  }
  if (value instanceof Set) return encode([...value], depth);
  if (value instanceof Map) {
    const out = {};
    for (const [k, v] of [...value].slice(0, 100)) {
      const encoded = encode(v, depth + 1);
      if (encoded !== undefined) out[String(k)] = encoded;
    }
    return out;
  }
  if (type === "object") {
    const out = {};
    let count = 0;
    for (const key of Object.keys(value)) {
      if (count++ >= 50) break;
      const encoded = encode(value[key], depth + 1);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  return String(value);
}

function finish(limited) {
  if (finished) return;
  finished = true;
  if (fd !== null) fs.writeSync(fd, JSON.stringify({ done: true, steps, limited }) + "\n");
}

process.on("exit", () => finish(false));

globalThis.__gm = function (line, kind, names, read) {
  steps++;
  if (steps > maxSteps) {
    finish(true);
    process.exit(0);
  }
  if (counting || fd === null) return;
  let values = [];
  try {
    values = read ? read() : [];
  } catch {
    // A variable was still in its temporal dead zone; record the step without values.
  }
  const vars = {};
  names.forEach((name, i) => {
    const encoded = encode(values[i], 0);
    if (encoded !== undefined) vars[name] = encoded;
  });
  fs.writeSync(fd, JSON.stringify({ l: line, k: kind, s: stack, v: vars }) + "\n");
};
globalThis.__gmE = (name) => { stack.push(name); };
globalThis.__gmX = () => { if (stack.length > 1) stack.pop(); };
globalThis.__gmN = () => Number(process.env.GM_N || 0);
globalThis.__gmData = () => {
  const n = Number(process.env.GM_N || 0);
  const sorted = process.env.GM_SORTED === "1";
  return Array.from({ length: n }, (_, i) => (sorted ? i * 3 + 1 : (i * 7919 + 13) % 1000));
};
