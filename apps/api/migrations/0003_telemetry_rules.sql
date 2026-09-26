-- 0003_telemetry_rules: which ruleset a round or match was played under
-- (classic / teeth / pulse / resolve, docs/duel-engagement-options.md §5)
-- and how a match ended (seals or resolve). The rulesets are compared
-- against each other in the summary, so every event must carry its rules.
ALTER TABLE telemetry_events ADD COLUMN rules TEXT NOT NULL DEFAULT 'classic' CHECK (rules IN ('classic', 'teeth', 'pulse', 'resolve'));
ALTER TABLE telemetry_events ADD COLUMN end_reason TEXT CHECK (end_reason IN ('seals', 'resolve'));
