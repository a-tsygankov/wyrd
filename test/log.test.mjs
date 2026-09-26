import assert from "node:assert/strict";
import test from "node:test";
import { createLog } from "../dist/apps/web/src/log.js";

test("the client log is a ring buffer that keeps the newest entries", () => {
    const sink = [];
    const log = createLog({ capacity: 3, now: () => 1000, sink: entry => sink.push(entry) });
    log.info("a");
    log.info("b", { x: 1 });
    log.warn("c");
    log.error("d");
    const entries = log.entries();
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(e => e.message), ["b", "c", "d"]);
    assert.deepEqual(entries.map(e => e.level), ["info", "warn", "error"]);
    assert.deepEqual(entries[0].data, { x: 1 });
    assert.equal(entries[0].ts, 1000);
    assert.equal(sink.length, 4, "every entry is mirrored to the sink (console)");
});

test("subscribers are told about each new entry", () => {
    const log = createLog({ capacity: 10, now: () => 0, sink: () => undefined });
    const seen = [];
    const unsubscribe = log.subscribe(entry => seen.push(entry.message));
    log.info("one");
    unsubscribe();
    log.info("two");
    assert.deepEqual(seen, ["one"]);
});
