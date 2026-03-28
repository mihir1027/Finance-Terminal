import { API, ld } from '../../core/utils.js';

export async function doN(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Fetching Google News for ${tk}…`);
  try{
    const r=await fetch(`${API}/news/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    if(!r.news.length){el.innerHTML=`<div class="empty">No news found for ${tk}</div>`;return;}

    // Header strip showing source + count
    const srcLabel = r.source === 'google_news_rss'
      ? `<span style="color:var(--green);font-size:8px">● GOOGLE NEWS RSS</span>`
      : `<span style="color:var(--amber);font-size:8px">● yfinance fallback</span>`;

    const newsHTML = r.news.map(n => {
      // Format pub date nicely — Google News gives RFC 2822 strings
      let timeStr = '';
      if(n.pubDate){
        try{
          const d = new Date(n.pubDate);
          const now = new Date();
          const diffMs = now - d;
          const diffMin = Math.floor(diffMs/60000);
          const diffHr  = Math.floor(diffMs/3600000);
          const diffDay = Math.floor(diffMs/86400000);
          if(diffMin < 60)       timeStr = `${diffMin}m ago`;
          else if(diffHr < 24)   timeStr = `${diffHr}h ago`;
          else if(diffDay < 7)   timeStr = `${diffDay}d ago`;
          else timeStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
        }catch(e){ timeStr = n.pubDate.substring(0,16); }
      }
      // Sentiment color hint based on keywords
      const titleLc = (n.title||'').toLowerCase();
      const isBull = /beat|surge|soar|rally|upgrade|buy|strong|gain|up|record|high/.test(titleLc);
      const isBear = /miss|fall|drop|decline|cut|sell|weak|loss|down|layoff|crash|plunge/.test(titleLc);
      const sentDot = isBull
        ? `<span style="color:var(--green);font-size:9px">▲</span>`
        : isBear
        ? `<span style="color:var(--red);font-size:9px">▼</span>`
        : `<span style="color:var(--dim);font-size:9px">●</span>`;

      return `<div class="ni"${n.url?` onclick="window.open('${n.url.replace(/'/g,"\\'")}','_blank')"`:''}
        style="cursor:${n.url?'pointer':'default'}">
        <div class="ni-meta">
          ${sentDot}
          <span class="ni-src">${n.provider||'Google News'}</span>
          <span class="ni-time" style="color:${timeStr.includes('m ago')?'var(--green)':'var(--dim)'}">${timeStr}</span>
        </div>
        <div class="ni-title">${n.title}</div>
        ${n.summary?`<div class="ni-sum">${n.summary}</div>`:''}
      </div>`;
    }).join('');

    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:#0a0a0a">
        ${srcLabel}
        <span style="font-size:8px;color:var(--dim)">${r.count} articles · last 7 days</span>
        <span style="font-size:8px;color:var(--dim);cursor:pointer" onclick="doN(this.closest('.wbody'),'${tk}')">↻ refresh</span>
      </div>
      <div style="flex:1;overflow-y:auto">${newsHTML}</div>
    `;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

