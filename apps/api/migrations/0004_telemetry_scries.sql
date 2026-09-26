-- 0004_telemetry_scries: how many hidden telegraph glyphs the player paid
-- to reveal (Scry, 1 Focus each, reaction-cost rulesets) before reacting.
-- The progressive-reveal experiment (options doc §G) asks whether players
-- buy information or wait for it; this is the buy side of that question.
ALTER TABLE telemetry_events ADD COLUMN scries INTEGER NOT NULL DEFAULT 0;
