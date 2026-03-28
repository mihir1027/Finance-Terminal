import { ow } from './windowManager.js';
import { openQM } from '../panels/global/qm.js';
import { doFa } from '../panels/ticker/fa.js';
import { doG } from '../panels/ticker/g.js';
import { doDes } from '../panels/ticker/des.js';
import { doN } from '../panels/ticker/n.js';
import { doHds } from '../panels/ticker/hds.js';
import { doHldr } from '../panels/ticker/hldr.js';
import { doAnr } from '../panels/ticker/anr.js';
import { doCf } from '../panels/ticker/cf.js';
import { doHp } from '../panels/ticker/hp.js';
import { doFocus } from '../panels/ticker/focus.js';
import { doWei } from '../panels/global/wei.js';
import { doGlco, doWcr } from '../panels/global/perf.js';
import { doFx } from '../panels/global/fx.js';
import { doMost } from '../panels/global/most.js';
import { doPred } from '../panels/global/pred.js';
import { doFisc } from '../panels/global/fisc.js';
import { doEco } from '../panels/global/eco.js';
import { doMacro } from '../panels/global/mac.js';
import { doRate } from '../panels/global/rate.js';
import { doEqs } from '../panels/global/eqs.js';
import { doGc } from '../panels/global/gc.js';
import { doSecf } from '../panels/global/secf.js';
import { doGp } from '../panels/global/gp.js';
import { doSovgWorld, doSovgCountry } from '../panels/global/sovg.js';
import { doSOVM } from '../panels/global/sovm.js';
import { doModl } from '../panels/ticker/modl.js';
import { doErn } from '../panels/ticker/ern.js';
import { doEm } from '../panels/ticker/em.js';
import { doEcal } from '../panels/global/ecal.js';
import { doBio } from '../panels/global/ni.js';
import { openResPanel } from '../panels/global/res.js';
import { doHelp } from '../panels/global/help.js';
import { doPdf } from '../panels/global/pdf.js';
import { doPlaceholder } from '../panels/global/placeholder.js';
import { PURE, SKIP, TICKER_ALIAS } from './commands.js';

