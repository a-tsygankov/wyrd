import { STROKES, classify, type Point, type Rune, type StrokePoint } from "./runeDuel.js";

export type TraceRune = "line" | "arc" | "triangle";
export const TRACE_RUNES: readonly TraceRune[] = ["line", "arc", "triangle"];

export type TraceScore = {
    target: TraceRune;
    recognized: Rune | "unknown";
    correct: boolean;
    durationMs: number;
    accuracy: number;
    form: number;
    direction: number;
    speed: number;
    total: number;
    attackDamage: number;
};

export type ParryOutcome = "block" | "deflect" | "reflect" | "miss";

export type ParryScore = {
    outcome: ParryOutcome;
    timing: number;
    crossingAngleDeg: number;
    curvature: number;
    quality: number;
    incomingDamage: number;
    counterDamage: number;
    intersection?: { x: number; y: number; t: number };
    detail: string;
};

export type IncomingPath = {
    width: number;
    height: number;
    launchedAt: number;
    impactAt: number;
    /** Vertical lane as a 0..1 fraction of the canvas height. Default 0.5. */
    laneY?: number;
    /** Full damage if the incoming spell is not controlled. Default 14. */
    damage?: number;
};

type XY = { x: number; y: number };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function length(points: readonly XY[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    }
    return total;
}

function resample(points: readonly XY[], count: number): XY[] {
    if (points.length === 0) return [];
    if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0]! }));

    const total = length(points);
    if (total <= 0.0001) return Array.from({ length: count }, () => ({ ...points[0]! }));

    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
        cumulative.push(cumulative[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    }

    const result: XY[] = [];
    let segment = 1;
    for (let i = 0; i < count; i++) {
        const target = (total * i) / Math.max(1, count - 1);
        while (segment < points.length - 1 && cumulative[segment]! < target) segment++;
        const a = points[segment - 1]!;
        const b = points[segment]!;
        const span = cumulative[segment]! - cumulative[segment - 1]! || 1;
        const t = (target - cumulative[segment - 1]!) / span;
        result.push({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        });
    }
    return result;
}

function normalize(points: readonly XY[]): XY[] {
    if (points.length === 0) return [];
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    return points.map(point => ({ x: (point.x - cx) / scale, y: (point.y - cy) / scale }));
}

function canonicalPoints(rune: TraceRune): XY[] {
    return STROKES[rune].map(point => ({ x: point.x, y: point.y }));
}

function shapeAccuracy(points: readonly Point[], target: TraceRune): number {
    const drawn = normalize(resample(points, 32));
    const canonical = normalize(resample(canonicalPoints(target), 32));
    if (drawn.length !== canonical.length || drawn.length === 0) return 0;

    const errorAgainst = (template: readonly XY[]): number =>
        drawn.reduce((sum, point, index) => {
            const expected = template[index]!;
            return sum + Math.hypot(point.x - expected.x, point.y - expected.y);
        }, 0) / drawn.length;

    // Shape and direction are intentionally separate skills. A perfectly
    // reversed rune is still the right form, but directionScore() will make
    // it materially weaker.
    const forwardError = errorAgainst(canonical);
    const reverseError = errorAgainst([...canonical].reverse());
    return clamp01(1 - Math.min(forwardError, reverseError) / 0.55);
}

/**
 * Trace mode has a visible target template, so recognition should compare the
 * completed stroke to the trace vocabulary rather than reuse Rune Lab's
 * intentionally forgiving free-draw classifier. Rune Lab's opponent runes
 * share long openings; that makes its canonical Redirect look line-like to
 * the generic classifier even though it is the exact Redirect trace.
 */
function recognizeTrace(points: readonly Point[]): { rune: TraceRune | "unknown"; score: number } {
    if (points.length < 5) return { rune: "unknown", score: 0 };
    const ranked = TRACE_RUNES
        .map(rune => ({ rune, score: shapeAccuracy(points, rune) }))
        .sort((a, b) => b.score - a.score);
    const best = ranked[0]!;
    return best.score >= 0.46 ? best : { rune: "unknown", score: best.score };
}

function directionScore(points: readonly Point[], target: TraceRune): number {
    const drawn = resample(points, 16);
    const canonical = resample(canonicalPoints(target), 16);
    if (drawn.length < 4 || canonical.length < 4) return 0;

    const vector = (ps: readonly XY[]): XY => ({
        x: ps[4]!.x - ps[0]!.x,
        y: ps[4]!.y - ps[0]!.y
    });
    const a = vector(drawn);
    const b = vector(canonical);
    const al = Math.hypot(a.x, a.y) || 1;
    const bl = Math.hypot(b.x, b.y) || 1;
    const dot = (a.x * b.x + a.y * b.y) / (al * bl);
    return clamp01((dot + 1) / 2);
}

export function traceSpeedScore(durationMs: number): number {
    if (durationMs <= 0) return 0;
    if (durationMs < 120) return 0.55;
    if (durationMs <= 550) return 1;
    return Math.max(0.3, 1 - ((durationMs - 550) / 2200) * 0.7);
}

export function scoreTrace(points: readonly Point[], target: TraceRune): TraceScore {
    const recognition = recognizeTrace(points);
    const genericRecognition = classify(points);
    const started = points[0]?.t ?? 0;
    const ended = points.at(-1)?.t ?? started;
    const durationMs = Math.max(0, ended - started);
    const accuracy = shapeAccuracy(points, target);
    const direction = directionScore(points, target);
    const speed = traceSpeedScore(durationMs);
    const correct = recognition.rune === target;
    // Keep the existing free-draw classifier as a secondary form signal when
    // it agrees; template similarity remains authoritative for Trace mode.
    const genericBonus = genericRecognition.rune === target ? genericRecognition.score * 0.15 : 0;
    const form = correct
        ? clamp01(recognition.score * 0.85 + genericBonus)
        : recognition.rune === "unknown" ? 0 : recognition.score * 0.25;

    const raw = accuracy * 0.45 + form * 0.25 + direction * 0.15 + speed * 0.15;
    const total = correct ? clamp01(raw) : Math.min(0.35, clamp01(raw * 0.45));
    const attackDamage = correct ? Math.round(6 + total * 18) : 0;

    return {
        target,
        recognized: recognition.rune,
        correct,
        durationMs,
        accuracy,
        form,
        direction,
        speed,
        total,
        attackDamage
    };
}

