/**
 * The pure half of the arena's graphics pass (arena.ts draws these): ember
 * drift, shockwaves, bolt sparks, rune rings, the star dome, the camera's
 * idle sway and the gate's rune glow. Deterministic functions of index and
 * time, so a replay looks the same twice and test/arena-fx.test.mjs can hold
 * them without WebGL.
 */

/** Deterministic pseudo-random in [0, 1) from an index and a salt. */
function hash(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

export const EMBER_COUNT = 90;
const EMBER_TOP = 3.6;

export type Ember = { x: number; y: number; z: number; glow: number };

/**
 * One ember at time `t` (seconds): rises through the arena volume at its own
 * pace, sways a little, and loops back to the floor. `glow` flickers.
 */
export function emberPosition(i: number, t: number): Ember {
    const speed = 0.12 + hash(i, 1) * 0.18;
    const phase = hash(i, 2);
    const cycle = (t * speed + phase) % 1;
    const baseX = (hash(i, 3) - 0.5) * 10;
    const baseZ = -3.2 + hash(i, 4) * 5.4;
    const sway = Math.sin(t * (0.6 + hash(i, 5)) + i) * 0.25;
    const x = Math.max(-5.5, Math.min(5.5, baseX + sway));
    const z = Math.max(-3.5, Math.min(2.5, baseZ + Math.cos(t * 0.4 + i) * 0.15));
    const y = cycle * EMBER_TOP;
    // Bright in the middle of its climb, dim at both ends, with a flicker.
    const arc = Math.sin(cycle * Math.PI);
    const flicker = 0.75 + 0.25 * Math.sin(t * (3 + hash(i, 6) * 4) + i * 1.7);
    return { x, y, z, glow: Math.max(0.15, Math.min(1, 0.15 + 0.85 * arc * flicker)) };
}

/** An impact shockwave over `t` in [0, 1]: a ring that grows fast and fades out. */
export function shockwave(t: number): { radius: number; opacity: number } {
    const ease = 1 - Math.pow(1 - t, 2);
    return { radius: 0.15 + 1.35 * ease, opacity: Math.max(0, 0.9 * (1 - t)) };
}

/** Sparks shed behind a bolt flying in `dir` (+1 toward +x): `count` offsets that scatter and lag as `t` advances. */
export function sparkOffsets(count: number, t: number, dir: 1 | -1): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
        const lag = 0.08 + hash(i, 8) * 0.55;
        const wobble = Math.sin(t * 14 + i * 2.1) * 0.12;
        out.push({
            x: -dir * lag,
            y: (hash(i, 9) - 0.5) * 0.35 + wobble,
            z: (hash(i, 10) - 0.5) * 0.3
        });
    }
    return out;
}

/** The glow halo around a bolt: bigger for a heavier spell, capped so a split-amplified bolt does not fill the frame. */
export function haloScale(magnitude: number): number {
    return 0.7 + 0.3 * Math.min(3, Math.max(0, magnitude));
}

/** `n` runes evenly around a floor ring of `radius`, each with the angle it faces. */
export function runeRing(n: number, radius: number): { x: number; z: number; angle: number }[] {
    const out: { x: number; z: number; angle: number }[] = [];
    for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        out.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle });
    }
    return out;
}

/** `count` stars on the upper dome (radius 24), denser toward the zenith. */
export function starPositions(count: number): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
        const theta = hash(i, 11) * Math.PI * 2;
        // Elevation above the horizon: never below 0.5 m.
        const elevation = 0.05 + hash(i, 12) * 0.95;
        const phi = Math.acos(elevation);
        out.push({ x: Math.sin(phi) * Math.cos(theta) * 24, y: Math.cos(phi) * 24, z: Math.sin(phi) * Math.sin(theta) * 24 });
    }
    return out;
}

/** The camera's breathing at rest: a slow figure-eight a few centimetres wide. */
export function idleSway(t: number): { x: number; y: number } {
    return { x: Math.sin(t * 0.45) * 0.04, y: Math.sin(t * 0.9 + 1) * 0.025 };
}

/** How bright the gate's runes burn: a closed gate holds the light, an open one smoulders, a broken one is dark. */
export function gateGlow(state: "open" | "closed" | "broken", t: number): number {
    if (state === "broken") return 0;
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
    return (state === "closed" ? 1.8 : 0.5) * pulse;
}
