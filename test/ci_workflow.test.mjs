import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The E2E job runs inside Microsoft's Playwright image so the browsers and
// their system packages come preinstalled: `playwright install --with-deps`
// took 1 to 16 minutes on a runner, most of it apt. The image's browsers only
// match the test runner of the same version, so the tag must follow the
// lockfile whenever @playwright/test is bumped.

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
/** The workflow without its comments, so a comment explaining a removed command does not count as the command. */
const commands = workflow.split(/\r?\n/).filter(line => !line.trim().startsWith("#")).join("\n");
const lock = readFileSync("pnpm-lock.yaml", "utf8");

test("the E2E job's Playwright image matches the locked @playwright/test version", () => {
    const locked = lock.match(/'@playwright\/test@(\d+\.\d+\.\d+)'/)?.[1];
    assert.ok(locked, "@playwright/test not found in pnpm-lock.yaml");
    const images = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-\w+/g)].map(m => m[1]);
    assert.ok(images.length > 0, "the E2E job does not run in the Playwright image");
    for (const tag of images) assert.equal(tag, locked, `image v${tag} but the lockfile has ${locked}: bump the image tag in deploy.yml`);
    assert.ok(!/playwright install --with-deps/.test(commands), "the image already has the browsers; installing them again costs minutes");
});

test("the E2E job is split by device and shard so each runner takes a quarter of the suite", () => {
    // One worker per runner: two browsers on one runner timed out clicks under load (2026-09-30),
    // so the parallelism comes from separate runners instead.
    assert.match(workflow, /project:\s*\[\s*webkit\s*,\s*chromium\s*\]/);
    assert.match(workflow, /shard:\s*\[\s*1\s*,\s*2\s*\]/);
    assert.match(workflow, /pnpm test:e2e --project=\$\{\{ matrix\.project \}\} --shard=\$\{\{ matrix\.shard \}\}\/2/);
});
