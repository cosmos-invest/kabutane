const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("assets/core-detail-fallback.js", "utf8");

const base = {
  records: {
    "5243": {
      code: "5243",
      ticker: "5243.T",
      name: "note",
      daily: [
        ["2026-08-01", 1000, 1030, 980, 1020, 100000],
        ["2026-08-04", 1020, 1080, 1010, 1070, 180000],
      ],
      monthly: [["2026-07", 48.1, 49.2]],
      cross_events: [{ type: "DC", month: "2026-07" }],
      record: { signal_month: "2026-07", status: "OUT", monthly_rsi14: 48.1, monthly_rsi_ma5: 49.2 },
    },
  },
};
const daily = {
  records: {
    "5243": {
      price_date: "2026-08-05",
      daily: [["2026-08-05", 1080, 1200, 1070, 1180, 500000]],
      technical: { current_price: 1180, price_date: "2026-08-05" },
      provisional_signal: { month: "2026-08", status: "GC", active: true, monthly_rsi14: 50.4, monthly_rsi_ma5: 49.8, spread: 0.6 },
    },
  },
};
const finance = {
  records: {
    "5243": { fundamentals_available: true, per: 30.2, pbr: 4.1, roe_pct: 12.3 },
  },
};

function response(payload, status = 200) {
  return new Response(payload === null ? "" : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeFetch(input) {
  const url = String(typeof input === "string" ? input : input.url);
  if (url.includes("data/charts/5243.json")) return response(null, 404);
  if (url.includes("data/daily/5243.json")) return response(null, 404);
  if (url.includes("data/charts/5942.json")) {
    return response({
      code: "5942",
      record: { status: "OUT", provisional_status: "GC", provisional_month: "2026-08" },
      provisional_signal: { month: "2026-08", status: "GC", active: true, monthly_rsi14: 55, monthly_rsi_ma5: 54 },
    });
  }
  if (url.includes("data/core/charts/52.json")) return response(base);
  if (url.includes("data/core/daily/52.json")) return response(daily);
  if (url.includes("data/core/fundamentals/52.json")) return response(finance);
  return response(null, 404);
}

const window = {
  fetch: fakeFetch,
  addEventListener() {},
  setTimeout() {},
  Chart: { getChart() { return null; } },
};
const document = {
  getElementById() { return null; },
};
const context = vm.createContext({ window, document, Response, Headers, URL, console, setTimeout });
vm.runInContext(source, context);

(async () => {
  const chartResponse = await window.fetch("data/charts/5243.json?v=1");
  if (!chartResponse.ok) throw new Error("fallback chart response is not ok");
  const chart = await chartResponse.json();
  if (chart.code !== "5243" || chart.name !== "note") throw new Error("fallback identity mismatch");
  if (!chart.core_universe_fallback) throw new Error("fallback marker is missing");
  if (chart.daily.at(-1).close !== 1180) throw new Error("latest daily overlay was not merged");
  if (chart.record.current_price !== 1180) throw new Error("technical current price was not merged");
  if (chart.record.per !== 30.2 || chart.record.roe_pct !== 12.3) throw new Error("fundamentals were not merged");
  if (chart.provisional_signal !== null) throw new Error("premium-only provisional GC leaked through fallback chart");
  if (chart.record.provisional_status) throw new Error("premium-only provisional status leaked through fallback record");

  const dailyResponse = await window.fetch("data/daily/5243.json?v=1");
  const overlay = await dailyResponse.json();
  if (!dailyResponse.ok || overlay.provisional_signal !== null) throw new Error("premium-only GC leaked through fallback daily overlay");
  if (overlay.record.per !== 30.2) throw new Error("daily fallback finance merge failed");

  const normalResponse = await window.fetch("data/charts/5942.json?v=1");
  const normal = await normalResponse.json();
  if (normal.provisional_signal !== null) throw new Error("premium-only GC leaked through normal detail payload");
  if (Object.prototype.hasOwnProperty.call(normal.record, "provisional_status")) throw new Error("normal detail record retained premium provisional status");

  const api = window.KabutaneCoreDetailFallback;
  if (!api || api.publicProvisional({ status: "GC" }) !== null) throw new Error("premium boundary helper is missing");
  if (api.publicProvisional({ status: "DC" })?.status !== "DC") throw new Error("public provisional DC should remain visible");

  console.log("core detail fallback + premium boundary: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
