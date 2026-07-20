function processAutomaticOrders(row) {
  recalculatePlan();
  if (!state.plan.armed && !state.plan.entryDate) return;
  const first = ReplayPro.evaluateBracketBar({
    row,
    entryArmed: state.plan.armed,
    positionOpen: state.account.shares > 0 && Boolean(state.plan.entryDate),
    entry: state.plan.entry,
    stop: state.plan.activeStop,
    tpLevels: state.plan.tpPrices,
    hitTargets: state.plan.hitTargets,
  });
  if (first.action === "ENTRY") {
    const plan = currentPositionPlan();
    const desired = plan.slotShares * state.plan.autoSlots;
    const result = executeBuy(desired, first.price, `自動エントリー ${state.plan.autoSlots}枠`, state.plan.autoSlots);
    if (!result.ok) {
      state.plan.armed = false;
      message(`自動エントリーできませんでした：${result.error}`, true);
      return;
    }
    state.plan.armed = false;
    state.plan.entryDate = row.date;
    state.plan.initialAutoShares = result.shares;
    els.sessionState.textContent = "自動管理中";
    message(`${yen(first.price)}へタッチし、${result.shares.toLocaleString("ja-JP")}株を自動購入しました。同じ足では損切りのみ判定します。`);
    const sameBarStop = ReplayPro.evaluateBracketBar({
      row,
      entryArmed: false,
      positionOpen: true,
      entry: state.plan.entry,
      stop: state.plan.activeStop,
      tpLevels: state.plan.tpPrices,
      hitTargets: state.plan.hitTargets,
      entryJustFilled: true,
    });
    if (sameBarStop.action === "STOP") {
      const stopResult = executeSell(state.account.shares, sameBarStop.price, "自動損切り（エントリー同日）");
      els.sessionState.textContent = "損切り完了";
      message(`同じ足で損切りラインへ到達し、${yen(sameBarStop.price)}で全株売却しました。実現損益${yen(stopResult.realized)}。`);
    }
    return;
  }

  const evaluation = ReplayPro.evaluateBracketBar({
    row,
    entryArmed: false,
    positionOpen: state.account.shares > 0 && Boolean(state.plan.entryDate),
    entry: state.plan.entry,
    stop: state.plan.activeStop,
    tpLevels: state.plan.tpPrices,
    hitTargets: state.plan.hitTargets,
  });
  if (evaluation.action === "STOP") {
    const result = executeSell(state.account.shares, evaluation.price, "自動損切り/トレール");
    els.sessionState.textContent = "自動決済完了";
    message(`${yen(evaluation.price)}へ到達し、全株を自動売却しました。実現損益${yen(result.realized)}。`);
    return;
  }
  if (evaluation.action === "TARGETS") {
    const messages = [];
    evaluation.targets.forEach(({ index, price }) => {
      if (state.account.shares <= 0 || state.plan.hitTargets[index]) return;
      const isLast = index === ReplayPro.TP_COUNT - 1;
      let shares = isLast
        ? state.account.shares
        : ReplayPro.roundToLot(state.plan.initialAutoShares / ReplayPro.TP_COUNT, state.lotSize);
      if (shares <= 0 || shares > state.account.shares) shares = state.account.shares;
      const result = executeSell(shares, price, `自動TP${index + 1}`);
      if (!result.ok) return;
      state.plan.hitTargets[index] = true;
      trailAfterTarget(index);
      messages.push(`TP${index + 1} ${yen(price)}で${shares.toLocaleString("ja-JP")}株`);
    });
    if (state.account.shares === 0) els.sessionState.textContent = "TP完了";
    else els.sessionState.textContent = "トレーリング中";
    message(`${messages.join("、")}を自動利確。新しい損切りは${yen(state.plan.activeStop)}です。`);
  }
}
