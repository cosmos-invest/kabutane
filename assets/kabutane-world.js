(function () {
  "use strict";

  if (typeof window === "undefined" || document.querySelector(".kabutane-world-launcher")) return;

  const QA_URL = "https://note.com/qa/cosmos_invest";
  const PAGE = document.body?.dataset?.page || (document.getElementById("priceChart") ? "detail" : "index");
  const STORAGE_KEY = "kabutane_world_visits_v1";

  const characters = {
    cosmos: { name: "コスモス🌸", role: "見る順番を整理するよ" },
    lumo: { name: "ルーモ✨", role: "まず試す勇気を担当！" },
    aile: { name: "エール💜", role: "難しいところを一緒に確認するよ" },
  };

  const generic = {
    cosmos: {
      guide: "最初から全部見なくて大丈夫だよ。上から順番に、一つずつ確認していこう🌸",
      first: "まず、この画面で一番大きく書かれている項目を見よう。次に気になる数字を一つだけ選べば十分だよ🌸",
      caution: "数字が良く見えても、それだけで買う理由にはしないよ。チャートと会社の公式情報も一緒に確認しよう🌸",
    },
    lumo: {
      guide: "気になるボタンを一つ押してみよう！間違えても戻せるから、まず動かして覚えよう✨",
      first: "最初の一歩は小さくてOK！候補を一社開く、練習を一回始める、それだけでも前進だよ✨",
      caution: "結果が良かった時だけじゃなく、決めたルールを守れたかも見よう！そこが本当の成長ポイントだよ✨",
    },
    aile: {
      guide: "分からない言葉があっても止まらなくて大丈夫だよ。気になる言葉だけ、学び・FAQで確認しよう。",
      first: "最初に『どこまでなら損しても大丈夫か』を考えよう。利益より先に、資金を守る準備をするよ。",
      caution: "表示は学習用の情報だよ。最終判断は企業の公式情報と、自分のリスク許容度を確認してからにしようね。",
    },
  };

  const pageTalk = {
    index: {
      title: "たね探し広場",
      welcome: "今日はどんな会社の“たね”を探す？ 迷ったら3人に声をかけてね。",
      cosmos: { guide: "まずは『まずは基本』で候補を眺めよう。気になる会社を3〜5社に絞ると、比べやすいよ🌸", first: "会社名を知っているかより、『なぜ候補に出たか』を見よう。理由カードから始めると迷いにくいよ🌸" },
      lumo: { guide: "気になるカードを開いたら、次は過去チャートで練習！見るだけで終わらせず、一回試してみよう✨" },
      aile: { caution: "候補一覧は買い推奨じゃないよ。上位やNEWだけで決めず、値動きと会社の情報も確認しよう。" },
    },
    detail: {
      title: "銘柄観察テーブル",
      welcome: "この会社を、3人と一緒に上から順番に見ていこう。",
      cosmos: { guide: "日足チャート → 月足RSI → 配当・分割 → 財務の順に見れば、情報が散らからないよ🌸" },
      lumo: { first: "まずチャートを横に動かしてみよう！上がる前、下がる前にどんな形だったか探すと面白いよ✨" },
      aile: { caution: "確定シグナルと進行中月の暫定シグナルは別物だよ。点線は月末まで変わる可能性があるよ。" },
    },
    replay: {
      title: "売買練習ルーム",
      welcome: "未来を隠したチャートで、何度でも作戦を試せるよ。",
      cosmos: { guide: "入口より先に、損切り・利確・株数を決めよう。順番を守るだけで判断が落ち着くよ🌸" },
      lumo: { first: "失敗してOK！一回最後まで進めて、次の練習で一つだけ直そう✨" },
      aile: { caution: "損切り価格を不安で遠ざけないようにしよう。最初に決めた最大損失を守る練習だよ。" },
    },
    ranking: {
      title: "動き発見ボード",
      welcome: "順位を見るだけじゃなく、動いた理由を探しにいこう。",
      cosmos: { guide: "GCした月と継続月数を一緒に見よう。同じ騰落率でも、進んだ時間が違うよ🌸" },
      lumo: { first: "順位が大きく上がった会社を一つ開いて、チャートで何が起きたか探してみよう✨" },
      aile: { caution: "上位ほど、すでに大きく上がっている場合があるよ。ランキングは観察の入口だよ。" },
    },
    "monthly-report": {
      title: "月初作戦会議",
      welcome: "忙しい月初は、全体 → 市場 → セクター → 銘柄の順で確認しよう。",
      cosmos: { guide: "最初は上の4つの数字だけで全体像をつかもう。そのあと、変化が多い市場とセクターを見るよ🌸" },
      lumo: { first: "NEWやOUTが多い場所を見つけたら、気になる会社を一つ開こう！全部見る必要はないよ✨" },
      aile: { caution: "節目接近は予測じゃないよ。確定月のRSI14と5か月MAの差が0〜2ポイントだった事実を示しているよ。" },
    },
    howto: {
      title: "はじめて案内所",
      welcome: "使い方で迷子になったら、いつでもここへ戻ってきてね。",
    },
    learn: {
      title: "ことばの図書室",
      welcome: "難しい言葉は、一度に全部覚えなくて大丈夫だよ。",
      aile: { guide: "今見ている画面で分からなかった言葉を、一つだけ探してみよう。それで十分だよ。" },
    },
    backtest: {
      title: "運用実験室",
      welcome: "一番良い結果より、続けられる下落幅かを一緒に確認しよう。",
    },
    history: {
      title: "練習のアルバム",
      welcome: "利益だけじゃなく、守れたルールも成長として残っているよ。",
    },
  };

  function visits() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (_) { return {}; }
  }

  function recordVisit() {
    const state = visits();
    const count = Number(state[PAGE] || 0) + 1;
    state[PAGE] = count;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    return count;
  }

  const visitCount = recordVisit();
  const config = pageTalk[PAGE] || { title: "かぶたね広場", welcome: "3人と一緒に、今日の一歩を進めよう。" };
  let activeCharacter = "cosmos";
  let activeTopic = "guide";

  function answer(character, topic) {
    return config?.[character]?.[topic] || generic[character]?.[topic] || generic.cosmos.guide;
  }

  function createUi() {
    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "kabutane-world-launcher";
    launcher.setAttribute("aria-label", "コスモス・ルーモ・エールに話しかける");
    launcher.innerHTML = `<span class="world-launcher-faces" aria-hidden="true"><i class="world-launcher-face cosmos"></i><i class="world-launcher-face lumo"></i><i class="world-launcher-face aile"></i></span><span class="world-launcher-label">3人に話す<small>${config.title}</small></span>${visitCount === 1 ? '<span class="world-unread">1</span>' : ""}`;

    const backdrop = document.createElement("div");
    backdrop.className = "kabutane-world-backdrop";

    const panel = document.createElement("aside");
    panel.className = "kabutane-world-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "3人との会話パネル");
    panel.innerHTML = `
      <div class="world-panel-head">
        <div><span>KABUTANE WORLD</span><h2>${config.title}</h2></div>
        <button class="world-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="world-panel-body">
        <p class="world-welcome">${visitCount > 1 ? "おかえり！ " : "はじめまして！ "}${config.welcome}</p>
        <div class="world-character-tabs">
          ${Object.entries(characters).map(([key, value]) => `<button type="button" class="world-character-tab${key === activeCharacter ? " active" : ""}" data-character="${key}"><i aria-hidden="true"></i><span>${value.name}<small>${value.role}</small></span></button>`).join("")}
        </div>
        <div class="world-speech" aria-live="polite"><strong id="worldSpeaker">${characters[activeCharacter].name}</strong><p id="worldAnswer">${answer(activeCharacter, activeTopic)}</p></div>
        <div class="world-topics" aria-label="聞きたいこと">
          <button type="button" class="world-topic active" data-topic="guide">この画面の見方</button>
          <button type="button" class="world-topic" data-topic="first">最初にすること</button>
          <button type="button" class="world-topic" data-topic="caution">気をつけること</button>
        </div>
        <a class="world-question-link" href="${QA_URL}" target="_blank" rel="noopener noreferrer"><span>自由に質問したいことがある</span><strong>note質問箱へ ↗</strong></a>
        <p class="world-footnote">ここでの会話は、画面に合わせて用意した案内だよ。個別の質問はnote質問箱へ送ってね。</p>
      </div>`;

    document.body.append(backdrop, panel, launcher);

    const open = () => {
      launcher.querySelector(".world-unread")?.remove();
      backdrop.classList.add("open");
      panel.classList.add("open");
      document.body.style.overflow = "hidden";
      panel.querySelector(".world-close")?.focus();
    };
    const close = () => {
      backdrop.classList.remove("open");
      panel.classList.remove("open");
      document.body.style.overflow = "";
      launcher.focus();
    };
    const render = () => {
      panel.querySelectorAll(".world-character-tab").forEach((button) => button.classList.toggle("active", button.dataset.character === activeCharacter));
      panel.querySelectorAll(".world-topic").forEach((button) => button.classList.toggle("active", button.dataset.topic === activeTopic));
      panel.querySelector("#worldSpeaker").textContent = characters[activeCharacter].name;
      panel.querySelector("#worldAnswer").textContent = answer(activeCharacter, activeTopic);
    };

    launcher.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    panel.querySelector(".world-close").addEventListener("click", close);
    panel.addEventListener("click", (event) => {
      const character = event.target.closest("[data-character]");
      if (character) { activeCharacter = character.dataset.character; render(); return; }
      const topic = event.target.closest("[data-topic]");
      if (topic) { activeTopic = topic.dataset.topic; render(); }
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && panel.classList.contains("open")) close(); });
    window.KabutaneWorld = { open, close };
  }

  function injectInlineGreeting() {
    if (!["index", "monthly-report", "ranking", "history"].includes(PAGE)) return;
    const main = document.querySelector("main.container");
    if (!main || main.querySelector(".world-inline-greeting")) return;
    const node = document.createElement("section");
    node.className = "world-inline-greeting";
    node.innerHTML = `<div class="world-inline-faces" aria-hidden="true"><i class="cosmos"></i><i class="lumo"></i><i class="aile"></i></div><div><strong>${visitCount > 1 ? "おかえり！3人が待ってたよ。" : "3人と一緒に進めるよ。"}</strong><p>${config.welcome}</p><button type="button">3人に話しかける →</button></div>`;
    const anchor = PAGE === "index" ? main.querySelector(".kabutane-hero") : main.firstElementChild;
    anchor?.insertAdjacentElement("afterend", node);
    node.querySelector("button").addEventListener("click", () => window.KabutaneWorld?.open());
  }

  function init() {
    createUi();
    injectInlineGreeting();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
