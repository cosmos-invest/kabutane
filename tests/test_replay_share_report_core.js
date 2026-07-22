const assert = require("node:assert/strict");
const Core = require("../assets/replay-share-report-core.js");

const snapshot = Core.createSnapshot({
  payload: { name: "テスト工業", code: "1234.T" },
  rows: [
    { date: "2026-01-05", close: 1000 },
    { date: "2026-01-06", close: 1050 },
    { date: "2026-01-07", close: 1040 },
  ],
  startIndex: 0,
  cursor: 2,
  account: { fees: 120, shares: 0 },
  initialCapital: 1000000,
  maxDrawdown: -4,
  trades: [
    { type: "BUY", memo: "出来高を確認", date: "2026-01-05", price: 1000 },
    { type: "BUY", memo: "分割買い", date: "2026-01-05", price: 990 },
    { type: "SELL", memo: "ルール通り部分利確", date: "2026-01-06", price: 1050 },
    { type: "SELL", memo: "全決済", date: "2026-01-07", price: 1040 },
  ],
  plan: { activeStop: 950, ratios: [2, 3, 4, 5], ladder: { plannedLoss: 5000 } },
  metrics: { totalReturn: 5, totalProfit: 50000, totalValue: 1050000, averagePrice: 1000 },
  url: "https://cosmos-invest.github.io/kabutane/replay.html?code=1234",
});

assert.equal(snapshot.code, "1234");
assert.equal(snapshot.score, 69);
assert.equal(snapshot.learning, "全決済");
assert.equal(snapshot.reportMessageLabel, "今回の学び");
assert.equal(snapshot.series.length, 3);
assert.equal(snapshot.tradeMarkers.length, 3);
assert.equal(snapshot.tradeMarkers[0].label, "買×2");
assert.equal(snapshot.tradeMarkers[1].label, "売1");
assert.equal(snapshot.tradeMarkers[2].label, "売2");
assert.equal(snapshot.tradeMarkers[0].price, 995);

assert.equal(Core.xWeightedLength("A"), 1);
assert.equal(Core.xWeightedLength("あ"), 2);
assert.equal(Core.xWeightedLength("🌱"), 2);
assert.equal(Core.xWeightedLength("https://example.com/a/very/long/path"), 23);
assert.equal(Core.shortDate("2026-01-05"), "1/5");
assert.deepEqual(Core.normalizeHandles("cosmos_note @_cosmos_note invalid!"), ["@cosmos_note", "@_cosmos_note"]);

const xPost = Core.buildXPost(snapshot);
assert.equal(xPost.valid, true);
assert.ok(xPost.weightedLength <= Core.X_MAX_WEIGHTED_LENGTH);
assert.match(xPost.combined, /無料で試せます/);
assert.match(xPost.combined, /#かぶたね/);
assert.match(xPost.combined, /kabutane\/replay\.html/);
assert.doesNotMatch(xPost.combined, /今回の学び/);

const mentioned = Core.buildXPost(snapshot, { includeHandles: true, handles: "@_cosmos_note" });
assert.match(mentioned.combined, /@_cosmos_note/);
assert.equal(mentioned.valid, true);

const threads = Core.buildThreadsPost(snapshot);
assert.match(threads.combined, /買い方・売り方が分からない/);
assert.match(threads.combined, /無料のかぶたね/);
const note = Core.buildNotePost(snapshot);
assert.match(note.combined, /実際のお金を動かす前/);
assert.match(note.combined, /今回の振り返り：全決済/);

const emptyMemoSnapshot = Core.createSnapshot({
  payload: { name: "メモなし", code: "9999" },
  rows: [{ date: "2026-02-01", close: 100 }, { date: "2026-02-02", close: 101 }],
  startIndex: 0,
  cursor: 1,
  trades: [],
  metrics: {},
});
assert.equal(emptyMemoSnapshot.learning, "");
assert.equal(emptyMemoSnapshot.reportMessageLabel, "かぶたねでできること");
assert.match(emptyMemoSnapshot.reportMessage, /何度でも練習/);

assert.equal(Core.fileName(snapshot, "wide"), "kabutane-1234-20260107-wide.png");
assert.equal(Core.riskScore(20, -5), 83);
assert.equal(Core.riskScore(-100, -50), 0);

console.log("replay share report core tests passed");
