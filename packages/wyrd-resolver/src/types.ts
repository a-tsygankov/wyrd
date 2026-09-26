export type PlayerId = "player" | "opponent";

export type ActiveWard = {
    ownerId: PlayerId;
    essence?: string;
    /** Remaining magnitude the ward absorbs before it shatters (rules.wardIntegrity > 0 only). */
    integrity?: number;
};

export type PlayerState = {
    id: PlayerId;
    focus: number;
    seals: number;
    ward?: ActiveWard;
    bound?: boolean;
    /** Essence of the last spell this player resolved (ignite rule). */
    lastEssence?: string;
    /** Ended the last encounter at 0 Focus: the telegraph reveals one more glyph next round. */
    exposed?: boolean;
    /** Hit points under the resolve rule; undefined when the rule is off. */
    resolve?: number;
    /** resolve <= FALTERING_AT: brittle wards, one more glyph revealed. */
    faltering?: boolean;
};

/**
 * Which optional rules are in force. `rulesVersion` in the architecture doc:
 * a match records its options, so a replay always resolves against the
 * rules it was played with.
 */
export type RuleOptions = {
    /** A ward absorbs this much magnitude before it shatters; 0 = wards never break (classic). */
    wardIntegrity: number;
    /** Reactions cost Focus (REACTION_COSTS) from the reacting player's budget; unaffordable ones fail. */
    reactionCosts: boolean;
    /** Casting the same essence two encounters running adds +1 magnitude. */
    ignite: boolean;
    /** A context flagged quickCast gains +1 magnitude. */
    quickCast: boolean;
    /** Starting hit points; SEEK deals its magnitude to the target's resolve. 0 = off. */
    resolve: number;
};

export const CLASSIC_RULES: RuleOptions = {
    wardIntegrity: 0,
    reactionCosts: false,
    ignite: false,
    quickCast: false,
    resolve: 0
};

/**
 * The objective between the mages. CLOSE scores while it is open, OPEN
 * scores while it is closed; BREAK takes it out of play until MEND repairs
 * it. Persists across rounds, resets with the match.
 */
export type GateState = "open" | "closed" | "broken";

export type DuelState = {
    round: number;
    activePlayerId: PlayerId;
    players: Record<PlayerId, PlayerState>;
    rules: RuleOptions;
    gate: GateState;
};

export type ReactionGlyph = "null" | "reflect" | "silence";

/** Focus prices of reactions under rules.reactionCosts. */
export const REACTION_COSTS: Record<ReactionGlyph, number> = { silence: 1, reflect: 2, null: 3 };

export const ROUND_FOCUS = 7;
/** Under the resolve rule, at or below this many points a player is faltering. */
export const FALTERING_AT = 3;
/** Extra Focus a bound player pays for their next spell under the resolve rule. */
export const BOUND_TAX = 2;
/** Resolve restored by MEND SELF under the resolve rule. */
export const MEND_RESOLVE = 2;

export type ResolutionStage =
    | "validation"
    | "cost"
    | "cancel"
    | "anchor"
    | "routing"
    | "magnitude"
    | "suppression"
    | "boundary"
    | "effect"
    | "outcome";

export type ResolutionStep = {
    stage: ResolutionStage;
    result: "applied" | "blocked" | "canceled" | "failed" | "info";
    code: string;
    text: string;
};

export type ResolutionContext = {
    casterId: PlayerId;
    defenderId: PlayerId;
    spellTokens: string[];
    reaction?: ReactionGlyph;
    /** The caster committed fast (client-measured); +1 magnitude under rules.quickCast. */
    quickCast?: boolean;
};

export type SpellAction = "seek" | "bind" | "ward" | "close" | "open" | "break" | "mend";

export type ResolvedEffect = {
    action: SpellAction;
    target?: "self" | "enemy" | "gate";
    essence?: string;
    magnitude: number;
    anchored: boolean;
    reflected: boolean;
    silenced: boolean;
    canceled: boolean;
};

export type ResolutionResult = {
    state: DuelState;
    effect?: ResolvedEffect;
    steps: ResolutionStep[];
    sealAwardedTo?: PlayerId;
};
