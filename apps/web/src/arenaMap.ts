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
