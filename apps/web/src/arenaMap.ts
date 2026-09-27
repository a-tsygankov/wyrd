import { PERSONALITIES } from "../../../packages/wyrd-simulation/src/bot.js";
import type { Beat, Side } from "./stage.js";

/**
 * The pure half of the Three.js arena (arena.ts): which KayKit clip plays
 * for which beat, which character each opponent personality wears, where
 * things stand. No WebGL here so test/arena.test.mjs can hold it.
 *
 * Clip names are the KayKit Adventurers pack's (CC0); the prepared GLBs in
 * apps/web/assets/arena keep exactly these (scripts/prepare_arena_assets.mjs).
 */
export const ARENA_CLIPS = {
    idle: "Idle",
    cast: "Spellcast_Shoot",
    castLong: "Spellcast_Long",
    raise: "Spellcast_Raise",
    ward: "Block",
    blocking: "Blocking",
    blockHit: "Block_Hit",
    hit: "Hit_A",
    hitB: "Hit_B",
    cheer: "Cheer",
    fizzle: "Interact",
    death: "Death_A"
} as const;

export type ArenaModel = {
    source: string;
    /** Emissive tint that tells the two mages apart. */
    tint: number;
    /** Weapon or prop meshes to show; the pack ships every variant in one file, all others are hidden. */
    show: readonly string[];
    /** Prefix of the body meshes when it differs from the source name (Rogue_Hooded's parts are Rogue_*). */
    bodyPrefix?: string;
};

/** Prepared GLB file → KayKit source character, tint and the props it holds. */
export const ARENA_MODELS: Record<string, ArenaModel> = {
    "mage.glb": { source: "Mage", tint: 0xad63ff, show: ["2H_Staff"] },
    "knight.glb": { source: "Knight", tint: 0x4fb3ff, show: ["1H_Sword", "Round_Shield"] },
    "barbarian.glb": { source: "Barbarian", tint: 0xff7a3d, show: ["2H_Axe"] },
    "rogue.glb": { source: "Rogue", tint: 0x6ee7a8, show: ["Knife"] },
    "rogue_hooded.glb": { source: "Rogue_Hooded", tint: 0xa56bff, show: ["Knife", "Knife_Offhand"], bodyPrefix: "Rogue" }
};

const BODY_PARTS = new Set(["Body", "Head", "Head_Hooded", "ArmLeft", "ArmRight", "LegLeft", "LegRight", "Hat", "Cape", "Helmet"]);

/** Is this KayKit mesh part of the body (shown always) rather than a weapon or prop (shown only when listed)? */
export function isBodyPart(meshName: string, model: ArenaModel | string): boolean {
    const prefix = typeof model === "string" ? model : (model.bodyPrefix ?? model.source);
    if (!meshName.startsWith(prefix + "_")) return false;
    return BODY_PARTS.has(meshName.slice(prefix.length + 1));
}

const OPPONENT_MODEL: Record<string, string> = {
    balanced: "mage.glb",
    aggressor: "barbarian.glb",
    warden: "knight.glb",
    trickster: "rogue_hooded.glb",
    gatekeeper: "rogue.glb"
};

/**
 * A persona: what a mage looks like on both renderers. The opponent's
 * follows its personality (title from the bot, a distinct tint, a KayKit
 * character and the props it holds); the player is always the Mage.
 */
export type Persona = {
    title: string;
    blurb: string;
    /** CSS hex colour for robes, rings and nameplates. */
    tint: string;
    model: string;
    /** Weapon and prop meshes shown on the KayKit character. */
    show: readonly string[];
};

const PERSONA_PROPS: Record<string, Pick<Persona, "tint" | "model" | "show">> = {
    balanced: { tint: "#a56bff", model: "mage.glb", show: ["2H_Staff"] },
    aggressor: { tint: "#ff7a3d", model: "barbarian.glb", show: ["2H_Axe"] },
    warden: { tint: "#4fb3ff", model: "knight.glb", show: ["1H_Sword", "Round_Shield"] },
    trickster: { tint: "#6ee7a8", model: "rogue_hooded.glb", show: ["Knife", "Knife_Offhand"] },
    gatekeeper: { tint: "#f2c46b", model: "rogue.glb", show: ["1H_Crossbow"] }
};

export function personaFor(id: string): Persona {
    if (id === "player") return { title: "You", blurb: "The mage on the left; your spells, your seals.", tint: "#ad63ff", model: "mage.glb", show: ["2H_Staff"] };
    const personality = PERSONALITIES.find(p => p.id === id) ?? PERSONALITIES[0]!;
    const props = PERSONA_PROPS[personality.id] ?? PERSONA_PROPS.balanced!;
    return { title: personality.title, blurb: personality.blurb, ...props };
}

export function modelFor(side: Side, personalityId?: string): string {
    if (side === "player") return "mage.glb";
    return OPPONENT_MODEL[personalityId ?? "balanced"] ?? "mage.glb";
}

export type ClipChoice = { name: string; side: Side; loop?: boolean };

