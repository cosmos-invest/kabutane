function ensurePastelThemeStyles() {
  if (document.querySelector('link[href="assets/pastel.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/pastel.css";
  document.head.appendChild(link);
}

ensurePastelThemeStyles();

const characterGuide = (() => {
  const characters = {
    cosmos: { name: "コスモス🌸" },
    lumo: { name: "ルーモ✨" },
    aile: { name: "エール💜" },
  };

  const messages = {
    index: [
      { character: "cosmos", text: "まずはNEWと🌸コスモス注目から候補を探そう。最初から全部の数字を追わず、入口を絞ると見やすいよ🌸" },
      { character: "lumo", text: "銘柄コードでも会社名でも検索できるよ！ 気になる会社を見つけたら、名前をタップして詳しく見てみよう✨" },
      { character: "aile", text: "数字が『—』の項目は取得できなかったデータです。0とは意味が違うから、そこだけ気をつけてね。" },
      { character: "cosmos", text: "一覧は候補を見つける場所。買うかどうかは、詳細ページのチャート・企業イベント・財務を見てから考えよう🌸" },
    ],
    analysis: [
      { character: "cosmos", text: "分析は『前半で条件探し、後半で答え合わせ』が基本だよ。同じ期間だけで良く見える条件を作りすぎないようにしよう🌸" },
      { character: "lumo", text: "52週高値やVCPも試せるよ！ 条件を一つずつ足して、対象件数が急に減っていないかも見よう✨" },
      { character: "aile", text: "平均が高くても、少数の大幅上昇に引っぱられることがあります。中央値・最大下落・対象件数を一緒に確認してね。" },
      { character: "cosmos", text: "TOPIXや日経平均に勝ったかだけでなく、負けた時の下がり方も大切。リターンと守りをセットで見よう🌸" },
      { character: "aile", text: "財務は現在の最新値です。過去のNEW当時の情報ではないため、過去実績の原因として断定しないようにしましょう。" },
      { character: "cosmos", text: "出口戦略は最大利益だけでなく、最大下落と平均保有期間も比較しよう。資金効率まで含めて見るのがコツだよ🌸" },
    ],
    detail: [
      { character: "cosmos", text: "上から株価チャート、月足RSI、企業イベント、過去実績、財務の順に見ると迷いにくいよ🌸" },
      { character: "lumo", text: "ローソク足で値動きを確認して、平均足でトレンドの続きやすさを見ると分かりやすいよ✨" },
      { character: "aile", text: "決算予定や権利落ちの直前は値動きが大きくなることがあります。チャートだけでなく日付も確認してね。" },
      { character: "cosmos", text: "過去のGC実績は参考になるけれど、同じ結果を保証するものではないよ。ワーストケースも一緒に想定しよう🌸" },
    ],
    howto: [
      { character: "cosmos", text: "このサイトは『一覧で探す → 詳細で確認 → 分析で検証』の3ステップで使うと分かりやすいよ🌸" },
      { character: "lumo", text: "最初は条件を盛りすぎなくて大丈夫！ NEWか🌸注目を選んで、気になる会社を3〜5社だけ開いてみよう✨" },
      { character: "aile", text: "最後に必ず、損失をどこまで許容するかと、どの条件で撤退するかを決めておくと落ち着いて使えます。" },
    ],
  };

  let page = "index";
  let current = 0;
  let root;

  function detectPage() {
    if (document.body.dataset.page) return document.body.dataset.page;
    if (document.getElementById("priceChart")) return "detail";
    if (document.querySelector(".analysis-controls")) return "analysis";
    return "index";
  }

  function injectPetals() {
    if (document.querySelector(".petal-layer")) return;
    const layer = document.createElement("div");
    layer.className = "petal-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = Array.from({ length: 14 }, (_, index) => `<span style="--petal-index:${index}"></span>`).join("");
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
      ["analysis.html", "実績を分析"],
      ["howto.html", "使い方"],
    ].map(([href, label]) => `<a href="${href}"${currentFile === href ? ' class="active" aria-current="page"' : ""}>${label}</a>`).join("");
    headerMeta.prepend(nav);
  }

  function quickStartTemplate() {
    if (page === "index") {
      return `
        <section class="quickstart-banner panel" aria-label="おすすめの使い方">
          <div><span class="quickstart-label">はじめての方へ</span><strong>一覧 → 詳細 → 分析の3ステップで使えます</strong><p>まずはNEWまたは🌸コスモス注目から、気になる銘柄を3〜5社に絞りましょう。</p></div>
          <a class="button quickstart-button" href="howto.html#first-route">使い方を見る</a>
        </section>`;
    }
    if (page === "detail") {
      return `
        <section class="quickstart-banner compact panel" aria-label="詳細ページの見方">
          <div><span class="quickstart-label">見る順番</span><strong>チャート → イベント → 過去実績 → 財務</strong><p>トレンド、直近の変動要因、再現性、企業体力を順番に確認します。</p></div>
          <a class="button quickstart-button" href="howto.html#detail-guide">詳しい見方</a>
        </section>`;
    }
    if (page === "analysis") {
      return `
        <section class="quickstart-banner compact panel" aria-label="分析ページの基本">
          <div><span class="quickstart-label">分析の基本</span><strong>前半で条件を探し、後半で答え合わせ</strong><p>平均だけでなく、中央値・最大下落・対象件数・指数超過をセットで確認します。</p></div>
          <a class="button quickstart-button" href="howto.html#analysis-guide">分析の使い方</a>
        </section>`;
    }
    return "";
  }

  function injectQuickStart(main) {
    const markup = quickStartTemplate();
    if (!markup || main.querySelector(".quickstart-banner")) return;
    const holder = document.createElement("div");
    holder.innerHTML = markup.trim();
    main.prepend(holder.firstElementChild);
  }

  function template() {
    const avatarButtons = Object.entries(characters).map(([key, value]) => `
      <button class="character-avatar" type="button" data-character="${key}" aria-label="${value.name}のヒントを表示">
        <span class="character-avatar-image ${key}" aria-hidden="true"></span>
      </button>`).join("");
    return `
      <section class="character-guide panel" aria-label="コスモス・ルーモ・エールの使い方ヒント">
        <div class="character-avatar-rail">${avatarButtons}</div>
        <div class="character-speech">
          <div class="character-speech-heading">
            <div><strong id="characterName"></strong></div>
            <button class="character-close" type="button" aria-label="ヒントを小さくする">×</button>
          </div>
          <p id="characterMessage"></p>
          <div class="character-actions">
            <span id="characterCount"></span>
            <button class="character-next button secondary" type="button">次のヒント</button>
          </div>
        </div>
        <button class="character-reopen" type="button">3人のヒントを開く</button>
      </section>`;
  }

  function show(index) {
    const pageMessages = messages[page] || messages.index;
    current = (index + pageMessages.length) % pageMessages.length;
    const message = pageMessages[current];
    const character = characters[message.character];
    root.dataset.activeCharacter = message.character;
    root.querySelector("#characterName").textContent = character.name;
    root.querySelector("#characterMessage").textContent = message.text;
    root.querySelector("#characterCount").textContent = `${current + 1} / ${pageMessages.length}`;
    root.querySelectorAll(".character-avatar").forEach((button) => {
      button.classList.toggle("active", button.dataset.character === message.character);
    });
  }

  function showCharacter(character, text = null) {
    if (!root) return;
    if (text) {
      const profile = characters[character];
      root.dataset.activeCharacter = character;
      root.querySelector("#characterName").textContent = profile.name;
      root.querySelector("#characterMessage").textContent = text;
      root.querySelector("#characterCount").textContent = "操作ヒント";
      root.querySelectorAll(".character-avatar").forEach((button) => button.classList.toggle("active", button.dataset.character === character));
      root.classList.remove("collapsed");
      return;
    }
    const pageMessages = messages[page] || messages.index;
    const nextIndex = pageMessages.findIndex((message, index) => index > current && message.character === character);
    const firstIndex = pageMessages.findIndex((message) => message.character === character);
    show(nextIndex >= 0 ? nextIndex : firstIndex);
  }

  function bindPageEvents() {
    if (page === "analysis") {
      document.getElementById("presetArticle")?.addEventListener("click", () => {
        showCharacter("lumo", "いつもの条件を入れたよ！ ここからRSIや移動平均線を一つずつ変えると、何が効いているか分かりやすいよ✨");
      });
      document.getElementById("presetHighZone")?.addEventListener("click", () => showCharacter("lumo", "52週高値から−10%以内に絞ったよ！ 高値圏にいる会社の、その後を見てみよう✨"));
      document.getElementById("presetVcpTrend")?.addEventListener("click", () => showCharacter("cosmos", "VCP・第2ステージ・Supertrend上向きを重ねたよ。条件を増やした分、対象件数も確認しようね🌸"));
      document.getElementById("researchPeriod")?.addEventListener("change", (event) => {
        if (event.target.value === "validate") showCharacter("aile", "ここは後半の答え合わせです。前半で良かった条件が、別の期間でも続いたかを確認しましょう。");
      });
      ["operatingCf", "freeCf", "roeMin", "revenueGrowthMin", "equityRatioMin"].forEach((id) => {
        document.getElementById(id)?.addEventListener("change", () => showCharacter("aile"));
      });
      document.querySelectorAll("[data-pattern]").forEach((card) => card.addEventListener("click", () => {
        const label = card.dataset.pattern === "CLOSED" ? "OUT済み" : card.dataset.pattern === "ACTIVE" ? "継続中" : "全体";
        showCharacter("cosmos", `${label}の実績に切り替えたよ。平均だけでなく、中央値とプラス比率も一緒に見てみよう🌸`);
      }));
    }
    if (page === "index") {
      let timer;
      document.getElementById("searchInput")?.addEventListener("input", (event) => {
        clearTimeout(timer);
        if (!event.target.value.trim()) return;
        timer = setTimeout(() => showCharacter("lumo", "検索できたかな？ 会社名を全部入力しなくても、一部の文字や4桁コードで探せるよ✨"), 500);
      });
    }
  }

  function init() {
    document.body.classList.add("pastel-theme");
    injectPetals();
    injectNavigation();

    const main = document.querySelector("main.container");
    if (!main) return;
    page = detectPage();
    injectQuickStart(main);

    const holder = document.createElement("div");
    holder.innerHTML = template().trim();
    root = holder.firstElementChild;
    const quickstart = main.querySelector(".quickstart-banner");
    if (quickstart) quickstart.insertAdjacentElement("afterend", root);
    else main.prepend(root);

    root.querySelector(".character-next").addEventListener("click", () => show(current + 1));
    root.querySelector(".character-close").addEventListener("click", () => root.classList.add("collapsed"));
    root.querySelector(".character-reopen").addEventListener("click", () => root.classList.remove("collapsed"));
    root.querySelectorAll(".character-avatar").forEach((button) => button.addEventListener("click", () => showCharacter(button.dataset.character)));
    show(0);
    bindPageEvents();
  }

  return { init, showCharacter };
})();

document.addEventListener("DOMContentLoaded", characterGuide.init);
