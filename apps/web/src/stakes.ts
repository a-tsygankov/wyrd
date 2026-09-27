import type { DuelState, PlayerId, RoundResolution } from "../../../packages/wyrd-resolver/src/index.js";

/**
 * The stakes of a round beyond the resolver: sudden death (options doc §H)
 * and press the round (ideas doc §J). Pure, so the rules can be read here
 * and tested without a page.
 */
export const SEALS_TO_WIN = 3;

/** 2-2 with the option on: the next round is sudden death. */
export function isSuddenDeath(state: DuelState, enabled: boolean): boolean {
    const p = state.players.player.seals;
    const o = state.players.opponent.seals;
    return enabled && p === SEALS_TO_WIN - 1 && o === SEALS_TO_WIN - 1;
}

/**
 * Who a sudden-death round went to: the first seal to land, in resolution
 * order. A spell that scored for both (a SPLIT met by REFLECT) decides
 * nothing on its own; a round where nobody scored decides nothing at all.
 */
export function suddenDeathWinner(round: RoundResolution): PlayerId | undefined {
    for (const id of round.order) {
        const result = round.results[id];
        if (!result?.sealsAwarded) continue;
        const p = result.sealsAwarded.player ?? 0;
        const o = result.sealsAwarded.opponent ?? 0;
        if (p !== o) return p > o ? "player" : "opponent";
    }
    return undefined;
}

export type Stake = {
    pressed: Partial<Record<PlayerId, boolean>>;
    /** Who retreated from the other's press, if anyone. */
    retreated?: PlayerId | undefined;
    /** Seals each side took from the resolutions this round. */
    yours: number;
    theirs: number;
};

export type StakeOutcome = {
    /** Extra seals for the round's winner: one for a press (x2), three when both pressed (x4). */
    extra?: { to: PlayerId; seals: number };
    /** A retreat: one seal from the retreater to the presser, the round itself at single stake. */
    conceded?: { from: PlayerId; to: PlayerId };
};

export function pressResult(stake: Stake): StakeOutcome {
    const pressers = (["player", "opponent"] as const).filter(id => stake.pressed[id]);
    if (pressers.length === 0) return {};
    if (stake.retreated) {
        const to = stake.retreated === "player" ? "opponent" : "player";
        return { conceded: { from: stake.retreated, to } };
    }
    if (stake.yours === stake.theirs) return {};
    const to: PlayerId = stake.yours > stake.theirs ? "player" : "opponent";
    return { extra: { to, seals: pressers.length === 2 ? 3 : 1 } };
}

/** The verdict lines for the stake, in the log's voice. */
export function stakeLines(stake: Stake, outcome: StakeOutcome, names: { you: string; them: string }): string[] {
    const lines: string[] = [];
    const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
    const who = (id: PlayerId): string => cap(id === "player" ? names.you : names.them);
    const pressers = (["player", "opponent"] as const).filter(id => stake.pressed[id]);
    if (pressers.length === 2) lines.push(`Both pressed the round: the seal counts four.`);
    else if (pressers.length === 1) lines.push(`${who(pressers[0] as PlayerId)} pressed the round: the seal counts double.`);
    if (outcome.conceded) lines.push(`${who(outcome.conceded.from)} retreated and conceded one seal to ${who(outcome.conceded.to)}; the round was played at single stake.`);
    if (outcome.extra) lines.push(`${who(outcome.extra.to)} took the round and the stake: ${outcome.extra.seals + 1} seals.`);
    if (pressers.length > 0 && !outcome.extra && !outcome.conceded) lines.push("An even round: the press doubled nothing.");
    return lines;
}

/** Apply the stake to the state: extra and conceded seals, never below zero. */
export function applyStake(state: DuelState, outcome: StakeOutcome): DuelState {
    if (!outcome.extra && !outcome.conceded) return state;
    const next: DuelState = { ...state, players: { player: { ...state.players.player }, opponent: { ...state.players.opponent } } };
    if (outcome.extra) next.players[outcome.extra.to].seals += outcome.extra.seals;
    if (outcome.conceded) next.players[outcome.conceded.to].seals += 1;
    return next;
}
