// ════════════════════════════════════════════════════════════════
// DataBaseball — DIGEST QUOTIDIEN par email (Brevo)
// Lancé par GitHub Actions APRÈS build-data.mjs. Lit le snapshot du jour +
// les abonnés opt-in dans Supabase, envoie le pronostic GRATUIT du jour.
// Secrets requis (env) : SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY.
// Optionnels : SENDER_EMAIL, SENDER_NAME, SITE_URL.
// ════════════════════════════════════════════════════════════════
const URL=(process.env.SUPABASE_URL||'').trim().replace(/\/rest\/v1.*$/i,'').replace(/\/+$/,'').replace(/^(?!https?:\/\/)/,'https://');
const KEY=(process.env.SUPABASE_SERVICE_KEY||'').trim();
const BREVO=(process.env.BREVO_API_KEY||'').trim();
const SENDER_EMAIL=process.env.SENDER_EMAIL||'pronos@databaseball.app';
const SENDER_NAME=process.env.SENDER_NAME||'DataBaseball';
const SITE=process.env.SITE_URL||'https://databaseball.app';

if(!URL||!KEY){console.log('ℹ️ SUPABASE_URL/SERVICE_KEY absents → digest non envoyé.');process.exit(0);}
if(!BREVO){console.log('ℹ️ BREVO_API_KEY absent → digest non envoyé.');process.exit(0);}

const sb=(path,opts={})=>fetch(`${URL}/rest/v1/${path}`,{...opts,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(opts.headers||{})}});
const today=()=>new Date().toISOString().split('T')[0];

// ── Pronostic gratuit du jour = même logique que l'app (computeFreePick) ──
function freePick(pronos){
  const elig=pronos.filter(p=>p.coteVegas&&p.dataDispos>=50);
  if(elig.length)return elig.slice().sort((a,b)=>b.proba-a.proba)[0];
  return pronos.slice().sort((a,b)=>(b.confScore??0)-(a.confScore??0))[0]||null;
}
function localizePick(p,lang){
  const L=['fr','en','es'].includes(lang)?lang:'fr';
  if(p.type==='victoire'){const home=(p.probaHome??0)>=(p.probaAway??0);const tn=(home?p.homeTeam:p.awayTeam)?.name||'';return {fr:`${tn} gagne`,en:`${tn} to win`,es:`${tn} gana`}[L];}
  if(p.type==='ou'){const over=p.ouSide==='over',line=p.ouLine;return over?{fr:`Plus de ${line} points`,en:`Over ${line} runs`,es:`Más de ${line} carreras`}[L]:{fr:`Moins de ${line} points`,en:`Under ${line} runs`,es:`Menos de ${line} carreras`}[L];}
  if(p.type==='runline'){const tn=(p.rlIsHome?p.homeTeam:p.awayTeam)?.name||'';const pt=(p.rlPoint>0?'+':'')+p.rlPoint;return `${tn} ${pt}`;}
  return p.pick||'';
}

// ── Copie i18n de l'email ──
const I={
 fr:{subj:'⚾ Ton prono MLB gratuit du jour',hi:'Salut 👋',intro:'Les matchs MLB du jour sont analysés. Voici ton <b>pronostic gratuit</b> :',match:'Match',pick:'Pronostic',proba:'Chance de gagner',cote:'Cote',teaser:n=>`Et <b>${n} autres pronos à signal fort</b> t'attendent dans l'app.`,cta:'Voir tous les pronos du jour',foot:'Tu reçois cet email car tu as un compte DataBaseball.',unsub:'Se désinscrire',resp:'⚠️ Outil d\'analyse à but informatif. Parier comporte des risques — ne misez que ce que vous pouvez perdre. Réservé aux 18+.'},
 en:{subj:'⚾ Your free MLB pick of the day',hi:'Hi 👋',intro:'Today\'s MLB games are analyzed. Here is your <b>free pick</b>:',match:'Game',pick:'Pick',proba:'Win chance',cote:'Odds',teaser:n=>`And <b>${n} more strong-signal picks</b> are waiting in the app.`,cta:'See all today\'s picks',foot:'You receive this email because you have a DataBaseball account.',unsub:'Unsubscribe',resp:'⚠️ Statistical analysis tool for information only. Betting carries risk — only bet what you can afford to lose. 18+ only.'},
 es:{subj:'⚾ Tu pronóstico MLB gratis del día',hi:'Hola 👋',intro:'Los partidos MLB de hoy están analizados. Aquí tienes tu <b>pronóstico gratis</b>:',match:'Partido',pick:'Pronóstico',proba:'Prob. de ganar',cote:'Cuota',teaser:n=>`Y <b>${n} pronósticos de señal fuerte más</b> te esperan en la app.`,cta:'Ver todos los pronósticos de hoy',foot:'Recibes este email porque tienes una cuenta DataBaseball.',unsub:'Darse de baja',resp:'⚠️ Herramienta de análisis con fines informativos. Apostar conlleva riesgo — apuesta solo lo que puedas permitirte perder. Solo +18.'}
};