/** The body animation a beat asks for, if any (bolts, gates and orbs are not bodies). */
export function clipFor(beat: Beat): ClipChoice | undefined {
    switch (beat.kind) {
        case "cast":
            return { name: (beat.spell ?? "").includes("AMPLIFY") || (beat.spell ?? "").includes("SPLIT") ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast, side: beat.side };
        case "hit":
            return { name: ARENA_CLIPS.hit, side: beat.side };
        case "bind":
            return { name: ARENA_CLIPS.hitB, side: beat.side };
        case "ward-up":
            return { name: ARENA_CLIPS.ward, side: beat.side };
        case "ward-block":
            return { name: beat.broken ? ARENA_CLIPS.hit : ARENA_CLIPS.blockHit, side: beat.side };
        case "ward-break":
            return { name: ARENA_CLIPS.hit, side: beat.side };
        case "mend":
        case "reflect":
        case "split":
        case "reverse":
            return { name: ARENA_CLIPS.raise, side: beat.side };
        case "gate-ward-up":
            return { name: ARENA_CLIPS.raise, side: beat.side };
        case "seal":
            return { name: ARENA_CLIPS.cheer, side: beat.side };
        case "fizzle":
            return { name: ARENA_CLIPS.fizzle, side: beat.side };
        default:
            return undefined;
    }
}

/** World positions (metres): the mages face each other across the gate at the origin. */
export const POSITIONS: Record<Side, { x: number; z: number }> = { player: { x: -2.4, z: 0 }, opponent: { x: 2.4, z: 0 } };
export const MARKS: Record<Side | "gate", { x: number; z: number }> = { player: POSITIONS.player, opponent: POSITIONS.opponent, gate: { x: 0, z: 0 } };
/** Hand height, where bolts leave and land. */
export const HAND_Y = 1.25;

/** A bolt's position at `t` in [0, 1] from one mage's hand to the other's: a shallow arc, never below the floor. */
export function boltArc(from: Side, to: Side, t: number): { x: number; y: number; z: number } {
    const dir = POSITIONS[to].x > POSITIONS[from].x ? 1 : -1;
    const x0 = POSITIONS[from].x + dir * 0.55;
    const x1 = POSITIONS[to].x - dir * 0.55;
    return { x: x0 + (x1 - x0) * t, y: HAND_Y + 0.9 * Math.sin(Math.PI * t), z: 0 };
}

/**
 * The gate as the scoreboard (docs/duel-ux-ideas.md §C): a chain runs from
 * the gate toward each mage with three notches; a seal lights the next notch
 * on its owner's chain and the gate leans toward the leader; the third
 * seal swings it. Shared by the SVG stage and the arena.
 */
export const NOTCHES = 3;

export type SealNotch = { side: Side; index: number; lit: boolean };

export function sealNotches(seals: Record<Side, number>): SealNotch[] {
    const out: SealNotch[] = [];
    for (const side of ["player", "opponent"] as const) {
        for (let index = 0; index < NOTCHES; index++) out.push({ side, index, lit: index < Math.min(NOTCHES, seals[side]) });
    }
    return out;
}

/** World position of a notch (metres): along the chain at chest height, the first nearest the gate. */
export function notchPosition(side: Side, index: number): { x: number; y: number; z: number } {
    const dir = side === "player" ? -1 : 1;
    return { x: dir * (1.15 + index * 0.42), y: 1.9, z: 0 };
}

/** The gate's lean (radians, negative toward the player): a notch per seal of difference, a swing at three. */
export function gateLean(seals: Record<Side, number>): number {
    const diff = Math.min(NOTCHES, seals.opponent) - Math.min(NOTCHES, seals.player);
    const swing = Math.abs(seals.player) >= NOTCHES || Math.abs(seals.opponent) >= NOTCHES ? 0.24 : 0;
    return Math.max(-0.6, Math.min(0.6, diff * 0.1 + Math.sign(diff) * swing));
}

/** Deterministic pseudo-random in [0, 1) from an index, for shards and bursts. */
function hash(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

export type ShardOffset = { x: number; y: number; z: number; spin: number };

/** Where each shard of the gate slab is at `t` in [0, 1] of the shatter: out, down, spinning. */
export function shardOffsets(count: number, t: number): ShardOffset[] {
    const out: ShardOffset[] = [];
    for (let i = 0; i < count; i++) {
        const angle = hash(i, 1) * Math.PI * 2;
        const reach = 0.4 + hash(i, 2) * 1.1;
        const ease = t * t;
        out.push({
            x: Math.cos(angle) * reach * t,
            y: -1.6 * ease + 0.5 * t * (1 - t) * hash(i, 3),
            z: Math.sin(angle) * 0.9 * t,
            spin: (hash(i, 4) - 0.5) * Math.PI * 2 * t
        });
    }
    return out;
}

/** An impact burst: `count` points flying out from the origin, radius up to 1.2 at t = 1. */
export function burstOffsets(count: number, t: number): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
        const theta = hash(i, 5) * Math.PI * 2;
        const phi = hash(i, 6) * Math.PI;
        const r = (0.5 + 0.7 * hash(i, 7)) * t;
        out.push({ x: Math.sin(phi) * Math.cos(theta) * r, y: Math.abs(Math.cos(phi)) * r, z: Math.sin(phi) * Math.sin(theta) * r });
    }
    return out;
}
