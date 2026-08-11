(() => {
  "use strict";
  const list = document.getElementById("largeHoldingsList");
  const empty = document.getElementById("largeHoldingsEmpty");
  const summary = document.getElementById("largeHoldingsSummary");
  const date = document.getElementById("largeHoldingsDate");
  const search = document.getElementById("largeHoldingsSearch");
  const kind = document.getElementById("largeHoldingsKind");
  const sort = document.getElementById("largeHoldingsSort");
  const more = document.getElementById("largeHoldingsMore");
  let payload = null;
  let limit = 80;
  const labels = {NEW_OVER_5:"新規5%超",INCREASE:"保有割合 増加",DECREASE:"保有割合 減少",IMPORTANT_PROPOSAL:"重要提案の可能性",CORRECTION:"訂正報告書",CHANGE_OTHER:"その他変更"};
  const classes = {NEW_OVER_5:"kind-new",INCREASE:"kind-up",DECREASE:"kind-down",IMPORTANT_PROPOSAL:"kind-important",CORRECTION:"kind-correction",CHANGE_OTHER:"kind-correction"};
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const finite = (value) => value === null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const pct = (value) => {const n=finite(value);return n===null?"—":`${n>0?"+":""}${n.toFixed(2)}pt`;};
  const safeSource = (item) => /^S[0-9A-Z]{6,39}$/.test(String(item.doc_id||"")) ? `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${encodeURIComponent(item.doc_id)}` : "";
  const isCorrection = (item) => item?.report_type === "訂正報告書" || item?.event_kind === "CORRECTION";
  const signalDelta = (item) => isCorrection(item) ? null : finite(item?.change_pct_point);
  function isNegativeImportantStatement(value){const compact=String(value||"").replace(/[\s。、・｡]/g,"");const exact=new Set(["なし","無し","該当なし","該当無し","該当ありません","該当事項なし","該当事項無し","該当事項はありません","該当事項ありません","当該事項なし","当該事項無し","該等事項はありません","該当する事項なし","特になし","特に無し","特にありません","記載事項はありません","ありません"]);if(!compact||exact.has(compact))return true;return [/重要提案行為等?を行う予定(?:は|が)?ありません/,/重要提案行為等?を行う予定(?:は|が)?ない/,/重要提案行為等?を行うことを目的とするものではありません/,/重要提案行為等?を行う意(?:思|図)(?:は|が)?ありません/,/重要提案行為等?は行いません/].some((pattern)=>pattern.test(compact));}
  function hasImportantProposal(item){const parts=String(item?.important_proposal_text||"").split(/\s*\/\s*/).filter(Boolean);const purpose=String(item?.purpose||"").replace(/[\s。、・｡]/g,"");return parts.some((part)=>!isNegativeImportantStatement(part))||(purpose.includes("重要提案")&&!isNegativeImportantStatement(purpose));}
  function matchesKind(item,selected){
    const delta=signalDelta(item);
    if(selected==="all")return true;
    if(selected==="NEW_OVER_5")return item.report_type==="大量保有報告書";
    if(selected==="INCREASE")return item.report_type==="変更報告書"&&delta!==null&&delta>0;
    if(selected==="DECREASE")return item.report_type==="変更報告書"&&delta!==null&&delta<0;
    if(selected==="IMPORTANT_PROPOSAL")return !isCorrection(item)&&hasImportantProposal(item);
    if(selected==="CORRECTION")return isCorrection(item);
    return item.event_kind===selected;
  }
  function badges(item){
    if(isCorrection(item))return [["CORRECTION",labels.CORRECTION]];
    const values=[];const delta=signalDelta(item);
    if(item.report_type==="大量保有報告書")values.push(["NEW_OVER_5",labels.NEW_OVER_5]);
    if(item.report_type==="変更報告書"&&delta!==null&&delta>0)values.push(["INCREASE",labels.INCREASE]);
    if(item.report_type==="変更報告書"&&delta!==null&&delta<0)values.push(["DECREASE",labels.DECREASE]);
    if(hasImportantProposal(item))values.push(["IMPORTANT_PROPOSAL",labels.IMPORTANT_PROPOSAL]);
    if(!values.length)values.push(["CHANGE_OTHER",labels.CHANGE_OTHER]);
    return values;
  }
  function filtered(){
    const query=String(search?.value||"").trim().toLowerCase();
    const selected=kind?.value||"all";
    const rows=[...(payload?.records||[])].filter((item)=>matchesKind(item,selected)&&(!query||`${item.security_code||""} ${item.issuer_name||""} ${item.filer_name||""}`.toLowerCase().includes(query)));
    rows.sort((a,b)=>{const av=signalDelta(a)??0,bv=signalDelta(b)??0;if(sort?.value==="increase")return bv-av;if(sort?.value==="decrease")return av-bv;if(sort?.value==="ratio")return (finite(b.current_ratio_pct)??-1)-(finite(a.current_ratio_pct)??-1);return String(b.submitted_at||"").localeCompare(String(a.submitted_at||""));});
    return rows;
  }
  function render(){
    if(!payload)return;
    const rows=filtered(),shown=rows.slice(0,limit);
    list.innerHTML=shown.map((item)=>{const source=safeSource(item);const delta=signalDelta(item);const chips=badges(item).map(([key,value])=>`<span class="large-holding-kind ${classes[key]||"kind-correction"}">${escapeHtml(value)}</span>`).join("");return `<article class="large-holding-card"><div><div class="large-holding-badges">${chips}</div><small>${escapeHtml(String(item.submitted_at||"").slice(0,10)||"—")}</small></div><div class="large-holding-stock"><strong><a href="detail.html?code=${encodeURIComponent(item.security_code||"")}">${escapeHtml(item.security_code||"—")} ${escapeHtml(item.issuer_name||"")}</a></strong><small>${escapeHtml(item.report_type||"")}</small></div><div class="large-holding-filer"><span>提出者</span><strong>${escapeHtml(item.filer_name||"—")}</strong><small>${escapeHtml(item.purpose||"目的記載なし")}</small></div><div class="large-holding-ratio"><strong>${finite(item.current_ratio_pct)===null?"—":`${Number(item.current_ratio_pct).toFixed(2)}%`}</strong>${isCorrection(item)?`<small>訂正報告（増減判定外）</small>`:`<small class="${delta>0?"up":delta<0?"down":""}">前回比 ${pct(delta)}</small>`}${source?`<a href="${source}" target="_blank" rel="noopener noreferrer">原本 ↗</a>`:""}</div></article>`;}).join("");
    empty.hidden=rows.length>0;more.hidden=rows.length<=limit;more.textContent=`さらに表示（残り ${Math.max(0,rows.length-limit)}件）`;
  }
  function liveFacets(){const records=payload?.records||[];return {NEW_OVER_5:records.filter((item)=>item.report_type==="大量保有報告書").length,INCREASE:records.filter((item)=>item.report_type==="変更報告書"&&(signalDelta(item)??0)>0).length,DECREASE:records.filter((item)=>item.report_type==="変更報告書"&&(signalDelta(item)??0)<0).length,IMPORTANT_PROPOSAL:records.filter((item)=>!isCorrection(item)&&hasImportantProposal(item)).length,CORRECTION:records.filter(isCorrection).length,CHANGE_OTHER:records.filter((item)=>item.event_kind==="CHANGE_OTHER").length};}
  async function init(){try{const response=await fetch("data/large-holdings/latest.json",{cache:"no-cache"});if(!response.ok)throw new Error(String(response.status));payload=await response.json();if(!payload.ready){date.textContent="初回生成待ち";summary.innerHTML="<span>EDINET APIキーを端末内で入力し、初回更新すると表示されます</span>";}else{date.textContent=`更新 ${String(payload.generated_at||"").slice(0,10)||"—"}`;summary.innerHTML=Object.entries(liveFacets()).map(([key,value])=>`<span>${escapeHtml(labels[key]||key)} ${Number(value||0)}件</span>`).join("");}render();}catch(error){date.textContent="データ未生成";empty.hidden=false;empty.textContent=`データを読み込めませんでした（${escapeHtml(error.message)}）`;}}
  [search,kind,sort].forEach((element)=>element?.addEventListener(element===search?"input":"change",()=>{limit=80;render();}));more?.addEventListener("click",()=>{limit+=80;render();});init();
})();
