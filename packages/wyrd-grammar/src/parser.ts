import { glyphRegistryByDisplayName } from "../../wyrd-content/src/glyphs.js";
import type { GlyphDefinition, ParseDiagnostic, ParseResult, Port, SemanticType, SpellNode, ValueNode } from "./types.js";

export type GlyphRegistry = ReadonlyMap<string, GlyphDefinition>;

type IndexedNode = {
    index: number;
    node: ValueNode;
};

type Assignment = {
    arguments: Record<string, SpellNode | SpellNode[]>;
    used: Set<number>;
    score: number;
};

type Candidate = {
    ast: SpellNode;
    score: number;
};

const effectTypes = new Set<SemanticType>([
    "InstantEffect",
    "PersistentEffect",
    "ReactionEffect",
    "TriggeredEffect",
    "QueryEffect",
    "TransformEffect"
]);

function normalizeToken(token: string): string {
    return token.trim().toUpperCase();
}

function matches(node: SpellNode, accepted: SemanticType[]): boolean {
    if (accepted.includes(node.outputType)) {
        return true;
    }

    return accepted.includes("SpellRef") && effectTypes.has(node.outputType);
}

function valueNode(glyph: GlyphDefinition): ValueNode {
    return {
        kind: "value",
        glyphId: glyph.id,
        outputType: glyph.produces[0]!
    };
}

function makeModifier(glyph: GlyphDefinition, child: SpellNode): SpellNode {
    return {
        kind: "modifier",
        glyphId: glyph.id,
        outputType: glyph.produces[0]!,
        child
    };
}

function focusCost(definitions: GlyphDefinition[]): number {
    return definitions.reduce((sum, glyph) => sum + glyph.baseFocusCost, 0);
}

function complexity(ast: SpellNode | undefined, glyphCount: number): number {
    if (!ast) {
        return glyphCount;
    }

    const visit = (node: SpellNode): number => {
        if (node.kind === "value") {
            return 0;
        }
        if (node.kind === "modifier") {
            return 1 + visit(node.child);
        }
        if (node.kind === "conditional") {
            return 1 + visit(node.condition) + visit(node.effect);
        }
        return 1 + Object.values(node.arguments).reduce((sum, arg) => {
            if (Array.isArray(arg)) {
                return sum + arg.reduce((inner, child) => inner + visit(child), 0);
            }
            return sum + visit(arg);
        }, 0);
    };

    return glyphCount + visit(ast);
}

function invalid(definitions: GlyphDefinition[], diagnostics: ParseDiagnostic[]): ParseResult {
    return {
        status: "invalid",
        focusCost: focusCost(definitions),
        complexity: definitions.length,
        diagnostics
    };
}

function semanticBonus(port: Port, node: SpellNode): number {
    if (port.name === "target" && ["EntityRef", "RegionRef"].includes(node.outputType)) {
        return 10;
    }
    if (port.name === "essence" && node.outputType === "Essence") {
        return 10;
    }
    return 0;
}

function attachmentScore(operatorIndex: number, valueIndex: number, port: Port, node: SpellNode): number {
    const distance = Math.abs(valueIndex - operatorIndex);
    const adjacency = distance === 1 ? 20 : Math.max(0, 10 - distance);
    const rightBias = valueIndex > operatorIndex ? 2 : 0;
    return 100 + adjacency + rightBias + semanticBonus(port, node);
}

function assignPorts(
    ports: Port[],
    values: IndexedNode[],
    operatorIndex: number,
    portIndex = 0,
    used = new Set<number>(),
    args: Record<string, SpellNode | SpellNode[]> = {},
    score = 0
): Assignment[] {
    if (portIndex >= ports.length) {
        return [{
            arguments: args,
            used,
            score
        }];
    }

    const port = ports[portIndex]!;
    const compatible = values.filter(({ index, node }) => !used.has(index) && matches(node, port.accepts));
    const next: Assignment[] = [];

    if (port.optional) {
        next.push(...assignPorts(
            ports,
            values,
            operatorIndex,
            portIndex + 1,
            new Set(used),
            { ...args },
            score
        ));
    }

    if (port.variadic) {
        if (compatible.length > 0) {
            const usedNext = new Set(used);
            let branchScore = score;
            const nodes = compatible.map(({ index, node }) => {
                usedNext.add(index);
                branchScore += attachmentScore(operatorIndex, index, port, node);
                return node;
            });
            next.push(...assignPorts(
                ports,
                values,
                operatorIndex,
                portIndex + 1,
                usedNext,
                { ...args, [port.name]: nodes },
                branchScore
            ));
        }
        return next;
    }

    for (const { index, node } of compatible) {
        const usedNext = new Set(used);
        usedNext.add(index);
        next.push(...assignPorts(
            ports,
            values,
            operatorIndex,
            portIndex + 1,
            usedNext,
            { ...args, [port.name]: node },
            score + attachmentScore(operatorIndex, index, port, node)
        ));
    }

    return next;
}

