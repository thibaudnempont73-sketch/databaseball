// ════════════════════════════════════════════════════════════════
// BACKTEST DataBaseball — valide/ajuste le modèle sur résultats RÉELS
// ────────────────────────────────────────────────────────────────
// Reconstruit chaque match passé AVANT le match (point-in-time, byDateRange →
// aucune fuite du futur), fait tourner le VRAI calcEquipe (importé), compare au
// vainqueur réel. Met les matchs en CACHE disque pour itérer sur les variantes
// sans re-télécharger. Compare plusieurs variantes pur-math + fit logistique.
//
// Exclus (honnête) : platoon (pas de split G/D borné dans le temps → fuite),
//   forme 10 matchs / fatigue / streak (coût fetch, poids faibles),
//   PRIOR-MARCHÉ (pas de cotes historiques → non backtestable, voir forward-test).
//
// Usage : node scripts/backtest.mjs [start] [end]
// ════════════════════════════════════════════════════════════════
import { calcEquipe, normProba, calcFIP, pythagorean, statsLigue, LG, estimerMatch, PARK } from './build-data.mjs';
import fs from 'fs';

const MLB='https://statsapi.mlb.com/api/v1';
const SEASON=2026;
const SEASON_START=`${SEASON}-03-18`;
const START=process.argv[2]||`${SEASON}-04-15`;
const END=process.argv[3]||`${SEASON}-06-22`;
const CACHE=`scripts/backtest-cache-v2-${START}_${END}.json`;

const fmt=d=>d.toISOString().split('T')[0];
const dayBefore=ds=>fmt(new Date(new Date(ds+'T00:00:00Z').getTime()-864e5));
const daysBack=(ds,n)=>fmt(new Date(new Date(ds+'T00:00:00Z').getTime()-n*864e5));
const num=x=>x==null?null:(isNaN(parseFloat(x))?null:parseFloat(x));

let fetches=0;
async function j(u){for(let i=0;i<4;i++){try{fetches++;const r=await fetch(u);if(r.ok)return await r.json();if(r.status===404)return null;}catch(e){}await new Promise(r=>setTimeout(r,250*(i+1)));}return null;}
async function pmap(arr,fn,conc=6){const out=new Array(arr.length);let i=0;async function w(){while(i<arr.length){const k=i++;out[k]=await fn(arr[k],k);}}await Promise.all(Array.from({length:Math.min(conc,arr.length)},w));return out;}

const cTeamHit={},cTeamPit={},cRecHit={},cPit={},cPitRec={};
async function teamHitTo(id,end){const k=id+'|'+end;if(k in cTeamHit)return cTeamHit[k];const d=await j(`${MLB}/teams/${id}/stats?stats=byDateRange&group=hitting&season=${SEASON}&startDate=${SEASON_START}&endDate=${end}`);return cTeamHit[k]=(d?.stats?.[0]?.splits?.[0]?.stat||null);}
async function teamPitTo(id,end){const k=id+'|'+end;if(k in cTeamPit)return cTeamPit[k];const d=await j(`${MLB}/teams/${id}/stats?stats=byDateRange&group=pitching&season=${SEASON}&startDate=${SEASON_START}&endDate=${end}`);return cTeamPit[k]=(d?.stats?.[0]?.splits?.[0]?.stat||null);}
async function teamRecHit(id,end){const k=id+'|'+end;if(k in cRecHit)return cRecHit[k];const d=await j(`${MLB}/teams/${id}/stats?stats=byDateRange&group=hitting&season=${SEASON}&startDate=${daysBack(end,15)}&endDate=${end}`);const s=d?.stats?.[0]?.splits?.[0]?.stat;return cRecHit[k]=((s&&s.atBats>=20)?num(s.ops):null);}
async function pitTo(pid,end){const k=pid+'|'+end;if(k in cPit)return cPit[k];const d=await j(`${MLB}/people/${pid}/stats?stats=byDateRange&group=pitching&season=${SEASON}&startDate=${SEASON_START}&endDate=${end}`);return cPit[k]=(d?.stats?.[0]?.splits?.[0]?.stat||null);}
async function pitRecTo(pid,end){const k=pid+'|'+end;if(k in cPitRec)return cPitRec[k];const d=await j(`${MLB}/people/${pid}/stats?stats=byDateRange&group=pitching&season=${SEASON}&startDate=${daysBack(end,30)}&endDate=${end}`);const s=d?.stats?.[0]?.splits?.[0]?.stat;return cPitRec[k]=((s&&parseFloat(s.inningsPitched)>=8)?num(s.era):null);}