export function parseRun(raw){
  const pts=raw.trim().split(/\s+/);
  // Resolve crypto aliases on the first token
  if(TICKER_ALIAS[pts[0]])pts[0]=TICKER_ALIAS[pts[0]];

  // Pure commands with optional country argument: SOVG US, WB DE, GOVT JP, SOVM DE
  if(['SOVG','WB','GOVT','SOVM'].includes(pts[0])){
    dispatch(null, pts[0], pts.slice(1));
    return;
  }
  if(PURE.has(pts[0])){dispatch(null,pts[0],pts.slice(1));return;}
  if(pts.length===1){dispatch(pts[0],'Q',[]);return;}

  // Handle "US SOVG" / "DE SOVM" pattern (country then command)
  if(pts.length===2 && ['SOVG','WB','GOVT','SOVM'].includes(pts[1])){
    dispatch(null, pts[1], [pts[0]]);
    return;
  }

  let i=1;while(i<pts.length&&SKIP.has(pts[i]))i++;
  dispatch(pts[0],pts[i]||'Q',pts.slice(i+1));
}
export function dispatch(t,cmd,args){
  (window as any).clog?.(`→ ${t||''} ${cmd}`,'cl-info');
  switch(cmd){
    case'Q':    return (window as any).showInlineQuote?.(t);
    case'DES':  return ow('des', t,`DES · ${t}`, 720,580,(e,tk,id)=>doDes(e,tk,id));
    case'FA':   return ow('fa',  t,`FA · ${t}`,  560,420,(e,tk,id)=>doFa(e,tk));
    case'G':    return ow('g',   t,`G · ${t}`,   720,520,(e,tk,id)=>doG(e,tk,'D',id));
    case'GIP':  return ow('g',   t,`GIP · ${t}`, 720,520,(e,tk,id)=>doG(e,tk,'1',id));
    case'N':    return ow('n',   t,`N · ${t}`,   400,440,(e,tk)=>doN(e,tk));
    case'HDS':  return ow('hds', t,`HDS · ${t}`, 520,380,(e,tk)=>doHds(e,tk));
    case'ANR':  return ow('anr', t,`ANR · ${t}`, 520,420,(e,tk)=>doAnr(e,tk));
    case'CF':   return ow('cf',  t,`CF · ${t}`,  520,380,(e,tk)=>doCf(e,tk));
    case'HP':   return ow('hp',  t,`HP · ${t}`,  500,380,(e,tk)=>doHp(e,tk));
    case'FOCUS':return ow('foc', t,`FOCUS · ${t}`,300,110,(e,tk,id)=>doFocus(e,tk,id));
    case'WEI':  return ow('mon', null,'WEI',       460,440,(e)=>doWei(e));
    case'GLCO': return ow('mon', null,'GLCO · COMMODITIES',780,680,(e,tk,id)=>doGlco(e,id));
    case'FX':   return ow('mon', null,'FX · FOREX',980,560,(e,tk,id)=>doFx(e,id));
    case'WCR':  return ow('mon', null,'WCR · WORLD CURRENCY RATES',680,520,(e,tk,id)=>doWcr(e,id));
    case'MOST': return ow('mon', null,'MOST',      460,380,(e)=>doMost(e));
    case'PRED': return ow('mon', null,'PRED · PREDICTION MARKETS',860,540,(e,_,id)=>doPred(e,id));
    case'FISC': return ow('mon', null,'FISC · US TREASURY FISCAL',940,580,(e,t,id)=>doFisc(e,id));
    case'ECO':  return ow('mon', null,'ECO · ECONOMIC CALENDAR',1060,600,(e)=>doEco(e));
    case'MAC':  return ow('mon',null,'MAC · US MACROECONOMIC INDICATORS',960,600,(e,t,id)=>doMacro(e,id));
    case'RATE': return ow('mon',null,'RATE · KEY RATES MONITOR',480,640,(e)=>doRate(e));
    case'EQS':  return ow('mon', null,'EQS · EQUITY SCREENER',940,560,(e,t,wid)=>doEqs(e,wid));
    case'SECF': return ow('mon', null,'SECF · SECURITIES FINDER',1100,620,(e,tk,id)=>doSecf(e,id));
    case'GC':   return ow('gc',  null,'GC · CURVES',1020,700,(e,tk,id)=>doGc(e,id));
    case'GP':   return ow('gp',  null,'GP · GRAPH PLOT',1060,580,(e,tk,id)=>doGp(e,id));
    case'SOVG': return args[0]
      ? ow('sovg', args[0].toUpperCase(), `SOVG · ${args[0].toUpperCase()}`, 680, 560, (e,tk,id)=>doSovgCountry(e, args[0].toUpperCase(), id))
      : ow('sovg', null, 'SOVG · WORLD BONDS', 860, 560, (e,tk,id)=>doSovgWorld(e,id));
    case'WB':   return ow('sovg', null, 'WB · WORLD BONDS', 860, 560, (e,tk,id)=>doSovgWorld(e,id));
    case'GOVT':
      // GOVT <CC> → country detail, GOVT alone → world monitor
      return args[0]
        ? ow('sovg', args[0].toUpperCase(), `GOVT · ${args[0].toUpperCase()}`, 680, 560, (e,tk,id)=>doSovgCountry(e, args[0].toUpperCase(), id))
        : ow('sovg', null, 'GOVT · WORLD BONDS', 860, 560, (e,tk,id)=>doSovgWorld(e,id));
    case'SOVM': {
      const cc=(args[0]||'US').toUpperCase();
      return ow('sovm',cc,`SOVM · ${cc} · SOVEREIGN DEBT MONITOR`,1120,580,(e,tk,id)=>doSOVM(e,cc,id));
    }
    case'MODL': return ow('modl',t,`MODL · ${t} · FINANCIAL MODEL`,1200,620,(e,tk,id)=>doModl(e,tk,id));
    case'HLDR': return ow('hldr',t,`HLDR · ${t} · ETF HOLDINGS`,1020,600,(e,tk,id)=>doHldr(e,tk,id));
    case'ERN':  return ow('ern', t,`ERN · ${t}`,640,520,(e,tk)=>doErn(e,tk));
    case'EM':   return ow('em',  t,`EM · ${t}`,1080,640,(e,tk,id)=>doEm(e,tk,id));
    case'ECAL': return ow('ecal',null,'ECAL · EARNINGS CALENDAR',1020,580,(e)=>doEcal(e));
    case'QM':   return openQM();
    case'NI':   {const q=args.join(' ');return ow('bio',null,`NI · ${q||'INTELLIGENCE'}`,580,520,(e)=>doBio(e,q));}
    case'BIO':  {const q=args.join(' ');return ow('bio',null,`BIO · ${q||'RESEARCH'}`,580,520,(e)=>doBio(e,q));}
    case'RES':  return openResPanel();
    case'HELP': return ow('help',null,'HELP · COMMAND REFERENCE',700,620,(e)=>doHelp(e));
    case'PDF':  return ow('pdf',null,'PDF · PREFERENCES DISPLAY FUNCTIONS',800,460,(e,t,id)=>doPdf(e,id));
    case'CORP':  return ow('ph',null,'CORP · CORPORATE BONDS',  420,280,(e)=>doPlaceholder(e,'CORP','Corporate bond market — not yet implemented'));
    case'MTGE':  return ow('ph',null,'MTGE · MORTGAGE',         420,280,(e)=>doPlaceholder(e,'MTGE','Mortgage-backed securities — not yet implemented'));
    case'M-MKT': return ow('ph',null,'M-MKT · MONEY MARKET',    420,280,(e)=>doPlaceholder(e,'M-MKT','Money market securities — not yet implemented'));
    case'MUNI':  return ow('ph',null,'MUNI · MUNICIPAL BONDS',  420,280,(e)=>doPlaceholder(e,'MUNI','Municipal bond market — not yet implemented'));
    case'PFD':   return ow('ph',null,'PFD · PREFERRED',         420,280,(e)=>doPlaceholder(e,'PFD','Preferred securities — not yet implemented'));
    case'PORT':  return ow('ph',null,'PORT · PORTFOLIO',        420,280,(e)=>doPlaceholder(e,'PORT','Portfolio management — not yet implemented'));
    default: if(t)dispatch(t,'Q',[]); else (window as any).clog?.(`ERR: Unknown command "${cmd}". Type HELP.`,'cl-err');
  }
}