export function projectilePosition(path: IncomingPath, time: number): XY {
    const progress = clamp01((time - path.launchedAt) / Math.max(1, path.impactAt - path.launchedAt));
    return {
        x: path.width * (0.88 - 0.76 * progress),
        y: path.height * (path.laneY ?? 0.5)
    };
}

function totalCurvature(points: readonly Point[]): number {
    if (points.length < 3) return 0;
    const sampled = resample(points, 18);
    const angles: number[] = [];
    for (let i = 1; i < sampled.length; i++) {
        angles.push(Math.atan2(sampled[i]!.y - sampled[i - 1]!.y, sampled[i]!.x - sampled[i - 1]!.x));
    }

    let total = 0;
    for (let i = 1; i < angles.length; i++) {
        let delta = angles[i]! - angles[i - 1]!;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        total += Math.abs(delta);
    }
    return clamp01(total / Math.PI);
}

type Crossing = {
    x: number;
    t: number;
    angleDeg: number;
    timing: number;
};

function crossings(points: readonly Point[], path: IncomingPath): Crossing[] {
    const y = path.height * (path.laneY ?? 0.5);
    const result: Crossing[] = [];

    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const ay = a.y - y;
        const by = b.y - y;
        if (ay === 0 && by === 0) continue;
        if (ay * by > 0) continue;

        const dy = b.y - a.y;
        if (Math.abs(dy) < 0.001) continue;
        const u = (y - a.y) / dy;
        if (u < 0 || u > 1) continue;

        const x = a.x + (b.x - a.x) * u;
        if (x < path.width * 0.08 || x > path.width * 0.92) continue;
        const time = a.t + (b.t - a.t) * u;
        const projectile = projectilePosition(path, time);
        const timing = clamp01(1 - Math.abs(x - projectile.x) / (path.width * 0.26));
        const angleDeg = Math.atan2(Math.abs(dy), Math.abs(b.x - a.x)) * 180 / Math.PI;
        result.push({ x, t: time, angleDeg, timing });
    }

    return result;
}

export function evaluateParry(points: readonly Point[], path: IncomingPath): ParryScore {
    if (points.length < 2) {
        return {
            outcome: "miss",
            timing: 0,
            crossingAngleDeg: 0,
            curvature: 0,
            quality: 0,
            incomingDamage: path.damage ?? 14,
            counterDamage: 0,
            detail: "No complete parry stroke."
        };
    }

    const options = crossings(points, path).sort((a, b) => b.timing - a.timing);
    const best = options[0];
    const curvature = totalCurvature(points);

    if (!best || best.timing < 0.25) {
        return {
            outcome: "miss",
            timing: best?.timing ?? 0,
            crossingAngleDeg: best?.angleDeg ?? 0,
            curvature,
            quality: 0,
            incomingDamage: path.damage ?? 14,
            counterDamage: 0,
            detail: best ? "The stroke crossed the lane, but the projectile was not there yet." : "The stroke never crossed the spell trajectory."
        };
    }

    const angleQuality = clamp01((best.angleDeg - 15) / 75);
    const quality = clamp01(best.timing * 0.65 + angleQuality * 0.25 + curvature * 0.1);

    let outcome: ParryOutcome;
    let incomingDamage = 0;
    let counterDamage = 0;
    let detail: string;

    if (curvature >= 0.48 && best.timing >= 0.7 && best.angleDeg >= 25) {
        outcome = "reflect";
        counterDamage = Math.round(10 + quality * 10);
        detail = "Curved contact caught the spell and turned it back.";
    } else if (best.angleDeg >= 68) {
        outcome = "block";
        detail = "A steep crossing stopped the spell.";
    } else if (best.angleDeg >= 25) {
        outcome = "deflect";
        counterDamage = Math.round(3 + quality * 6);
        detail = "An angled crossing pushed the spell off line.";
    } else {
        outcome = "miss";
        incomingDamage = Math.max(8, Math.round((path.damage ?? 14) * 0.75));
        detail = "The stroke was too parallel to take control of the spell.";
    }

    return {
        outcome,
        timing: best.timing,
        crossingAngleDeg: best.angleDeg,
        curvature,
        quality,
        incomingDamage,
        counterDamage,
        intersection: { x: best.x, y: path.height * (path.laneY ?? 0.5), t: best.t },
        detail
    };
}

export function canonicalTracePoints(rune: TraceRune, width: number, height: number): StrokePoint[] {
    const source = STROKES[rune];
    const xs = source.map(point => point.x);
    const ys = source.map(point => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sourceWidth = Math.max(1, maxX - minX);
    const sourceHeight = Math.max(1, maxY - minY);
    const scale = Math.min((width * 0.72) / sourceWidth, (height * 0.62) / Math.max(sourceHeight, 18));
    const drawnWidth = sourceWidth * scale;
    const drawnHeight = sourceHeight * scale;
    const left = (width - drawnWidth) / 2;
    const top = (height - drawnHeight) / 2;

    return source.map(point => ({
        x: left + (point.x - minX) * scale,
        y: top + (point.y - minY) * scale
    }));
}