async function gamesInWindow(start,end){
  const sch=await j(`${MLB}/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=probablePitcher`);
  const games=[];
  (sch?.dates||[]).forEach(d=>(d.games||[]).forEach(g=>{
    if(g.status?.abstractGameState==='Final'&&g.gameType==='R'&&g.teams?.away?.score!=null&&g.teams?.home?.score!=null&&g.teams.away.score!==g.teams.home.score){
      games.push({date:g.officialDate||d.date,aId:g.teams.away.team.id,hId:g.teams.home.team.id,aScore:g.teams.away.score,hScore:g.teams.home.score,aP:g.teams.away.probablePitcher?.id||null,hP:g.teams.home.probablePitcher?.id||null});
    }}));
  return games;
}
async function buildGame(g){
  const end=dayBefore(g.date);
  const [aHit,hHit,aPit,hPit,aRec,hRec,aPs,hPs,aPsRec,hPsRec]=await Promise.all([
    teamHitTo(g.aId,end),teamHitTo(g.hId,end),teamPitTo(g.aId,end),teamPitTo(g.hId,end),
    teamRecHit(g.aId,end),teamRecHit(g.hId,end),
    g.aP?pitTo(g.aP,end):null,g.hP?pitTo(g.hP,end):null,g.aP?pitRecTo(g.aP,end):null,g.hP?pitRecTo(g.hP,end):null]);
  if(!aHit||!hHit||!aPit||!hPit)return null;
  const mk=(est,hit,pit,ps,rec,psRec)=>{const rs=num(hit.runs),ra=num(pit.runs);return {estDomicile:est,pythWinPct:(rs&&ra)?pythagorean(rs,ra):null,winPct:null,ops:num(hit.ops),opsSplit:false,eraEquipe:num(pit.era),eraPartant:ps?num(ps.era):null,fipPartant:ps?calcFIP(ps):null,nomPartant:null,whipPartant:ps?num(ps.whip):null,k9Partant:ps?num(ps.strikeoutsPer9Inn):null,opsRecent:rec,eraRecent:psRec,opsVsHand:null,oppHand:null,forme:null,streak:null};};
  return {a:mk(false,aHit,aPit,aPs,aRec,aPsRec),h:mk(true,hHit,hPit,hPs,hRec,hPsRec),y:g.hScore>g.aScore?1:0,
    margin:g.hScore-g.aScore, total:g.aScore+g.hScore, parkPct:PARK[g.hId]||100};
}

// ── scoring custom : ré-agrège les scores de facteurs avec des poids arbitraires ──
function facMapOf(data, recencyPitch){
  // option recencyPitch : remplace le FIP du partant par 0.5*FIP_saison + 0.5*ERA_30j
  let d=data;
  if(recencyPitch && data.eraRecent!=null && data.fipPartant!=null){
    const eff=Math.max(1.5,Math.min(8,0.5*data.fipPartant+0.5*data.eraRecent));
    d={...data,fipPartant:eff};
  }
  const r=calcEquipe(d);const m={};r.facteurs.forEach(f=>{if(f.code)m[f.code]=f.score;});return m;
}
function teamScore(m,W){let st=0,sw=0;for(let code in m){let c=code==='away'?'home':(code==='winpct'?'pyth':code);const w=W[c];if(w==null)continue;st+=m[code]*w;sw+=w;}return sw>0?st/sw:50;}
function probaHome(ma,mh,W){const[,pH]=normProba(teamScore(ma,W),teamScore(mh,W));return pH/100;}