function operatorCandidates(definitions: GlyphDefinition[], operatorIndex: number): Candidate[] {
    const operator = definitions[operatorIndex]!;
    const modifierEntries = definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => definition.attachment === "postfix");

    if (modifierEntries.some(({ index }) => index < operatorIndex)) {
        return [];
    }

    const values = definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => definition.attachment === "value")
        .map(({ definition, index }) => ({ index, node: valueNode(definition) }));

    const assignments = assignPorts(operator.inputs ?? [], values, operatorIndex);
    const complete = assignments.filter((assignment) => assignment.used.size === values.length);
    const candidates: Candidate[] = [];

    for (const assignment of complete) {
        let ast: SpellNode = {
            kind: "operator",
            glyphId: operator.id,
            outputType: operator.produces[0]!,
            arguments: assignment.arguments
        };

        let score = assignment.score;
        let legal = true;

        for (const { definition: modifier, index } of modifierEntries.sort((a, b) => a.index - b.index)) {
            const input = modifier.inputs?.[0];
            if (!input || !matches(ast, input.accepts)) {
                legal = false;
                break;
            }

            const distance = Math.max(1, index - operatorIndex);
            score += 100 + (distance === 1 ? 20 : Math.max(0, 10 - distance));
            ast = makeModifier(modifier, ast);
        }

        if (legal) {
            candidates.push({ ast, score });
        }
    }

    return candidates;
}

function postfixOnlyCandidates(definitions: GlyphDefinition[]): Candidate[] {
    if (definitions.length !== 2) {
        return [];
    }

    const [value, modifier] = definitions;
    if (!value || !modifier || value.attachment !== "value" || modifier.attachment !== "postfix") {
        return [];
    }

    const node = valueNode(value);
    const port = modifier.inputs?.[0];
    if (!port || !matches(node, port.accepts)) {
        return [];
    }

    return [{
        ast: makeModifier(modifier, node),
        score: 120 + semanticBonus(port, node)
    }];
}

