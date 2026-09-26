-- 0000_init: the duel log. One row per encounter the worker resolves
-- through POST /api/duel/resolve - the audit trail for the authoritative
-- (server-side) resolution that M3 multiplayer builds on. Created now so
-- the schema tier has a version and CI's migrate step has something to
-- apply. Integers only (epoch-ms); server-generated UUID keys.
CREATE TABLE duel_log (
  id              TEXT    PRIMARY KEY,
  ts              INTEGER NOT NULL,
  caster          TEXT    NOT NULL CHECK (caster IN ('player', 'opponent')),
  spell           TEXT    NOT NULL,
  reaction        TEXT    CHECK (reaction IN ('null', 'reflect', 'silence')),
  seal_awarded_to TEXT    CHECK (seal_awarded_to IN ('player', 'opponent')),
  steps           TEXT    NOT NULL
);
CREATE INDEX duel_log_ts ON duel_log (ts DESC);
