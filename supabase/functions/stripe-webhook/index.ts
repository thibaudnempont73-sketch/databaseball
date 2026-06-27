// Edge Function Supabase : reçoit les webhooks Stripe et met à jour profiles.abonnement.
// C'est LA source de vérité du paiement (on ne fait jamais confiance au client).
// Déploiement : supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets requis : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const WH = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

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
      const sub = s.subscription ? await stripe.subscriptions.retrieve(s.subscription as string) : null;
      await setAbo((s.metadata?.uid as string) || null, s.customer as string, 'actif', sub?.current_period_end ?? null);
    } else if (ev.type === 'customer.subscription.updated') {
      const sub = ev.data.object as Stripe.Subscription;
      const actif = sub.status === 'active' || sub.status === 'trialing';
      await setAbo((sub.metadata?.uid as string) || null, sub.customer as string, actif ? 'actif' : 'annule', sub.current_period_end);
    } else if (ev.type === 'customer.subscription.deleted') {
      const sub = ev.data.object as Stripe.Subscription;
      await setAbo((sub.metadata?.uid as string) || null, sub.customer as string, 'annule', null);
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('Erreur: ' + (e as Error).message, { status: 500 });
  }
});
