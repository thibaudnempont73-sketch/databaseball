#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// DataBaseball — JOB SERVEUR (Étape 1)
// Récupère MLB + cotes UNE fois, calcule tous les pronos (même moteur que l'app),
// et écrit un snapshot JSON dans Supabase. Aucune clé exposée côté navigateur.
//
// Variables d'environnement attendues (GitHub Actions Secrets) :
//   VEGAS_KEY            (optionnel) clé the-odds-api.com
//   SUPABASE_URL         ex: https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY clé service_role (secrète, JAMAIS côté client)
// Sans SUPABASE_*, le script écrit juste un fichier local snapshot.json (pour tester).
// ═══════════════════════════════════════════════════
import fs from 'node:fs';

const MLB='https://statsapi.mlb.com/api/v1';
const WEATHER='https://api.open-meteo.com/v1/forecast';
const SEASON=2026;
const VEGAS_KEY=process.env.VEGAS_KEY||'';
const _cache={};
let LG={ops:null,teamEra:null,starterEra:null,starterFip:null,whip:null,k9:null};

const today=()=>new Date().toISOString().split('T')[0];
const yesterday=()=>{const d=new Date();d.setDate(d.getDate()-1);return d.toISOString().split('T')[0];};
const dateMinus=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().split('T')[0];};
const pt=(n,dec=1)=>Math.round(n*(10**dec))/(10**dec);

