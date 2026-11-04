#!/usr/bin/env node
// Asks the test runners how many tests exist and fails if the numbers the site
// states have drifted from them. Run from the repository root after a build.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = (command, cwd = ".") => execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const cargoTests = (command, cwd) => run(command, cwd).split("\n").filter((line) => line.endsWith(": test")).length;

const actual = {
  contractUnitTests: cargoTests("cargo test -p lien-agent --lib -- --list"),
  sandboxTests: cargoTests("cargo test --release -p lien-integration-tests --test lifecycle -- --list"),
  agentTests: cargoTests("cargo test -- --list", "agents/sentinel"),
  webTests: run("npx vitest list", "web").split("\n").filter((line) => line.includes(" > ")).length,
};

const stated = Object.fromEntries(
  [...readFileSync("web/src/lib/facts.ts", "utf8").matchAll(/(\w+): (\d+),/g)].map((match) => [match[1], Number(match[2])]),
);

let failed = false;
for (const [key, value] of Object.entries(actual)) {
  const ok = stated[key] === value;
  console.log(`${ok ? "ok  " : "FAIL"} ${key}: stated ${stated[key]}, counted ${value}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
