// Edge Function Supabase : reçoit les webhooks Stripe et met à jour profiles.abonnement.
// C'est LA source de vérité du paiement (on ne fait jamais confiance au client).
// Envoie aussi les emails de confirmation/résiliation (Brevo).
// Déploiement : supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets requis : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//                  + (pour les emails) BREVO_API_KEY, SENDER_EMAIL (optionnel), APP_URL (optionnel)
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const WH = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// ── Emails (Brevo) ──
const BREVO = Deno.env.get('BREVO_API_KEY') || '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'pronos@databaseball.app';
const SENDER_NAME = 'DataBaseball';
const APP_URL = Deno.env.get('APP_URL') || 'https://databaseball.app/app.html';

async function langOf(uid: string | null): Promise<string> {
  if (!uid) return 'fr';
  try { const { data } = await admin.from('email_subs').select('lang').eq('user_id', uid).single();
    return ['fr','en','es'].includes(data?.lang as string) ? (data!.lang as string) : 'fr'; } catch { return 'fr'; }
}
function shell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0E1520;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#E8EDF5"><div style="max-width:520px;margin:0 auto;padding:28px 18px"><div style="text-align:center;font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:18px">DATA<span style="color:#E8192C">BASEBALL</span></div>${inner}<hr style="border:none;border-top:1px solid #1C2A3E;margin:18px 0"><p style="font-size:11px;color:#5C6E87">⚠️ Outil d'analyse à but informatif. Parier comporte des risques — ne misez que ce que vous pouvez perdre. Réservé aux 18+.</p></div></body></html>`;
}
async function sendMail(to: string | null | undefined, subject: string, html: string) {
  if (!BREVO || !to) return;
  try { await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST',
    headers:{'api-key':BREVO,'Content-Type':'application/json','accept':'application/json'},
    body: JSON.stringify({ sender:{name:SENDER_NAME,email:SENDER_EMAIL}, to:[{email:to}], subject, htmlContent:html }) }); } catch (_) { /* non bloquant */ }
}
const cta = (txt: string) => `<div style="text-align:center;margin:18px 0"><a href="${APP_URL}" style="display:inline-block;background:#E8192C;color:#fff;font-weight:800;text-decoration:none;padding:13px 28px;border-radius:11px">${txt}</a></div>`;
const MAILS: Record<string, { wS:string; wH:string; cS:string; cH:string }> = {
  fr:{ wS:'✅ Bienvenue en Premium DataBaseball !',
       wH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">Merci, et bienvenue en Premium ! ⭐</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 8px">Ton abonnement est <b>actif</b>. Tu débloques <b>tous les pronos du jour</b>, ta <b>sélection complète</b>, l'historique et la calibration.</p>${cta('⚡ Accéder à mes pronos')}<p style="font-size:11px;color:#5C6E87">Tu peux gérer ou résilier ton abonnement à tout moment depuis « Mon compte ».</p>`,
       cS:'Ton abonnement DataBaseball est résilié',
       cH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">Abonnement résilié</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6">Ton abonnement Premium a bien été résilié. Tu peux te réabonner quand tu veux depuis l'app. Merci d'avoir testé DataBaseball Premium 🙏</p>` },
  en:{ wS:'✅ Welcome to DataBaseball Premium!',
       wH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">Thank you, and welcome to Premium! ⭐</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 8px">Your subscription is <b>active</b>. You unlock <b>all daily picks</b>, your <b>full selection</b>, history and calibration.</p>${cta('⚡ Open my picks')}<p style="font-size:11px;color:#5C6E87">You can manage or cancel your subscription anytime from "My account".</p>`,
       cS:'Your DataBaseball subscription is canceled',
       cH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">Subscription canceled</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6">Your Premium subscription has been canceled. You can resubscribe anytime from the app. Thanks for trying DataBaseball Premium 🙏</p>` },
  es:{ wS:'✅ ¡Bienvenido a DataBaseball Premium!',
       wH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">¡Gracias y bienvenido a Premium! ⭐</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6;margin:0 0 8px">Tu suscripción está <b>activa</b>. Desbloqueas <b>todos los pronósticos del día</b>, tu <b>selección completa</b>, el historial y la calibración.</p>${cta('⚡ Ver mis pronósticos')}<p style="font-size:11px;color:#5C6E87">Puedes gestionar o cancelar tu suscripción cuando quieras desde "Mi cuenta".</p>`,
       cS:'Tu suscripción DataBaseball ha sido cancelada',
       cH:`<p style="font-size:18px;font-weight:800;margin:0 0 12px">Suscripción cancelada</p><p style="font-size:14px;color:#AbB6C8;line-height:1.6">Tu suscripción Premium ha sido cancelada. Puedes volver a suscribirte cuando quieras desde la app. Gracias por probar DataBaseball Premium 🙏</p>` },
};

// Met à jour le profil par uid (metadata) ou par customer Stripe
async function setAbo(uid: string | null, customer: string | null, abonnement: string, fin: number | null) {
  const patch: Record<string, unknown> = { abonnement };
  if (fin) patch.fin_periode = new Date(fin * 1000).toISOString();
  if (customer) patch.stripe_customer_id = customer;
  if (uid)            await admin.from('profiles').update(patch).eq('id', uid);
  else if (customer)  await admin.from('profiles').update(patch).eq('stripe_customer_id', customer);
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature') || '';
  const body = await req.text();
  let ev: Stripe.Event;
  try {
    ev = await stripe.webhooks.constructEventAsync(body, sig, WH);
  } catch (e) {
    return new Response('Signature invalide: ' + (e as Error).message, { status: 400 });
  }
  try {
    if (ev.type === 'checkout.session.completed') {
      const s = ev.data.object as Stripe.Checkout.Session;
      const uid = (s.metadata?.uid as string) || null;
      const sub = s.subscription ? await stripe.subscriptions.retrieve(s.subscription as string) : null;
      await setAbo(uid, s.customer as string, 'actif', sub?.current_period_end ?? null);
      // Email de confirmation / bienvenue Premium
      const m = MAILS[await langOf(uid)] || MAILS.fr;
      await sendMail(s.customer_details?.email, m.wS, shell(m.wH));
    } else if (ev.type === 'customer.subscription.updated') {
      const sub = ev.data.object as Stripe.Subscription;
      const actif = sub.status === 'active' || sub.status === 'trialing';
      await setAbo((sub.metadata?.uid as string) || null, sub.customer as string, actif ? 'actif' : 'annule', sub.current_period_end);
    } else if (ev.type === 'customer.subscription.deleted') {
      const sub = ev.data.object as Stripe.Subscription;
      const uid = (sub.metadata?.uid as string) || null;
      await setAbo(uid, sub.customer as string, 'annule', null);
      // Email de résiliation (on récupère l'email via le client Stripe)
      try { const cust = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const m = MAILS[await langOf(uid)] || MAILS.fr; await sendMail(cust?.email, m.cS, shell(m.cH)); } catch (_) { /* */ }
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('Erreur: ' + (e as Error).message, { status: 500 });
  }
});
