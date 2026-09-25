#!/usr/bin/env node
// Web ⇄ iOS parity check.   npm run parity   (add --backlog to list every gap)
//
// web/ and ios/ are two clients of the same two services (server/ and
// accounts/) and share no code, so they drift silently. On iOS, drift is a
// crash rather than a cosmetic bug: a Swift enum missing a value the API sends,
// or a struct field Swift requires that the API leaves out, fails the decode of
// the *whole* response. This reads the sources directly and fails on any
// difference that isn't recorded in parity.json — as `pending` (the lagging
// platform's backlog) or `skip` (deliberately platform-specific, with a reason).
//
//   routes        every route in server/ and accounts/ vs what each client calls
//   enums         string unions in web/src/lib vs same-named Swift `enum X: String`,
//                 both directions (either side may write the value the other reads)
//   fields        Swift Codable structs vs the same-named web interface: a field
//                 Swift requires must be required and non-null on web, and a
//                 Swift enum field must accept every value web's type allows
//   entitlements  plan→feature map and live statuses in accounts, server, web and
//                 iOS. Never exempt: a mismatch shows or hides paid features wrongly
//
// Web's types stand in for the API contract: web is the client that is exercised
// daily, so "iOS can decode anything web's types say the API sends" is the bar.
//
// Zero dependencies, so CI and the Claude Code hook can run it without an
// install. It parses this repo's own style with regexes and brace counting; if a
// refactor trips it, fix the parser here rather than loosening the check.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "parity.json";

const SERVICES = [
  { index: "server/src/index.ts", routes: "server/src/routes" },
  { index: "accounts/src/index.ts", routes: "accounts/src/routes" },
];
const IOS_SOURCES = walk("ios/Fitnofat/Sources", ".swift");
// Web must make every API call through lib/api.ts; page code also holds
// app-route strings like navigate("/billing") that would read as API calls.
const CLIENT_FILES = { web: ["web/src/lib/api.ts"], ios: IOS_SOURCES };
const WEB_TYPE_FILES = ["web/src/lib/types.ts", "web/src/lib/api.ts"];

// ── Source helpers ───────────────────────────────────────────────────────────

function walk(dir, ext) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8"));

// Drops // and /* */ comments; strings are kept intact and line breaks survive.
function stripComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, "");
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

// Walks `src` from `from`, skipping string contents, and calls visit(char, i,
// depth) for every character outside a string. Returning true stops the walk.
function scan(src, from, visit) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    if (c === "}" || c === ")" || c === "]") depth--;
    if (visit(c, i, depth)) return i;
    if (c === "{" || c === "(" || c === "[") depth++;
  }
  return src.length;
}

// Body of the {...} block that opens at or after `from`.
function blockAt(src, from) {
  const open = src.indexOf("{", from);
  const close = scan(src, open, (c, _i, depth) => c === "}" && depth === 0);
  return src.slice(open + 1, close);
}

