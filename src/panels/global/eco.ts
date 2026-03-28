import { API, fp, ld } from '../../core/utils.js';

export async function doEco(el){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Fetching economic release calendar\u2026');

  const today=new Date().toISOString().slice(0,10);
  function addDays(iso,n){const d=new Date(iso+'T12:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
  let _ev=[], _filter='all';
  let _from=addDays(today,-14), _to=addDays(today,28);

  const DAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const CAT_ABBR={labor:'LAB',inflation:'INF',growth:'GDP',monetary:'FED',housing:'HSG',trade:'TRD',sentiment:'SNT'};

  // Impact: orange filled bars, dark empty
  function impactBars(n){
    return `<span style="color:var(--orange);letter-spacing:1.5px">${'\u25ae'.repeat(n)}</span><span style="color:#2c2c2c;letter-spacing:1.5px">${'\u25ae'.repeat(3-n)}</span>`;
  }

  function actualColor(ev){
    if(ev.actual_num==null||ev.prior_num==null||ev.better_hi==null) return '#aaa';
    return (ev.better_hi?ev.actual_num>ev.prior_num:ev.actual_num<ev.prior_num)?'var(--green)':'#f87171';
  }

  // Grid columns: # | TIME | CC | IMP | CAT | EVENT | PERIOD | ACTUAL | PRIOR
  const GRID='24px 62px 28px 48px 34px 1fr 66px 88px 88px';

  function renderSection(sortedDays, groups, isUpcoming){
    if(!sortedDays.length) return '';
    const divLabel = isUpcoming ? 'UPCOMING' : 'RELEASED';
    let html=`<div style="padding:5px 14px 4px;font-size:10px;color:#666;letter-spacing:.18em;border-bottom:1px solid #111;display:flex;align-items:center;gap:8px"><span style="color:#333;flex:1;border-top:1px solid #252525;margin-right:4px"></span>${divLabel}<span style="color:#333;flex:1;border-top:1px solid #252525;margin-left:4px"></span></div>`;
    let n=0;
    for(const day of sortedDays){
      const isToday=day===today;
      const d=new Date(day+'T12:00');
      const dayStr=`${DAYS[d.getDay()]}  ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}, ${d.getFullYear()}`;
      const dayEvs=groups[day];
      const highImpact=dayEvs.some(e=>e.impact===3);
      html+=`<div style="border-left:2px solid ${isToday?'var(--orange)':'transparent'}">
        <div style="padding:5px 14px 5px 12px;background:#0e0e0e;font-size:11px;color:${isToday?'var(--orange)':'#999'};letter-spacing:.14em;position:sticky;top:0;z-index:1;border-bottom:1px solid #121212;display:flex;align-items:center;gap:10px">
          <span style="font-weight:700">${dayStr}</span>
          ${highImpact?`<span style="font-size:9px;color:var(--orange);opacity:.85;letter-spacing:.1em">HIGH IMPACT</span>`:''}
          <span style="margin-left:auto;font-size:9px;color:#555">${dayEvs.length} RELEASE${dayEvs.length!==1?'S':''}</span>
        </div>`;
      for(const ev of dayEvs){
        n++;
        const actColor=ev.past?actualColor(ev):'#555';
        const actVal=ev.past?(ev.actual??'\u2014'):'\u2014';
        const priVal=ev.prior??'\u2014';
        const catAbbr=CAT_ABBR[ev.category]||ev.category.slice(0,3).toUpperCase();
        const isBeat=ev.past&&ev.actual_num!=null&&ev.prior_num!=null&&ev.better_hi!=null&&(ev.better_hi?ev.actual_num>ev.prior_num:ev.actual_num<ev.prior_num);
        const isMiss=ev.past&&ev.actual_num!=null&&ev.prior_num!=null&&ev.better_hi!=null&&!isBeat&&ev.better_hi!==null;
        const rowBg=ev.impact===3?'background:rgba(240,140,0,.06)':'';
        html+=`<div style="display:grid;grid-template-columns:${GRID};align-items:center;padding:7px 14px 7px 12px;border-bottom:1px solid #1a1a1a;${rowBg}" title="${ev.name}">
          <span style="color:#666;font-size:11px">${n}</span>
          <span style="color:#999;font-size:11px;letter-spacing:.04em">${ev.time||'\u2014'}</span>
          <span style="color:#bbb;font-size:11px;font-weight:600;letter-spacing:.04em">${ev.country}</span>
          <span style="font-size:11px">${impactBars(ev.impact)}</span>
          <span style="color:#666;font-size:10px;letter-spacing:.07em">${catAbbr}</span>
          <span style="color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:14px;font-size:11px">${ev.name}</span>
          <span style="color:#888;font-size:11px;letter-spacing:.04em">${ev.period||'\u2014'}</span>
          <span style="color:${actColor};font-size:11px;font-weight:${isBeat||isMiss?'700':'400'};letter-spacing:.03em">${actVal}</span>
          <span style="color:#999;font-size:11px;letter-spacing:.03em">${priVal}</span>
        </div>`;
      }
      html+='</div>';
    }
    return html;
  }

  function render(){
    const body=document.getElementById('eco-body');if(!body)return;
    let evs=_ev.filter(e=>e.date>=_from&&e.date<=_to);
    if(_filter!=='all')evs=evs.filter(e=>e.category===_filter);
    if(!evs.length){
      body.innerHTML=`<div style="padding:40px;text-align:center;color:#666;font-size:11px;letter-spacing:.1em">NO RELEASES IN SELECTED RANGE</div>`;
      return;
    }
    const groups={};
    evs.forEach(e=>{if(!groups[e.date])groups[e.date]=[];groups[e.date].push(e);});
    const allDays=Object.keys(groups).sort();
    const upcomingDays=allDays.filter(d=>d>=today);
    const pastDays=allDays.filter(d=>d<today).reverse();
    body.innerHTML=
      renderSection(upcomingDays,groups,true)+
      renderSection(pastDays,groups,false);
  }

  function buildShell(){
    const allCats=[...new Set(_ev.map(e=>e.category))].sort();
    const INP='background:#0a0a0a;border:1px solid #2c2c2c;color:#aaa;font-family:inherit;font-size:10px;padding:3px 7px;border-radius:2px;outline:none;width:108px;letter-spacing:.04em;';
    const pillBase='cursor:pointer;padding:2px 10px;font-size:9px;border:1px solid #2c2c2c;border-radius:2px;letter-spacing:.1em;color:#888;transition:color .1s,border-color .1s';
    el.innerHTML=`
      <div style="display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;gap:5px;flex-wrap:wrap;background:#0a0a0a">
        <span style="font-size:9px;color:#777;letter-spacing:.1em">FROM</span>
        <input id="eco-from" type="date" value="${_from}" style="${INP}">
        <span style="font-size:9px;color:#777;letter-spacing:.1em">TO</span>
        <input id="eco-to" type="date" value="${_to}" style="${INP}">
        <span id="eco-today" style="${pillBase}" onmouseover="this.style.color='var(--orange)';this.style.borderColor='var(--orange)'" onmouseout="this.style.color='#888';this.style.borderColor='#2c2c2c'">TODAY</span>
        <span style="width:1px;height:14px;background:#2e2e2e;margin:0 2px"></span>
        <span class="eco-fi" data-k="all" style="${pillBase}${_filter==='all'?';color:var(--orange);border-color:var(--orange)':''}">ALL</span>
        ${allCats.map(k=>`<span class="eco-fi" data-k="${k}" style="${pillBase}${_filter===k?';color:var(--orange);border-color:var(--orange)':''}">${(CAT_ABBR[k]||k.slice(0,3)).toUpperCase()}</span>`).join('')}
        <span style="margin-left:auto;font-size:8px;color:#555;letter-spacing:.08em">FRED \u00b7 STLOUISFED.ORG \u00b7 \u2190\u2192 WEEK</span>
      </div>
      <div style="display:grid;grid-template-columns:${GRID};padding:5px 14px 5px 12px;border-bottom:1px solid #111;font-size:10px;color:#666;letter-spacing:.12em;background:#0a0a0a;flex-shrink:0">
        <span>#</span><span>TIME ET</span><span>CC</span><span>IMP</span><span>TYPE</span><span>EVENT</span><span>PERIOD</span><span>ACTUAL</span><span>PRIOR</span>
      </div>
      <div id="eco-body" style="flex:1;overflow-y:auto"></div>`;

    el.querySelector('#eco-from').addEventListener('change',e=>{_from=e.target.value;render();});
    el.querySelector('#eco-to').addEventListener('change',e=>{_to=e.target.value;render();});
    el.querySelector('#eco-today').addEventListener('click',()=>{
      _from=addDays(today,-14);_to=addDays(today,28);
      el.querySelector('#eco-from').value=_from;
      el.querySelector('#eco-to').value=_to;
      render();
    });
    el.addEventListener('keydown',e=>{
      if(document.activeElement&&(document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='SELECT')) return;
      if(e.key==='ArrowRight'){e.preventDefault();_from=addDays(_from,7);_to=addDays(_to,7);el.querySelector('#eco-from').value=_from;el.querySelector('#eco-to').value=_to;render();}
      else if(e.key==='ArrowLeft'){e.preventDefault();_from=addDays(_from,-7);_to=addDays(_to,-7);el.querySelector('#eco-from').value=_from;el.querySelector('#eco-to').value=_to;render();}
    });
    el.querySelectorAll('.eco-fi').forEach(f=>f.addEventListener('click',()=>{
      _filter=f.dataset.k;
      el.querySelectorAll('.eco-fi').forEach(x=>{
        const active=x.dataset.k===_filter;
        x.style.color=active?'var(--orange)':'#404040';
        x.style.borderColor=active?'var(--orange)':'#1e1e1e';
      });
      render();
    }));
    render();
  }

  try{
    const r=await fetch(`${API}/eco`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    _ev=r.events||[];
    buildShell();
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}
