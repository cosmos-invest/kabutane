const assert = require("node:assert/strict");
const History = require("../assets/practice-history-core.js");

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const storage = new MemoryStorage();
History.add({ id: "a", savedAt: "2026-07-20", totalProfit: 1000, outcome: "target", ruleAchieved: 5, ruleTotal: 6 }, storage);
History.add({ id: "b", savedAt: "2026-07-21", totalProfit: -500, outcome: "stop", ruleAchieved: 6, ruleTotal: 6 }, storage);
assert.equal(History.read(storage).length, 2);
assert.equal(History.read(storage)[0].id, "b");
assert.deepEqual(History.summary(History.read(storage)), { total: 2, profits: 1, stops: 1, ruleRate: 11 / 12 * 100 });

const exported = History.exportText(History.read(storage));
const second = new MemoryStorage();
History.importText(exported, second);
assert.equal(History.read(second).length, 2);
History.remove("a", second);
assert.equal(History.read(second).length, 1);
History.clear(second);
assert.equal(History.read(second).length, 0);

console.log("practice history core tests passed");
