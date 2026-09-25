#!/usr/bin/env node
// Claude Code Stop hook: keeps web/ and ios/ moving together (see "Web and iOS
// are two clients" in CLAUDE.md).
//
// Before Claude stops, if this session's work changed one client and not the
// other, or left `npm run parity` failing, Claude is sent back once to port the
// change or record the gap in parity.json. It asks at most once per finding per
// session — a later stop in the same session goes through, and so does the
// immediate retry (stop_hook_active) — so a change with no counterpart on the
// other platform (styling, PWA plumbing) costs Claude one sentence, not a loop.
//
// "This session's work" is the uncommitted tree plus commits on this branch that
// main doesn't have. Any failure in here exits 0: a broken hook must never wedge
// a session.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOWN_FILES = 8;

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function changedFiles() {
  const base = git("merge-base", "HEAD", "main").trim();
  const lists = [git("diff", "--name-only", "HEAD"), git("ls-files", "--others", "--exclude-standard")];
  if (base) lists.push(git("diff", "--name-only", base, "HEAD"));
  return [...new Set(lists.join("\n").split("\n").map((f) => f.trim()).filter(Boolean))];
}

const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.startsWith("web/src/test/");
const isWeb = (f) => f.startsWith("web/src/") && !isTest(f);
const isIos = (f) => f.startsWith("ios/Fitnofat/Sources/");
const isApi = (f) => /^(server|accounts)\/src\//.test(f) && !isTest(f);

function list(files) {
  const shown = files.slice(0, SHOWN_FILES).map((f) => `  ${f}`);
  if (files.length > SHOWN_FILES) shown.push(`  …and ${files.length - SHOWN_FILES} more`);
  return shown.join("\n");
}

function oneSided(changed, missing, files) {
  const other = missing === "iOS" ? "ios/Fitnofat" : "web/src";
  const side = missing === "iOS" ? "ios" : "web";
  return (
    `This session changed the ${changed} client but not ${missing}:\n${list(files)}\n` +
    `If the change affects what a user can do or see, or what data the app sends or ` +
    `accepts, port it to ${other} (the port-feature skill has the file map), or record it ` +
    `in parity.json under ${side}.pending as "ui: …" or "logic: …". If it has no ${missing} ` +
    `counterpart (styling, PWA plumbing, a ${changed}-only bug), say so in one line and stop.`
  );
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    /* no stdin: run with defaults */
  }
  if (input.stop_hook_active) return;

  const files = changedFiles();
  const web = files.filter(isWeb);
  const ios = files.filter(isIos);
  const manifestTouched = files.includes("parity.json");
  if (!web.length && !ios.length && !manifestTouched && !files.some(isApi)) return;

  const findings = [];
  const check = spawnSync(process.execPath, [join(ROOT, "scripts", "parity.mjs")], { cwd: ROOT, encoding: "utf8" });
  if (check.status !== 0) {
    const output = `${check.stdout ?? ""}${check.stderr ?? ""}`.trim();
    findings.push({
      key: `parity:${output}`,
      text: `npm run parity fails, and CI runs the same check:\n${output}`,
    });
  }
  if (!manifestTouched && web.length && !ios.length) findings.push({ key: "web-only", text: oneSided("web", "iOS", web) });
  if (!manifestTouched && ios.length && !web.length) findings.push({ key: "ios-only", text: oneSided("iOS", "web", ios) });

  // Only raise each finding once per session.
  const stateFile = join(tmpdir(), `claude-parity-${String(input.session_id ?? "none").replace(/\W/g, "")}.json`);
  let seen = [];
  try {
    seen = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* first stop this session */
  }
  const fresh = findings.filter((f) => !seen.includes(f.key));
  if (!fresh.length) return;
  try {
    writeFileSync(stateFile, JSON.stringify([...seen, ...fresh.map((f) => f.key)]));
  } catch {
    /* worst case we ask again next stop */
  }

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `Web ⇄ iOS parity (CLAUDE.md):\n\n${fresh.map((f) => f.text).join("\n\n")}`,
    })
  );
}

try {
  main();
} catch {
  /* never block a session on a hook bug */
}