async function fetchJSON(url,timeout=12000){
  const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),timeout);
  try{const r=await fetch(url,{headers:{'Accept':'application/json'},signal:ctrl.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
  finally{clearTimeout(t);}
}
// API MLB en direct (côté serveur : pas de CORS, pas de proxy) avec petit retry
async function api(path){
  if(_cache[path])return _cache[path];
  let err;
  for(let i=0;i<3;i++){try{const d=await fetchJSON(MLB+path);_cache[path]=d;return d;}catch(e){err=e;await new Promise(r=>setTimeout(r,400*(i+1)));}}
  throw err;
}
async function getWeather(lat,lon){try{return await fetchJSON(`${WEATHER}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`,8000);}catch(e){return null;}}

// ── Cotes (h2h + spreads + totals) : meilleure cote globale + meilleure US + meilleure EU, par marché ──
// Bookmakers européens/UK connus (région 'eu'/'uk' de The Odds API) ; tout le reste = US.
const EU_BOOKS=new Set(['pinnacle','onexbet','betclic','sport888','williamhill','betfair_ex_uk','betfair_ex_eu','matchbook','unibet_eu','unibet_uk','betsson','nordicbet','coolbet','marathonbet','betvictor','ladbrokes_uk','coral','skybet','paddypower','betway','gtbets','suprabets','everygame','tipico_de','winamax_fr','winamax_de','parionssport_fr','betano','mrgreen','casumo','leovegas','10bet','betclic_fr','livescorebet']);
const isEU=k=>EU_BOOKS.has(k);
// Parse un événement → meilleures cotes (overall + _us + _eu) par marché. PURE (testable sans API).
export function parseEventOdds(ev){
  const home=ev.home_team,away=ev.away_team,books=ev.bookmakers||[];if(!books.length)return null;
  const e={home,away,commence:ev.commence_time};
  const up=(o,cote,bk)=>(!o||cote>o.cote)?{cote,bk}:o;
  // H2H — filtre anti-aberration : une cote moneyline MLB réaliste reste dans ~[1.01, 8]
  const okH2H=(c)=>typeof c==='number'&&c>=1.01&&c<=8;
  let bH,bA,bHu,bAu,bHe,bAe; const pairs=[];
  books.forEach(bk=>{const h=bk.markets?.find(m=>m.key==='h2h');if(!h)return;const eu=isEU(bk.key);
    let oH=h.outcomes.find(o=>o.name===home)?.price,oA=h.outcomes.find(o=>o.name===away)?.price;
    if(!okH2H(oH))oH=null; if(!okH2H(oA))oA=null;
    if(oH){bH=up(bH,oH,bk.title);if(eu)bHe=up(bHe,oH,bk.title);else bHu=up(bHu,oH,bk.title);}
    if(oA){bA=up(bA,oA,bk.title);if(eu)bAe=up(bAe,oA,bk.title);else bAu=up(bAu,oA,bk.title);}
    if(oH&&oA)pairs.push({key:bk.key,oH,oA,vig:1/oH+1/oA});
  });
  if(bH&&bA){
    e.coteH=bH.cote;e.coteA=bA.cote;e.bkH=bH.bk;e.bkA=bA.bk;
    e.coteH_us=bHu?.cote;e.bkH_us=bHu?.bk;e.coteA_us=bAu?.cote;e.bkA_us=bAu?.bk;
    e.coteH_eu=bHe?.cote;e.bkH_eu=bHe?.bk;e.coteA_eu=bAe?.cote;e.bkA_eu=bAe?.bk;
    // Proba de marché (dé-viggée) depuis UNE ligne 2-camps cohérente d'un seul book (Pinnacle prioritaire),
    // jamais le max cross-book (qui mélange des cotes de books différents → résultat faussé).
    const coherent=pairs.filter(p=>p.vig>=1.0&&p.vig<=1.2);
    const ref=coherent.find(p=>p.key==='pinnacle')
      ||coherent.slice().sort((a,b)=>Math.abs(a.vig-1.05)-Math.abs(b.vig-1.05))[0]
      ||{oH:bH.cote,oA:bA.cote};
    const iH=1/ref.oH,iA=1/ref.oA,tt=iH+iA;e.probaH=iH/tt*100;e.probaA=iA/tt*100;
  }
  // TOTALS : ligne la plus fréquente, puis meilleures cotes (overall/us/eu) À CETTE ligne
  const cnt={};
  books.forEach(bk=>{const tot=bk.markets?.find(m=>m.key==='totals');if(!tot)return;const ov=tot.outcomes.find(o=>o.name==='Over');if(ov&&ov.point!=null)cnt[ov.point]=(cnt[ov.point]||0)+1;});
  const ml=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];
  if(ml){const L=+ml;let ov,un,ovu,unu,ove,une;
    books.forEach(bk=>{const tot=bk.markets?.find(m=>m.key==='totals');if(!tot)return;const eu=isEU(bk.key);
      const o=tot.outcomes.find(x=>x.name==='Over'&&x.point===L),u=tot.outcomes.find(x=>x.name==='Under'&&x.point===L);
      if(o){ov=up(ov,o.price,bk.title);if(eu)ove=up(ove,o.price,bk.title);else ovu=up(ovu,o.price,bk.title);}
      if(u){un=up(un,u.price,bk.title);if(eu)une=up(une,u.price,bk.title);else unu=up(unu,u.price,bk.title);}
    });
    if(ov&&un){e.totalLine=L;e.overOdds=ov.cote;e.bkOver=ov.bk;e.underOdds=un.cote;e.bkUnder=un.bk;
      e.overOdds_us=ovu?.cote;e.bkOver_us=ovu?.bk;e.underOdds_us=unu?.cote;e.bkUnder_us=unu?.bk;
      e.overOdds_eu=ove?.cote;e.bkOver_eu=ove?.bk;e.underOdds_eu=une?.cote;e.bkUnder_eu=une?.bk;}
  }
  // SPREADS ±1.5
  let sH,sA,sHu,sAu,sHe,sAe;
  books.forEach(bk=>{const sp=bk.markets?.find(m=>m.key==='spreads');if(!sp)return;const eu=isEU(bk.key);
    const sh=sp.outcomes.find(o=>o.name===home),sa=sp.outcomes.find(o=>o.name===away);
    if(sh&&Math.abs(sh.point)===1.5){if(!sH||sh.price>sH.cote)sH={point:sh.point,cote:sh.price,bk:bk.title};if(eu){if(!sHe||sh.price>sHe.cote)sHe={cote:sh.price,bk:bk.title};}else{if(!sHu||sh.price>sHu.cote)sHu={cote:sh.price,bk:bk.title};}}
    if(sa&&Math.abs(sa.point)===1.5){if(!sA||sa.price>sA.cote)sA={point:sa.point,cote:sa.price,bk:bk.title};if(eu){if(!sAe||sa.price>sAe.cote)sAe={cote:sa.price,bk:bk.title};}else{if(!sAu||sa.price>sAu.cote)sAu={cote:sa.price,bk:bk.title};}}
  });
  if(sH&&sA){e.spHomePoint=sH.point;e.spHomeOdds=sH.cote;e.bkSpHome=sH.bk;e.spAwayPoint=sA.point;e.spAwayOdds=sA.cote;e.bkSpAway=sA.bk;
    e.spHomeOdds_us=sHu?.cote;e.bkSpHome_us=sHu?.bk;e.spAwayOdds_us=sAu?.cote;e.bkSpAway_us=sAu?.bk;
    e.spHomeOdds_eu=sHe?.cote;e.bkSpHome_eu=sHe?.bk;e.spAwayOdds_eu=sAe?.cote;e.bkSpAway_eu=sAe?.bk;}
  return e;
}
async function getVegasOdds(){
  if(!VEGAS_KEY)return null;
  try{
    // regions=us,eu → meilleure cote américaine ET européenne (coût ~markets×2 régions)
    const url=`https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us,eu&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${VEGAS_KEY}`;
    const d=await fetchJSON(url,12000);
    const map={};
    d.forEach(ev=>{const e=parseEventOdds(ev);if(!e)return;const k=`${e.away}@${e.home}`;(map[k]=map[k]||[]).push(e);});
    return map;
  }catch(e){return null;}
}
function pickOdds(map,away,home,gameDate){
  const v=map&&map[`${away}@${home}`];const arr=Array.isArray(v)?v:(v?[v]:null);
  if(!arr||!arr.length)return null;if(arr.length===1)return arr[0];
  const t=new Date(gameDate).getTime();let best=arr[0],bestD=Infinity;
  arr.forEach(e=>{const d=Math.abs(new Date(e.commence).getTime()-t);if(d<bestD){bestD=d;best=e;}});return best;
}

async function getFormeFatigue(teamId){
  try{
    const d=await api(`/schedule?sportId=1&teamId=${teamId}&startDate=${dateMinus(21)}&endDate=${yesterday()}&hydrate=team,linescore`);
    const games=(d.dates??[]).flatMap(x=>x.games??[]).filter(g=>g.status?.abstractGameState==='Final').sort((a,b)=>new Date(b.gameDate)-new Date(a.gameDate));
    const logs=games.slice(0,15).map(g=>{const isHome=g.teams.home.team.id===teamId;const my=isHome?(g.teams.home.score??0):(g.teams.away.score??0);const opp=isHome?(g.teams.away.score??0):(g.teams.home.score??0);return{w:my>opp,my,opp,isHome,total:my+opp,margin:my-opp,date:g.gameDate};});
    const last10=logs.slice(0,10);const wins=last10.filter(x=>x.w).length;
    const last7=games.filter(g=>new Date(g.gameDate)>=new Date(dateMinus(7)));
    const joursJoues7=new Set(last7.map(g=>g.gameDate.split('T')[0])).size;
    const reposSemaine=Math.max(0,7-joursJoues7),doubleHeaders=last7.length-joursJoues7;
    const bilan=arr=>({w:arr.filter(x=>x.w).length,l:arr.filter(x=>!x.w).length,n:arr.length});
    const dom=last10.filter(x=>x.isHome),ext=last10.filter(x=>!x.isHome);
    const over85=last10.filter(x=>x.total>8.5).length,cover15=last10.filter(x=>x.margin>=2).length,plus15=last10.filter(x=>x.margin>=-1).length;
    const serie=test=>{let c=0;for(const x of logs){if(test(x))c++;else break;}return c;};
    const serieW=logs[0]?(logs[0].w?serie(x=>x.w):-serie(x=>!x.w)):0;
    const serieOver=logs[0]?(logs[0].total>8.5?serie(x=>x.total>8.5):-serie(x=>x.total<=8.5)):0;
    return{last10,wins,total:last10.length,formePct:last10.length?wins/last10.length:null,matchs7j:last7.length,reposSemaine,doubleHeaders,tendances:{bilan10:bilan(last10),domicile:bilan(dom),exterieur:bilan(ext),over85,over85n:last10.length,cover15,plus15,serieW,serieOver}};
  }catch(e){return null;}
}
async function getSplits(teamId){
  const out={hitH:null,hitA:null,pitH:null,pitA:null};
  try{const dh=await api(`/teams/${teamId}/stats?stats=statSplits&sitCodes=h,a&group=hitting&season=${SEASON}`);(dh.stats?.[0]?.splits??[]).forEach(s=>{if(s.split?.code==='h')out.hitH=s.stat;if(s.split?.code==='a')out.hitA=s.stat;});}catch(e){}
  try{const dp=await api(`/teams/${teamId}/stats?stats=statSplits&sitCodes=h,a&group=pitching&season=${SEASON}`);(dp.stats?.[0]?.splits??[]).forEach(s=>{if(s.split?.code==='h')out.pitH=s.stat;if(s.split?.code==='a')out.pitA=s.stat;});}catch(e){}
  return out;
}

const STADES={133:{lat:37.7516,lon:-122.2005,nom:'Oakland Coliseum'},134:{lat:40.4469,lon:-80.0057,nom:'PNC Park'},135:{lat:32.7076,lon:-117.1570,nom:'Petco Park'},136:{lat:47.5914,lon:-122.3326,nom:'T-Mobile Park',toit:'retractable'},137:{lat:37.7786,lon:-122.3893,nom:'Oracle Park'},138:{lat:38.6226,lon:-90.1928,nom:'Busch Stadium'},139:{lat:27.7682,lon:-82.6534,nom:'Tropicana Field',toit:'fixe'},140:{lat:32.7473,lon:-97.0844,nom:'Globe Life Field',toit:'retractable'},141:{lat:43.6414,lon:-79.3894,nom:'Rogers Centre',toit:'retractable'},142:{lat:44.9817,lon:-93.2777,nom:'Target Field'},143:{lat:39.9061,lon:-75.1665,nom:'Citizens Bank Park'},144:{lat:33.8908,lon:-84.4678,nom:'Truist Park'},145:{lat:41.8299,lon:-87.6338,nom:'Guaranteed Rate Field'},146:{lat:25.7781,lon:-80.2197,nom:'LoanDepot Park',toit:'retractable'},147:{lat:40.8296,lon:-73.9262,nom:'Yankee Stadium'},158:{lat:43.0280,lon:-87.9712,nom:'American Family Field',toit:'retractable'},108:{lat:33.8003,lon:-117.8827,nom:'Angel Stadium'},109:{lat:33.4453,lon:-112.0667,nom:'Chase Field',toit:'retractable'},110:{lat:39.2838,lon:-76.6218,nom:'Oriole Park'},111:{lat:42.3467,lon:-71.0972,nom:'Fenway Park'},112:{lat:41.9484,lon:-87.6553,nom:'Wrigley Field'},113:{lat:39.0979,lon:-84.5083,nom:'Great American Ball Park'},114:{lat:41.4962,lon:-81.6852,nom:'Progressive Field'},115:{lat:39.7559,lon:-104.9942,nom:'Coors Field'},116:{lat:42.3390,lon:-83.0485,nom:'Comerica Park'},117:{lat:29.7573,lon:-95.3555,nom:'Daikin Park',toit:'retractable'},118:{lat:39.0517,lon:-94.4803,nom:'Kauffman Stadium'},119:{lat:34.0739,lon:-118.2400,nom:'Dodger Stadium'},120:{lat:38.8730,lon:-77.0074,nom:'Nationals Park'},121:{lat:40.7571,lon:-73.8458,nom:'Citi Field'}};
const PARK={115:118,113:105,111:106,110:103,143:103,140:101,145:101,142:100,158:100,141:102,147:102,116:97,114:99,118:102,108:99,117:100,109:103,133:97,136:93,137:96,135:96,119:99,121:96,120:101,144:101,146:97,134:99,138:99,139:97,112:101};

// ── Moteur (formules identiques à l'app) ──
const sERA=e=>e==null||isNaN(e)?null:Math.round(Math.max(8,Math.min(95,95-((e-2.0)/4.5)*80)));
const sWinPct=w=>w==null?null:Math.round(Math.max(5,Math.min(97,(w-0.33)/0.40*90+5)));
const sOPS=o=>!o||isNaN(o)?null:Math.round(Math.max(8,Math.min(95,(o-0.55)/0.40*85+8)));
const sWHIP=w=>!w||isNaN(w)?null:Math.round(Math.max(8,Math.min(95,95-((w-0.85)/1.0)*80)));
const sKper9=k=>!k||isNaN(k)?null:Math.round(Math.max(20,Math.min(95,(k-5)/7*70+20)));
function sStreakBoost(s){if(!s)return 0;const n=parseInt(s.slice(1))||0,isW=s.startsWith('W');if(isW&&n>=6)return -4;if(isW&&n>=3)return 3;if(!isW&&n>=5)return -5;if(!isW&&n>=3)return -3;return 0;}
function pythagorean(rs,ra){if(!rs||!ra||ra===0)return null;const r=Math.pow(rs/ra,1.83);return r/(1+r);}
function windImpact(ws,wd){if(!ws||!wd)return{score:0,label:'Vent inconnu',impact:'neu'};const kmh=ws;if(kmh<10)return{score:0,label:`Vent faible (${kmh}km/h)`,impact:'neu'};const fav=(wd>=270||wd<90);const score=fav?Math.round(kmh/50*15):-Math.round(kmh/50*15);return{score,label:`Vent ${kmh}km/h ${fav?'dans le dos (plus de circuits)':'de face (moins de circuits)'}`,impact:fav?'boost':'down'};}
function meteoIndex(meteo){if(!meteo)return{score:0,parts:[],impact:'neu',label:'Météo non disponible',breakdown:''};if(meteo.toit==='fixe')return{score:0,parts:[],impact:'neu',label:'Stade couvert (dôme fermé)',breakdown:'Toit fixe : jeu en intérieur, météo sans effet.'};const parts=[];let score=0;const w=windImpact(meteo.wind,meteo.windDir);if(w.score!==0){score+=w.score;parts.push(`${w.score>0?'+':''}${w.score} vent`);}if(meteo.temp!=null){if(meteo.temp<10){score-=8;parts.push('−8 froid');}else if(meteo.temp>27){score+=6;parts.push('+6 chaleur');}}if(meteo.humidity!=null&&meteo.humidity>=75){score-=4;parts.push('−4 humidité');}const retract=meteo.toit==='retractable';if(retract)score=Math.round(score*0.5);score=Math.round(score);const sens=score>3?'penche vers le Over (plus de points)':score<-3?'penche vers le Under (moins de points)':'globalement neutre';return{score,impact:score>3?'boost':score<-3?'down':'neu',label:`Effet net : ${sens}`,breakdown:(parts.length?`Détail (pts Over) : ${parts.join(', ')}`:'Conditions neutres')+(retract?' · toit rétractable (effet réduit, dépend de l\'ouverture)':'')};}
function statsLigue(values){const v=values.filter(x=>x!=null&&!isNaN(x));if(v.length<3)return null;const mean=v.reduce((a,b)=>a+b,0)/v.length;const variance=v.reduce((a,b)=>a+(b-mean)**2,0)/v.length;return{mean,std:Math.sqrt(variance)||1,n:v.length};}
function zScore(value,lg,invert){if(value==null||isNaN(value)||!lg||!lg.std)return null;let z=(value-lg.mean)/lg.std;if(invert)z=-z;return Math.round(Math.max(8,Math.min(95,50+z*18)));}
function calcFIP(s){if(!s||!s.inningsPitched)return null;const parts=String(s.inningsPitched).split('.');const IP=(+parts[0]||0)+((parts[1]?+parts[1]:0)/3);if(IP<1)return null;const HR=+s.homeRuns||0,BB=+s.baseOnBalls||0,HBP=+s.hitBatsmen||0,K=+s.strikeOuts||0;let fip=((13*HR+3*(BB+HBP)-2*K)/IP)+3.15;const era=s.era?parseFloat(s.era):null;if(era!=null&&IP<30){const w=IP/30;fip=w*fip+(1-w)*era;}return Math.max(1.5,Math.min(8,fip));}
function versMarche(modele,marche,poidsMarche,cap){if(marche==null||isNaN(marche))return modele;let v=modele*(1-poidsMarche)+marche*poidsMarche;if(cap!=null)v=Math.max(marche-cap,Math.min(marche+cap,v));return v;}
function normProba(sA,sB){const t=sA+sB;if(!t)return[50,50];return[pt(sA/t*100),pt(sB/t*100)];}
function confiance(dA,dB,ecart){const base=Math.min(dA,dB);let c=1;if(base>=60)c=2;if(base>=75)c=3;if(base>=85)c=4;if(base>=90&&ecart>=10)c=5;return c;}
function confScore100(dataDispos,ecart,qualite){const dataC=Math.max(0,Math.min(100,dataDispos)),ecartC=Math.max(0,Math.min(100,ecart*2.2)),qualC=Math.max(0,Math.min(100,qualite));return Math.round(dataC*0.4+ecartC*0.4+qualC*0.2);}
function fmtSerie(n){if(!n)return null;return n>0?`${n} victoire${n>1?'s':''} de suite`:`${-n} défaite${-n<-1?'s':''} de suite`;}
function noteJouabilite(p){if(!p.coteVegas)return null;const probaC=Math.max(0,Math.min(100,(p.proba-48)/(70-48)*100));const edge=p.fairProba!=null?(p.proba/100-p.fairProba):0;const valueC=Math.max(0,Math.min(100,50+edge*100*10));const conf=p.confScore??50;const oddsSweet=c=>c==null?30:(c<1.4?35:c<=2.2?100:c<=2.8?72:c<=3.5?48:30);return Math.round(0.38*probaC+0.22*oddsSweet(p.coteVegas)+0.20*conf+0.20*valueC);}

function calcEquipe(data){
  const facteurs=[];let scoreTotal=0,totalPoids=0;const scoresContrib=[];
  const add=(score,poids,f)=>{if(score===null)return;scoreTotal+=score*poids;totalPoids+=poids;scoresContrib.push({score,poids});facteurs.push({...f,score,poids:Math.round(poids*100)});};
  const pyth=data.pythWinPct;
  if(pyth!=null){add(sWinPct(pyth),0.28,{nom:'Pourcentage de victoires théorique',valeur:`${Math.round(pyth*100)}% de victoires attendues cette saison`,detail:'Calculé sur les points marqués et encaissés réels (formule pythagoricienne de Bill James, 1977)',sense:sWinPct(pyth)>=55?'pos':sWinPct(pyth)<=45?'neg':'neu'});}
  else if(data.winPct!=null){add(sWinPct(data.winPct),0.22,{nom:'Pourcentage de victoires cette saison',valeur:`${Math.round((data.winPct||0.5)*100)}% de victoires en 2026`,detail:'Bilan victoires/défaites de la saison',sense:sWinPct(data.winPct)>=55?'pos':sWinPct(data.winPct)<=45?'neg':'neu'});}
  if(data.eraPartant!=null||data.fipPartant!=null){const metric=data.fipPartant??data.eraPartant;const s=zScore(metric,LG.starterFip||LG.starterEra,true)??sERA(metric);const q=metric<2.8?'exceptionnel':metric<3.4?'excellent':metric<3.9?'très bon':metric<4.5?'correct':'faible';const eraStr=data.eraPartant!=null?` (ERA ${data.eraPartant.toFixed(2)})`:'';add(s,0.26,{nom:'Qualité du lanceur de départ',valeur:`${data.nomPartant||'Lanceur'} : FIP ${metric.toFixed(2)} (${q})${eraStr}`,detail:'Le FIP isole la vraie performance du lanceur (circuits, marches, retraits) de la défense derrière lui — plus prédictif que l\'ERA. Le partant influence ~60% du match.',sense:s>=65?'pos':s<=40?'neg':'neu'});}
  if(data.ops!=null){const s=zScore(data.ops,LG.ops,false)??sOPS(data.ops);const q=data.ops>0.820?'excellente':data.ops>0.740?'bonne':data.ops>0.670?'correcte':'faible';const ctx=data.opsSplit?` à ${data.estDomicile?'domicile':'l\'extérieur'}`:'';add(s,0.18,{nom:'Force offensive de l\'équipe',valeur:`${data.ops}${ctx} — attaque ${q}`,detail:data.opsSplit?`Statistique offensive réelle ${data.estDomicile?'à domicile':'en déplacement'} (split contextuel)`:'Mesure la capacité à atteindre les bases et la puissance de frappe combinées',sense:s>=58?'pos':s<=42?'neg':'neu'});}
  if(data.whipPartant!=null){const s=zScore(data.whipPartant,LG.whip,true)??sWHIP(data.whipPartant);const poids=data.eraPartant!=null?0.04:0.10;add(s,poids,{nom:'Efficacité du lanceur (marcheurs + coups sûrs/manche)',valeur:`${data.whipPartant.toFixed(2)} — ${s>=65?'très efficace':s<=40?'peu efficace':'efficacité correcte'}${data.eraPartant!=null?' · poids réduit (corrélé à l\'ERA)':''}`,detail:'Mesure combien de coureurs le lanceur laisse atteindre les bases par manche. Fortement corrélé à l\'ERA, son poids est réduit pour éviter le double comptage.',sense:s>=65?'pos':s<=40?'neg':'neu'});}
  if(data.k9Partant!=null){const s=zScore(data.k9Partant,LG.k9,false)??sKper9(data.k9Partant);add(s,0.08,{nom:'Capacité d\'élimination directe du lanceur',valeur:`${data.k9Partant.toFixed(1)} éliminations directes par manche en moyenne`,detail:'Un lanceur qui élimine beaucoup = moins de risques pour son équipe',sense:s>=65?'pos':s<=40?'neg':'neu'});}
  if(data.eraEquipe!=null){const s=zScore(data.eraEquipe,LG.teamEra,true)??sERA(data.eraEquipe);add(s,0.08,{nom:'Qualité défensive globale de l\'équipe',valeur:`${data.eraEquipe.toFixed(2)} points encaissés/match en moyenne (tous lanceurs)`,detail:'Reflète la qualité du bullpen (lanceurs de remplacement) en plus du partant',sense:s>=58?'pos':s<=42?'neg':'neu'});}
  {const s=data.estDomicile?58:42;scoreTotal+=s*0.06;totalPoids+=0.06;scoresContrib.push({score:s,poids:0.06});facteurs.push({nom:data.estDomicile?'Avantage de jouer à domicile':'Désavantage de jouer à l\'extérieur',valeur:data.estDomicile?'🏠 Reçoit chez lui — avantage statistique de ~54% en MLB':'✈️ En déplacement — légèrement désavantagé statistiquement',detail:'En MLB, l\'équipe qui reçoit gagne en moyenne 54% de ses matchs à domicile',score:s,poids:6,sense:data.estDomicile?'pos':'neg'});}
  if(data.forme&&data.forme.total>=3){const fPct=data.forme.formePct;const s=Math.round(Math.max(15,Math.min(90,30+fPct*60)));add(s,0.05,{nom:'Forme récente (10 derniers matchs réels)',valeur:`${data.forme.wins}V-${data.forme.total-data.forme.wins}D sur les ${data.forme.total} derniers matchs`,detail:'Résultats réels récupérés via l\'API MLB, pas une estimation',sense:fPct>=0.6?'pos':fPct<=0.4?'neg':'neu'});}
  else if(data.streak){const boost=sStreakBoost(data.streak);add(50+boost,0.04,{nom:'Série en cours et momentum',valeur:`${data.streak.startsWith('W')?`${parseInt(data.streak.slice(1))||0} victoires`:`${parseInt(data.streak.slice(1))||0} défaites`} consécutives`,detail:'Une équipe en série de victoires est en confiance',sense:boost>0?'pos':boost<0?'neg':'neu'});}
  if(data.forme&&data.forme.matchs7j!=null){const m7=data.forme.matchs7j,repos=data.forme.reposSemaine,dh=data.forme.doubleHeaders;const fatScore=Math.round(Math.max(35,Math.min(62,50+repos*5-dh*6-(m7>=7?5:0))));add(fatScore,0.03,{nom:'Fraîcheur / calendrier',valeur:`${m7} matchs sur 7 jours · ${repos} jour${repos>1?'s':''} de repos${dh>0?` · ${dh} doubleheader${dh>1?'s':''}`:''}`,detail:'Un calendrier chargé sans jour de repos fatigue surtout le bullpen (lanceurs de relève)',sense:fatScore>=52?'pos':fatScore<=44?'neg':'neu'});}
  let score=totalPoids>0?Math.round(scoreTotal/totalPoids):50;
  const dataDispos=Math.min(100,Math.round(totalPoids*100));
  let facteurReg=0,regInfo=null;
  if(data.streak&&data.streak.startsWith('W')){const n=parseInt(data.streak.slice(1))||0;facteurReg=Math.min(0.15,Math.max(0,(n-4)*0.03));if(facteurReg>0){const avant=score;score=Math.round(50+(score-50)*(1-facteurReg));regInfo={n,facteur:facteurReg,avant,apres:score};facteurs.push({nom:'Régression vers la moyenne',valeur:`Série de ${n}V → score ajusté ${avant}→${score} (−${Math.round(facteurReg*100)}%)`,detail:`Après ${n}+ victoires consécutives, les équipes reviennent statistiquement vers leur niveau réel. Le score est corrigé à la baisse.`,score,poids:0,sense:'warn'});}}
  let incertitude=8;
  if(scoresContrib.length){const sp=scoresContrib.reduce((a,c)=>a+c.poids,0);const moy=scoresContrib.reduce((a,c)=>a+c.score*c.poids,0)/sp;const varPond=scoresContrib.reduce((a,c)=>a+c.poids*(c.score-moy)**2,0)/sp;incertitude=Math.sqrt(varPond)*0.18;}
  incertitude+=(100-dataDispos)*0.06;incertitude=Math.round(Math.max(3,Math.min(12,incertitude)));
  return{score,facteurs,dataDispos,incertitude,facteurReg,regInfo};
}
function estimerMatch(aData,hData,parkPct,vegas,scoreA,scoreH){
  const[,phP]=normProba(scoreA,scoreH);const winH=phP/100;
  const leagueOPS=LG.ops?.mean||0.715,leaguePitch=LG.teamEra?.mean||4.15,park=(parkPct||100)/100,SH=0.65;
  const pitchRating=d=>{const fip=d.fipPartant??d.eraPartant??leaguePitch;const te=d.eraEquipe??leaguePitch;const raw=0.55*fip+0.45*te;return leaguePitch+SH*(raw-leaguePitch);};
  const offRatio=d=>{const raw=Math.pow((d.ops??leagueOPS)/leagueOPS,1.6);return 1+SH*(raw-1);};
  const base=leaguePitch;
  let rA=Math.max(2,Math.min(8.5,base*offRatio(aData)*(pitchRating(hData)/leaguePitch)*park));
  let rH=Math.max(2,Math.min(8.5,base*offRatio(hData)*(pitchRating(aData)/leaguePitch)*park*1.03));
  const line=vegas&&vegas.totalLine!=null?vegas.totalLine:null;
  if(line){const tot=rA+rH,sA=rA/tot,anchored=0.65*line+0.35*tot;rA=anchored*sA;rH=anchored*(1-sA);}
  const expTotal=rA+rH;const overProb=line!=null?1/(1+Math.exp(-(expTotal-line)/1.7)):null;
  const cov=(p,pw)=>Math.max(0.08,Math.min(0.92,p<0?pw*0.62:0.38+0.62*pw));
  return{winA:1-winH,winH,expRunsA:rA,expRunsH:rH,line,overProb,coverA_m15:cov(-1.5,1-winH),coverA_p15:cov(1.5,1-winH),coverH_m15:cov(-1.5,winH),coverH_p15:cov(1.5,winH)};
}
function raisonPick(p){
  const pos=(p.facteurs||[]).filter(f=>f.sense==='pos'&&f.poids>0).sort((a,b)=>b.poids-a.poids);
  const traduire=f=>{const n=(f.nom||'').toLowerCase();if(n.includes('lanceur de départ'))return 'lanceur de départ de qualité';if(n.includes('force offensive'))return 'attaque performante';if(n.includes('théorique')||n.includes('pourcentage de victoires'))return 'meilleure équipe sur la saison';if(n.includes('domicile'))return 'avantage du terrain';if(n.includes('forme'))return 'équipe en forme';if(n.includes('défensive')||n.includes('efficacité du lanceur'))return 'défense solide';if(n.includes('élimination'))return 'lanceur qui élimine beaucoup';return null;};
  const forces=[];for(const f of pos){const x=traduire(f);if(x&&!forces.includes(x))forces.push(x);if(forces.length>=2)break;}
  const angle=[];const edge=p.fairProba!=null?(p.proba/100-p.fairProba)*100:0;
  if(edge>=3)angle.push(`<span style="color:var(--green)">valeur +${edge.toFixed(0)}% vs marché</span>`);
  if(p.coteVegas>=1.7&&p.coteVegas<=2.4)angle.push(`cote intéressante (${p.coteVegas.toFixed(2)})`);
  if(p.type==='runline'&&/\+1\.5/.test(p.pick))angle.push('filet de sécurité (+1.5)');
  let s=forces.length?forces.join(' + '):'profil équilibré';s=s.charAt(0).toUpperCase()+s.slice(1);if(angle.length)s+=' — '+angle.join(', ');return s+'.';
}

// ═══════════════════════════════════════════════════
// CALIBRATION / TRACK RECORD (boucle serveur : stocke les résultats, mesure, recalibre)
// ═══════════════════════════════════════════════════
function supaConf(){
  let url=(process.env.SUPABASE_URL||'').trim().replace(/\/rest\/v1.*$/i,'').replace(/\/+$/,'');
  if(url&&!/^https?:\/\//i.test(url))url='https://'+url;
  return {url,key:(process.env.SUPABASE_SERVICE_KEY||'').trim()};
}
// Règle une ligne de résultat avec les scores finaux (byPk: gamePk→game). 'W' / 'L' / null (pas fini).
function settleResultRow(r,byPk){
  const g=byPk[r.gamepk]; if(!g||g.status?.abstractGameState!=='Final')return null;
  const a=g.teams.away.score??0,h=g.teams.home.score??0,homeName=g.teams.home.team.name;
  if(r.type==='victoire')return ((r.pick||'').includes(homeName)?h>a:a>h)?'W':'L';
  if(r.type==='ou'){const tot=a+h,line=r.ou_line??8.5;return (r.ou_side==='over'?tot>line:tot<line)?'W':'L';}
  if(r.type==='runline'){const my=r.rl_is_home?h:a,opp=r.rl_is_home?a:h;return (my+(r.rl_point??0))>opp?'W':'L';}
  return 'L';
}
// Bilan global + calibration (par tranche de proba) depuis les lignes réglées. PURE (testable).
export function computeTrackRecord(rows){
  const fin=rows.filter(r=>r.resultat==='W'||r.resultat==='L');
  const n=fin.length,wins=fin.filter(r=>r.resultat==='W').length;
  let roi=0;fin.forEach(r=>{roi+=r.resultat==='W'?((+r.cote||2)-1):-1;});
  const buckets=[[50,60],[60,70],[70,80],[80,90],[90,101]].map(([lo,hi])=>{
    const it=fin.filter(r=>r.proba>=lo&&r.proba<hi),w=it.filter(r=>r.resultat==='W').length;
    return {lo,hi:Math.min(hi,100),n:it.length,real:it.length?Math.round(w/it.length*100):null,annonce:(lo+Math.min(hi,100))/2};
  });
  return {n,wins,winRate:n?Math.round(wins/n*100):null,roiPct:n?Math.round(roi/n*1000)/10:null,buckets,maj:today()};
}
// Recalibration par tranche avec atténuation (shrinkage). Renvoie {apply, n, active}. Identité si données insuffisantes.
export function buildRecalibrator(rows,minN=150,K=40){
  const fin=rows.filter(r=>(r.resultat==='W'||r.resultat==='L')&&typeof r.proba==='number');
  if(fin.length<minN)return {apply:p=>p,n:fin.length,active:false};
  const bins={};
  fin.forEach(r=>{const b=Math.min(95,Math.floor(r.proba/5)*5);(bins[b]=bins[b]||{w:0,n:0}).n++;if(r.resultat==='W')bins[b].w++;});
  const corr=p=>{const b=Math.min(95,Math.floor(p/5)*5),bin=bins[b];if(!bin||!bin.n)return p;const obs=bin.w/bin.n*100,w=bin.n/(bin.n+K);return p*(1-w)+obs*w;};
  return {apply:p=>Math.max(1,Math.min(99,corr(p))),n:fin.length,active:true};
}
// Stocke les pronos du jour + règle ceux d'hier en base, renvoie toutes les lignes réglées. Non bloquant.
async function recordAndSettleResults(pronos){
  const {url,key}=supaConf(); if(!url||!key)return [];
  const H={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  const POST=body=>fetch(`${url}/rest/v1/results`,{method:'POST',headers:{...H,Prefer:'resolution=merge-duplicates'},body:JSON.stringify(body)});
  // 1) Régler hier
  const ydate=yesterday();
  let games=[];try{const s=await api(`/schedule?sportId=1&date=${ydate}&hydrate=team,linescore`);games=s?.dates?.[0]?.games||[];}catch(e){}
  if(games.length){
    const byPk={};games.forEach(g=>byPk[g.gamePk]=g);
    const pend=await fetch(`${url}/rest/v1/results?select=*&resultat=eq.P&date=eq.${ydate}`,{headers:H}).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const settled=pend.map(r=>{const res=settleResultRow(r,byPk);return res?{...r,resultat:res}:null;}).filter(Boolean);
    if(settled.length)await POST(settled);
    console.log(`📊 Résultats réglés (${ydate}) : ${settled.length}/${pend.length}`);
  }
  // 2) Enregistrer les pronos d'aujourd'hui (proba BRUTE, avant recalibration)
  const td=today();
  const rows=pronos.filter(p=>p.coteVegas).map(p=>({id:p.id,date:td,type:p.type,proba:p.proba,cote:p.coteVegas,fair_proba:p.fairProba??null,gamepk:p.gamePk,pick:p.pick,ou_line:p.ouLine??null,ou_side:p.ouSide??null,rl_is_home:p.rlIsHome??null,rl_point:p.rlPoint??null,resultat:'P'}));
  if(rows.length)await POST(rows);
  // 3) Toutes les lignes réglées (pour bilan + recalibration)
  return await fetch(`${url}/rest/v1/results?select=proba,cote,resultat,type&resultat=in.(W,L)`,{headers:H}).then(r=>r.ok?r.json():[]).catch(()=>[]);
}

// ═══════════════════════════════════════════════════
// PIPELINE PRINCIPAL (réplique loadPronos, sans le DOM)
// ═══════════════════════════════════════════════════
async function build(){
  const [schedData,standData,teamHitData,teamPitData]=await Promise.all([
    api(`/schedule?sportId=1&date=${today()}&hydrate=team,probablePitcher,linescore,venue,lineups`),
    api(`/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason&hydrate=team`),
    api(`/teams/stats?season=${SEASON}&sportId=1&group=hitting&stats=season`),
    api(`/teams/stats?season=${SEASON}&sportId=1&group=pitching&stats=season`),
  ]);
  const games=schedData.dates?.[0]?.games??[];
  const standMap={};
  standData.records?.forEach(div=>div.teamRecords?.forEach(t=>{standMap[t.team.id]={winPct:parseFloat(t.winningPercentage)||null,pythWinPct:null,wins:t.wins,losses:t.losses,streak:t.streak?.streakCode??null,runsScored:null,runsAllowed:null};}));
  const hitMap={},pitMap={};
  teamHitData.stats?.[0]?.splits?.forEach(s=>{if(s.team?.id)hitMap[s.team.id]=s.stat;});
  teamPitData.stats?.[0]?.splits?.forEach(s=>{if(s.team?.id)pitMap[s.team.id]=s.stat;});
  Object.keys(standMap).forEach(id=>{const rs=hitMap[id]?parseFloat(hitMap[id].runs):null,ra=pitMap[id]?parseFloat(pitMap[id].runs):null;if(rs&&ra){standMap[id].pythWinPct=pythagorean(rs,ra);standMap[id].runsScored=rs;standMap[id].runsAllowed=ra;}});
  LG.ops=statsLigue(Object.values(hitMap).map(h=>parseFloat(h.ops)));
  LG.teamEra=statsLigue(Object.values(pitMap).map(p=>parseFloat(p.era)));

  if(!games.length)return {date:today(),generatedAt:new Date().toISOString(),pronos:[],matchDataMap:{},tendancesJour:[],standings:standData.records??[],pythMap:{},leaders:{},matchs:[],vide:true};

  const pitcherIds=[...new Set(games.flatMap(g=>[g.teams.away.probablePitcher?.id,g.teams.home.probablePitcher?.id].filter(Boolean)))];
  const pitcherMap={};
  await Promise.all(pitcherIds.map(async id=>{try{const d=await api(`/people/${id}/stats?stats=season&group=pitching&season=${SEASON}`);const s=d.stats?.[0]?.splits?.[0]?.stat;if(s)pitcherMap[id]=s;}catch(e){}}));
  const pvals=Object.values(pitcherMap);
  LG.starterEra=statsLigue(pvals.map(p=>parseFloat(p.era)));
  LG.starterFip=statsLigue(pvals.map(p=>calcFIP(p)).filter(x=>x!=null));
  LG.whip=statsLigue(pvals.map(p=>parseFloat(p.whip)));
  LG.k9=statsLigue(pvals.map(p=>parseFloat(p.strikeoutsPer9Inn)));

  const teamIds=[...new Set(games.flatMap(g=>[g.teams.away.team.id,g.teams.home.team.id]))];
  const formeMap={};await Promise.all(teamIds.map(async id=>{formeMap[id]=await getFormeFatigue(id);}));
  const teamInfo={};games.forEach(g=>{teamInfo[g.teams.away.team.id]=g.teams.away.team;teamInfo[g.teams.home.team.id]=g.teams.home.team;});
  const tendancesJour=teamIds.map(id=>({team:teamInfo[id],forme:formeMap[id]})).filter(x=>x.team&&x.forme&&x.forme.tendances);
  const splitMap={};await Promise.all(teamIds.map(async id=>{splitMap[id]=await getSplits(id);}));
  const vegasMap=await getVegasOdds();
  const meteoMap={};
  await Promise.all(games.map(async g=>{const stade=STADES[g.teams.home.team.id];if(!stade)return;const w=await getWeather(stade.lat,stade.lon);if(w?.current)meteoMap[g.gamePk]={temp:w.current.temperature_2m,humidity:w.current.relative_humidity_2m,wind:w.current.wind_speed_10m,windDir:w.current.wind_direction_10m,stade:stade.nom,toit:stade.toit||null};}));

  const pronos=[];const matchDataMap={};
  const slim=t=>t?{id:t.id,name:t.name,abbreviation:t.abbreviation}:t;
  for(const game of games){
    const away=game.teams.away,home=game.teams.home,aId=away.team.id,hId=home.team.id;
    const aStand=standMap[aId]??{},hStand=standMap[hId]??{},aHit=hitMap[aId]??{},hHit=hitMap[hId]??{},aPit=pitMap[aId]??{},hPit=pitMap[hId]??{};
    const aPitStat=away.probablePitcher?.id?pitcherMap[away.probablePitcher.id]??null:null;
    const hPitStat=home.probablePitcher?.id?pitcherMap[home.probablePitcher.id]??null:null;
    const meteo=meteoMap[game.gamePk]??null;const wind=meteoIndex(meteo);
    const aForme=formeMap[aId]??null,hForme=formeMap[hId]??null,aSplit=splitMap[aId]??{},hSplit=splitMap[hId]??{};
    const time=game.gameDate?new Date(game.gameDate).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—';
    const dateCourt=game.gameDate?new Date(game.gameDate).toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',timeZone:'Europe/Paris'}):'';
    const dhSuffix=(game.doubleHeader&&game.doubleHeader!=='N')?` (Match ${game.gameNumber||''})`:'';
    const matchLbl=`${away.team.name} @ ${home.team.name}${dhSuffix}`;
    const partantManquant=!away.probablePitcher?.id||!home.probablePitcher?.id;
    const compoConfirmee=!!(game.lineups?.homePlayers?.length&&game.lineups?.awayPlayers?.length);
    const heuresAvant=game.gameDate?(new Date(game.gameDate)-new Date())/3600000:null;
    let compoHTML='';
    if(partantManquant)compoHTML=`<div class="compo-alert err">⚠️ Lanceur partant non encore annoncé — pari à éviter tant que ce n'est pas officiel.</div>`;
    else if(!compoConfirmee)compoHTML=`<div class="compo-alert warn">⏳ Composition non confirmée${heuresAvant!=null&&heuresAvant>0?` (match dans ${heuresAvant<1?'moins d\'1h':Math.round(heuresAvant)+'h'})`:''} — le partant probable peut changer au dernier moment. Vérifiez avant de miser.</div>`;
    const aOpsSplit=aSplit.hitA?.ops?parseFloat(aSplit.hitA.ops):null,hOpsSplit=hSplit.hitH?.ops?parseFloat(hSplit.hitH.ops):null;
    const aEraSplit=aSplit.pitA?.era?parseFloat(aSplit.pitA.era):null,hEraSplit=hSplit.pitH?.era?parseFloat(hSplit.pitH.era):null;
    const aData={estDomicile:false,winPct:aStand.winPct??null,pythWinPct:aStand.pythWinPct??null,eraPartant:aPitStat?.era?parseFloat(aPitStat.era):null,fipPartant:calcFIP(aPitStat),nomPartant:away.probablePitcher?.fullName??null,ops:aOpsSplit??(aHit.ops?parseFloat(aHit.ops):null),opsSplit:aOpsSplit!=null,eraEquipe:aEraSplit??(aPit.era?parseFloat(aPit.era):null),whipPartant:aPitStat?.whip?parseFloat(aPitStat.whip):null,k9Partant:aPitStat?.strikeoutsPer9Inn?parseFloat(aPitStat.strikeoutsPer9Inn):null,streak:aStand.streak??null,forme:aForme};
    const hData={estDomicile:true,winPct:hStand.winPct??null,pythWinPct:hStand.pythWinPct??null,eraPartant:hPitStat?.era?parseFloat(hPitStat.era):null,fipPartant:calcFIP(hPitStat),nomPartant:home.probablePitcher?.fullName??null,ops:hOpsSplit??(hHit.ops?parseFloat(hHit.ops):null),opsSplit:hOpsSplit!=null,eraEquipe:hEraSplit??(hPit.era?parseFloat(hPit.era):null),whipPartant:hPitStat?.whip?parseFloat(hPitStat.whip):null,k9Partant:hPitStat?.strikeoutsPer9Inn?parseFloat(hPitStat.strikeoutsPer9Inn):null,streak:hStand.streak??null,forme:hForme};
    const rA=calcEquipe(aData),rH=calcEquipe(hData);
    const vegas=pickOdds(vegasMap,away.team.name,home.team.name,game.gameDate);
    const vg=vegas||{}; // raccourci sûr pour lire les cotes US/EU même si vegas est null
    const parkPct=PARK[hId]||100;
    const sim=estimerMatch(aData,hData,parkPct,vegas,rA.score,rH.score);
    const wMkt=0.55,capMkt=0.06;
    let pH=versMarche(sim.winH,vegas&&vegas.probaH!=null?vegas.probaH/100:null,wMkt,capMkt)*100;
    let pA=100-pH;pA=pt(pA);pH=pt(pH);
    const ecart=Math.abs(pA-pH);const conf=confiance(rA.dataDispos,rH.dataDispos,ecart);
    const favH=pH>=pA,favTeam=favH?home.team:away.team,favProba=favH?pH:pA,favRes=favH?rH:rA,favForme=favH?hForme:aForme;
    const qualite=Math.round((rA.dataDispos+rH.dataDispos)/2*(favForme?1:0.85));
    const cScore=confScore100(Math.min(rA.dataDispos,rH.dataDispos),ecart,qualite);
    const margeCI=Math.round((rA.incertitude+rH.incertitude)/2);
    const alerteReg=favRes.regInfo?{valeur:`${favTeam.name} sur ${favRes.regInfo.n} victoires — score corrigé de la surchauffe (régression vers la moyenne appliquée)`}:null;
    let valueAlert=null,coteVegasFav=null,bkFav=null,fairFav=null;
    if(vegas&&vegas.coteH&&vegas.coteA){const ourFav=favProba,vegasFav=favH?vegas.probaH:vegas.probaA;const edge=pt(ourFav-vegasFav,1);coteVegasFav=favH?vegas.coteH:vegas.coteA;bkFav=favH?vegas.bkH:vegas.bkA;fairFav=(favH?vegas.probaH:vegas.probaA)/100;if(edge<=-4)valueAlert=`Valeur inversée : le marché donne ${favTeam.name} plus probable (${vegasFav.toFixed(1)}%) que notre modèle (${ourFav.toFixed(1)}%). Signal contrarian — prudence sur ce favori.`;else if(edge>=5)valueAlert=`Value bet : notre modèle voit ${favTeam.name} plus fort (${ourFav.toFixed(1)}%) que le marché (${vegasFav.toFixed(1)}%). Edge potentiellement rentable.`;}
    else{const fw=favH?hStand.winPct:aStand.winPct,dw=favH?aStand.winPct:hStand.winPct;if(fw!=null&&dw!=null&&fw<dw-0.03&&favProba>52)valueAlert=`Value contrarian : ${favTeam.name} a un moins bon bilan saison (${Math.round(fw*100)}%) que l'adversaire (${Math.round(dw*100)}%), mais le modèle le favorise (${favProba.toFixed(1)}%).`;}
    const formeDots=favForme&&favForme.last10?.length?`<span class="forme-dots">${favForme.last10.map(x=>`<span class="forme-dot ${x.w?'forme-w':'forme-l'}">${x.w?'V':'D'}</span>`).join('')}</span>`:'';
    const fatigueBadge=favForme&&(favForme.reposSemaine===0||favForme.doubleHeaders>0)?`<span class="fatigue-badge">😴 ${favForme.matchs7j} matchs/7j${favForme.doubleHeaders>0?` · ${favForme.doubleHeaders} doubleheader`:' · 0 repos'}</span>`:'';
    const tf=favForme&&favForme.tendances;const splitT=favH?(tf&&tf.domicile.n?`${tf.domicile.w}-${tf.domicile.l} à domicile`:''):(tf&&tf.exterieur.n?`${tf.exterieur.w}-${tf.exterieur.l} à l'extérieur`:'');
    const tendV=tf?`📈 ${favTeam.name} : ${tf.bilan10.w}-${tf.bilan10.l} sur ses 10 derniers${splitT?` · ${splitT}`:''}${fmtSerie(tf.serieW)?` · ${fmtSerie(tf.serieW)}`:''}`:'';
    const meteoHTML=meteo?(meteo.toit==='fixe'?`<div class="meteo-badge" title="${wind.breakdown}">🏟️ ${meteo.stade} — dôme fermé<span class="meteo-impact neu">météo sans effet</span></div>`:`<div class="meteo-badge" title="${wind.breakdown}">🌡️ ${meteo.temp}°C${meteo.humidity!=null?` · 💧${meteo.humidity}%`:''} · 💨 ${Math.round(meteo.wind)}km/h<span class="meteo-impact ${wind.impact}">net ${wind.score>0?'+':''}${wind.score} pts Over</span></div>`):'';
    const regAlertHTML=alerteReg?`<div class="reg-alert">⚠️ ${alerteReg.valeur}</div>`:'';
    const valueAlertHTML=valueAlert?`<div class="value-alert">💎 ${valueAlert}</div>`:'';
    matchDataMap[game.gamePk]={away:slim(away.team),home:slim(home.team),heure:time,dateCourt,gameDate:game.gameDate,state:game.status.abstractGameState,probaAway:pA,probaHome:pH,scoreA:rA.score,scoreH:rH.score,confScore:cScore,marge:margeCI,aData,hData,aStand,hStand,aPitStat,hPitStat,aForme,hForme,aSplit,hSplit,meteo,meteoIdx:wind,vegas,sim,parkPct,nomPartantA:away.probablePitcher?.fullName,nomPartantH:home.probablePitcher?.fullName};
    const base={gamePk:game.gamePk,heure:time,dateCourt,gameDate:game.gameDate,matchLabel:matchLbl,awayTeam:slim(away.team),homeTeam:slim(home.team),probaAway:pA,probaHome:pH,state:game.status.abstractGameState,meteoHTML,compoHTML};
    // 1. VICTOIRE
    pronos.push({...base,id:`${game.gamePk}-V`,type:'victoire',typeLabel:'Victoire du match',pick:`${favTeam.name} remporte le match`,explication:`Modèle sur données réelles (stats MLB + cotes du marché) : ${favTeam.name} a ${favProba.toFixed(1)}% de chances de gagner (intervalle ${Math.max(0,favProba-margeCI).toFixed(0)}–${Math.min(100,favProba+margeCI).toFixed(0)}%). Runs estimés : ${sim.expRunsA.toFixed(1)} − ${sim.expRunsH.toFixed(1)}.`,proba:favProba,confiance:conf,confScore:cScore,marge:margeCI,coteVegas:coteVegasFav,bookmaker:bkFav,fairProba:fairFav,coteUS:(favH?vg.coteH_us:vg.coteA_us)??null,bkUS:(favH?vg.bkH_us:vg.bkA_us)??null,coteEU:(favH?vg.coteH_eu:vg.coteA_eu)??null,bkEU:(favH?vg.bkH_eu:vg.bkA_eu)??null,facteurs:favRes.facteurs,dataDispos:Math.round(Math.min(rA.dataDispos,rH.dataDispos)),regAlertHTML,valueAlertHTML,formeDots,fatigueBadge,tendance:tendV,scoreA:rA.score,scoreH:rH.score});
    // 2. TOTAL
    if(vegas&&vegas.totalLine!=null&&sim.overProb!=null){
      const line=vegas.totalLine;const fairOver=vegas.overOdds&&vegas.underOdds?(1/vegas.overOdds)/((1/vegas.overOdds)+(1/vegas.underOdds)):null;
      const simOver=versMarche(sim.overProb,fairOver,wMkt,capMkt);const isOver=simOver>=0.5;const ourProba=(isOver?simOver:1-simOver)*100;const coteOU=isOver?vegas.overOdds:vegas.underOdds;
      pronos.push({...base,id:`${game.gamePk}-OU`,type:'ou',typeLabel:'Total points (O/U)',pick:`${isOver?'OVER':'UNDER'} ${line} points au total`,ouLine:line,ouSide:isOver?'over':'under',explication:`Estimation sur données réelles : total attendu ${(sim.expRunsA+sim.expRunsH).toFixed(1)} points (${sim.expRunsA.toFixed(1)} − ${sim.expRunsH.toFixed(1)}) vs ligne ${line}. Probabilité ${isOver?'OVER':'UNDER'} : ${ourProba.toFixed(1)}%.`,proba:pt(ourProba),confiance:Math.max(1,conf-1),coteVegas:coteOU,bookmaker:isOver?vegas.bkOver:vegas.bkUnder,coteUS:(isOver?vg.overOdds_us:vg.underOdds_us)??null,bkUS:(isOver?vg.bkOver_us:vg.bkUnder_us)??null,coteEU:(isOver?vg.overOdds_eu:vg.underOdds_eu)??null,bkEU:(isOver?vg.bkOver_eu:vg.bkUnder_eu)??null,fairProba:fairOver!=null?(isOver?fairOver:1-fairOver):null,facteurs:[{nom:'Total de runs estimé',valeur:`${(sim.expRunsA+sim.expRunsH).toFixed(1)} pts au total vs ligne ${line}`,detail:'Calculé sur les données réelles : offense (OPS), FIP des lanceurs, bullpen, park factor, ancrage sur la ligne du marché',score:isOver?70:30,poids:40,sense:isOver?'pos':'neg'},aData.fipPartant!=null?{nom:'FIP lanceur visiteur',valeur:`${aData.nomPartant||'TBD'} : ${aData.fipPartant.toFixed(2)}`,detail:'FIP = qualité réelle du lanceur.',score:sERA(aData.fipPartant),poids:20,sense:isOver?(sERA(aData.fipPartant)<=45?'pos':'neg'):(sERA(aData.fipPartant)>=55?'pos':'neg')}:null,hData.fipPartant!=null?{nom:'FIP lanceur domicile',valeur:`${hData.nomPartant||'TBD'} : ${hData.fipPartant.toFixed(2)}`,detail:'',score:sERA(hData.fipPartant),poids:20,sense:isOver?(sERA(hData.fipPartant)<=45?'pos':'neg'):(sERA(hData.fipPartant)>=55?'pos':'neg')}:null,{nom:`Park factor (${meteo?.stade||'stade'})`,valeur:`${parkPct} / 100`,detail:parkPct>=104?'Stade qui gonfle les points':parkPct<=97?'Stade qui réduit les points':'Stade neutre',score:parkPct,poids:10,sense:(parkPct>=104&&isOver)||(parkPct<=97&&!isOver)?'pos':'neu'},meteo&&wind.score!==0?{nom:'Impact météo (net)',valeur:wind.label,detail:wind.breakdown,score:50+wind.score*2,poids:10,sense:wind.impact}:null].filter(Boolean),regAlertHTML:'',tendance:(aForme?.tendances||hForme?.tendances)?`📈 Over 8.5 récemment : ${aForme?.tendances?`${away.team.abbreviation} ${aForme.tendances.over85}/${aForme.tendances.over85n}`:''}${aForme?.tendances&&hForme?.tendances?' · ':''}${hForme?.tendances?`${home.team.abbreviation} ${hForme.tendances.over85}/${hForme.tendances.over85n}`:''}`:''});
    }
    // 3. RUN LINE
    if(vegas&&vegas.spHomePoint!=null&&vegas.spAwayPoint!=null){
      const coverSim=(isHome,point)=>point<0?(isHome?sim.coverH_m15:sim.coverA_m15):(isHome?sim.coverH_p15:sim.coverA_p15);
      let homeCover=coverSim(true,vegas.spHomePoint),awayCover=coverSim(false,vegas.spAwayPoint);
      const fH=vegas.spHomeOdds&&vegas.spAwayOdds?(1/vegas.spHomeOdds)/((1/vegas.spHomeOdds)+(1/vegas.spAwayOdds)):null;
      homeCover=versMarche(homeCover,fH,wMkt,capMkt);awayCover=versMarche(awayCover,fH!=null?1-fH:null,wMkt,capMkt);
      const edgeHome=homeCover-1/vegas.spHomeOdds,edgeAway=awayCover-1/vegas.spAwayOdds,betHome=edgeHome>=edgeAway;
      const side=betHome?{team:home.team,isHome:true,point:vegas.spHomePoint,odds:vegas.spHomeOdds,proba:homeCover*100,win:pH,bk:vegas.bkSpHome,fair:fH}:{team:away.team,isHome:false,point:vegas.spAwayPoint,odds:vegas.spAwayOdds,proba:awayCover*100,win:pA,bk:vegas.bkSpAway,fair:fH!=null?1-fH:null};
      pronos.push({...base,id:`${game.gamePk}-RL`,type:'runline',typeLabel:'Run line (handicap)',pick:`${side.team.name} ${side.point>0?'+':''}${side.point}`,rlIsHome:side.isHome,rlPoint:side.point,explication:`Run line : ${side.point<0?`${side.team.name} doit gagner par 2 points ou plus`:`${side.team.name} peut perdre par 1 point max (ou gagner)`}. Couverture estimée : ${side.proba.toFixed(1)}%.`,proba:pt(side.proba),confiance:Math.max(1,conf-1),coteVegas:side.odds,bookmaker:side.bk,coteUS:(side.isHome?vg.spHomeOdds_us:vg.spAwayOdds_us)??null,bkUS:(side.isHome?vg.bkSpHome_us:vg.bkSpAway_us)??null,coteEU:(side.isHome?vg.spHomeOdds_eu:vg.spAwayOdds_eu)??null,bkEU:(side.isHome?vg.bkSpHome_eu:vg.bkSpAway_eu)??null,fairProba:side.fair,facteurs:[{nom:`Probabilité de victoire de ${side.team.name}`,valeur:`${side.win.toFixed(1)}%`,detail:'Issue du modèle sur données réelles',score:side.win,poids:50,sense:side.win>=55?'pos':'neg'},{nom:'Couverture du handicap estimée',valeur:`${side.proba.toFixed(1)}%`,detail:side.point<0?'Probabilité que l\'équipe gagne par 2 points ou plus':'Probabilité que l\'équipe ne perde pas par 2+',score:side.proba,poids:50,sense:side.proba>=55?'pos':'neg'}],regAlertHTML:'',tendance:(()=>{const sf=(side.isHome?hForme:aForme)?.tendances;if(!sf)return '';return `📈 ${side.team.name} récemment : ${side.point<0?`gagne par 2+ dans ${sf.cover15}/${sf.over85n}`:`couvre le +1.5 dans ${sf.plus15}/${sf.over85n}`}`;})()});
    }
  }
  // confScore + marge génériques
  pronos.forEach(p=>{if(p.confScore==null){const decisif=Math.abs(p.proba-50);p.confScore=confScore100(p.dataDispos,decisif,p.dataDispos);}if(p.marge==null)p.marge=Math.round(Math.max(3,Math.min(12,12-(p.confScore/100)*6)));});

  // pythMap pour la page Classements
  const pythMap={};
  Object.keys(hitMap).forEach(id=>{const rs=parseFloat(hitMap[id].runs),ra=pitMap[id]?parseFloat(pitMap[id].runs):null;if(rs&&ra)pythMap[id]={rs,ra,pyth:pythagorean(rs,ra)};});

  // Leaders (joueurs)
  const LEAD=[['hr','homeRuns'],['avg','battingAverage'],['rbi','rbi'],['ops','ops'],['sb','stolenBases'],['runs','runs'],['era','era'],['so','strikeOuts'],['wins','wins'],['whip','whip'],['saves','saves'],['k9','strikeoutsPer9Inn']];
  const leaders={};
  await Promise.all(LEAD.map(async([key,cat])=>{try{const d=await api(`/stats/leaders?leaderCategories=${cat}&season=${SEASON}&sportId=1&limit=8`);leaders[key]=(d.leagueLeaders?.[0]?.leaders??[]).map(l=>({rank:l.rank,name:l.person?.fullName,team:l.team?.name,value:l.value}));}catch(e){leaders[key]=[];}}));

  // matchs (liste brute pour l'onglet Matchs)
  const matchs=games.map(g=>({gamePk:g.gamePk,away:slim(g.teams.away.team),home:slim(g.teams.home.team),awayRec:g.teams.away.leagueRecord,homeRec:g.teams.home.leagueRecord,awayScore:g.teams.away.score,homeScore:g.teams.home.score,state:g.status.abstractGameState,gameDate:g.gameDate,awayP:g.teams.away.probablePitcher?.fullName,homeP:g.teams.home.probablePitcher?.fullName}));

  // ── Boucle de calibration (non bloquant) : enregistre/règle en base, mesure, recalibre les probas ──
  let trackRecord=null;
  try{
    const settledRows=await recordAndSettleResults(pronos);
    trackRecord=computeTrackRecord(settledRows);
    const recal=buildRecalibrator(settledRows);
    if(recal.active)pronos.forEach(p=>{if(typeof p.proba==='number')p.proba=pt(recal.apply(p.proba));});
    trackRecord.recalActive=recal.active;
    console.log(`📈 Track record : ${trackRecord.n} réglés · ${trackRecord.winRate??'—'}% · ROI ${trackRecord.roiPct??'—'}% · recalibration:${recal.active?'ON':'OFF'}`);
  }catch(e){console.log('ℹ️ Track record indisponible :',e.message);}

  return {date:today(),generatedAt:new Date().toISOString(),pronos,matchDataMap,tendancesJour,standings:standData.records??[],pythMap,leaders,matchs,trackRecord};
}

async function upsertSupabase(snapshot){
  let url=(process.env.SUPABASE_URL||'').trim();
  url=url.replace(/\/rest\/v1.*$/i,'').replace(/\/+$/,''); // enlève un éventuel /rest/v1… puis le / final
  if(url&&!/^https?:\/\//i.test(url))url='https://'+url;   // ajoute https:// si absent
  const key=(process.env.SUPABASE_SERVICE_KEY||'').trim();
  if(!url||!key){console.log('ℹ️  SUPABASE_URL/SERVICE_KEY absents → écriture locale snapshot.json uniquement.');fs.writeFileSync('snapshot.json',JSON.stringify(snapshot));return;}
  const r=await fetch(`${url}/rest/v1/snapshots`,{method:'POST',headers:{'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify({date:snapshot.date,generated_at:snapshot.generatedAt,data:snapshot})});
  if(!r.ok)throw new Error('Supabase upsert '+r.status+' '+await r.text());
  console.log('✅ Snapshot écrit dans Supabase.');
}

// N'exécute le job que si lancé directement (permet d'importer parseEventOdds dans un test)
const isMain=process.argv[1]&&process.argv[1].replace(/\\/g,'/').endsWith('build-data.mjs');
if(isMain)(async()=>{
  try{
    console.log('⏳ Calcul du snapshot pour',today(),'...');
    const snap=await build();
    console.log(`✅ ${snap.pronos.length} pronos · ${snap.tendancesJour.length} équipes (tendances) · ${snap.matchs.length} matchs · cotes:${snap.pronos.some(p=>p.coteVegas)?'oui':'non'}`);
    await upsertSupabase(snap);
    console.log('Terminé.');
  }catch(e){console.error('❌ Erreur:',e.message);process.exit(1);}
})();
