const characterGuide = (() => {
  const characters = {
    cosmos: { name: "コスモス🌸", label: "整理する案内役" },
    lumo: { name: "ルーモ✨", label: "元気な発見役" },
    aile: { name: "エール💜", label: "読者目線の確認役" },
  };

  const messages = {
    index: [
      { character: "cosmos", text: "まずはNEWとOUTを分けて見てみよう。NEWは月足RSI5がRSI14を上抜けた最初の月だよ🌸" },
      { character: "lumo", text: "銘柄コードでも会社名でも検索できるよ！ 気になる会社を見つけたら、名前をタップして詳しく見てみよう✨" },
      { character: "aile", text: "数字が『—』の項目は取得できなかったデータです。0とは意味が違うから、そこだけ気をつけてね。" },
    ],
    analysis: [
      { character: "cosmos", text: "RSI5とRSI14は別々に範囲を決められるよ。差だけでは見えなかった月足の温度を、一緒に比べてみよう🌸" },
      { character: "lumo", text: "『記事の条件を適用』なら、いつもの3段階のふるいを一度に試せるよ！ そのあと数字を変えて遊んでみよう✨" },
      { character: "aile", text: "テクニカルはNEW当時、財務は現在の最新値です。同じ時点の数字ではないから、過去成績を見る時は混ぜすぎないでね。" },
      { character: "cosmos", text: "対象が0件になったら、条件をひとつずつ戻してみよう。どの条件で銘柄が減ったのかも、大切な発見だよ。" },
    ],
    detail: [
      { character: "cosmos", text: "上段は株価、下段は月足RSIだよ。月ごとの大きな流れと、その後の株価を並べて観察してみよう🌸" },
      { character: "lumo", text: "GC実績の表では、始まった月からOUTまでの動きを追えるよ。継続中の銘柄もちゃんと残ってるよ！✨" },
      { character: "aile", text: "これは売買サインではなく、研究用の見える化です。数字だけで急いで結論を出さなくて大丈夫。" },
      { character: "cosmos", text: "財務情報に『—』があっても、会社が悪いという意味ではないよ。取得元にデータがない場合もあります。" },
    ],
  };

  let page = "index";
  let current = 0;
  let root;

  function detectPage() {
    if (document.getElementById("episodeTable")) return "analysis";
    if (document.getElementById("priceChart")) return "detail";
    return "index";
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
            <div><strong id="characterName"></strong><small id="characterRole"></small></div>
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
    const pageMessages = messages[page];
    current = (index + pageMessages.length) % pageMessages.length;
    const message = pageMessages[current];
    const character = characters[message.character];
    root.dataset.activeCharacter = message.character;
    root.querySelector("#characterName").textContent = character.name;
    root.querySelector("#characterRole").textContent = character.label;
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
      root.querySelector("#characterRole").textContent = profile.label;
      root.querySelector("#characterMessage").textContent = text;
      root.querySelector("#characterCount").textContent = "操作ヒント";
      root.querySelectorAll(".character-avatar").forEach((button) => button.classList.toggle("active", button.dataset.character === character));
      root.classList.remove("collapsed");
      return;
    }
    const nextIndex = messages[page].findIndex((message, index) => index > current && message.character === character);
    const firstIndex = messages[page].findIndex((message) => message.character === character);
    show(nextIndex >= 0 ? nextIndex : firstIndex);
  }

  function bindPageEvents() {
    if (page === "analysis") {
      document.getElementById("presetArticle")?.addEventListener("click", () => {
        showCharacter("lumo", "いつもの条件を入れたよ！ ここからRSIや移動平均線を少しずつ変えると、条件ごとの成績を比べられるよ✨");
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
    const main = document.querySelector("main.container");
    if (!main) return;
    page = detectPage();
    const holder = document.createElement("div");
    holder.innerHTML = template().trim();
    root = holder.firstElementChild;
    main.prepend(root);
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
