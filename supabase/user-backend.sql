-- ════════════════════════════════════════════════════════════
-- DataBaseball — Backend UTILISATEUR (profils + abonnement + données)
-- À exécuter dans Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════

-- 1) PROFILS : 1 ligne par compte, porte le statut d'abonnement (source de vérité = Stripe via webhook)
create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  abonnement         text default 'gratuit',     -- 'gratuit' | 'actif' | 'annule'
  stripe_customer_id text,
  fin_periode        timestamptz,                -- fin de la période payée (renouvellement)
  created_at         timestamptz default now()
);
alter table profiles enable row level security;
-- Chacun ne lit/écrit QUE sa propre ligne (le webhook Stripe écrit via la service key, qui ignore RLS)
drop policy if exists "profiles self read"   on profiles;
drop policy if exists "profiles self update" on profiles;
create policy "profiles self read"   on profiles for select using (auth.uid() = id);
create policy "profiles self update" on profiles for update using (auth.uid() = id);

-- Crée automatiquement le profil à l'inscription
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- (Optionnel) Créer les profils des comptes DÉJÀ existants
insert into public.profiles (id, email)
select id, email from auth.users on conflict (id) do nothing;

-- 2) DONNÉES UTILISATEUR : bankroll, paris, historique — rattachés au compte (synchro multi-appareils)
create table if not exists user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table user_state enable row level security;
drop policy if exists "user_state self" on user_state;
create policy "user_state self" on user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
