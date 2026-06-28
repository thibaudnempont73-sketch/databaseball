-- ════════════════════════════════════════════════════════════════
-- DataBaseball — Déclencheur quotidien FIABLE via Supabase (pg_cron + pg_net)
-- ────────────────────────────────────────────────────────────────
-- Pourquoi : le cron natif de GitHub Actions est souvent en retard/sauté,
-- et GitHub DÉSACTIVE un cron après 60 jours sans commit. Ici, c'est Supabase
-- qui appelle l'API GitHub chaque jour pour lancer le workflow `build-data.yml`.
-- Le build lui-même reste sur GitHub Actions (rien à porter).
--
-- À exécuter UNE FOIS dans Supabase → SQL Editor.
-- Remplace les 3 valeurs marquées « ⬅️ À REMPLIR » avant de lancer.
-- ════════════════════════════════════════════════════════════════

-- 1) Extensions nécessaires (déjà dispo sur Supabase, idempotent)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Stocke ton jeton GitHub dans le Vault (chiffré, jamais en clair dans les jobs)
--    Crée un Personal Access Token "fine-grained" sur GitHub :
--    Settings → Developer settings → Fine-grained tokens → Generate
--      • Repository access : seulement ton dépôt DataBaseball
--      • Permissions → Repository → "Actions" = Read and write
--    Puis colle-le ci-dessous (commence par github_pat_...).
-- (idempotent : crée le secret s'il n'existe pas, sinon met à jour sa valeur → ré-exécutable sans erreur)
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'github_pat_databaseball';
  if sid is null then
    perform vault.create_secret('github_pat_XXXXXXXXXXXXXXXXXXXX', 'github_pat_databaseball');  -- ⬅️ À REMPLIR : ton token
  else
    perform vault.update_secret(sid, 'github_pat_XXXXXXXXXXXXXXXXXXXX');                         -- ⬅️ À REMPLIR : ton token
  end if;
end $$;

-- 3) Programme le déclenchement quotidien
--    13:10 UTC = 15h10 Paris (été) / 14h10 (hiver). pg_cron tourne en UTC.
--    Remplace OWNER/REPO (ex: thibaud/databaseball) et la branche si ce n'est pas "main".
select cron.schedule(
  'databaseball-daily',          -- nom du job
  '10 13 * * *',                 -- tous les jours à 13:10 UTC
  $$
  select net.http_post(
    url     := 'https://api.github.com/repos/OWNER/REPO/actions/workflows/build-data.yml/dispatches',  -- ⬅️ À REMPLIR : OWNER/REPO
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_pat_databaseball'),
      'Accept',        'application/vnd.github+json',
      'User-Agent',    'supabase-cron-databaseball',
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('ref', 'main')   -- ⬅️ branche par défaut (main ou master)
  );
  $$
);

-- ════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS / MAINTENANCE (à lancer au besoin)
-- ────────────────────────────────────────────────────────────────
-- Voir les jobs programmés :
--   select * from cron.job;
--
-- Tester MAINTENANT (sans attendre 15h10) — lance le workflow tout de suite :
--   select net.http_post(
--     url     := 'https://api.github.com/repos/OWNER/REPO/actions/workflows/build-data.yml/dispatches',
--     headers := jsonb_build_object(
--       'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='github_pat_databaseball'),
--       'Accept','application/vnd.github+json','User-Agent','supabase-cron-databaseball','Content-Type','application/json'),
--     body    := jsonb_build_object('ref','main')
--   );
--   → puis regarde l'onglet Actions de GitHub : un run doit démarrer dans les secondes.
--
-- Voir le résultat des derniers appels HTTP (codes, erreurs) :
--   select id, created, status_code, content from net._http_response order by created desc limit 5;
--   (200/201/204 = OK ; 401 = token invalide ; 404 = OWNER/REPO ou nom de workflow faux)
--
-- Voir l'historique d'exécution du cron :
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- Changer l'heure : ré-exécute cron.schedule avec le même nom 'databaseball-daily'.
-- Supprimer le job :  select cron.unschedule('databaseball-daily');
-- ════════════════════════════════════════════════════════════════