function metrics(ps,ys){let ll=0,br=0,acc=0;for(let i=0;i<ps.length;i++){const p=Math.max(1e-6,Math.min(1-1e-6,ps[i]));ll+=-(ys[i]*Math.log(p)+(1-ys[i])*Math.log(1-p));br+=(p-ys[i])**2;acc+=((p>=0.5?1:0)===ys[i])?1:0;}const n=ps.length;return{logloss:ll/n,brier:br/n,acc:acc/n};}
function calib(ps,ys){const B=[[0,.4],[.4,.45],[.45,.5],[.5,.55],[.55,.6],[.6,1]];return B.map(([lo,hi])=>{let n=0,s=0,w=0;for(let i=0;i<ps.length;i++)if(ps[i]>=lo&&ps[i]<hi){n++;s+=ps[i];w+=ys[i];}return{band:`${(lo*100)|0}-${(hi*100)|0}%`,n,pred:n?s/n*100:null,real:n?w/n*100:null};});}
function fitLogit(X,y,m,iter=5000,lr=0.3,l2=0.003){let w=new Array(m).fill(0),b=0;const n=X.length;for(let it=0;it<iter;it++){const gw=new Array(m).fill(0);let gb=0;for(let i=0;i<n;i++){let z=b;for(let f=0;f<m;f++)z+=w[f]*X[i][f];const p=1/(1+Math.exp(-z)),e=p-y[i];gb+=e;for(let f=0;f<m;f++)gw[f]+=e*X[i][f];}b-=lr*gb/n;for(let f=0;f<m;f++)w[f]-=lr*(gw[f]/n+l2*w[f]);}return{w,b};}