// A block body with every nested block collapsed to "{}", so only the block's
// own members remain (a computed property keeps its "{}" as a marker).
function collapse(body) {
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (depth === 0) out += c;
      if (c === "\\") {
        i++;
        if (depth === 0) out += body[i] ?? "";
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    if (c === "{") {
      if (depth === 0) out += "{}";
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

const stringLiterals = (s) => [...s.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// ── Routes ───────────────────────────────────────────────────────────────────

// ":id", "${id}" and "\(id)" all become ":param"; query strings are dropped.
function normPath(p) {
  const path = p
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/\\\((?:[^()]|\([^()]*\))*\)/g, ":param")
    .replace(/:\w+/g, ":param")
    .replace(/\/+$/, "");
  return path || "/";
}

function serverRoutes() {
  const routes = new Set();
  for (const { index, routes: dir } of SERVICES) {
    const idx = read(index);
    const mounts = new Map();
    for (const m of idx.matchAll(/\bapp\.use\(\s*"([^"]+)"[^)]*?\b(\w+)\s*\)/g)) mounts.set(m[2], m[1]);
    for (const m of idx.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      routes.add(`${m[1].toUpperCase()} ${normPath(m[2])}`);
    }
    for (const file of walk(dir, ".ts")) {
      for (const m of read(file).matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
        const prefix = mounts.get(m[1]);
        if (prefix != null) routes.add(`${m[2].toUpperCase()} ${normPath(prefix + m[3])}`);
      }
    }
  }
  return routes;
}

// The `method:` argument of the call whose argument list contains `from`.
function callMethod(src, from) {
  const end = scan(src, from, (_c, _i, depth) => depth < 0);
  return src.slice(from, end).match(/\bmethod:\s*"(\w+)"/)?.[1] ?? "GET";
}

function clientCalls(files) {
  const calls = new Map();
  // A template literal may hold quotes inside ${…}, so each quote style gets
  // its own alternative rather than a shared backreference.
  const literal =
    /"(\/(?:api|auth|account|billing|admin)(?=[/?"])[^"\n]*)"|`(\/(?:api|auth|account|billing|admin)(?=[/?$`])[^`\n]*)`/g;
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(literal)) {
      const route = `${callMethod(src, m.index + m[0].length)} ${normPath(m[1] ?? m[2])}`;
      if (!calls.has(route)) calls.set(route, file);
    }
  }
  return calls;
}

// "METHOD /path" where METHOD may be "*" and a trailing "/*" matches a prefix.
function routeMatches(route, pattern) {
  const [method, path] = route.split(" ");
  const [pm, pp] = pattern.split(" ");
  if (pm !== "*" && pm !== method) return false;
  return pp.endsWith("/*") ? path.startsWith(pp.slice(0, -1)) : path === normPath(pp);
}

// ── Web types ────────────────────────────────────────────────────────────────

