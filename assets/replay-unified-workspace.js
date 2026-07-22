(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function byId(id) { return document.getElementById(id); }
  function button(label, action, extraClass = "") {
    return `<button type="button" class="unified-menu-button ${extraClass}" data-unified-action="${action}">${label}</button>`;
  }

  function buildIndicatorDetails(chartPanel) {
    if (!chartPanel || byId("unifiedIndicatorDetails")) return;
    const controls = chartPanel.querySelector(".indicator-controls");
    const monthlyBox = chartPanel.querySelector(".monthly-rsi-chart-box");
    const oscillatorBox = chartPanel.querySelector(".oscillator-chart-box");
    const monthlyHeading = monthlyBox?.previousElementSibling;
    const oscillatorHeading = oscillatorBox?.previousElementSibling;
    if (!controls && !monthlyBox && !oscillatorBox) return;

    const details = document.createElement("details");
    details.id = "unifiedIndicatorDetails";
    details.className = "unified-details unified-indicator-details";
    details.innerHTML = `<summary><span>指標・サブチャート</span><small>必要な時だけ開く</small></summary><div id="unifiedIndicatorBody" class="unified-details-body"></div>`;
    const chartBox = chartPanel.querySelector(".pro-main-chart");
    chartPanel.insertBefore(details, chartBox || chartPanel.firstChild);
    const body = byId("unifiedIndicatorBody");
    [controls, monthlyHeading, monthlyBox, oscillatorHeading, oscillatorBox].filter(Boolean).forEach((node) => body.appendChild(node));
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      requestAnimationFrame(() => {
        if (typeof renderSynchronizedCharts === "function") renderSynchronizedCharts();
        if (typeof state !== "undefined") {
          state.rsiChart?.resize?.();
          state.oscillatorChart?.resize?.();
        }
      });
    });
  }

  function installDrawer(workspace) {
    if (byId("unifiedDrawer")) return;
    const drawer = document.createElement("aside");
    drawer.id = "unifiedDrawer";
    drawer.className = "unified-drawer";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = `
      <div class="unified-drawer-header">
        <div><span class="mini-kicker">KABUTANE MENU</span><h2 id="unifiedDrawerTitle">売買ルール</h2></div>
        <button type="button" class="unified-close-button" data-unified-action="close-drawer" aria-label="メニューを閉じる">×</button>
      </div>
      <div id="unifiedDrawerBody" class="unified-drawer-body"></div>`;
    const backdrop = document.createElement("button");
    backdrop.id = "unifiedDrawerBackdrop";
    backdrop.className = "unified-drawer-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("data-unified-action", "close-drawer");
    backdrop.setAttribute("aria-label", "メニューを閉じる");
    document.body.append(backdrop, drawer);

    const risk = byId("workspaceRisk");
    const result = byId("workspaceResult");
    const account = document.querySelector(".account-panel");
    if (account && result) result.insertBefore(account, result.querySelector(".trade-history-panel") || null);
    [risk, result].filter(Boolean).forEach((panel) => {
      panel.classList.add("unified-drawer-panel");
      drawer.querySelector("#unifiedDrawerBody").appendChild(panel);
    });

    workspace.dataset.unifiedReady = "true";
  }

  function installUnifiedWorkspace() {
    const workspace = byId("replayWorkspace");
    const chart = byId("workspaceChart");
    const order = byId("workspaceOrder");
    if (!workspace || !chart || !order || workspace.dataset.unifiedInstalled === "true") return;
    workspace.dataset.unifiedInstalled = "true";
    document.body.classList.add("replay-unified");

    const toolbar = document.createElement("div");
    toolbar.id = "unifiedToolbar";
    toolbar.className = "unified-toolbar";
    toolbar.innerHTML = `
      <div class="unified-toolbar-title"><span>練習ワークスペース</span><strong>チャートを見ながら、その場で注文</strong></div>
      <div class="unified-toolbar-actions">
        ${button("注文", "toggle-order", "mobile-priority")}
        ${button("売買ルール", "open-risk")}
        ${button("指標", "toggle-indicators")}
        ${button("成績・履歴", "open-result")}
        ${button("共有画像", "open-share", "share-action")}
      </div>`;
    const topbar = workspace.querySelector(".workspace-topbar");
    workspace.insertBefore(toolbar, topbar || workspace.firstChild);

    const grid = document.createElement("div");
    grid.id = "unifiedMainGrid";
    grid.className = "unified-main-grid";
    if (topbar?.nextSibling) workspace.insertBefore(grid, topbar.nextSibling);
    else workspace.appendChild(grid);
    grid.append(chart, order);

    buildIndicatorDetails(chart.querySelector(".pro-chart-panel"));
    installDrawer(workspace);

    const orderHeading = order.querySelector(".order-workspace-heading h2");
    if (orderHeading) orderHeading.textContent = "注文";
    const orderText = order.querySelector(".order-workspace-heading p");
    if (orderText) orderText.textContent = "チャートを見ながら、自動・手動の注文を操作します。";

    requestAnimationFrame(() => {
      if (typeof renderSynchronizedCharts === "function" && !byId("practiceArea")?.hidden) renderSynchronizedCharts();
    });
  }

  function closeDrawer() {
    document.body.classList.remove("unified-drawer-open");
    byId("unifiedDrawer")?.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".unified-drawer-panel").forEach((panel) => panel.classList.remove("unified-drawer-panel-active"));
  }

  function openDrawer(name) {
    const drawer = byId("unifiedDrawer");
    if (!drawer) return;
    const target = name === "result" ? byId("workspaceResult") : byId("workspaceRisk");
    document.querySelectorAll(".unified-drawer-panel").forEach((panel) => panel.classList.toggle("unified-drawer-panel-active", panel === target));
    const title = byId("unifiedDrawerTitle");
    if (title) title.textContent = name === "result" ? "成績・履歴" : "売買ルール";
    document.body.classList.add("unified-drawer-open");
    drawer.setAttribute("aria-hidden", "false");
    if (name === "result" && typeof renderAll === "function") renderAll();
  }

  function toggleIndicators() {
    const details = byId("unifiedIndicatorDetails");
    if (!details) return;
    details.open = !details.open;
    details.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function toggleOrder() {
    document.body.classList.toggle("unified-order-open");
    if (document.body.classList.contains("unified-order-open")) {
      byId("workspaceOrder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleAction(action) {
    if (action === "open-risk") openDrawer("risk");
    else if (action === "open-result") openDrawer("result");
    else if (action === "close-drawer") closeDrawer();
    else if (action === "toggle-indicators") toggleIndicators();
    else if (action === "toggle-order") toggleOrder();
    else if (action === "open-share") document.dispatchEvent(new CustomEvent("kabutane:open-share-report"));
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-unified-action]");
    if (!control) return;
    handleAction(control.dataset.unifiedAction);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      if (typeof state !== "undefined") {
        state.chart?.resize?.();
        state.rsiChart?.resize?.();
        state.oscillatorChart?.resize?.();
      }
    });
  });

  installUnifiedWorkspace();
})();
