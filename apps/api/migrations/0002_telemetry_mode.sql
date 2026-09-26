-- 0002_telemetry_mode: which opponent a round was played against. Solo
-- rounds (scenario deck, then the heuristic bot) and hot-seat rounds
-- (two humans on one phone) must be separable in the playtest summary:
-- hot-seat telegraphs are read by a person, not scripted, so mixing them
-- would blur the inference-vs-guessing question the deck exists to answer.
ALTER TABLE telemetry_events ADD COLUMN mode TEXT NOT NULL DEFAULT 'solo' CHECK (mode IN ('solo', 'hotseat'));
