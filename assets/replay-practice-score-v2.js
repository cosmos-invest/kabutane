(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReplayPracticeScoreV2 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCORE_VERSION = 2;

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizedText(value) {
    return String(value || "").trim();
  }

  function isRecorded(value) {
    const text = normalizedText(value);
    return Boolean(text && text !== "unknown" && text !== "未選択");
  }

  function dateIndex(rows, date) {
    return (Array.isArray(rows) ? rows : []).findIndex((row) => String(row?.date || "") === String(date || ""));
  }

  function entryTiming(trade, rows, horizon = 10) {
    if (trade?.type !== "BUY") return { points: 0, positionPoints: 0, maeMfePoints: 0, initialMovePoints: 0 };
    const entry = finite(trade.price);
    const stop = finite(trade?.decision?.stopAtDecision ?? trade?.stopAtDecision);
    const index = dateIndex(rows, trade.date);
    if (entry === null || stop === null || stop >= entry || index < 0) {
      return { points: 0, positionPoints: 0, maeMfePoints: 0, initialMovePoints: 0 };
    }
    const windowRows = rows.slice(index, Math.min(rows.length, index + Math.max(2, horizon + 1)));
    const lows = windowRows.map((row) => finite(row?.low ?? row?.close)).filter((value) => value !== null);
    const highs = windowRows.map((row) => finite(row?.high ?? row?.close)).filter((value) => value !== null);
    if (!lows.length || !highs.length) return { points: 0, positionPoints: 0, maeMfePoints: 0, initialMovePoints: 0 };

    const lowest = Math.min(...lows);
    const highest = Math.max(...highs);
    const range = Math.max(highest - lowest, Math.abs(entry) * 0.005, 0.01);
    const position = clamp((entry - lowest) / range, 0, 1);
    const positionPoints = position <= 0.2 ? 2 : position <= 0.35 ? 1 : 0;
    const risk = entry - stop;
    const maeR = Math.max(0, entry - lowest) / risk;
    const mfeR = Math.max(0, highest - entry) / risk;
    const maeMfePoints = mfeR >= 1 && maeR <= 0.3 ? 2 : mfeR >= 1 && maeR <= 0.5 ? 1 : 0;

    const firstFive = windowRows.slice(0, 6);
    let targetSeen = false;
    let adverseSeen = false;
    for (const row of firstFive) {
      const high = finite(row?.high ?? row?.close);
      const low = finite(row?.low ?? row?.close);
      if (low !== null && low <= entry - risk * 0.5) adverseSeen = true;
      if (high !== null && high >= entry + risk * 0.5) {
        targetSeen = true;
        break;
      }
    }
    const initialMovePoints = targetSeen && !adverseSeen ? 1 : 0;
    const points = clamp(positionPoints + maeMfePoints + initialMovePoints, 0, 5);
    return { points, positionPoints, maeMfePoints, initialMovePoints, lowest, highest, position, maeR, mfeR };
  }

  function timingSummary(trades, rows) {
    const buys = (Array.isArray(trades) ? trades : []).filter((trade) => trade?.type === "BUY");
    if (!buys.length) return { points: 0, best: null, average: 0 };
    const results = buys.map((trade) => ({ trade, ...entryTiming(trade, rows) }));
    const best = results.reduce((current, item) => !current || item.points > current.points ? item : current, null);
    const average = results.reduce((sum, item) => sum + item.points, 0) / results.length;
    return { points: Math.round(clamp(average, 0, 5)), best, average, results };
  }

  function category(name, max, items) {
    const earned = clamp(items.reduce((sum, item) => sum + (item.ok ? item.points : 0), 0), 0, max);
    return { name, earned, max, items };
  }

  function calculate(input = {}) {
    const trades = Array.isArray(input.trades) ? input.trades : [];
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const audit = input.audit || {};
    const buys = trades.filter((trade) => trade?.type === "BUY");
    const sells = trades.filter((trade) => trade?.type === "SELL");
    const firstBuy = buys[0] || null;
    const firstDecision = firstBuy?.decision || {};
    const allowedRiskPct = finite(input.riskPct) ?? finite(firstDecision.allowedRiskPct) ?? 1;
    const allowedAllocationPct = finite(input.allocationPct) ?? finite(firstDecision.allowedAllocationPct) ?? 20;
    const actualRiskPct = finite(audit.positionRiskPct ?? firstDecision.positionRiskPct);
    const allocationUsedPct = finite(audit.allocationUsedPct ?? firstDecision.allocationUsedPct);
    const plannedShares = finite(audit.plannedShares ?? firstDecision.plannedShares);
    const peakShares = finite(audit.peakShares);
    const stopBeforeEntry = finite(firstDecision.stopAtDecision) !== null && finite(firstBuy?.price) !== null && Number(firstDecision.stopAtDecision) < Number(firstBuy.price);
    const targetPlanned = finite(firstDecision.targetAtDecision) !== null && finite(firstBuy?.price) !== null && Number(firstDecision.targetAtDecision) > Number(firstBuy.price);
    const event = normalizedText(firstDecision.eventContext);
    const highRiskEvent = event === "earnings_cross" || event === "rights_cross";
    const reducedForEvent = !highRiskEvent || (actualRiskPct !== null && actualRiskPct <= allowedRiskPct * 0.75) || Boolean(firstDecision.eventRiskReduced);
    const additions = buys.slice(1);
    const additionsReasoned = additions.every((trade) => isRecorded(trade?.decision?.thesis) && trade?.decision?.planStatus !== "emotion");
    const plannedSplitCount = Math.max(1, Math.round(finite(firstDecision.plannedSplitCount) || 1));
    const splitDiscipline = buys.length <= plannedSplitCount && (plannedSplitCount > 1 ? additionsReasoned : buys.length === 1);
    const sellDecisions = sells.map((trade) => trade?.decision || {});
    const exitsRecorded = sells.length > 0 && sellDecisions.every((decision) => isRecorded(decision.exitReason || decision.thesis));
    const exitsPlanned = sells.length > 0 && sellDecisions.every((decision) => decision.planStatus === "planned" || decision.executionKind === "stop" || decision.executionKind === "target");
    const noEmotionalExit = sells.every((trade) => trade?.decision?.planStatus !== "emotion");
    const partialSell = sells.some((trade) => finite(trade?.remainingSharesAfter) > 0);
    const remainingDecision = !partialSell || sellDecisions.some((decision) => isRecorded(decision.remainingStopDecision));
    const memoRecorded = trades.some((trade) => isRecorded(trade?.memo)) || Boolean(audit.reviewed);
    const decisionCount = trades.filter((trade) => trade?.decision && (isRecorded(trade.decision.thesis) || isRecorded(trade.decision.exitReason))).length;
    const allChangesRecorded = !audit.planChanged || Boolean(audit.planChangesRecorded);
    const eventAware = isRecorded(event);
    const activityMeasured = buys.length <= 8 && sells.length <= 8;
    const timing = timingSummary(trades, rows);

    const categories = [
      category("事前計画", 15, [
        { key: "stop-before-entry", label: "買う前に損切りを設定", points: 4, ok: stopBeforeEntry },
        { key: "target-before-entry", label: "買う前に利確候補を設定", points: 3, ok: targetPlanned },
        { key: "entry-thesis", label: "エントリー理由を記録", points: 3, ok: isRecorded(firstDecision.thesis) },
        { key: "event-awareness", label: "決算・権利などの状況を確認", points: 2, ok: eventAware },
        { key: "plan-status", label: "計画どおりかを記録", points: 3, ok: isRecorded(firstDecision.planStatus) },
      ]),
      category("リスク・資金管理", 25, [
        { key: "risk-cap", label: "許容損失率以内", points: 10, ok: actualRiskPct !== null && actualRiskPct <= allowedRiskPct * 1.05 },
        { key: "allocation-cap", label: "銘柄配分上限以内", points: 5, ok: allocationUsedPct !== null && allocationUsedPct <= allowedAllocationPct * 1.02 },
        { key: "stop-held", label: "損切りを遠ざけなかった", points: 5, ok: !audit.stopWidened },
        { key: "share-cap", label: "計画株数を超えなかった", points: 5, ok: plannedShares !== null && peakShares !== null && peakShares <= plannedShares },
      ]),
      category("エントリー・追加判断", 20, [
        { key: "thesis-consistency", label: "初回購入の理由が明確", points: 5, ok: isRecorded(firstDecision.thesis) },
        { key: "split-discipline", label: "一括・分割の計画を守った", points: 5, ok: splitDiscipline },
        { key: "addition-reasons", label: "追加購入にも理由がある", points: 5, ok: additions.length ? additionsReasoned : plannedSplitCount === 1 },
        { key: "event-sizing", label: "イベントリスクに応じて枚数調整", points: 5, ok: eventAware && reducedForEvent },
      ]),
      category("保有中の規律", 15, [
        { key: "holding-stop", label: "保有中に損切りを広げなかった", points: 6, ok: !audit.stopWidened },
        { key: "change-record", label: "計画変更の理由を記録", points: 3, ok: allChangesRecorded },
        { key: "event-decision", label: "イベント時の判断を残した", points: 3, ok: eventAware },
        { key: "activity", label: "売買回数を増やしすぎなかった", points: 3, ok: activityMeasured },
      ]),
      category("利確・撤退判断", 15, [
        { key: "exit-reason", label: "売却理由を記録", points: 5, ok: exitsRecorded },
        { key: "exit-discipline", label: "計画または損切り・利確に沿って撤退", points: 5, ok: exitsPlanned },
        { key: "remaining-stop", label: "部分利確後の残りをどう守るか決定", points: 3, ok: remainingDecision && sells.length > 0 },
        { key: "no-panic", label: "感情だけで全決済しなかった", points: 2, ok: sells.length > 0 && noEmotionalExit },
      ]),
      category("振り返り", 5, [
        { key: "review", label: "判断メモまたは振り返りを記録", points: 5, ok: memoRecorded || decisionCount >= 2 },
      ]),
      category("タイミングボーナス", 5, [
        { key: "timing", label: "結果として良い位置で入れた", points: timing.points, ok: timing.points > 0 },
      ]),
    ];

    const score = clamp(Math.round(categories.reduce((sum, item) => sum + item.earned, 0)), 0, 100);
    const grade = score >= 90 ? "再現性の高い運用" : score >= 80 ? "安定した運用" : score >= 70 ? "基本は守れている" : score >= 60 ? "計画を整える途中" : "資金管理から練習";
    const timingMessage = timing.points >= 5
      ? "絶好のタイミングだったね！底を当てたことより、同じ理由で再現できるか振り返ろう。"
      : timing.points >= 3
        ? "結果として良い位置で入れたね。次も同じ根拠で判断できるか確認しよう。"
        : "タイミングより、損失を限定して次へ進める判断を優先できたか見よう。";

    return {
      version: SCORE_VERSION,
      score,
      grade,
      categories,
      timing,
      timingMessage,
      legacyComparable: false,
      summary: `${score}点｜${grade}`,
    };
  }

  return { SCORE_VERSION, finite, clamp, entryTiming, timingSummary, calculate };
});
