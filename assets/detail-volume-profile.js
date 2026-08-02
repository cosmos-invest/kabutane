(function (global) {
  "use strict";

  const PROFILE_VERSION = "estimated_daily_range_v1";
  const DEFAULT_LOOKBACK = 120;
  const BIN_COUNT = 20;
  const VALUE_AREA_RATIO = 0.7;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value, digits = 0) {
    const number = finite(value);
    return number === null ? "—" : number.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function formatPrice(value) {
    const number = finite(value);
    if (number === null) return "—";
    const digits = Math.abs(number) < 100 ? 2 : Math.abs(number) < 1000 ? 1 : 0;
    return number.toLocaleString("ja-JP", { maximumFractionDigits: digits });
  }

  function mergeRows(baseRows, overlayRows) {
    const byDate = new Map();
    for (const row of [...(baseRows || []), ...(overlayRows || [])]) {
      const date = String(row?.date || "").trim();
      if (!date) continue;
      byDate.set(date, { ...row, date });
    }
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function validProfileRows(rows, lookback) {
    return (rows || [])
      .filter((row) => {
        const low = finite(row?.low);
        const high = finite(row?.high);
        const volume = finite(row?.volume);
        return low !== null && high !== null && high >= low && volume !== null && volume > 0;
      })
      .slice(-Math.max(1, Number(lookback) || DEFAULT_LOOKBACK));
  }

  function buildValueArea(bins, pocIndex, totalVolume, ratio = VALUE_AREA_RATIO) {
    if (!bins.length || pocIndex < 0 || totalVolume <= 0) return null;
    const target = totalVolume * ratio;
    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    let accumulated = bins[pocIndex].volume;

    while (accumulated < target && (lowIndex > 0 || highIndex < bins.length - 1)) {
      const below = lowIndex > 0 ? bins[lowIndex - 1].volume : -1;
      const above = highIndex < bins.length - 1 ? bins[highIndex + 1].volume : -1;
      if (above >= below && highIndex < bins.length - 1) {
        highIndex += 1;
        accumulated += bins[highIndex].volume;
      } else if (lowIndex > 0) {
        lowIndex -= 1;
        accumulated += bins[lowIndex].volume;
      } else {
        break;
      }
    }

    return {
      lowIndex,
      highIndex,
      low: bins[lowIndex].low,
      high: bins[highIndex].high,
      volume: accumulated,
      ratio: totalVolume ? accumulated / totalVolume : 0,
    };
  }

  function buildProfile(rows, options = {}) {
    const lookback = Math.max(1, Number(options.lookback) || DEFAULT_LOOKBACK);
    const binCount = Math.max(8, Number(options.binCount) || BIN_COUNT);
    const selected = validProfileRows(rows, lookback);
    if (!selected.length) return null;

    const minPrice = Math.min(...selected.map((row) => finite(row.low)));
    const maxPrice = Math.max(...selected.map((row) => finite(row.high)));
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return null;

    const span = Math.max(maxPrice - minPrice, Math.max(Math.abs(maxPrice), 1) * 0.001);
    const step = span / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({
      index,
      low: minPrice + step * index,
      high: index === binCount - 1 ? maxPrice : minPrice + step * (index + 1),
      volume: 0,
    }));

    let inputVolume = 0;
    for (const row of selected) {
      const low = finite(row.low);
      const high = finite(row.high);
      const volume = finite(row.volume);
      if (low === null || high === null || volume === null || volume <= 0) continue;
      inputVolume += volume;

      if (high <= low) {
        const close = finite(row.close) ?? low;
        const index = Math.max(0, Math.min(binCount - 1, Math.floor((close - minPrice) / step)));
        bins[index].volume += volume;
        continue;
      }

      const range = high - low;
      for (const bin of bins) {
        const overlap = Math.max(0, Math.min(high, bin.high) - Math.max(low, bin.low));
        if (overlap > 0) bin.volume += volume * (overlap / range);
      }
    }

    const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
    if (totalVolume <= 0) return null;
    let pocIndex = 0;
    for (let index = 1; index < bins.length; index += 1) {
      if (bins[index].volume > bins[pocIndex].volume) pocIndex = index;
    }
    const maxBinVolume = bins[pocIndex].volume;
    for (const bin of bins) {
      bin.share = totalVolume ? bin.volume / totalVolume : 0;
      bin.relative = maxBinVolume ? bin.volume / maxBinVolume : 0;
    }

    const currentPrice = finite(selected[selected.length - 1]?.close);
    const valueArea = buildValueArea(bins, pocIndex, totalVolume);
    return {
      version: PROFILE_VERSION,
      method: "daily_high_low_range_weighted",
      lookback,
      binCount,
      rowCount: selected.length,
      startDate: selected[0]?.date || null,
      endDate: selected[selected.length - 1]?.date || null,
      currentPrice,
      minPrice,
      maxPrice,
      inputVolume,
      totalVolume,
      bins,
      pocIndex,
      poc: bins[pocIndex],
      valueArea,
    };
  }

  function pricePosition(profile) {
    const current = finite(profile?.currentPrice);
    const area = profile?.valueArea;
    if (current === null || !area) return "unknown";
    if (current > area.high) return "above";
    if (current < area.low) return "below";
    return "inside";
  }

  function observationText(profile) {
    const position = pricePosition(profile);
    if (position === "above") {
      return "現在値は主要な出来高集中帯より上です。押したときに、この価格帯が支持候補として機能するかを観察できます。";
    }
    if (position === "below") {
      return "現在値は主要な出来高集中帯より下です。戻る場面では、この価格帯が上値抵抗にならないかを観察できます。";
    }
    if (position === "inside") {
      return "現在値は主要な出来高集中帯の中です。過去に売買が重なった価格帯なので、買い手と売り手の攻防が起きやすい場所として観察できます。";
    }
    return "価格帯別出来高は、過去に売買が集中した価格帯を見つける補助材料として使います。";
  }

  function currentBinIndex(profile) {
    const current = finite(profile?.currentPrice);
    if (current === null || !profile?.bins?.length) return -1;
    return profile.bins.findIndex((bin, index) => {
      const isLast = index === profile.bins.length - 1;
      return current >= bin.low && (current < bin.high || (isLast && current <= bin.high));
    });
  }

  async function fetchJson(path, optional = false) {
    try {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (optional) return null;
      throw error;
    }
  }

  function createSection() {
    let section = document.getElementById("volumeProfileSection");
    if (section) return section;
    const priceSection = document.getElementById("priceChartSection") || document.getElementById("priceChart")?.closest("section");
    if (!priceSection) return null;
    section = document.createElement("section");
    section.id = "volumeProfileSection";
    section.className = "panel volume-profile-panel";
    section.innerHTML = `
      <div class="section-heading volume-profile-heading">
        <div>
          <div class="volume-profile-title-line"><h2>価格帯別出来高</h2><span class="volume-profile-estimated-badge">推定</span></div>
          <p>日足の高値〜安値へ当日の出来高を配分し、売買が厚かった価格帯を推定します。</p>
        </div>
        <div class="volume-profile-periods" role="group" aria-label="価格帯別出来高の集計期間">
          <button type="button" data-volume-lookback="60">3か月</button>
          <button type="button" data-volume-lookback="120" class="active">6か月</button>
          <button type="button" data-volume-lookback="250">1年</button>
        </div>
      </div>
      <div class="volume-profile-summary" id="volumeProfileSummary" aria-live="polite"></div>
      <div class="volume-profile-chart" id="volumeProfileChart"></div>
      <div class="volume-profile-observation" id="volumeProfileObservation"></div>
      <p class="volume-profile-disclosure">※ 約定価格ごとの実出来高ではありません。無料の日足OHLCVを使った推定値です。売買判断を断定する指標ではなく、支持・抵抗候補を探す観察材料として利用してください。</p>
    `;
    priceSection.insertAdjacentElement("afterend", section);
    return section;
  }

  function renderProfile(section, rows, lookback) {
    const profile = buildProfile(rows, { lookback });
    const summary = section.querySelector("#volumeProfileSummary");
    const chart = section.querySelector("#volumeProfileChart");
    const observation = section.querySelector("#volumeProfileObservation");
    if (!profile) {
      summary.innerHTML = "";
      chart.innerHTML = '<p class="volume-profile-empty">価格帯別出来高を計算できる日足データがありません。</p>';
      observation.innerHTML = "";
      return null;
    }

    const area = profile.valueArea;
    summary.innerHTML = `
      <article><span>集計</span><strong>${profile.rowCount}営業日</strong><small>${profile.startDate || "—"} → ${profile.endDate || "—"}</small></article>
      <article><span>最大出来高帯</span><strong>${formatPrice(profile.poc.low)}〜${formatPrice(profile.poc.high)}円</strong><small>POC相当・推定</small></article>
      <article><span>主要出来高帯</span><strong>${formatPrice(area?.low)}〜${formatPrice(area?.high)}円</strong><small>推定出来高の約${Math.round((area?.ratio || 0) * 100)}%</small></article>
      <article><span>現在値</span><strong>${formatPrice(profile.currentPrice)}円</strong><small>${pricePosition(profile) === "above" ? "主要帯より上" : pricePosition(profile) === "below" ? "主要帯より下" : "主要帯の中"}</small></article>
    `;

    const currentIndex = currentBinIndex(profile);
    chart.innerHTML = [...profile.bins].reverse().map((bin) => {
      const isPoc = bin.index === profile.pocIndex;
      const isCurrent = bin.index === currentIndex;
      const inValueArea = area && bin.index >= area.lowIndex && bin.index <= area.highIndex;
      const classes = ["volume-profile-row", isPoc ? "is-poc" : "", isCurrent ? "is-current" : "", inValueArea ? "is-value-area" : ""].filter(Boolean).join(" ");
      const width = Math.max(1.5, bin.relative * 100);
      return `
        <div class="${classes}">
          <span class="volume-profile-price">${formatPrice(bin.low)}〜${formatPrice(bin.high)}</span>
          <span class="volume-profile-track"><span class="volume-profile-bar" style="width:${width.toFixed(2)}%"></span></span>
          <span class="volume-profile-share">${(bin.share * 100).toFixed(1)}%</span>
          ${isPoc ? '<span class="volume-profile-tag">最大</span>' : isCurrent ? '<span class="volume-profile-tag current">現在</span>' : '<span class="volume-profile-tag"></span>'}
        </div>
      `;
    }).join("");

    observation.innerHTML = `<strong>🌱 見方</strong><p>${observationText(profile)}</p><p>最大出来高帯だけでなく、その上下に厚い帯が連続しているかも一緒に確認すると、価格の「居心地がよかった場所」を把握しやすくなります。</p>`;
    return profile;
  }

  async function init() {
    if (typeof document === "undefined") return;
    const code = new URLSearchParams(global.location?.search || "").get("code")?.trim() || "";
    if (!code) return;
    const section = createSection();
    if (!section) return;

    const chart = section.querySelector("#volumeProfileChart");
    chart.innerHTML = '<p class="volume-profile-empty">価格帯別出来高を計算しています…</p>';
    try {
      const [base, overlay] = await Promise.all([
        fetchJson(`data/charts/${encodeURIComponent(code)}.json`),
        fetchJson(`data/daily/${encodeURIComponent(code)}.json`, true),
      ]);
      const rows = mergeRows(base?.daily || [], overlay?.daily || []);
      let lookback = DEFAULT_LOOKBACK;
      renderProfile(section, rows, lookback);
      section.querySelectorAll("[data-volume-lookback]").forEach((button) => {
        button.addEventListener("click", () => {
          lookback = Number(button.dataset.volumeLookback) || DEFAULT_LOOKBACK;
          section.querySelectorAll("[data-volume-lookback]").forEach((item) => item.classList.toggle("active", item === button));
          renderProfile(section, rows, lookback);
        });
      });
    } catch (error) {
      chart.innerHTML = '<p class="volume-profile-empty">価格帯別出来高の読込に失敗しました。日足チャートはそのまま利用できます。</p>';
      console.warn("Kabutane volume profile unavailable", error);
    }
  }

  const api = {
    PROFILE_VERSION,
    DEFAULT_LOOKBACK,
    BIN_COUNT,
    mergeRows,
    buildProfile,
    buildValueArea,
    pricePosition,
    observationText,
    currentBinIndex,
    renderProfile,
    init,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.KabutaneVolumeProfileV1 = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
