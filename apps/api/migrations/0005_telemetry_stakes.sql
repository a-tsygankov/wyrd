-- 0005_telemetry_stakes: the playtest options behind Settings → Rules.
-- weather: the card in force that round (options doc §H), NULL for none.
-- sudden_death: 1 when the round was played at 2-2 with the option on.
-- pressed_by / retreated_by: press the round (ideas doc §J); the playtest
-- question is the press rate, the retreat rate and the round count.
ALTER TABLE telemetry_events ADD COLUMN weather TEXT;
ALTER TABLE telemetry_events ADD COLUMN sudden_death INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry_events ADD COLUMN pressed_by TEXT;
ALTER TABLE telemetry_events ADD COLUMN retreated_by TEXT;
