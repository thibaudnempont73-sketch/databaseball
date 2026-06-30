// ════════════════════════════════════════════════════════════════
// DataBaseball — RÉCAP HEBDOMADAIRE (Brevo) — l'angle HONNÊTETÉ
// Tourne chaque jour mais ne s'envoie QUE le lundi (ou WEEKLY_FORCE=1).
// Track record RÉEL des 7 derniers jours (table results) : réussite + ROI + calibration.
// ════════════════════════════════════════════════════════════════
const URL=(process.env.SUPABASE_URL||'').trim().replace(/\/rest\/v1.*$/i,'').replace(/\/+$/,'').replace(/^(?!https?:\/\/)/,'https://');
const KEY=(process.env.SUPABASE_SERVICE_KEY||'').trim();
const BREVO=(process.env.BREVO_API_KEY||'').trim();
const SENDER_EMAIL=process.env.SENDER_EMAIL||'pronos@databaseball.app';
const SENDER_NAME=process.env.SENDER_NAME||'DataBaseball';
const SITE=process.env.SITE_URL||'https://databaseball.app';
const FORCE=process.env.WEEKLY_FORCE==='1';
if(!URL||!KEY||!BREVO){console.log('ℹ️ Secrets manquants → récap non envoyé.');process.exit(0);}
if(new Date().getDay()!==1&&!FORCE){console.log('ℹ️ Pas lundi → pas de récap hebdo.');process.exit(0);}

const sb=(path,opts={})=>fetch(`${URL}/rest/v1/${path}`,{...opts,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(opts.headers||{})}});
const today=()=>new Date().toISOString().split('T')[0];
const weekAgo=()=>new Date(Date.now()-7*864e5).toISOString().split('T')[0];

const FOOT={
 fr:{foot:'Tu reçois cet email car tu as un compte DataBaseball.',unsub:'Se désinscrire',resp:'⚠️ Outil d\'analyse à but informatif. Parier comporte des risques — ne misez que ce que vous pouvez perdre. Réservé aux 18+.'},
 en:{foot:'You receive this email because you have a DataBaseball account.',unsub:'Unsubscribe',resp:'⚠️ Statistical analysis tool for information only. Betting carries risk — only bet what you can afford to lose. 18+ only.'},
 es:{foot:'Recibes este email porque tienes una cuenta DataBaseball.',unsub:'Darse de baja',resp:'⚠️ Herramienta de análisis con fines informativos. Apostar conlleva riesgo — apuesta solo lo que puedas permitirte perder. Solo +18.'}
};
function shell(inner,lang,unsubUrl){const c=FOOT[['fr','en','es'].includes(lang)?lang:'fr'];
  return `<!DOCTYPE html><html><body style="margin:0;background:#0E1520;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#E8EDF5"><div style="max-width:520px;margin:0 auto;padding:28px 18px"><div style="text-align:center;font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:18px">DATA<span style="color:#E8192C">BASEBALL</span></div>${inner}<hr style="border:none;border-top:1px solid #1C2A3E;margin:18px 0"><p style="font-size:11px;color:#5C6E87;line-height:1.5;margin:0 0 8px">${c.resp}</p><p style="font-size:11px;color:#5C6E87;margin:0">${c.foot} · <a href="${unsubUrl}" style="color:#5C6E87">${c.unsub}</a></p></div></body></html>`;}

