function stopPlayback() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  els.playButton.textContent = "▶ 再生";
}

function advanceOne() {
  if (state.ended || state.cursor >= state.rows.length - 1) return false;
  state.cursor += 1;
  processAutomaticOrders(currentRow());
  if (state.cursor >= state.rows.length - 1) stopPlayback();
  return true;
}

function advance(days = 1) {
  for (let count = 0; count < days; count += 1) {
    if (!advanceOne()) break;
  }
  renderAll();
}

function togglePlayback() {
  if (state.timer) { stopPlayback(); return; }
  const speed = Number(els.playSpeed.value) || 500;
  els.playButton.textContent = "⏸ 一時停止";
  state.timer = setInterval(() => {
    if (!advanceOne()) stopPlayback();
    renderAll();
  }, speed);
}

function finishSession() {
  stopPlayback();
  state.ended = true;
  const metrics = ReplayPro.accountMetrics(state.account, currentRow().close, state.initialCapital);
  els.sessionState.textContent = "練習終了";
  els.finishSummary.hidden = false;
  els.finishSummary.innerHTML = `<h3>今回の結果</h3><p><strong class="${performanceClass(metrics.totalProfit)}">${yen(metrics.totalProfit)}（${percent(metrics.totalReturn)}）</strong></p><p>購入${state.trades.filter((trade) => trade.type === "BUY").length}回、売却${state.trades.filter((trade) => trade.type === "SELL").length}回、手数料${yen(state.account.fees)}。終了時保有${state.account.shares.toLocaleString("ja-JP")}株。</p><p>TP設定：${state.plan.ratios.map((ratio) => `${ratio.toFixed(1)}R`).join(" / ")}、最大ドローダウン${percent(state.maxDrawdown)}。</p>`;
  renderAll();
  els.finishSummary.scrollIntoView({ behavior: "smooth", block: "center" });
}

function chooseStartIndex() {
  const minIndex = Math.min(240, Math.max(0, state.rows.length - 80));
  const maxIndex = Math.max(minIndex, state.rows.length - 50);
  if (els.startMode.value === "date" && els.startDate.value) {
    const found = state.rows.findIndex((row) => row.date >= els.startDate.value);
    return ReplayPro.clamp(found >= 0 ? found : minIndex, minIndex, maxIndex);
  }
  return minIndex + Math.floor(Math.random() * (maxIndex - minIndex + 1));
}

function resetPlanPrices() {
  const row = currentRow();
  if (!row) return;
  els.entryPrice.value = Number(row.close).toFixed(2);
  els.stopPrice.value = Number(row.close * 0.95).toFixed(2);
  state.plan.armed = false;
  recalculatePlan();
}

function startSession() {
  if (state.rows.length < 80) { els.setupNotice.textContent = "練習に必要な日足データが不足しています。"; return; }
  const assets = Number(els.totalAssets.value);
  const allocation = Number(els.allocationPct.value);
  const risk = Number(els.riskPct.value);
  if (!Number.isFinite(assets) || assets < 100000) { els.setupNotice.textContent = "保有資産額を10万円以上で入力してください。"; return; }
  if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) { els.setupNotice.textContent = "配分割合を1〜100%で入力してください。"; return; }
  if (!Number.isFinite(risk) || risk <= 0 || risk > 20) { els.setupNotice.textContent = "許容損失を0.1〜20%で入力してください。"; return; }
  stopPlayback();
  state.initialCapital = assets;
  state.allocationPct = allocation;
  state.riskPct = risk;
  state.lotSize = Number(els.lotSize.value);
  state.costBps = Number(els.costBps.value);
  state.startIndex = chooseStartIndex();
  state.cursor = state.startIndex;
  state.account = { cash: assets, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 };
  state.availableSlots = ReplayPro.MAX_SLOTS;
  state.trades = [];
  state.buySequence = 0;
  state.sellSequence = 0;
  state.peakValue = assets;
  state.maxDrawdown = 0;
  state.ended = false;
  state.plan.armed = false;
  state.plan.entryDate = null;
  state.plan.hitTargets = [false, false, false, false];
  state.plan.initialAutoShares = 0;
  resetPlanPrices();
  els.setupPanel.hidden = true;
  els.practiceArea.hidden = false;
  els.finishSummary.hidden = true;
  els.sessionState.textContent = "練習中";
  message("チャートをクリックしてエントリーと損切りを置くか、数値を入力してください。未来の足は隠れています。");
  renderAll();
}

