// Edge Function Supabase : ouvre le portail client Stripe (gérer / résilier l'abonnement).
// Déploiement : supabase functions deploy create-portal
// Secrets requis : STRIPE_SECRET_KEY, APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
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
    const authHeader = req.headers.get('Authorization') || '';
    const supaUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: 'Non connecté' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    const customer = prof?.stripe_customer_id as string | undefined;
    if (!customer) return json({ error: 'Aucun abonnement à gérer' }, 400);

    const portal = await stripe.billingPortal.sessions.create({ customer, return_url: APP_URL });
    return json({ url: portal.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
