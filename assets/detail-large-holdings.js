(() => {
  "use strict";
  const code = (new URLSearchParams(location.search).get("code") || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const status = document.getElementById("detailLargeHoldingsStatus");
  const summary = document.getElementById("detailLargeHoldingsSummary");
  const list = document.getElementById("detailLargeHoldingsList");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const finite = (value) => value === null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const isCorrection = (item) => item?.report_type === "訂正報告書" || item?.event_kind === "CORRECTION";
  function isNegativeImportantStatement(value){const compact=String(value||"").replace(/[\s。、・｡]/g,"");const exact=new Set(["なし","無し","該当なし","該当無し","該当ありません","該当事項なし","該当事項無し","該当事項はありません","該当事項ありません","当該事項なし","当該事項無し","該等事項はありません","該当する事項なし","特になし","特に無し","特にありません","記載事項はありません","ありません"]);if(!compact||exact.has(compact))return true;return [/重要提案行為等?を行う予定(?:は|が)?ありません/,/重要提案行為等?を行う予定(?:は|が)?ない/,/重要提案行為等?を行うことを目的とするものではありません/,/重要提案行為等?を行う意(?:思|図)(?:は|が)?ありません/,/重要提案行為等?は行いません/].some((pattern)=>pattern.test(compact));}
  function hasImportantProposal(item){const parts=String(item?.important_proposal_text||"").split(/\s*\/\s*/).filter(Boolean);const purpose=String(item?.purpose||"").replace(/[\s。、・｡]/g,"");return parts.some((part)=>!isNegativeImportantStatement(part))||(purpose.includes("重要提案")&&!isNegativeImportantStatement(purpose));}
  function labels(item){if(isCorrection(item))return "訂正";const values=[];const delta=finite(item?.change_pct_point);if(item.report_type==="大量保有報告書")values.push("新規5%超");if(item.report_type==="変更報告書"&&delta!==null&&delta>0)values.push("保有割合 増加");if(item.report_type==="変更報告書"&&delta!==null&&delta<0)values.push("保有割合 減少");if(hasImportantProposal(item))values.push("重要提案の可能性");return values.join("・")||"変更";}
  async function init(){
    if(!/^[0-9]{3}[0-9A-Z]$/.test(code)){status.textContent="コードなし";return;}
    try{
      const response=await fetch(`data/large-holdings/${code.slice(0,2)}.json`,{cache:"no-cache"});
      if(response.status===404){status.textContent="報告なし";list.innerHTML="<p>現在保存している期間に、この銘柄の報告書はありません。</p>";return;}
      if(!response.ok)throw new Error(String(response.status));
      const payload=await response.json();const rows=payload?.records_by_code?.[code]||[];
      status.textContent=rows.length?`${rows.length}件`:"報告なし";
      if(!rows.length){list.innerHTML="<p>現在保存している期間に、この銘柄の報告書はありません。</p>";return;}
      const latest=rows.find((item)=>!isCorrection(item))||rows[0];summary.innerHTML=`<span>最新 ${escapeHtml(String(latest.submitted_at||"").slice(0,10)||"—")}</span><span>保有割合 ${finite(latest.current_ratio_pct)===null?"—":Number(latest.current_ratio_pct).toFixed(2)+"%"}</span><span>提出者 ${escapeHtml(latest.filer_name||"—")}</span>`;
      list.innerHTML=rows.slice(0,8).map((item)=>{const delta=isCorrection(item)?null:finite(item.change_pct_point);const source=/^S[0-9A-Z]{6,39}$/.test(String(item.doc_id||""))?`https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${encodeURIComponent(item.doc_id)}`:"";return `<article class="detail-large-holding-row"><div><span class="detail-large-holding-kind">${escapeHtml(labels(item))}</span><small>${escapeHtml(String(item.submitted_at||"").slice(0,10)||"—")}</small></div><div class="detail-large-holding-filer"><strong>${escapeHtml(item.filer_name||"—")}</strong><small>${escapeHtml(item.purpose||"目的記載なし")}</small></div><div><strong>${finite(item.current_ratio_pct)===null?"—":Number(item.current_ratio_pct).toFixed(2)+"%"}</strong>${isCorrection(item)?"<small>増減判定外</small>":`<small class="detail-large-holding-ratio ${delta>0?"up":delta<0?"down":""}">前回比 ${delta===null?"—":`${delta>0?"+":""}${delta.toFixed(2)}pt`}</small>`}</div>${source?`<a href="${source}" target="_blank" rel="noopener noreferrer">EDINET原本 ↗</a>`:"<span>—</span>"}</article>`;}).join("");
    }catch(error){status.textContent="読込失敗";list.innerHTML="<p>大口保有データを読み込めませんでした。</p>";}
  }
  init();
})();