function emailHTML(p,nFort,lang,unsubUrl){
  const L=['fr','en','es'].includes(lang)?lang:'fr',c=I[L];
  const pick=localizePick(p,L),proba=Math.round(p.proba);
  return `<!DOCTYPE html><html><body style="margin:0;background:#0E1520;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#E8EDF5">
<div style="max-width:520px;margin:0 auto;padding:28px 18px">
  <div style="text-align:center;font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:18px">DATA<span style="color:#E8192C">BASEBALL</span></div>
  <p style="font-size:15px;margin:0 0 6px">${c.hi}</p>
  <p style="font-size:14px;color:#AbB6C8;line-height:1.5;margin:0 0 18px">${c.intro}</p>
  <div style="background:#0F1825;border:1px solid #1C2A3E;border-left:4px solid #00C896;border-radius:12px;padding:18px 20px;margin-bottom:18px">
    <div style="font-size:12px;color:#5C6E87;text-transform:uppercase;letter-spacing:.5px">${c.match}</div>
    <div style="font-size:16px;font-weight:700;margin:2px 0 12px">${p.matchLabel||''}</div>
    <div style="font-size:12px;color:#5C6E87;text-transform:uppercase;letter-spacing:.5px">${c.pick}</div>
    <div style="font-size:20px;font-weight:800;color:#00C896;margin:2px 0 12px">🎯 ${pick}</div>
    <div style="display:inline-block;margin-right:18px"><span style="font-size:12px;color:#5C6E87">${c.proba}</span> <b style="font-size:18px">${proba}%</b></div>
    ${p.coteVegas?`<div style="display:inline-block"><span style="font-size:12px;color:#5C6E87">${c.cote}</span> <b style="font-size:18px">${(+p.coteVegas).toFixed(2)}</b></div>`:''}
  </div>
  ${nFort>0?`<p style="font-size:13px;color:#AbB6C8;margin:0 0 18px">${c.teaser(nFort)}</p>`:''}
  <div style="text-align:center;margin:6px 0 22px"><a href="${SITE}/app.html" style="display:inline-block;background:#E8192C;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:11px">⚡ ${c.cta}</a></div>
  <hr style="border:none;border-top:1px solid #1C2A3E;margin:18px 0">
  <p style="font-size:11px;color:#5C6E87;line-height:1.5;margin:0 0 8px">${c.resp}</p>
  <p style="font-size:11px;color:#5C6E87;margin:0">${c.foot} · <a href="${unsubUrl}" style="color:#5C6E87">${c.unsub}</a></p>
</div></body></html>`;
}

async function sendOne(to,subject,html){
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':BREVO,'Content-Type':'application/json','accept':'application/json'},
    body:JSON.stringify({sender:{name:SENDER_NAME,email:SENDER_EMAIL},to:[{email:to}],subject,htmlContent:html})});
  if(!r.ok)throw new Error(`${r.status} ${(await r.text()).slice(0,160)}`);
}

(async()=>{
  // anti-doublon : déjà envoyé aujourd'hui ?
  const logR=await sb(`email_log?select=jour&jour=eq.${today()}&kind=eq.digest`);
  if(logR.ok&&(await logR.json()).length){console.log('ℹ️ Digest déjà envoyé aujourd\'hui → stop.');return;}

  const snR=await sb('snapshots?select=data&order=date.desc&limit=1');
  const snap=snR.ok?(await snR.json())[0]?.data:null;
  const pronos=snap?.pronos||[];
  if(!pronos.length){console.log('ℹ️ Aucun prono dans le snapshot → pas d\'envoi.');return;}
  const pick=freePick(pronos);
  if(!pick){console.log('ℹ️ Pas de free pick → pas d\'envoi.');return;}
  const nFort=pronos.filter(p=>p.coteVegas&&(p.proba??0)>=58).length-1; // hors le free pick montré

  const subR=await sb('email_subs?select=email,lang,unsub_token&optin=is.true');
  const subs=(subR.ok?await subR.json():[]).filter(s=>s.email);
  if(!subs.length){console.log('ℹ️ Aucun abonné opt-in → rien à envoyer.');return;}
  console.log(`📨 Envoi du digest à ${subs.length} abonné(s)…`);

  let ok=0,ko=0;
  for(const s of subs){
    const unsub=`${SITE}/app.html?unsub=${s.unsub_token}`;
    const L=['fr','en','es'].includes(s.lang)?s.lang:'fr';
    try{await sendOne(s.email,I[L].subj,emailHTML(pick,Math.max(0,nFort),L,unsub));ok++;}
    catch(e){ko++;console.log('  ✗',s.email,e.message);}
    await new Promise(r=>setTimeout(r,120)); // léger throttle
  }
  console.log(`✅ Digest envoyé : ${ok} OK, ${ko} échec(s).`);
  await sb('email_log',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({jour:today(),kind:'digest',n_sent:ok})});
})().catch(e=>{console.error('❌ send-daily:',e.message);process.exit(0);}); // exit 0 : ne casse pas le workflow build
