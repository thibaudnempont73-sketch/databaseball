-- ════════════════════════════════════════════════════════════════
-- DataBaseball — Emails : table des abonnés + désinscription + journal
-- À exécuter UNE FOIS dans Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════

-- 1) Abonnés au digest (1 ligne par utilisateur)
create table if not exists public.email_subs(
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  lang        text    default 'fr',
  optin       boolean not null default true,        -- reçoit les emails ?
  unsub_token uuid    not null default gen_random_uuid(),
  updated_at  timestamptz default now()
);
create index if not exists email_subs_token_idx on public.email_subs(unsub_token);
create index if not exists email_subs_optin_idx on public.email_subs(optin) where optin;

-- RLS : chaque utilisateur ne voit/gère QUE sa propre ligne (le service_role du job d'envoi contourne la RLS)
alter table public.email_subs enable row level security;
drop policy if exists "email_subs self select" on public.email_subs;
drop policy if exists "email_subs self insert" on public.email_subs;
drop policy if exists "email_subs self update" on public.email_subs;
create policy "email_subs self select" on public.email_subs for select using (auth.uid()=user_id);
create policy "email_subs self insert" on public.email_subs for insert with check (auth.uid()=user_id);
create policy "email_subs self update" on public.email_subs for update using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- 2) Désinscription par token (appelable SANS être connecté, depuis le lien d'un email)
create or replace function public.unsubscribe_by_token(tok uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.email_subs set optin=false, updated_at=now() where unsub_token=tok;
  get diagnostics n = row_count;
  return n > 0;
end $$;
grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated;

-- 3) Journal d'envoi (évite un double envoi si le job tourne 2x le même jour)
create table if not exists public.email_log(
  jour    date not null,
  kind    text not null,            -- 'digest', 'weekly', ...
  n_sent  int,
  sent_at timestamptz default now(),
  primary key (jour, kind)
);
alter table public.email_log enable row level security;  -- aucune policy → seul le service_role y touche

-- ════════════════════════════════════════════════════════════════
-- Vérif : select * from public.email_subs;   /   select * from public.email_log;
-- ════════════════════════════════════════════════════════════════
