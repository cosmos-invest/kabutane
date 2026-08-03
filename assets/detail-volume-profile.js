(() => {
  "use strict";

  const BIN_COUNT = 28;
  const VALUE_AREA_RATIO = 0.7;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatPrice(value) {
    return finite(value) === null ? "—" : `${Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}円`;
  }

  function formatVolume(value) {
    const number = finite(value);
    if (number === null) return "—";
    if (number >= 100000000) return `${(number / 100000000).toFixed(1)}億株`;
    if (number >= 10000) return `${(number / 10000).toFixed(1)}万株`;
    return `${Math.round(number).toLocaleString("ja-JP")}株`;
  }

  async function fetchJson(path, optional = false) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`${path} (${response.status})`);
    }
    return response.json();
  }

  function rowsByDate(...groups) {
    const merged = new Map();
    groups.flat().forEach((row) => {
      if (row?.date) merged.set(String(row.date), row);
    });
    return [...merged.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }

  function filterPeriod(rows, period) {
    if (period === "all" || !rows.length) return rows;
    const latest = new Date(`${rows.at(-1).date}T00:00:00`);
    const years = period === "1y" ? 1 : 3;
    const cutoff = new Date(latest);
    cutoff.setFullYear(cutoff.getFullYear() - years);
    return rows.filter((row) => new Date(`${row.date}T00:00:00`) >= cutoff);
  }

  function buildProfile(rows) {
    const valid = rows.filter((row) => {
      const high = finite(row.high);
      const low = finite(row.low);
      const volume = finite(row.volume);
      return high !== null && low !== null && volume !== null && volume > 0 && high >= low;
    });
    if (!valid.length) return null;

    const minimum = Math.min(...valid.map((row) => finite(row.low)));
    const maximum = Math.max(...valid.map((row) => finite(row.high)));
    if (!(maximum > minimum)) return null;
    const step = (maximum - minimum) / BIN_COUNT;
    const bins = Array.from({ length: BIN_COUNT }, (_, index) => ({
      index,
      low: minimum + step * index,
      high: minimum + step * (index + 1),
      volume: 0,
    }));

    valid.forEach((row) => {
      const low = finite(row.low);
      const high = finite(row.high);
      const volume = finite(row.volume);
      const first = Math.max(0, Math.min(BIN_COUNT - 1, Math.floor((low - minimum) / step)));
      const last = Math.max(first, Math.min(BIN_COUNT - 1, Math.floor((high - minimum) / step)));
      const allocation = volume / (last - first + 1);
      for (let index = first; index <= last; index += 1) bins[index].volume += allocation;
    });

    const total = bins.reduce((sum, bin) => sum + bin.volume, 0);
    const poc = bins.reduce((best, bin) => (bin.volume > best.volume ? bin : best), bins[0]);
    const selected = new Set([poc.index]);
    let accumulated = poc.volume;
    let lower = poc.index - 1;
    let upper = poc.index + 1;
    while (accumulated < total * VALUE_AREA_RATIO && (lower >= 0 || upper < bins.length)) {
      const lowerVolume = lower >= 0 ? bins[lower].volume : -1;
      const upperVolume = upper < bins.length ? bins[upper].volume : -1;
      if (upperVolume >= lowerVolume) {
        selected.add(upper);
        accumulated += bins[upper].volume;
        upper += 1;
      } else {
        selected.add(lower);
        accumulated += bins[lower].volume;
        lower -= 1;
      }
    }
    const selectedBins = bins.filter((bin) => selected.has(bin.index));
    return {
      bins,
      total,
      poc,
      valueLow: Math.min(...selectedBins.map((bin) => bin.low)),
      valueHigh: Math.max(...selectedBins.map((bin) => bin.high)),
      maxVolume: Math.max(...bins.map((bin) => bin.volume)),
      firstDate: valid[0].date,
      lastDate: valid.at(-1).date,
    };
  }

  function positionLabel(price, profile) {
    if (price === null) return "現在値を取得できません";
    if (price > profile.valueHigh) return "商いの中心帯より上";
    if (price < profile.valueLow) return "商いの中心帯より下";
    return "商いの中心帯の中";
  }

  function render(profile, currentPrice) {
    const chart = document.getElementById("volumeProfileChart");
    const stats = document.getElementById("volumeProfileStats");
    const note = document.getElementById("volumeProfileSummary");
    if (!chart || !stats || !note) return;
    if (!profile) {
      chart.innerHTML = '<p class="volume-profile-empty">価格帯別出来高を計算できる日足データがありません。</p>';
      stats.innerHTML = "";
      note.textContent = "日足の高値・安値・出来高が揃った後に表示されます。";
      return;
    }

    chart.innerHTML = "";
    [...profile.bins].reverse().forEach((bin) => {
      const row = document.createElement("div");
      row.className = "volume-profile-row";
      if (bin.index === profile.poc.index) row.classList.add("is-poc");
      if (bin.low >= profile.valueLow && bin.high <= profile.valueHigh) row.classList.add("is-value-area");
      const width = profile.maxVolume > 0 ? Math.max(1.5, (bin.volume / profile.maxVolume) * 100) : 0;
      row.innerHTML = `
        <span class="volume-profile-price">${formatPrice(bin.low)}–${formatPrice(bin.high)}</span>
        <span class="volume-profile-track"><span class="volume-profile-bar" style="width:${width.toFixed(2)}%"></span></span>
        <span class="volume-profile-volume">${formatVolume(bin.volume)}</span>`;
      chart.appendChild(row);
    });

    const cards = [
      ["推定POC", `${formatPrice(profile.poc.low)}–${formatPrice(profile.poc.high)}`],
      ["70%バリューエリア", `${formatPrice(profile.valueLow)}–${formatPrice(profile.valueHigh)}`],
      ["現在値の位置", positionLabel(currentPrice, profile)],
      ["集計期間", `${profile.firstDate}〜${profile.lastDate}`],
    ];
    stats.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
    note.textContent = currentPrice === null
      ? "価格の集中帯は、支持・抵抗を考えるための参考情報です。"
      : `現在値 ${formatPrice(currentPrice)} は「${positionLabel(currentPrice, profile)}」です。集中帯を抜けた事実だけで売買を決めず、トレンド・出来高増減・損切り位置と一緒に確認してください。`;
  }

  async function load(period = "1y") {
    const code = new URLSearchParams(location.search).get("code")?.trim();
    if (!code) return;
    const status = document.getElementById("volumeProfileStatus");
    try {
      status.textContent = "計算中…";
      const [base, overlay] = await Promise.all([
        fetchJson(`data/charts/${encodeURIComponent(code)}.json`),
        fetchJson(`data/daily/${encodeURIComponent(code)}.json`, true),
      ]);
      const rows = filterPeriod(rowsByDate(base?.daily || [], overlay?.daily || []), period);
      const currentPrice = finite(overlay?.record?.current_price ?? base?.record?.current_price ?? rows.at(-1)?.close);
      render(buildProfile(rows), currentPrice);
      status.textContent = `${period === "all" ? "全期間" : period === "1y" ? "直近1年" : "直近3年"}・${rows.length.toLocaleString("ja-JP")}営業日`;
    } catch (error) {
      status.textContent = "読込失敗";
      const chart = document.getElementById("volumeProfileChart");
      if (chart) chart.innerHTML = `<p class="volume-profile-empty">価格帯別出来高を読み込めませんでした。<br>${String(error.message || error)}</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = [...document.querySelectorAll("[data-volume-profile-period]")];
    buttons.forEach((button) => button.addEventListener("click", () => {
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      load(button.dataset.volumeProfilePeriod);
    }));
    load("1y");
  });
})();
