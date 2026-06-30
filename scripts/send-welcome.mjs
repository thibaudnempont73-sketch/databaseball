// ════════════════════════════════════════════════════════════════
// DataBaseball — Email de BIENVENUE (Brevo)
// Tourne chaque jour (workflow). Envoie un mail aux abonnés welcomed=false
// (nouveaux inscrits), puis marque welcomed=true. Réutilise l'infra Brevo.
// ════════════════════════════════════════════════════════════════
const URL=(process.env.SUPABASE_URL||'').trim().replace(/\/rest\/v1.*$/i,'').replace(/\/+$/,'').replace(/^(?!https?:\/\/)/,'https://');
const KEY=(process.env.SUPABASE_SERVICE_KEY||'').trim();
const BREVO=(process.env.BREVO_API_KEY||'').trim();
const SENDER_EMAIL=process.env.SENDER_EMAIL||'pronos@databaseball.app';
const SENDER_NAME=process.env.SENDER_NAME||'DataBaseball';
const SITE=process.env.SITE_URL||'https://databaseball.app';
if(!URL||!KEY||!BREVO){console.log('ℹ️ Secrets manquants → bienvenue non envoyée.');process.exit(0);}

const sb=(path,opts={})=>fetch(`${URL}/rest/v1/${path}`,{...opts,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(opts.headers||{})}});

// Coquille HTML brandée (dark) commune
function shell(inner,lang,unsubUrl){
  const c=FOOT[['fr','en','es'].includes(lang)?lang:'fr'];
  return `<!DOCTYPE html><html><body style="margin:0;background:#0E1520;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#E8EDF5">
<div style="max-width:520px;margin:0 auto;padding:28px 18px">
  <div style="text-align:center;font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:18px">DATA<span style="color:#E8192C">BASEBALL</span></div>
  ${inner}
  <hr style="border:none;border-top:1px solid #1C2A3E;margin:18px 0">
  <p style="font-size:11px;color:#5C6E87;line-height:1.5;margin:0 0 8px">${c.resp}</p>
  <p style="font-size:11px;color:#5C6E87;margin:0">${c.foot} · <a href="${unsubUrl}" style="color:#5C6E87">${c.unsub}</a></p>
</div></body></html>`;
}
const FOOT={
 fr:{foot:'Tu reçois cet email car tu as un compte DataBaseball.',unsub:'Se désinscrire',resp:'⚠️ Outil d\'analyse à but informatif. Parier comporte des risques — ne misez que ce que vous pouvez perdre. Réservé aux 18+.'},
 en:{foot:'You receive this email because you have a DataBaseball account.',unsub:'Unsubscribe',resp:'⚠️ Statistical analysis tool for information only. Betting carries risk — only bet what you can afford to lose. 18+ only.'},
 es:{foot:'Recibes este email porque tienes una cuenta DataBaseball.',unsub:'Darse de baja',resp:'⚠️ Herramienta de análisis con fines informativos. Apostar conlleva riesgo — apuesta solo lo que puedas permitirte perder. Solo +18.'}
};
const W={
 fr:{subj:'👋 Bienvenue sur DataBaseball !',h:'Bienvenue 👋',p1:'Content de t\'avoir avec nous ! DataBaseball analyse <b>chaque match MLB</b> à partir de <b>données 100% réelles</b> (FIP des lanceurs, OPS, park factors, vraies cotes) — <b>zéro simulation</b>.',p2:'Chaque jour, tu reçois ici le <b>pronostic gratuit du jour</b>, et tu peux retrouver tous les pronos, combinés et ton suivi de bankroll dans l\'app.',p3:'Notre promesse : <b>l\'honnêteté</b>. On te dit quand un match est trop serré, et notre calibration est vérifiable.',cta:'⚡ Voir les pronos du jour'},
 en:{subj:'👋 Welcome to DataBaseball!',h:'Welcome 👋',p1:'Glad to have you! DataBaseball analyzes <b>every MLB game</b> from <b>100% real data</b> (pitcher FIP, OPS, park factors, real odds) — <b>zero simulation</b>.',p2:'Every day you\'ll get the <b>free pick of the day</b> right here, and you can find all picks, parlays and your bankroll tracking in the app.',p3:'Our promise: <b>honesty</b>. We tell you when a game is too close, and our calibration is verifiable.',cta:'⚡ See today\'s picks'},
 es:{subj:'👋 ¡Bienvenido a DataBaseball!',h:'Bienvenido 👋',p1:'¡Encantados de tenerte! DataBaseball analiza <b>cada partido MLB</b> con <b>datos 100% reales</b> (FIP de lanzadores, OPS, park factors, cuotas reales) — <b>cero simulación</b>.',p2:'Cada día recibirás aquí el <b>pronóstico gratis del día</b>, y encontrarás todos los pronósticos, combinadas y tu seguimiento de bankroll en la app.',p3:'Nuestra promesa: <b>honestidad</b>. Te decimos cuándo un partido está muy reñido, y nuestra calibración es verificable.',cta:'⚡ Ver los pronósticos de hoy'}
};
function welcomeHTML(lang,unsubUrl){
  const L=['fr','en','es'].includes(lang)?lang:'fr',c=W[L];
  const inner=`<p style="font-size:18px;font-weight:800;margin:0 0 12px">${c.h}</p>
  <p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 12px">${c.p1}</p>
  <p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 12px">${c.p2}</p>
  <p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 18px">${c.p3}</p>
  <div style="text-align:center;margin:6px 0 4px"><a href="${SITE}/app.html" style="display:inline-block;background:#E8192C;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:11px">${c.cta}</a></div>`;
  return shell(inner,L,unsubUrl);
}
async function sendOne(to,subject,html){
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':BREVO,'Content-Type':'application/json','accept':'application/json'},body:JSON.stringify({sender:{name:SENDER_NAME,email:SENDER_EMAIL},to:[{email:to}],subject,htmlContent:html})});
  if(!r.ok)throw new Error(`${r.status} ${(await r.text()).slice(0,160)}`);
}
(async()=>{
  const r=await sb('email_subs?select=user_id,email,lang,unsub_token&welcomed=is.false&optin=is.true');
  const subs=(r.ok?await r.json():[]).filter(s=>s.email);
  if(!subs.length){console.log('ℹ️ Aucun nouvel inscrit à accueillir.');return;}
  console.log(`👋 Bienvenue à ${subs.length} nouvel(le)(s) inscrit(e)(s)…`);
  let ok=0;
  for(const s of subs){
    const L=['fr','en','es'].includes(s.lang)?s.lang:'fr';
    try{
      await sendOne(s.email,W[L].subj,welcomeHTML(L,`${SITE}/app.html?unsub=${s.unsub_token}`));
      await sb(`email_subs?user_id=eq.${s.user_id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({welcomed:true})});
      ok++;
    }catch(e){console.log('  ✗',s.email,e.message);}
    await new Promise(r=>setTimeout(r,120));
  }
  console.log(`✅ Bienvenue envoyée : ${ok}/${subs.length}.`);
})().catch(e=>{console.error('❌ send-welcome:',e.message);process.exit(0);});
