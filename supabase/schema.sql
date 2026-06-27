-- ═══════════════════════════════════════════════════
-- DataBaseball — schéma Supabase (Étape 1 : pipeline de données)
-- À coller dans Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════

-- Snapshot quotidien : tout le contenu calculé par le job serveur pour une journée.
-- L'app ne fait que LIRE la dernière ligne du jour (aucun appel API côté navigateur).
create table if not exists public.snapshots (
  date          date primary key,
  generated_at  timestamptz not null default now(),
  data          jsonb not null
);

alter table public.snapshots enable row level security;

-- Étape 1 : lecture publique (pas encore de mur payant).
-- On restreindra cette policy à l'Étape 3 (abonnés uniquement).
drop policy if exists "snapshots_lecture_publique" on public.snapshots;
create policy "snapshots_lecture_publique"
  on public.snapshots for select
  to anon, authenticated
  using (true);

-- L'écriture se fait uniquement côté serveur avec la clé service_role
-- (qui contourne la RLS), donc aucune policy d'écriture n'est nécessaire pour anon.

-- Index pour récupérer rapidement le dernier snapshot
create index if not exists snapshots_date_idx on public.snapshots (date desc);
