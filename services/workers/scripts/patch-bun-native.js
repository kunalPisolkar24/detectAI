#!/usr/bin/env node
// Patch native modules that crash Bun (uv_version_string) for HA tests.
// - ssh2/lib/protocol/crypto.js tries to load sshcrypto.node (NAPI, uses uv_version_string)
// - cpu-features/lib/index.js tries to load cpufeatures.node (same)
// Bun panics instead of catching, so we force JS fallbacks.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function patchCrypto() {
  const p = path.join(root, "node_modules/ssh2/lib/protocol/crypto.js");
  if (!fs.existsSync(p)) return;
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("patched: avoid Bun NAPI")) return;
  // Replace the try block that loads sshcrypto.node with a JS-only fallback
  // Original: try { binding = require('./crypto/build/Release/sshcrypto.node'); ({...}=binding); } catch {}
  // We keep the catch but make binding stay null so JS ciphers are used.
  const before = "try {\n  binding = require('./crypto/build/Release/sshcrypto.node');";
  const after = "try {\n  binding = null; // patched: avoid Bun NAPI uv_version_string - force JS fallback";
  if (s.includes(before)) {
    s = s.replace(before, after);
    fs.writeFileSync(p, s);
    console.log("[patch-bun] patched ssh2 crypto.js to avoid sshcrypto.node");
  } else if (s.includes("sshcrypto.node") && !s.includes("patched")) {
    // fallback: comment out require
    s = s.replace(/binding = require\('.\/crypto\/build\/Release\/sshcrypto\.node'\)/, "binding = null; // patched");
    fs.writeFileSync(p, s);
    console.log("[patch-bun] patched ssh2 crypto.js (fallback)");
  }
}

function patchCpuFeatures() {
  const p = path.join(root, "node_modules/cpu-features/lib/index.js");
  if (!fs.existsSync(p)) return;
  const s = fs.readFileSync(p, "utf8");
  if (s.includes("patched for Bun")) return;
  const patched = `'use strict';
// patched for Bun: avoid native cpufeatures.node which crashes Bun (uv_version_string)
module.exports = function() { return { flags: [], arch: 'x64' }; };
`;
  fs.writeFileSync(p, patched);
  console.log("[patch-bun] patched cpu-features to avoid cpufeatures.node");
}

patchCrypto();
patchCpuFeatures();
