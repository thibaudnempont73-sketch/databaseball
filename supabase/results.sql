-- Table d'historique des pronostics + résultats réels (boucle de calibration côté serveur)
-- À exécuter dans Supabase → SQL Editor.
create table if not exists results (
  id          text   not null,           -- id du prono (ex. "823283-V")
  date        date   not null,           -- date du match
  type        text,                       -- victoire / ou / runline
  proba       real,                       -- probabilité prédite par le modèle (brute, %)
  cote        real,                       -- meilleure cote au moment du prono
  fair_proba  real,                       -- proba de marché dé-viggée
  gamepk      bigint,
  pick        text,
  ou_line     real,
  ou_side     text,
  rl_is_home  boolean,
  rl_point    real,
  resultat    text default 'P',          -- P (attente) / W (gagné) / L (perdu)
  primary key (id, date)
);

alter table results enable row level security;

-- Lecture publique (pour afficher le track record global vérifié)
drop policy if exists "results public read" on results;
create policy "results public read" on results for select using (true);

create index if not exists results_resultat_idx on results (resultat);
create index if not exists results_date_idx on results (date);
