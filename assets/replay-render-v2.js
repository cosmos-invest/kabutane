function updatePeak(totalValue) {
  state.peakValue = Math.max(state.peakValue, totalValue);
  const drawdown = state.peakValue > 0 ? (totalValue / state.peakValue - 1) * 100 : 0;
  state.maxDrawdown = Math.min(state.maxDrawdown, drawdown);
}

function renderAccount() {
  const row = currentRow();
  if (!row) return;
  const metrics = ReplayPro.accountMetrics(state.account, row.close, state.initialCapital);
  updatePeak(metrics.totalValue);
  els.currentDate.textContent = row.date;
  els.currentPrice.textContent = yen(row.close);
  els.cashValue.textContent = yen(state.account.cash);
  els.shareValue.textContent = `${state.account.shares.toLocaleString("ja-JP")}株`;
  els.averagePrice.textContent = yen(metrics.averagePrice);
  els.unrealizedValue.textContent = `${yen(metrics.unrealized)}（${percent(metrics.unrealizedPct)}）`;
  els.unrealizedValue.className = performanceClass(metrics.unrealized);
  els.realizedValue.textContent = yen(state.account.realized);
  els.realizedValue.className = performanceClass(state.account.realized);
  els.totalValue.textContent = yen(metrics.totalValue);
  els.totalReturn.textContent = percent(metrics.totalReturn);
  els.totalReturn.className = performanceClass(metrics.totalReturn);
  els.totalProfit.textContent = yen(metrics.totalProfit);
  els.totalProfit.className = performanceClass(metrics.totalProfit);
  els.marketValue.textContent = yen(metrics.marketValue);
  els.averageCost.textContent = yen(metrics.averageCost);
  els.peakValue.textContent = yen(state.peakValue);
  els.maxDrawdown.textContent = percent(state.maxDrawdown);
  els.maxDrawdown.className = performanceClass(state.maxDrawdown);
  els.feeValue.textContent = yen(state.account.fees);
}

function renderSlots() {
  const used = ReplayPro.MAX_SLOTS - state.availableSlots;
  els.buyStageStatus.textContent = `${used} / ${ReplayPro.MAX_SLOTS}`;
  els.remainingBuys.textContent = `${state.availableSlots}枠`;
  els.slotDots.innerHTML = Array.from({ length: ReplayPro.MAX_SLOTS }, (_, index) => `<span class="${index < used ? "used" : ""}">${index + 1}</span>`).join("");
}

function renderPlan() {
  const plan = currentPositionPlan();
  const ratios = state.plan.ratios;
  state.plan.tpPrices.forEach((price, index) => { els[`tp${index + 1}Price`].textContent = price === undefined ? "—" : yen(price); });
  els.positionBudget.textContent = yen(plan.allocationBudget);
  els.riskBudget.textContent = yen(plan.riskBudget);
  els.recommendedShares.textContent = `${plan.recommendedShares.toLocaleString("ja-JP")}株`;
  els.slotShares.textContent = plan.slotShares > 0 ? `${plan.slotShares.toLocaleString("ja-JP")}株` : "8分割不可";
  els.plannedLoss.textContent = plan.riskPerShare ? yen(plan.recommendedShares * plan.riskPerShare) : "—";
  els.activeStopValue.textContent = yen(state.plan.activeStop);
  els.riskRewardBadge.textContent = `TP ${ratios.map((ratio) => `${ratio.toFixed(1)}R`).join(" / ")}`;
  const valid = state.plan.entry !== null && state.plan.initialStop !== null && state.plan.initialStop < state.plan.entry
    && ratios.every((ratio, index) => index === 0 || ratio > ratios[index - 1]);
  els.armBracketButton.disabled = !valid || state.ended || state.account.shares > 0;
  if (!valid) els.riskPlanNotice.textContent = "エントリーより下に損切りを置き、TP1〜TP4を1.5〜5.0Rの昇順で設定してください。";
  else if (state.plan.armed) els.riskPlanNotice.textContent = `待機中：日足の高値・安値が${yen(state.plan.entry)}へ触れたら自動エントリーします。`;
  else if (state.account.shares > 0 && state.plan.entryDate) els.riskPlanNotice.textContent = `自動管理中：現在の損切りは${yen(state.plan.activeStop)}です。同一足で損切りと利確へ触れた場合は、保守的に損切りを先に処理します。`;
  else if (state.account.shares > 0) els.riskPlanNotice.textContent = "手動保有中です。新しい自動エントリー注文は全株売却後に待機できます。";
  else els.riskPlanNotice.textContent = `推奨最大${plan.recommendedShares.toLocaleString("ja-JP")}株。自動注文は${state.plan.autoSlots}枠分で発注します。`;
}

function renderIndicators() {
  const row = currentRow();
  if (!row) return;
  const spread = row.monthlyRsi14 !== null && row.monthlyRsiMa5 !== null ? row.monthlyRsi14 - row.monthlyRsiMa5 : null;
  els.indicatorRsi.textContent = `月足RSI14 ${formatNumber(row.monthlyRsi14)} / 5か月MA ${formatNumber(row.monthlyRsiMa5)} / 差 ${formatNumber(spread)}`;
  els.indicatorTrend.textContent = `第${row.stage2 ? "2" : "—"}ステージ / Supertrend ${row.supertrendUp === true ? "上向き" : row.supertrendUp === false ? "下向き" : "—"} / 高値距離 ${percent(row.high52DistancePct)}`;
  els.indicatorSetup.textContent = `VCP簡易 ${row.vcpTight ? "○" : "—"} / MVP簡易 ${row.mvpSignal ? "○" : "—"} / 出来高20日比 ${row.volumeRatio === null ? "—" : `${formatNumber(row.volumeRatio)}倍`}`;
  els.dayProgress.textContent = `開始から${state.cursor - state.startIndex + 1}営業日目。未来の${Math.max(0, state.rows.length - state.cursor - 1)}営業日は非表示です。`;
}

function renderHistory() {
  els.tradeHistoryBody.innerHTML = state.trades.map((trade) => `
    <tr class="${trade.type === "BUY" ? "buy-row" : "sell-row"}">
      <td>${trade.date}</td><td><strong>${trade.label}</strong> ${trade.type === "BUY" ? "購入" : "売却"}</td>
      <td>${trade.reason || "手動"}</td><td class="num">${formatNumber(trade.price)}</td>
      <td class="num">${trade.shares.toLocaleString("ja-JP")}</td><td class="num ${performanceClass(trade.realized)}">${trade.type === "SELL" ? yen(trade.realized) : "—"}</td>
      <td>${trade.memo || "—"}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="empty-state">売買すると、ここに履歴が表示されます。</td></tr>';
}

function renderButtons() {
  const noShares = state.account.shares <= 0;
  const noFuture = state.cursor >= state.rows.length - 1;
  const plan = currentPositionPlan();
  els.buyChunkButton.disabled = state.ended || state.availableSlots <= 0 || plan.slotShares <= 0;
  els.buyCustomButton.disabled = state.ended || state.availableSlots <= 0;
  [els.sellQuarterButton, els.sellHalfButton, els.sellAllButton].forEach((button) => { button.disabled = state.ended || noShares; });
  [els.stepOneButton, els.stepFiveButton, els.playButton].forEach((button) => { button.disabled = state.ended || noFuture; });
  els.cancelBracketButton.disabled = !state.plan.armed && !state.plan.entryDate;
}

function renderAll() {
  renderAccount();
  renderSlots();
  renderPlan();
  renderIndicators();
  renderMainChart();
  renderMonthlyRsiChart();
  renderOscillatorChart();
  renderHistory();
  renderButtons();
}