(async()=>{
  let built;
  if(fs.existsSync(CACHE)){built=JSON.parse(fs.readFileSync(CACHE,'utf8'));console.log(`📦 Cache chargé : ${built.length} matchs (${CACHE})`);}
  else{
    console.log(`⏳ Construction ${START}→${END} (point-in-time)…`);
    const games=await gamesInWindow(START,END);
    console.log(`${games.length} matchs terminés. Reconstruction…`);
    let done=0;
    built=(await pmap(games,async g=>{const r=await buildGame(g);if(++done%100===0)console.log(`  …${done}/${games.length} (fetches:${fetches})`);return r;},6)).filter(Boolean);
    fs.writeFileSync(CACHE,JSON.stringify(built));
    console.log(`${built.length} matchs reconstruits → cache écrit (${fetches} fetches).`);
  }

  // LG depuis l'ensemble
  const col=k=>{const a=[];built.forEach(b=>[b.a,b.h].forEach(d=>{if(d[k]!=null)a.push(d[k]);}));return a;};
  LG.ops=statsLigue(col('ops'));LG.teamEra=statsLigue(col('eraEquipe'));LG.starterFip=statsLigue(col('fipPartant'));LG.starterEra=statsLigue(col('eraPartant'));LG.whip=statsLigue(col('whipPartant'));LG.k9=statsLigue(col('k9Partant'));

  // pré-calcule facMaps (baseline + recency) une fois
  const G=built.map(b=>({y:b.y,maB:facMapOf(b.a,false),mhB:facMapOf(b.h,false),maR:facMapOf(b.a,true),mhR:facMapOf(b.h,true),a:b.a,h:b.h,margin:b.margin,total:b.total,parkPct:b.parkPct}));
  const cut=Math.floor(G.length*0.7);const te=G.slice(cut);const ys=te.map(g=>g.y);
  const base=ys.reduce((a,b)=>a+b,0)/ys.length;

  // ── variantes ──
  const W0={pyth:0.28,starter:0.26,ops:0.18,whip:0.04,k9:0.08,teamera:0.08,recoff:0.05,recpit:0.05,home:0.06}; // ACTUEL
  const W1={pyth:0.30,starter:0.20,ops:0.12,whip:0.04,k9:0.02,teamera:0.08,recoff:0.05,recpit:0.15,home:0.06}; // RE-PONDÉRÉ (recpit↑, pyth↑, k9↓, ops↓)
  const variants=[
    {name:'V0 ACTUEL',                W:W0,rec:false},
    {name:'V1 re-pondéré',            W:W1,rec:false},
    {name:'V2 pitching récence',      W:W0,rec:true },
    {name:'V3 re-pond.+récence',      W:W1,rec:true },
  ];
  const evalV=(W,rec)=>{const ps=te.map(g=>probaHome(rec?g.maR:g.maB,rec?g.mhR:g.mhB,W));return {ps,m:metrics(ps,ys)};};

  // fit logistique (plafond data) — features = différentiel scores baseline
  const FEATS=['pyth','starter','ops','whip','k9','teamera','recoff','recpit'];
  const feat=g=>FEATS.map(f=>{const a=g.maB[f]??g.maB[f==='pyth'?'winpct':f],h=g.mhB[f]??g.mhB[f==='pyth'?'winpct':f];return(h!=null&&a!=null)?(h-a)/100:0;});
  const tr=G.slice(0,cut);const{w,b}=fitLogit(tr.map(feat),tr.map(g=>g.y),FEATS.length);
  const psFit=te.map(g=>1/(1+Math.exp(-(b+feat(g).reduce((a,xv,f)=>a+w[f]*xv,0)))));

  console.log(`\n════════ ${G.length} matchs · test out-of-sample ${te.length} · base domicile ${(base*100).toFixed(1)}% ════════`);
  console.log(`référence « tout à la base rate » : log-loss ${metrics(te.map(()=>base),ys).logloss.toFixed(4)}`);
  console.log(`référence « toujours domicile »   : exactitude ${(base*100).toFixed(1)}%\n`);
  console.log(`variante                 log-loss    Brier   exactitude`);
  const res={};
  variants.forEach(v=>{const e=evalV(v.W,v.rec);res[v.name]=e;console.log(`${v.name.padEnd(22)}  ${e.m.logloss.toFixed(4)}   ${e.m.brier.toFixed(4)}   ${(e.m.acc*100).toFixed(1)}%`);});
  const mFit=metrics(psFit,ys);
  console.log(`${'— plafond data (logit)'.padEnd(22)}  ${mFit.logloss.toFixed(4)}   ${mFit.brier.toFixed(4)}   ${(mFit.acc*100).toFixed(1)}%`);

  // meilleure variante → calibration
  let best=variants[0],bll=res[variants[0].name].m.logloss;variants.forEach(v=>{if(res[v.name].m.logloss<bll){bll=res[v.name].m.logloss;best=v;}});
  console.log(`\n— Calibration de la meilleure (${best.name}) :`);
  calib(res[best.name].ps,ys).forEach(c=>{if(c.n)console.log(`   ${c.band.padEnd(8)} n=${String(c.n).padStart(3)} · prédit ${c.pred.toFixed(0)}% · réel ${c.real.toFixed(0)}%`);});
  // ════════ RUN LINE (handicap ±1.5) — ligne fixe, pas besoin du marché ════════
  // estimerMatch attend les SCORES d'équipe (calcEquipe), pas les scores du match.
  const ests=te.map(g=>{const sA=calcEquipe(g.a).score,sH=calcEquipe(g.h).score;return estimerMatch(g.a,g.h,g.parkPct,null,sA,sH);});
  // On évalue la calibration des 4 probas de couverture vs la réalité (margin = hScore-aScore).
  const rlProbas=[],rlOut=[];
  te.forEach((g,i)=>{const e=ests[i],m=g.margin;
    rlProbas.push(e.coverH_m15); rlOut.push(m>=2?1:0);   // domicile -1.5 : gagne par ≥2
    rlProbas.push(e.coverH_p15); rlOut.push(m>=-1?1:0);   // domicile +1.5 : ne perd pas par ≥2
    rlProbas.push(e.coverA_m15); rlOut.push(m<=-2?1:0);   // extérieur -1.5
    rlProbas.push(e.coverA_p15); rlOut.push(m<=1?1:0);    // extérieur +1.5
  });
  const mRL=metrics(rlProbas,rlOut);
  console.log(`\n════════ RUN LINE (±1.5) — ${rlProbas.length} prédictions de couverture (test) ════════`);
  console.log(`log-loss ${mRL.logloss.toFixed(4)} · Brier ${mRL.brier.toFixed(4)} · exactitude ${(mRL.acc*100).toFixed(1)}%`);
  console.log(`(référence : taux de couverture réel moyen ${(rlOut.reduce((a,b)=>a+b,0)/rlOut.length*100).toFixed(1)}% → log-loss ${metrics(rlOut.map(()=>rlOut.reduce((a,b)=>a+b,0)/rlOut.length),rlOut).logloss.toFixed(4)})`);
  console.log(`— Calibration couverture :`);
  calib(rlProbas,rlOut).forEach(c=>{if(c.n)console.log(`   ${c.band.padEnd(8)} n=${String(c.n).padStart(3)} · prédit ${c.pred.toFixed(0)}% · réel ${c.real.toFixed(0)}%`);});

  // ════════ TOTAL (O/U) — précision d'estimation (pas de ligne marché) ════════
  const predT=te.map((g,i)=>ests[i].expRunsA+ests[i].expRunsH);
  const realT=te.map(g=>g.total);
  const mae=predT.reduce((a,p,i)=>a+Math.abs(p-realT[i]),0)/predT.length;
  const bias=predT.reduce((a,p,i)=>a+(p-realT[i]),0)/predT.length;
  const meanReal=realT.reduce((a,b)=>a+b,0)/realT.length;
  // edge directionnel vs une ligne FIXE (8.5, le total MLB classique) : Over si pred>8.5
  const L=8.5;let dir=0,n8=0;te.forEach((g,i)=>{const over=predT[i]>L,realOver=realT[i]>L;if(predT[i]!==L){n8++;if(over===realOver)dir++;}});
  const alwaysOver=realT.filter(t=>t>L).length/realT.length; // benchmark honnête : « toujours Over vs 8.5 »
  // corrélation pred vs réel (signal de rang)
  const mp=predT.reduce((a,b)=>a+b,0)/predT.length;
  const cov2=predT.reduce((a,p,i)=>a+(p-mp)*(realT[i]-meanReal),0);
  const sp=Math.sqrt(predT.reduce((a,p)=>a+(p-mp)**2,0)),sr=Math.sqrt(realT.reduce((a,r)=>a+(r-meanReal)**2,0));
  const corr=cov2/(sp*sr||1);
  // variante BIAIS CORRIGÉ (+0.68) : recentrer l'estimation
  const predTc=predT.map(p=>p-bias);const maeC=predTc.reduce((a,p,i)=>a+Math.abs(p-realT[i]),0)/predTc.length;
  console.log(`\n════════ TOTAL (O/U) — précision de l'estimation (test, ${predT.length} matchs) ════════`);
  console.log(`total réel moyen ${meanReal.toFixed(2)} · total estimé moyen ${(meanReal+bias).toFixed(2)} · BIAIS ${bias>=0?'+':''}${bias.toFixed(2)} (on sous-estime)`);
  console.log(`MAE estimation : ${mae.toFixed(2)} runs · MAE après correction du biais : ${maeC.toFixed(2)} · MAE naïve (toujours ${meanReal.toFixed(1)}) : ${(realT.reduce((a,r)=>a+Math.abs(r-meanReal),0)/realT.length).toFixed(2)}`);
  console.log(`corrélation estimé↔réel : ${corr.toFixed(3)} (0 = aucun signal de rang, 1 = parfait)`);
  console.log(`direction vs ligne fixe 8.5 : ${(dir/n8*100).toFixed(1)}% correct`);
  console.log(`  ⚠️ benchmark honnête : « toujours Over vs 8.5 » gagne déjà ${(alwaysOver*100).toFixed(1)}% (vu que la moyenne réelle ${meanReal.toFixed(1)} > 8.5)`);

  // ── O/U sur l'ÉCHELLE de lignes standard du book (notre pick = Over si estimé>ligne) ──
  console.log(`\n— O/U à chaque ligne standard (notre estimation choisit le côté) :`);
  console.log(`   ligne   notre %   on parie Over   meilleur côté trivial   gain vs trivial`);
  [6.5,7.5,8.5,9.5,10.5,11.5].forEach(L=>{
    let win=0,over=0;const n=predT.length;
    te.forEach((g,i)=>{const side=predT[i]>L?'O':'U';const w=side==='O'?(realT[i]>L):(realT[i]<L);if(w)win++;if(side==='O')over++;});
    const fracOver=realT.filter(t=>t>L).length/n;const trivial=Math.max(fracOver,1-fracOver);
    const our=win/n,edge=(our-trivial)*100;
    console.log(`   ${String(L).padStart(5)}   ${(our*100).toFixed(1)}%      ${(over/n*100).toFixed(0).padStart(3)}%           ${(trivial*100).toFixed(1)}%                ${edge>=0?'+':''}${edge.toFixed(1)} pts`);
  });
  console.log(`   (⚠️ taux de réussite uniquement — la rentabilité dépend des cotes à chaque ligne, qu'on n'a pas)`);

  console.log(`\nNote : O/U et moneyline VS LE MARCHÉ non testés (pas de cotes/lignes historiques) → forward-test.`);
})().catch(e=>{console.error('❌',e);process.exit(1);});
