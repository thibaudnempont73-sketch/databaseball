-- ════════════════════════════════════════════════════════════════
-- DataBaseball — RESET « PRÉ-LANCEMENT » : repartir de ZÉRO pour TOUS les utilisateurs
-- À lancer UNE FOIS dans Supabase → SQL Editor (tu es 'postgres' = service role).
-- ⚠️ DESTRUCTIF et IRRÉVERSIBLE. À faire juste avant le lancement réel.
-- ════════════════════════════════════════════════════════════════

-- 1) Track record GLOBAL du modèle (réussite / ROI / calibration + base du récap email hebdo)
truncate table public.results;

-- 2) Données de TOUS les utilisateurs (bankroll + historique + paris synchronisés)
truncate table public.user_state;

-- 3) Journaux d'envoi email (re-autorise digest/récap à repartir proprement)
truncate table public.email_log;

-- ON GARDE : profiles (comptes + abonnements), email_subs (abonnés email), snapshots (régénéré chaque jour).

-- ════════════════════════════════════════════════════════════════
-- OPTIONNEL — supprimer les COMPTES de test (pour vraiment tout remettre à neuf) :
--   → Supabase → Authentication → Users → supprime les comptes de test à la main.
--   (supprimer un user efface en cascade sa ligne profiles/email_subs/user_state)
--
-- ⚠️ APRÈS ce reset : sur TON navigateur, ton historique LOCAL existe encore et se
-- re-synchroniserait. Vide-le aussi (onglet Historique admin → ♻️ Réinitialiser, ou
-- vide le localStorage du site). Les NOUVEAUX utilisateurs, eux, démarrent bien à 0.
-- ════════════════════════════════════════════════════════════════
