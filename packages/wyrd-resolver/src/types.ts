export type PlayerId = "player" | "opponent";

export type ActiveWard = {
    ownerId: PlayerId;
    essence?: string;
};

export type PlayerState = {
    id: PlayerId;
    focus: number;
    seals: number;
    ward?: ActiveWard;
    bound?: boolean;
};

export type DuelState = {
    round: number;
    activePlayerId: PlayerId;
    players: Record<PlayerId, PlayerState>;
};

export type ReactionGlyph = "null" | "reflect" | "silence";

export type ResolutionStage =
    | "validation"
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
};

export type ResolvedEffect = {
    action: "seek" | "bind" | "ward" | "close";
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