function resetToSetup() {
  stopPlayback();
  els.practiceArea.hidden = true;
  els.setupPanel.hidden = false;
  els.sessionState.textContent = "条件設定";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTool(mode) {
  state.toolMode = mode;
  els.setEntryTool.classList.toggle("active", mode === "entry");
  els.setStopTool.classList.toggle("active", mode === "stop");
}

function setPriceMode(mode) {
  state.priceMode = mode;
  els.priceModeCandle.classList.toggle("active", mode === "candle");
  els.priceModeHeikin.classList.toggle("active", mode === "heikin");
  renderMainChart();
}

function bindEvents() {
  els.startMode.addEventListener("change", () => { els.startDate.disabled = els.startMode.value !== "date"; });
  els.startSessionButton.addEventListener("click", startSession);
  els.newSessionButton.addEventListener("click", resetToSetup);
  els.stepOneButton.addEventListener("click", () => advance(1));
  els.stepFiveButton.addEventListener("click", () => advance(5));
  els.playButton.addEventListener("click", togglePlayback);
  els.finishButton.addEventListener("click", finishSession);
  els.buyChunkButton.addEventListener("click", manualBuyChunk);
  els.buyCustomButton.addEventListener("click", manualBuyCustom);
  els.sellQuarterButton.addEventListener("click", () => manualSell(0.25));
  els.sellHalfButton.addEventListener("click", () => manualSell(0.5));
  els.sellAllButton.addEventListener("click", () => manualSell(1));
  els.armBracketButton.addEventListener("click", armBracket);
  els.cancelBracketButton.addEventListener("click", cancelBracket);
  els.setEntryTool.addEventListener("click", () => setTool("entry"));
  els.setStopTool.addEventListener("click", () => setTool("stop"));
  els.priceModeCandle.addEventListener("click", () => setPriceMode("candle"));
  els.priceModeHeikin.addEventListener("click", () => setPriceMode("heikin"));
  [els.entryPrice, els.stopPrice, els.rr1, els.rr2, els.rr3, els.rr4, els.autoEntrySlots, els.trailMode].forEach((element) => {
    element.addEventListener("change", () => { state.plan.armed = false; recalculatePlan(); renderAll(); });
    element.addEventListener("input", () => { if (!els.practiceArea.hidden) { recalculatePlan(); renderPlan(); renderMainChart(); } });
  });
  [els.showSma, els.showEma, els.showBollinger, els.showSupertrend, els.showHigh52, els.showAverage, els.showPlanLines].forEach((element) => element.addEventListener("change", renderMainChart));
  els.oscillatorSelect.addEventListener("change", renderOscillatorChart);
}

async function init() {
  ids.forEach((id) => { els[id] = $(id); });
  bindEvents();
  state.code = queryCode();
  if (!state.code) {
    els.setupNotice.textContent = "URLに銘柄コードがありません。銘柄詳細から開いてください。";
    els.startSessionButton.disabled = true;
    return;
  }
  try {
    state.payload = await fetchJson(`data/charts/${encodeURIComponent(state.code)}.json`);
    state.rows = ReplayPro.enrichRows(state.payload.daily || []);
    els.replayTitle.textContent = `${state.payload.name}（${state.payload.code}）売買練習🌸`;
    els.replaySubtitle.textContent = `${state.rows[0]?.date || "—"}〜${state.rows.at(-1)?.date || "—"}の日足から、平均足・月足RSI・テクニカル指標を使って練習できます。`;
    els.detailBackLink.href = `detail.html?code=${encodeURIComponent(state.code)}`;
    const minIndex = Math.min(240, Math.max(0, state.rows.length - 80));
    const maxIndex = Math.max(minIndex, state.rows.length - 50);
    els.startDate.min = state.rows[minIndex]?.date || "";
    els.startDate.max = state.rows[maxIndex]?.date || "";
    els.startDate.value = state.rows[minIndex]?.date || "";
    els.sessionState.textContent = "条件設定";
  } catch (error) {
    els.setupNotice.textContent = `データを読み込めませんでした：${error.message}`;
    els.startSessionButton.disabled = true;
  }
}

document.addEventListener("DOMContentLoaded", init);