function webTypes() {
  const unions = new Map();
  const interfaces = new Map();
  for (const file of WEB_TYPE_FILES) {
    const src = read(file);
    for (const m of src.matchAll(/\btype\s+(\w+)\s*=\s*([^;]+);/g)) {
      const parts = m[2].split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length && parts.every((p) => /^(["'])[^"']*\1$/.test(p))) {
        unions.set(m[1], parts.map((p) => p.slice(1, -1)));
      }
    }
    for (const m of src.matchAll(/\binterface\s+(\w+)\s*\{/g)) {
      const fields = new Map();
      // Members end in ";" in this codebase; a union may wrap across lines.
      for (const member of collapse(blockAt(src, m.index)).split(";")) {
        const f = member.replace(/\s+/g, " ").match(/^\s*(?:readonly\s+)?(\w+)(\?)?\s*:\s*(.+?)\s*$/);
        if (f) fields.set(f[1], { optional: !!f[2] || /\|\s*(null|undefined)\b/.test(f[3]), type: f[3] });
      }
      interfaces.set(m[1], fields);
    }
  }
  return { unions, interfaces };
}

// The string values a web field can hold: a list, "open" for plain string, or
// null when it isn't a string field at all.
function webValues(type, unions) {
  const t = type
    .replace(/\|\s*(null|undefined)\b/g, "")
    .trim()
    .replace(/\[\]$/, "")
    .replace(/^Array<(.+)>$/, "$1")
    .trim();
  if (t === "string") return "open";
  if (unions.has(t)) return { name: t, values: unions.get(t) };
  const parts = t.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => /^(["'])[^"']*\1$/.test(p))) {
    return { name: null, values: parts.map((p) => p.slice(1, -1)) };
  }
  return null;
}

// ── Swift types ──────────────────────────────────────────────────────────────

function swiftTypes() {
  const enums = new Map();
  const structs = new Map();
  for (const file of IOS_SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(/\benum\s+(\w+)\s*:\s*String\b([^{]*)\{/g)) {
      if (/\bCodingKey\b/.test(m[2])) continue;
      const body = blockAt(src, m.index);
      // A custom init(from:) that falls back on unknown raw values degrades
      // instead of failing the decode, so it may back an open-ended field.
      enums.set(m[1], { cases: enumCases(body), tolerant: /\binit\s*\(\s*from\b/.test(body) });
    }
    for (const m of src.matchAll(/\bstruct\s+(\w+)\s*:\s*([^{]+)\{/g)) {
      if (!/\b(Codable|Decodable)\b/.test(m[2])) continue;
      const body = blockAt(src, m.index);
      if (/\binit\s*\(\s*from\b/.test(body)) continue; // custom decoding: can't judge
      structs.set(m[1], { file, fields: structFields(body) });
    }
  }
  return { enums, structs };
}

// Case name → raw value, from the enum's own `case` declarations.
function enumCases(body) {
  const cases = new Map();
  for (const m of collapse(body).matchAll(/^\s*case\s+([^\n]+)/gm)) {
    for (const item of m[1].split(",")) {
      const c = item.trim().match(/^(\w+)(?:\s*=\s*"([^"]*)")?$/);
      if (c) cases.set(c[1], c[2] ?? c[1]);
    }
  }
  return cases;
}

// Stored properties the synthesized decoder reads, keyed by JSON key. A `var`
// with a default is still required by synthesized Decodable; a `let` with a
// default isn't decoded at all.
function structFields(body) {
  const ck = body.match(/\benum\s+CodingKeys\b[^{]*\{/);
  const keys = ck ? enumCases(blockAt(body, ck.index)) : null;
  const fields = new Map();
  for (const line of collapse(body).split("\n")) {
    const f = line.match(
      /^\s*(?:(?:public|internal|private|fileprivate)(?:\(set\))?\s+)*(let|var)\s+(\w+)\s*:\s*([^={]+?)\s*(=[^{]*)?(\{\})?\s*$/
    );
    if (!f || f[5] || (f[1] === "let" && f[4])) continue;
    if (keys && !keys.has(f[2])) continue;
    const type = f[3].trim();
    fields.set(keys ? keys.get(f[2]) : f[2], {
      optional: type.endsWith("?") || type.startsWith("Optional<"),
      type: type.replace(/\?$/, "").replace(/^\[(.+)\]$/, "$1"),
    });
  }
  return fields;
}

// ── Entitlements ─────────────────────────────────────────────────────────────

function entitlementSources(swiftEnums) {
  const tsMap = (file, anchor) => {
    const block = blockAt(read(file), read(file).indexOf(anchor));
    return Object.fromEntries([...block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map((m) => [m[1], stringLiterals(m[2])]));
  };
  const tsSet = (file, anchor) => {
    const m = read(file).match(new RegExp(`${anchor}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`));
    return m ? stringLiterals(m[1]) : null;
  };
  const accounts = read("accounts/src/entitlements.ts");
  const tiers = blockAt(accounts, accounts.indexOf("TIERS"));
  const accountsMap = Object.fromEntries(
    [...tiers.matchAll(/(\w+):\s*\{[^{}]*?features:\s*\[([^\]]*)\]/g)].map((m) => [m[1], stringLiterals(m[2])])
  );

  const swiftFile = "ios/Fitnofat/Sources/Services/EntitlementService.swift";
  const swift = read(swiftFile);
  const raw = (enumName, name) => swiftEnums.get(enumName)?.cases.get(name) ?? `.${name}?`;
  const planBlock = swift.match(/planFeatures\s*:[^=]*=\s*\[([\s\S]*?)\n\s*\]/)?.[1] ?? "";
  const swiftMap = Object.fromEntries(
    [...planBlock.matchAll(/\.(\w+):\s*\[([^\]]*)\]/g)].map((m) => [
      raw("Plan", m[1]),
      [...m[2].matchAll(/\.(\w+)/g)].map((c) => raw("Feature", c[1])),
    ])
  );
  const swiftLive = swift.match(/liveStatuses\s*:[^=]*=\s*\[([^\]]*)\]/)?.[1];

  return {
    plans: {
      "accounts/src/entitlements.ts": accountsMap,
      "server/src/entitlements.ts": tsMap("server/src/entitlements.ts", "PLAN_FEATURES"),
      "web/src/lib/entitlements.ts": tsMap("web/src/lib/entitlements.ts", "PLAN_FEATURES"),
      [swiftFile]: swiftMap,
    },
    live: {
      "accounts/src/stripe.ts": tsSet("accounts/src/stripe.ts", "ACTIVE_STATUSES"),
      "server/src/entitlements.ts": tsSet("server/src/entitlements.ts", "LIVE_STATUSES"),
      "web/src/lib/entitlements.ts": tsSet("web/src/lib/entitlements.ts", "LIVE_STATUSES"),
      [swiftFile]: swiftLive
        ? [...swiftLive.matchAll(/\.(\w+)/g)].map((c) => raw("SubscriptionStatus", c[1]))
        : null,
    },
  };
}

// ── Checks ───────────────────────────────────────────────────────────────────

function findDrift() {
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8"));
  const drift = []; // recordable: { side, id, why }
  const hard = []; // never recordable

  // Routes
  const routes = serverRoutes();
  const serverOnly = Object.keys(manifest.serverOnly ?? {});
  for (const pattern of serverOnly) {
    if (![...routes].some((r) => routeMatches(r, pattern))) {
      hard.push(`parity.json serverOnly "${pattern}" matches no route any more; delete it`);
    }
  }
  for (const side of ["web", "ios"]) {
    const calls = clientCalls(CLIENT_FILES[side]);
    for (const [route, file] of calls) {
      if (!routes.has(route)) hard.push(`${side} calls ${route} (${file}), which neither service defines`);
    }
    for (const route of routes) {
      if (calls.has(route) || serverOnly.some((p) => routeMatches(route, p))) continue;
      drift.push({ side, id: route, why: `${side} never calls this route` });
    }
  }

  // Enums with the same name on both sides
  const web = webTypes();
  const swift = swiftTypes();
  for (const [name, { cases }] of swift.enums) {
    const webVals = web.unions.get(name);
    if (!webVals) continue;
    const iosVals = [...cases.values()];
    for (const v of webVals.filter((v) => !iosVals.includes(v))) {
      drift.push({ side: "ios", id: `enum ${name}: ${v}`, why: `iOS can't decode "${v}" — a whole response containing it fails` });
    }
    for (const v of iosVals.filter((v) => !webVals.includes(v))) {
      drift.push({ side: "web", id: `enum ${name}: ${v}`, why: `web doesn't know "${v}", which iOS can write` });
    }
  }

  // Struct fields
  for (const [name, { fields }] of swift.structs) {
    const webFields = web.interfaces.get(name);
    if (!webFields) continue;
    for (const [key, f] of fields) {
      const w = webFields.get(key);
      if (!f.optional && (!w || w.optional)) {
        drift.push({
          side: "ios",
          id: `field ${name}.${key}`,
          why: w
            ? `iOS requires it but web's type allows it to be missing or null`
            : `iOS requires it but web's ${name} has no such field`,
        });
      }
      const iosEnum = swift.enums.get(f.type);
      const values = w && iosEnum && !iosEnum.tolerant ? webValues(w.type, web.unions) : null;
      if (!values || values.name === f.type) continue; // same-name enums are checked above
      const iosVals = [...iosEnum.cases.values()];
      if (values === "open") {
        drift.push({ side: "ios", id: `field ${name}.${key}: any string`, why: `web treats it as any string; iOS enum ${f.type} fails on values it doesn't list` });
      } else {
        for (const v of values.values.filter((v) => !iosVals.includes(v))) {
          drift.push({ side: "ios", id: `field ${name}.${key}: ${v}`, why: `iOS enum ${f.type} can't decode "${v}"` });
        }
      }
    }
  }

  // Entitlements: every copy must agree exactly
  const ent = entitlementSources(swift.enums);
  const [refFile, refPlans] = Object.entries(ent.plans)[0];
  for (const [file, plans] of Object.entries(ent.plans).slice(1)) {
    for (const plan of new Set([...Object.keys(refPlans), ...Object.keys(plans)])) {
      if (!sameSet(refPlans[plan] ?? [], plans[plan] ?? [])) {
        hard.push(
          `entitlements: ${file} gives "${plan}" [${(plans[plan] ?? []).join(", ")}], ` +
            `${refFile} gives [${(refPlans[plan] ?? []).join(", ")}]`
        );
      }
    }
  }
  const [refLiveFile, refLive] = Object.entries(ent.live)[0];
  for (const [file, live] of Object.entries(ent.live)) {
    if (!live) hard.push(`entitlements: couldn't find the live-status set in ${file}; update scripts/parity.mjs`);
    else if (refLive && !sameSet(refLive, live)) {
      hard.push(`entitlements: ${file} treats [${live.join(", ")}] as live, ${refLiveFile} [${refLive.join(", ")}]`);
    }
  }

  // Sort drift into recorded / unrecorded, and catch stale records
  const unrecorded = [];
  const recorded = { web: { pending: [], skip: [] }, ios: { pending: [], skip: [] } };
  for (const d of drift) {
    const entry = manifest[d.side] ?? {};
    const status = d.id in (entry.pending ?? {}) ? "pending" : d.id in (entry.skip ?? {}) ? "skip" : null;
    if (status) recorded[d.side][status].push({ ...d, note: entry[status][d.id] });
    else unrecorded.push(d);
  }
  for (const side of ["web", "ios"]) {
    for (const status of ["pending", "skip"]) {
      for (const [id, note] of Object.entries(manifest[side]?.[status] ?? {})) {
        // Routes, enums and fields are detected, so their records can go stale.
        // Anything else ("ui: …", "logic: …") is a gap only a person can see.
        if (!/^(GET|POST|PUT|PATCH|DELETE) |^enum |^field /.test(id)) {
          recorded[side][status].push({ side, id, note });
        } else if (!drift.some((d) => d.side === side && d.id === id)) {
          hard.push(`parity.json ${side}.${status} "${id}" no longer differs; delete the entry`);
        }
      }
    }
  }
  return { unrecorded, recorded, hard };
}

// ── Report ───────────────────────────────────────────────────────────────────

const { unrecorded, recorded, hard } = findDrift();
const showBacklog = process.argv.includes("--backlog");

if (showBacklog) {
  for (const side of ["ios", "web"]) {
    for (const status of ["pending", "skip"]) {
      const items = recorded[side][status];
      if (!items.length) continue;
      console.log(`\n${side} ${status} (${items.length})`);
      for (const i of items) console.log(`  - ${i.id}${i.note ? `  — ${i.note}` : ""}`);
    }
  }
  console.log("");
}

for (const h of hard) console.log(`FAIL  ${h}`);
for (const d of unrecorded) console.log(`FAIL  ${d.side}  ${d.id}  — ${d.why}`);

const count = (side, status) => recorded[side][status].length;
const summary =
  `iOS: ${count("ios", "pending")} pending, ${count("ios", "skip")} skipped · ` +
  `web: ${count("web", "pending")} pending, ${count("web", "skip")} skipped`;

if (hard.length || unrecorded.length) {
  console.log(
    `\nparity: ${hard.length + unrecorded.length} problem(s). Port the change to the other client, or ` +
      `record the gap in ${MANIFEST} under <side>.pending (to do) or <side>.skip (with the reason).`
  );
  console.log(`(${summary})`);
  process.exit(1);
}
console.log(`parity: ok (${summary})${showBacklog ? "" : " — --backlog to list"}`);
