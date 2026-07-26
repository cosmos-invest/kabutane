(function () {
  "use strict";

  const REPLACEMENTS = [
    ["実際のお金を動かす前の5項目", "実際のお金を動かす前の6項目"],
    ["レポートには売買位置、最大DD、損益、ルール達成、今回の学びが表示されます。", "レポートには売買位置、最大DD、損益、ルール達成が表示されます。判断メモを書いた場合だけ、その内容を「今回の学び」として載せます。"],
    ["スマホでは画像と文章を共有メニューへまとめて渡します。", "スマホでは画像と文章を共有メニューへまとめて渡します。共有先からXを選ぶと、画像付き投稿へ進めます。"],
    ["TOPIXとの比較", "TOPIX代替ベンチマークとの比較"],
    ["Yahooで取得できるTOPIX連動ETFの調整済み価格を代替使用します。", "TOPIX指数を安定取得できない場合は、Yahoo Financeで取得できるTOPIX連動ETFの調整済み価格を代替ベンチマークとして使います。指数そのものではありません。"],
    ["今月NEW", "判定月NEW"],
    ["今月OUT", "判定月OUT"],
    ["月初に確認したい月足RSIのNEW・OUT・節目接近", "月末確定値で判定した月足RSIのNEW・OUT・節目接近"],
    ["節目接近は次に変化しそうな候補だよ。まだINやOUTが確定したわけじゃないよ。", "節目接近は、確定月のRSI14と5か月MAの差が0〜2ポイントだった観察対象だよ。次のINやOUTを予測する表示ではないよ。"],
    ["NEWとOUTが多い場所を見つけたら、チャートを開いて理由を探そう！", "確定したNEWとOUTが多い市場やセクターを見つけたら、チャートを開いて背景を確認しよう！"],
  ];

  function replaceExactText(root, before, after) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue?.includes(before)) continue;
      node.nodeValue = node.nodeValue.replaceAll(before, after);
    }
  }

  function replaceAll(root = document.body) {
    if (!root) return;
    REPLACEMENTS.forEach(([before, after]) => replaceExactText(root, before, after));
  }

  function auditHowto() {
    if (document.body?.dataset.page !== "howto" || document.body.dataset.howtoCopyAudited === "true") return;

    const stateSection = [...document.querySelectorAll(".howto-section")]
      .find((section) => section.querySelector("h2")?.textContent.includes("ホームに出る3つの状態"));
    const intro = stateSection?.querySelector(".howto-section-heading p:last-child");
    if (intro) intro.textContent = "NEW・CONTINUE・OUTは、すべて月末まで完成した月足で判定します。進行中月の暫定GC・暫定DCは正式判定ではありません。";

    const glossary = stateSection?.querySelectorAll(".glossary-strip article p") || [];
    if (glossary[0]) glossary[0].textContent = "完成した月足のRSI14が、自身の5か月移動平均を下から上へ抜けた判定月。";
    if (glossary[1]) glossary[1].textContent = "完成した月足のRSI14が5か月移動平均より上にあり、確定状態が続いている判定月。";
    if (glossary[2]) glossary[2].textContent = "完成した月足のRSI14が5か月移動平均以下へ戻った判定月。弱まりを確認する目印です。";

    const monthlyCard = [...document.querySelectorAll(".reading-card")]
      .find((card) => card.querySelector("h3")?.textContent.includes("月足RSI14"));
    if (monthlyCard) {
      const paragraph = monthlyCard.querySelector("p");
      const list = monthlyCard.querySelector("ul");
      if (paragraph) paragraph.textContent = "確定した月足の勢いと、進行中月の暫定変化を分けて確認します。";
      if (list) list.innerHTML = [
        "確定NEW・確定継続・確定OUTのどれか",
        "実線は月末確定値、点線は進行中月の暫定値",
        "暫定GC・暫定DCは月末までに消える場合がある",
        "正式判定は翌月最初の日足から表示",
      ].map((text) => `<li>${text}</li>`).join("");
    }

    const ready = [...document.querySelectorAll(".howto-section")]
      .find((section) => section.querySelector(".ready-check-grid"));
    const heading = ready?.querySelector("h2");
    const count = ready?.querySelectorAll('.ready-check-grid input[type="checkbox"]').length || 0;
    if (heading && count) heading.textContent = `実際のお金を動かす前の${count}項目`;
    document.body.dataset.howtoCopyAudited = "true";
  }

  function auditLearn() {
    if (document.body?.dataset.page !== "learn" || document.body.dataset.learnCopyAudited === "true") return;
    const monthly = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent.includes("月足RSIとは"));
    const paragraph = monthly?.querySelector("p");
    if (paragraph) paragraph.textContent = "月末ごとの値動きから、上昇の力と下落の力のバランスを0〜100で表します。正式なNEW・CONTINUE・OUTは完成済み月足だけで判定し、進行中月は参考用の暫定値として別表示します。";
    document.body.dataset.learnCopyAudited = "true";
  }

  function applyAudit() {
    replaceAll();
    auditHowto();
    auditLearn();
    document.documentElement.dataset.copyAudit = "confirmed-vs-provisional-v1";
  }

  let scheduled = false;
  function scheduleAudit() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      replaceAll();
    });
  }

  function init() {
    applyAudit();
    const observer = new MutationObserver(scheduleAudit);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