function parseFragmentWithRegistry(
    tokens: string[],
    registry: GlyphRegistry,
    allowValueOnly: boolean
): ParseResult {
    const normalized = tokens.map(normalizeToken);
    const definitions: GlyphDefinition[] = [];
    const diagnostics: ParseDiagnostic[] = [];

    for (const token of normalized) {
        const glyph = registry.get(token);
        if (!glyph) {
            diagnostics.push({
                code: "UNKNOWN_GLYPH",
                glyphId: token.toLowerCase(),
                message: `Unknown glyph: ${token}`
            });
        } else {
            definitions.push(glyph);
        }
    }

    if (diagnostics.length > 0) {
        return invalid(definitions, diagnostics);
    }

    if (definitions.length === 0) {
        return invalid(definitions, [{
            code: "INVALID",
            message: "A spell fragment must contain at least one glyph."
        }]);
    }

    const infixIndexes = definitions
        .map((definition, index) => definition.attachment === "infix" ? index : -1)
        .filter((index) => index >= 0);

    if (infixIndexes.length > 1) {
        return invalid(definitions, [{
            code: "INVALID",
            message: "Parser v0.3 supports one infix conditional per spell."
        }]);
    }

    if (infixIndexes.length === 1) {
        const infixIndex = infixIndexes[0]!;
        const infix = definitions[infixIndex]!;
        if (infixIndex === 0 || infixIndex === definitions.length - 1) {
            return invalid(definitions, [{
                code: "MISSING_INPUT",
                glyphId: infix.id,
                message: `${infix.displayName} requires both a condition and an effect.`
            }]);
        }

        const leftTokens = tokens.slice(0, infixIndex);
        const rightTokens = tokens.slice(infixIndex + 1);
        const left = parseFragmentWithRegistry(leftTokens, registry, true);
        const right = parseFragmentWithRegistry(rightTokens, registry, false);

        if (left.status !== "valid" || !left.ast) {
            return invalid(definitions, [{
                code: "MISSING_INPUT",
                glyphId: infix.id,
                message: `${infix.displayName} requires a valid Condition on its left.`
            }]);
        }

        if (right.status !== "valid" || !right.ast) {
            return invalid(definitions, [{
                code: "MISSING_INPUT",
                glyphId: infix.id,
                message: `${infix.displayName} requires a valid effect on its right.`
            }]);
        }

        const [conditionPort, effectPort] = infix.inputs ?? [];
        if (!conditionPort || !effectPort ||
            !matches(left.ast, conditionPort.accepts) ||
            !matches(right.ast, effectPort.accepts)) {
            return invalid(definitions, [{
                code: "MISSING_INPUT",
                glyphId: infix.id,
                message: `${infix.displayName} inputs do not match Condition → Effect.`
            }]);
        }

        const ast: SpellNode = {
            kind: "conditional",
            glyphId: infix.id,
            outputType: infix.produces[0]!,
            condition: left.ast,
            effect: right.ast
        };

        return {
            status: "valid",
            ast,
            focusCost: focusCost(definitions),
            complexity: complexity(ast, definitions.length),
            diagnostics: []
        };
    }

    const unsupported = definitions.filter((definition) =>
        !["value", "operator", "postfix"].includes(definition.attachment)
    );
    if (unsupported.length > 0) {
        return invalid(definitions, unsupported.map((definition) => ({
            code: "INVALID",
            glyphId: definition.id,
            message: `${definition.displayName} uses ${definition.attachment} syntax, which is not implemented in parser v0.3.`
        })));
    }

    if (allowValueOnly && definitions.length === 1 && definitions[0]!.attachment === "value") {
        const ast = valueNode(definitions[0]!);
        return {
            status: "valid",
            ast,
            focusCost: focusCost(definitions),
            complexity: complexity(ast, definitions.length),
            diagnostics: []
        };
    }

    const operatorIndexes = definitions
        .map((definition, index) => definition.attachment === "operator" ? index : -1)
        .filter((index) => index >= 0);

    if (operatorIndexes.length > 1) {
        return invalid(definitions, [{
            code: "INVALID",
            message: "Parser v0.3 supports one base action per spell fragment; nested actions will be added separately."
        }]);
    }

    const candidates = operatorIndexes.length === 1
        ? operatorCandidates(definitions, operatorIndexes[0]!)
        : postfixOnlyCandidates(definitions);

    if (candidates.length === 0) {
        return invalid(definitions, [missingInputDiagnostic(definitions)]);
    }

    const ordered = [...candidates].sort((a, b) => b.score - a.score);
    const bestScore = ordered[0]!.score;
    const best = ordered.filter((candidate) => candidate.score === bestScore);

    if (best.length > 1) {
        return {
            status: "ambiguous",
            focusCost: focusCost(definitions),
            complexity: definitions.length,
            diagnostics: [{
                code: "AMBIGUOUS",
                message: `${best.length} equally scored complete parses were found (score ${bestScore}). Add or reorder glyphs to disambiguate the spell.`
            }]
        };
    }

    const ast = best[0]!.ast;
    return {
        status: "valid",
        ast,
        focusCost: focusCost(definitions),
        complexity: complexity(ast, definitions.length),
        diagnostics: []
    };
}

function missingInputDiagnostic(definitions: GlyphDefinition[]): ParseDiagnostic {
    const operator = definitions.find((definition) => definition.attachment === "operator");
    if (!operator) {
        return {
            code: "INVALID",
            message: "The glyph sequence does not form a complete typed spell."
        };
    }

    return {
        code: "MISSING_INPUT",
        glyphId: operator.id,
        message: `${operator.displayName} does not have a complete type-compatible set of inputs.`
    };
}

export function parseSpellWithRegistry(tokens: string[], registry: GlyphRegistry): ParseResult {
    return parseFragmentWithRegistry(tokens, registry, false);
}

export function parseSpell(tokens: string[]): ParseResult {
    return parseSpellWithRegistry(tokens, glyphRegistryByDisplayName);
}
