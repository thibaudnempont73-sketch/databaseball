// Edge Function Supabase : crée une session de paiement Stripe Checkout pour l'utilisateur connecté.
// Déploiement : supabase functions deploy create-checkout
// Secrets requis : STRIPE_SECRET_KEY, STRIPE_PRICE_MOIS, STRIPE_PRICE_AN, APP_URL,
//                  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const PRICES: Record<string, string> = {
  mois: Deno.env.get('STRIPE_PRICE_MOIS')!,
  an:   Deno.env.get('STRIPE_PRICE_AN')!,
};
const APP_URL = Deno.env.get('APP_URL') || 'https://databaseball.app/app.html';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // 1) Identifier l'utilisateur via son jeton
    const authHeader = req.headers.get('Authorization') || '';
    const supaUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: 'Non connecté' }, 401);

    const { plan } = await req.json().catch(() => ({ plan: 'mois' }));
    const price = PRICES[plan] || PRICES.mois;

    // 2) Récupérer (ou créer) le client Stripe lié au profil — écriture via service role
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    let customer = prof?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email, metadata: { uid: user.id } });
      customer = c.id;
      await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }

    // 3) Créer la session de paiement (abonnement récurrent)
    const session = await stripe.checkout.sessions.create({
      customer,
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: APP_URL + '?paid=1',
      cancel_url: APP_URL,
      metadata: { uid: user.id },
      subscription_data: { metadata: { uid: user.id } },
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
