function ensurePastelThemeStyles() {
  if (document.querySelector('link[href="assets/pastel.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/pastel.css";
  document.head.appendChild(link);
}

function ensureCharacterImageStyles() {
  if (document.querySelector('link[href="assets/kabutane-characters.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/kabutane-characters.css";
  document.head.appendChild(link);
}

function ensureSignalV2Script() {
  if (document.querySelector('script[src="assets/signal-v2.js"]')) return;
  const script = document.createElement("script");
  script.src = "assets/signal-v2.js";
  script.defer = true;
  document.head.appendChild(script);
}

function ensureReplayMonthEndScript() {
  if (!document.body?.classList.contains("replay-page")) return;
  if (document.querySelector('script[src="assets/replay-month-end.js"]')) return;
  const script = document.createElement("script");
  script.src = "assets/replay-month-end.js";
  document.head.appendChild(script);
}

ensurePastelThemeStyles();
ensureCharacterImageStyles();
ensureSignalV2Script();
ensureReplayMonthEndScript();

const characterGuide = (() => {
  const characters = {
    cosmos: { name: "コスモス🌸" },
    lumo: { name: "ルーモ✨" },
    aile: { name: "エール💜" },
  };

  const messages = {
    index: [
      { character: "cosmos", text: "ここに並ぶのは、買う銘柄ではなく『次に調べる候補』だよ。まずは気になる会社を3〜5社だけ開いてみよう🌸" },
      { character: "lumo", text: "会社名の一部や証券コードで検索できるよ！ 詳細を見たら、今度は過去チャートで練習しよう✨" },
      { character: "aile", text: "難しい条件を全部選ばなくても大丈夫です。最初は『月足の勢い』だけで、どんな会社が出てくるか見てみましょう。" },
      { character: "cosmos", text: "🌸コスモス注目も売買推奨ではないよ。勢いと長期トレンドの両方を詳しく確認したい候補です🌸" },
    ],
    detail: [
      { character: "cosmos", text: "詳細は、株価チャート → 月足RSI → 配当・株式分割 → 財務の順に見ると迷いにくいよ🌸" },
      { character: "lumo", text: "ローソク足で値動きを見て、平均足でトレンドの続きやすさを確認してみよう✨" },
      { character: "aile", text: "有料APIや適時開示には接続していません。重要な企業情報は、投資前に会社の公式IRでも確認してください。" },
      { character: "cosmos", text: "過去の成績は未来の保証ではないよ。良かった場面だけでなく、一番下がった場面も想像しよう🌸" },
    ],
    howto: [
      { character: "cosmos", text: "見つける → 確かめる → 練習する。この順番なら、焦らず自分の判断を作れるよ🌸" },
      { character: "lumo", text: "練習では失敗してOK！ 入口、損切り、利確の理由をメモして、同じルールでもう一度試そう✨" },
      { character: "aile", text: "自分のお金を動かす前に、なぜ買うのか、どこで撤退するのかを説明できるまで練習してください。" },
    ],
    backtest: [
      { character: "cosmos", text: "成績が一番高い条件だけでなく、最大下落と取引数も一緒に確認しよう🌸" },
      { character: "aile", text: "バックテストには実際の約定との差や将来情報の混入リスクがあります。前提条件を確認して使いましょう。" },
    ],
    replay: [
      { character: "lumo", text: "ここは何度失敗しても大丈夫な場所！ まず損切りを決めてから、1回分の株数を考えよう✨" },
      { character: "aile", text: "月足の状態を待ちたい時は『月末へ』で進められます。途中の損切り・利確判定も日足順に処理されます。" },
      { character: "cosmos", text: "良い結果だけでなく、判断メモがルール通りだったかも振り返ろう🌸" },
    ],
    learn: [
      { character: "aile", text: "分からない言葉があったら、ここで一つずつ確認しましょう。全部を一度に覚える必要はありません。" },
      { character: "cosmos", text: "知識は銘柄を当てるためではなく、リスクを理解して落ち着いて判断するために使おう🌸" },
    ],
  };

  let page = "index";
  let current = 0;
  let root;

  function detectPage() {
    if (document.body.dataset.page) return document.body.dataset.page;
    if (document.getElementById("priceChart")) return "detail";
    if (document.querySelector(".backtest-page")) return "backtest";
    if (document.querySelector(".replay-page")) return "replay";
    return "index";
  }

  function injectPetals() {
    if (document.querySelector(".petal-layer")) return;
    const layer = document.createElement("div");
    layer.className = "petal-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = Array.from({ length: 12 }, (_, index) => `<span style="--petal-index:${index}"></span>`).join("");
    document.body.prepend(layer);
  }

  function injectNavigation() {
    const headerMeta = document.querySelector(".header-meta");
    if (!headerMeta || headerMeta.querySelector(".site-nav")) return;
    const currentFile = window.location.pathname.split("/").pop() || "index.html";
    const nav = document.createElement("nav");
    nav.className = "site-nav";
    nav.setAttribute("aria-label", "サイト内ナビゲーション");
    nav.innerHTML = [
      ["index.html", "銘柄を探す"],
      ["backtest.html", "運用を試す"],
      ["replay.html", "売買を練習"],
      ["howto.html", "使い方"],
      ["learn.html", "学び・FAQ"],
    ].map(([href, label]) => `<a href="${href}"${currentFile === href ? ' class="active" aria-current="page"' : ""}>${label}</a>`).join("")
      + '<a class="note-nav-link" href="https://note.com/cosmos_invest" target="_blank" rel="noopener noreferrer">note ↗</a>';
    headerMeta.prepend(nav);
  }

  function injectBrand() {
    const header = document.querySelector(".site-header .header-inner");
    if (!header || header.querySelector(".kabutane-mini-brand")) return;
    const brand = document.createElement("a");
    brand.className = "kabutane-mini-brand";
    brand.href = "index.html";
    brand.innerHTML = "<span>🌱</span><strong>かぶたね</strong>";
    header.prepend(brand);
  }

  function quickStartTemplate() {
    if (page === "detail") return `<section class="quickstart-banner compact panel"><div><span class="quickstart-label">次に見る順番</span><strong>チャート → 月足RSI → 配当・分割 → 練習</strong><p>気になった理由と、想定が崩れる条件をメモしてから練習へ進みます。</p></div><a class="button quickstart-button" href="howto.html#detail-guide">見方を確認</a></section>`;
    return "";
  }

  function template() {
    const avatars = Object.entries(characters).map(([key, value]) => `<button class="character-avatar" type="button" data-character="${key}" aria-label="${value.name}のヒント"><span class="character-avatar-image ${key}" aria-hidden="true"></span></button>`).join("");
    return `<section class="character-guide panel" aria-label="3人の使い方ヒント"><div class="character-avatar-rail">${avatars}</div><div class="character-speech"><div class="character-speech-heading"><strong id="characterName"></strong><button class="character-close" type="button" aria-label="ヒントを閉じる">×</button></div><p id="characterMessage"></p><div class="character-actions"><span id="characterCount"></span><button class="character-next button secondary" type="button">次のヒント</button></div></div><button class="character-reopen" type="button">3人のヒントを開く</button></section>`;
  }

  function show(index) {
    const pageMessages = messages[page] || messages.index;
    current = (index + pageMessages.length) % pageMessages.length;
    const message = pageMessages[current];
    root.dataset.activeCharacter = message.character;
    root.querySelector("#characterName").textContent = characters[message.character].name;
    root.querySelector("#characterMessage").textContent = message.text;
    root.querySelector("#characterCount").textContent = `${current + 1} / ${pageMessages.length}`;
    root.querySelectorAll(".character-avatar").forEach((button) => button.classList.toggle("active", button.dataset.character === message.character));
  }

  function showCharacter(character) {
    const pageMessages = messages[page] || messages.index;
    const index = pageMessages.findIndex((message) => message.character === character);
    if (index >= 0) show(index);
    root.classList.remove("collapsed");
  }

  function init() {
    document.body.classList.add("pastel-theme");
    injectPetals();
    injectNavigation();
    if (!document.querySelector(".kabutane-logo")) injectBrand();
    const main = document.querySelector("main.container");
    if (!main) return;
    page = detectPage();
    const quickMarkup = quickStartTemplate();
    if (quickMarkup && !main.querySelector(".quickstart-banner")) main.insertAdjacentHTML("afterbegin", quickMarkup);
    const holder = document.createElement("div");
    holder.innerHTML = template();
    root = holder.firstElementChild;
    const anchor = main.querySelector(".quickstart-banner") || main.firstElementChild;
    anchor?.insertAdjacentElement("afterend", root);
    if (!anchor) main.prepend(root);
    root.querySelector(".character-next").addEventListener("click", () => show(current + 1));
    root.querySelector(".character-close").addEventListener("click", () => root.classList.add("collapsed"));
    root.querySelector(".character-reopen").addEventListener("click", () => root.classList.remove("collapsed"));
    root.querySelectorAll(".character-avatar").forEach((button) => button.addEventListener("click", () => showCharacter(button.dataset.character)));
    show(0);
  }

  return { init, showCharacter };
})();

document.addEventListener("DOMContentLoaded", characterGuide.init);
