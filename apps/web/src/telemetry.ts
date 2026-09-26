/**
 * Anonymous playtest telemetry (plan POC-5): per round, what was
 * telegraphed, what was cast, how the player reacted, who scored and how
 * long the commit took; plus rematches and match ends. Fire-and-forget:
 * a failed send is dropped, never retried, never surfaced - offline play
 * must be unaffected. Nothing personal is collected; the session id is a
 * random UUID kept in local storage so one device's rounds group together.
 *
 * Pure pieces (buildRoundEvent, getSessionId, createTelemetry with an
 * injected `send`) are unit-tested in node; main.ts wires the browser.
 */
export type ReactionName = "null" | "reflect" | "silence";

export type TelemetryEvent = {
    event: "round" | "rematch" | "match_end";
    sessionId: string;
    matchSeed: string;
    webVersion: string;
    round: number;
    playerSeals: number;
    opponentSeals: number;
    scenarioId?: string | null;
    telegraphPreset?: "high" | "medium" | null;
    telegraph?: string | null;
    opponentSpell?: string[] | null;
    playerSpell?: string[] | null;
    playerReaction?: ReactionName | null;
    opponentReaction?: ReactionName | null;
    playerGained?: number;
    opponentGained?: number;
    timeToCommitMs?: number | null;
};

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const SESSION_KEY = "wyrd.telemetry.session";

export function getSessionId(storage: StorageLike, mint: () => string = () => crypto.randomUUID()): string {
    try {
        const existing = storage.getItem(SESSION_KEY);
        if (existing) return existing;
    } catch {
        // Storage denied (private mode): a per-page-load id is still useful.
    }
    const id = mint();
    try {
        storage.setItem(SESSION_KEY, id);
    } catch {
        // Same: keep going with the in-memory id.
    }
    return id;
}

export type RoundFacts = {
    sessionId: string;
    matchSeed: string;
    webVersion: string;
    round: number;
    scenarioId: string | undefined;
    telegraphPreset: "high" | "medium";
    telegraph: string;
    opponentSpell: string[];
    playerSpell: string[];
    playerReaction: ReactionName | undefined;
    opponentReaction: ReactionName | undefined;
    playerSealsBefore: number;
    opponentSealsBefore: number;
    playerSeals: number;
    opponentSeals: number;
    roundStartedAt: number;
    committedAt: number;
};

export function buildRoundEvent(facts: RoundFacts): TelemetryEvent {
    return {
        event: "round",
        sessionId: facts.sessionId,
        matchSeed: facts.matchSeed,
        webVersion: facts.webVersion,
        round: facts.round,
        scenarioId: facts.scenarioId ?? null,
        telegraphPreset: facts.telegraphPreset,
        telegraph: facts.telegraph,
        opponentSpell: facts.opponentSpell,
        playerSpell: facts.playerSpell,
        playerReaction: facts.playerReaction ?? null,
        opponentReaction: facts.opponentReaction ?? null,
        playerSeals: facts.playerSeals,
        opponentSeals: facts.opponentSeals,
        playerGained: Math.max(0, facts.playerSeals - facts.playerSealsBefore),
        opponentGained: Math.max(0, facts.opponentSeals - facts.opponentSealsBefore),
        timeToCommitMs: Math.max(0, Math.round(facts.committedAt - facts.roundStartedAt))
    };
}

export type Telemetry = {
    record(event: TelemetryEvent): void;
    /** Send everything recorded so far. Resolves even when the send fails. */
    flush(): Promise<void>;
};

export type TelemetryOptions = {
    endpoint: string;
    enabled?: boolean;
    send?: (url: string, body: string) => Promise<unknown>;
};

/** Default transport: keepalive so a send started on "match end" survives navigation. */
async function fetchSend(url: string, body: string): Promise<void> {
    await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true
    });
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
    const enabled = options.enabled ?? true;
    const send = options.send ?? fetchSend;
    let queue: TelemetryEvent[] = [];
    return {
        record(event) {
            if (enabled) queue.push(event);
        },
        async flush() {
            if (!enabled || queue.length === 0) return;
            const batch = queue;
            queue = [];
            try {
                await send(options.endpoint, JSON.stringify({ events: batch }));
            } catch {
                // Offline, blocked or the worker is down: the batch is lost by
                // design. Telemetry must never cost the player anything.
            }
        }
    };
}