const T={
 fr:{subj:'📊 Ton récap DataBaseball de la semaine',h:'Le bilan honnête de la semaine 📊',intro:n=>`Sur les 7 derniers jours, <b>${n} pronostics</b> ont été réglés. Voici les vrais chiffres, sans filtre :`,win:'Taux de réussite',roi:'ROI',calib:(a,r)=>`🎯 Calibration : quand on annonçait <b>≥60%</b>, on a réellement gagné <b>${r}%</b> (sur ${a} pronos).`,note:'Pas de promesse de gain — juste les résultats réels. C\'est ça, l\'honnêteté.',cta:'⚡ Voir les pronos du jour'},
 en:{subj:'📊 Your DataBaseball weekly recap',h:'The honest week in review 📊',intro:n=>`Over the last 7 days, <b>${n} picks</b> were settled. Here are the real numbers, unfiltered:`,win:'Win rate',roi:'ROI',calib:(a,r)=>`🎯 Calibration: when we said <b>≥60%</b>, we actually won <b>${r}%</b> (over ${a} picks).`,note:'No promises of profit — just real results. That\'s what honesty looks like.',cta:'⚡ See today\'s picks'},
 es:{subj:'📊 Tu resumen semanal DataBaseball',h:'El balance honesto de la semana 📊',intro:n=>`En los últimos 7 días, se resolvieron <b>${n} pronósticos</b>. Aquí están las cifras reales, sin filtro:`,win:'Tasa de acierto',roi:'ROI',calib:(a,r)=>`🎯 Calibración: cuando decíamos <b>≥60%</b>, ganamos realmente <b>${r}%</b> (sobre ${a} pronósticos).`,note:'Sin promesas de ganancia — solo resultados reales. Eso es honestidad.',cta:'⚡ Ver los pronósticos de hoy'}
};
function recapHTML(stats,lang,unsubUrl){
  const L=['fr','en','es'].includes(lang)?lang:'fr',c=T[L];
  const roiCol=stats.roiPct>=0?'#00C896':'#E8192C',roiTxt=(stats.roiPct>=0?'+':'')+stats.roiPct+'%';
  const box=(lbl,val,col)=>`<div style="display:inline-block;width:46%;background:#0F1825;border:1px solid #1C2A3E;border-radius:12px;padding:16px;text-align:center;margin:1%"><div style="font-size:12px;color:#5C6E87;text-transform:uppercase;letter-spacing:.5px">${lbl}</div><div style="font-size:28px;font-weight:800;color:${col}">${val}</div></div>`;
  const inner=`<p style="font-size:18px;font-weight:800;margin:0 0 12px">${c.h}</p>
  <p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 16px">${c.intro(stats.n)}</p>
  <div style="text-align:center;margin:0 0 14px">${box(c.win,stats.winRate+'%','#E8EDF5')}${box(c.roi,roiTxt,roiCol)}</div>
  ${stats.cal60n>=5?`<p style="font-size:13px;color:#AbB6C8;line-height:1.6;margin:0 0 14px">${c.calib(stats.cal60n,stats.cal60r)}</p>`:''}
  <p style="font-size:13px;color:#5C6E87;line-height:1.6;margin:0 0 18px"><i>${c.note}</i></p>
  <div style="text-align:center"><a href="${SITE}/app.html" style="display:inline-block;background:#E8192C;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:11px">${c.cta}</a></div>`;
  return shell(inner,L,unsubUrl);
}
async function sendOne(to,subject,html){const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':BREVO,'Content-Type':'application/json','accept':'application/json'},body:JSON.stringify({sender:{name:SENDER_NAME,email:SENDER_EMAIL},to:[{email:to}],subject,htmlContent:html})});if(!r.ok)throw new Error(`${r.status} ${(await r.text()).slice(0,160)}`);}

(async()=>{
  // anti-doublon
  const lg=await sb(`email_log?select=jour&kind=eq.weekly&jour=eq.${today()}`);
  if(lg.ok&&(await lg.json()).length){console.log('ℹ️ Récap déjà envoyé aujourd\'hui → stop.');return;}
  // stats réelles des 7 derniers jours (table results)
  const rr=await sb(`results?select=proba,cote,resultat&date=gte.${weekAgo()}&resultat=in.(W,L)`);
  const rows=rr.ok?await rr.json():[];
  if(!rows.length){console.log('ℹ️ Aucun prono réglé cette semaine → pas de récap.');return;}
  const n=rows.length,wins=rows.filter(r=>r.resultat==='W').length;
  let roi=0;rows.forEach(r=>{roi+=r.resultat==='W'?((+r.cote||2)-1):-1;});
  const hi=rows.filter(r=>(+r.proba||0)>=60),hiW=hi.filter(r=>r.resultat==='W').length;
  const stats={n,winRate:Math.round(wins/n*100),roiPct:Math.round(roi/n*1000)/10,cal60n:hi.length,cal60r:hi.length?Math.round(hiW/hi.length*100):null};
  console.log(`📊 Récap : ${n} réglés · ${stats.winRate}% · ROI ${stats.roiPct}%`);

  const sr=await sb('email_subs?select=email,lang,unsub_token&optin=is.true');
  const subs=(sr.ok?await sr.json():[]).filter(s=>s.email);
  if(!subs.length){console.log('ℹ️ Aucun abonné opt-in.');return;}
  let ok=0;
  for(const s of subs){const L=['fr','en','es'].includes(s.lang)?s.lang:'fr';
    try{await sendOne(s.email,T[L].subj,recapHTML(stats,L,`${SITE}/app.html?unsub=${s.unsub_token}`));ok++;}catch(e){console.log('  ✗',s.email,e.message);}
    await new Promise(r=>setTimeout(r,120));
  }
  console.log(`✅ Récap envoyé : ${ok}/${subs.length}.`);
  if(ok>0)await sb('email_log',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({jour:today(),kind:'weekly',n_sent:ok})});
})().catch(e=>{console.error('❌ send-weekly:',e.message);process.exit(0);});
