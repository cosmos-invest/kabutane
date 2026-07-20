function message(text, error = false) {
  els.orderMessage.textContent = text;
  els.orderMessage.classList.toggle("negative", error);
}

function slotsForShares(shares, plan) {
  if (plan.slotShares <= 0) return ReplayPro.MAX_SLOTS;
  return ReplayPro.clamp(Math.ceil(shares / plan.slotShares), 1, ReplayPro.MAX_SLOTS);
}

function automaticOrderShares(plan) {
  return ReplayPro.roundToLot(
    plan.recommendedShares * state.plan.autoSlots / ReplayPro.MAX_SLOTS,
    state.lotSize,
  );
}

function executeBuy(shares, price, reason = "手動", explicitSlots = null) {
  const plan = currentPositionPlan();
  let quantity = ReplayPro.roundToLot(shares, state.lotSize);
  if (quantity <= 0) return { ok: false, error: "購入株数がありません。" };
  const remainingAllocation = Math.max(0, plan.allocationBudget - state.account.costBasis);
  const maxByCash = ReplayPro.roundToLot(state.account.cash / (price * (1 + state.costBps / 10000)), state.lotSize);
  const maxByAllocation = ReplayPro.roundToLot(remainingAllocation / (price * (1 + state.costBps / 10000)), state.lotSize);
  quantity = Math.min(quantity, maxByCash, maxByAllocation);
  if (quantity <= 0) return { ok: false, error: "現金または銘柄配分の上限に達しています。" };
  const slots = explicitSlots || slotsForShares(quantity, plan);
  if (slots > state.availableSlots) return { ok: false, error: `必要枠${slots}に対し、空きは${state.availableSlots}枠です。` };
  const result = ReplayPro.applyBuy(state.account, quantity, price, state.costBps);
  if (!result.ok) return result;
  state.account = result.account;
  state.availableSlots -= slots;
  state.buySequence += 1;
  state.trades.push({ date: currentRow().date, type: "BUY", label: `B${state.buySequence}`, reason, price, shares: quantity, realized: null, memo: els.tradeMemo.value.trim() });
  els.tradeMemo.value = "";
  return { ok: true, shares: quantity, slots };
}

function executeSell(shares, price, reason = "手動") {
  const quantity = Math.min(state.account.shares, ReplayPro.roundToLot(shares, state.lotSize) || state.account.shares);
  const beforeShares = state.account.shares;
  const result = ReplayPro.applySell(state.account, quantity, price, state.costBps);
  if (!result.ok) return result;
  state.account = result.account;
  const soldRatio = beforeShares ? quantity / beforeShares : 1;
  const restore = state.account.shares === 0 ? ReplayPro.MAX_SLOTS : soldRatio >= 0.5 ? 4 : 2;
  state.availableSlots = state.account.shares === 0 ? ReplayPro.MAX_SLOTS : Math.min(ReplayPro.MAX_SLOTS, state.availableSlots + restore);
  state.sellSequence += 1;
  state.trades.push({ date: currentRow().date, type: "SELL", label: `S${state.sellSequence}`, reason, price, shares: quantity, realized: result.realizedDelta, memo: els.tradeMemo.value.trim() });
  els.tradeMemo.value = "";
  if (state.account.shares === 0) {
    state.plan.entryDate = null;
    state.plan.initialAutoShares = 0;
    state.plan.hitTargets = [false, false, false, false];
  }
  return { ok: true, shares: quantity, realized: result.realizedDelta };
}

function manualBuyChunk() {
  const plan = currentPositionPlan();
  const result = executeBuy(plan.slotShares, currentRow().close, "手動1枠", 1);
  message(result.ok ? `${result.shares.toLocaleString("ja-JP")}株を終値で購入しました。` : result.error, !result.ok);
  renderAll();
}

function manualBuyCustom() {
  const result = executeBuy(Number(els.customBuyShares.value), currentRow().close, "手動指定");
  message(result.ok ? `${result.shares.toLocaleString("ja-JP")}株を終値で購入しました。` : result.error, !result.ok);
  renderAll();
}

function manualSell(ratio) {
  if (state.account.shares <= 0) return;
  let shares = ratio >= 1 ? state.account.shares : ReplayPro.roundToLot(state.account.shares * ratio, state.lotSize);
  if (shares <= 0) shares = state.account.shares;
  const result = executeSell(shares, currentRow().close, ratio >= 1 ? "手動全売却" : `手動${Math.round(ratio * 100)}%売却`);
  message(result.ok ? `${result.shares.toLocaleString("ja-JP")}株を売却。実現損益${yen(result.realized)}。` : result.error, !result.ok);
  renderAll();
}

function armBracket() {
  recalculatePlan();
  const plan = currentPositionPlan();
  if (state.account.shares > 0) {
    message("自動エントリー注文は保有株がない状態で待機してください。現在の保有株は手動で管理できます。", true);
    return;
  }
  if (state.plan.entry === null || state.plan.initialStop === null || state.plan.initialStop >= state.plan.entry) return;
  const desiredShares = automaticOrderShares(plan);
  const minimumForFourTargets = state.lotSize * ReplayPro.TP_COUNT;
  if (desiredShares < minimumForFourTargets) {
    message(`TP1〜TP4へ分割するには最低${minimumForFourTargets.toLocaleString("ja-JP")}株必要です。自動エントリー枠・配分・売買単位を見直してください。`, true);
    return;
  }
  state.plan.armed = true;
  state.plan.activeStop = state.plan.initialStop;
  state.plan.hitTargets = [false, false, false, false];
  state.plan.entryDate = null;
  els.sessionState.textContent = "自動注文待機";
  message(`${yen(state.plan.entry)}で${desiredShares.toLocaleString("ja-JP")}株のエントリー待機。損切り${yen(state.plan.activeStop)}、TP1〜TP4を自動監視します。`);
  renderAll();
}

function cancelBracket() {
  state.plan.armed = false;
  state.plan.entryDate = null;
  state.plan.initialAutoShares = 0;
  state.plan.hitTargets = [false, false, false, false];
  state.plan.activeStop = state.plan.initialStop;
  els.sessionState.textContent = state.account.shares > 0 ? "手動管理" : "練習中";
  message("自動注文を解除しました。保有株は手動で管理できます。");
  renderAll();
}

function trailAfterTarget(index) {
  if (state.plan.trailMode !== "step") return;
  if (index === 0) state.plan.activeStop = Math.max(state.plan.activeStop || 0, state.plan.entry);
  else state.plan.activeStop = Math.max(state.plan.activeStop || 0, state.plan.tpPrices[index - 1]);
}
