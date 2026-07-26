const assert = require("node:assert/strict");
const Viewport = require("../assets/detail-chart-viewport-core.js");

assert.deepEqual(Viewport.normalizeRange(100, 90, 99, 12), { start: 88, end: 99, span: 12 });
assert.deepEqual(Viewport.latestRange(100, 30, 12), { start: 70, end: 99, span: 30 });
assert.deepEqual(Viewport.panRange({ start: 70, end: 99 }, -20, 100, 12), { start: 50, end: 79, span: 30 });
assert.deepEqual(Viewport.panRange({ start: 70, end: 99 }, 20, 100, 12), { start: 70, end: 99, span: 30 });

const zoomed = Viewport.zoomRange({ start: 40, end: 79 }, 0.5, 60, 100, 12);
assert.equal(zoomed.span, 20);
assert.ok(zoomed.start <= 60 && zoomed.end >= 60);

const zoomedOut = Viewport.zoomRange(zoomed, 2, 60, 100, 12);
assert.equal(zoomedOut.span, 40);
assert.ok(zoomedOut.start <= 60 && zoomedOut.end >= 60);

const bounds = Viewport.verticalBounds([100, 110, 120], 1, 0, 0.05);
assert.ok(bounds.min < 100);
assert.ok(bounds.max > 120);
const tighter = Viewport.verticalBounds([100, 110, 120], 0.5, 0, 0.05);
assert.ok((tighter.max - tighter.min) < (bounds.max - bounds.min));

const payload = { daily: Array.from({ length: 20 }, (_, index) => ({ date: `d${index}`, close: index })) };
const sliced = Viewport.slicePayload(payload, { start: 5, end: 9 });
assert.equal(sliced.daily.length, 12);
assert.equal(sliced.daily[0].date, "d5");
assert.equal(sliced.daily.at(-1).date, "d16");
assert.equal(sliced.viewport.span, 12);
assert.equal(Viewport.nextHeightMode("compact"), "standard");
assert.equal(Viewport.nextHeightMode("standard"), "tall");
assert.equal(Viewport.nextHeightMode("tall"), "compact");

console.log("detail chart viewport tests passed");
