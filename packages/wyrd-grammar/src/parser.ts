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

type CandidateSearch = {
    candidates: Candidate[];
    /** Why no complete parse exists, naming the glyph at fault; undefined when candidates exist. */
    failure?: ParseDiagnostic;
};

function names(definitions: readonly GlyphDefinition[]): string {
    const list = definitions.map((definition) => definition.displayName);
    if (list.length <= 1) {
        return list.join("");
    }
    return list.slice(0, -1).join(", ") + " or " + list[list.length - 1];
}

/** Value glyphs of the registry that would satisfy `port`, for "add one of …" hints. */
function fillers(port: Port, registry: GlyphRegistry): GlyphDefinition[] {
    return [...registry.values()].filter((definition) =>
        definition.attachment === "value" && definition.produces.some((type) => port.accepts.includes(type))
    );
}

function describePorts(ports: Port[]): string {
    return ports.map((port) => (port.optional ? `an optional ${port.name}` : `a ${port.name}`)).join(" and ");
}

function operatorCandidates(definitions: GlyphDefinition[], operatorIndex: number, registry: GlyphRegistry): CandidateSearch {
    const operator = definitions[operatorIndex]!;
    const modifierEntries = definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => definition.attachment === "postfix");

    // Postfix modifiers attach to the complete effect on their left (spec §7);
    // one placed before the action has nothing to attach to yet.
    const early = modifierEntries.find(({ index }) => index < operatorIndex);
    if (early) {
        return {
            candidates: [],
            failure: {
                code: "INVALID",
                glyphId: early.definition.id,
                message: `${early.definition.displayName} modifies the effect on its left: place it after ${operator.displayName}.`
            }
        };
    }

    const values = definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => definition.attachment === "value")
        .map(({ definition, index }) => ({ index, node: valueNode(definition) }));

    const ports = operator.inputs ?? [];
    const assignments = assignPorts(ports, values, operatorIndex);
    const complete = assignments.filter((assignment) => assignment.used.size === values.length);
    const candidates: Candidate[] = [];
    let failure: ParseDiagnostic | undefined;

    if (assignments.length === 0) {
        // A required port has no compatible value: say which glyphs would fill it.
        const missing = ports.find((port) => !port.optional && !values.some(({ node }) => matches(node, port.accepts)));
        const port = missing ?? ports.find((port) => !port.optional) ?? ports[0];
        // Name the values that feed no slot at all (GATE in "FIRE SEEK GATE").
        const strays = values
            .filter(({ node }) => !ports.some((candidate) => matches(node, candidate.accepts)))
            .map(({ index }) => definitions[index]!);
        const stray = strays.length > 0 ? `${names(strays)} cannot feed ${operator.displayName}. ` : "";
        failure = {
            code: "MISSING_INPUT",
            glyphId: operator.id,
            message: port
                ? `${stray}${operator.displayName} needs ${describePorts([port])}: add ${names(fillers(port, registry))}.`
                : `${stray}${operator.displayName} does not have a complete type-compatible set of inputs.`
        };
    } else if (complete.length === 0) {
        // Every slot is taken; the values left over have nowhere to go.
        const best = [...assignments].sort((a, b) => b.used.size - a.used.size)[0]!;
        const orphans = values.filter(({ index }) => !best.used.has(index)).map(({ index }) => definitions[index]!);
        failure = {
            code: "ORPHAN_GLYPH",
            glyphId: orphans[0]?.id ?? operator.id,
            message: `${names(orphans)} ${orphans.length > 1 ? "have" : "has"} no slot in ${operator.displayName}, which takes ${describePorts(ports)} - and those are filled.`
        };
    }

    for (const assignment of complete) {
        let ast: SpellNode = {
            kind: "operator",
            glyphId: operator.id,
            outputType: operator.produces[0]!,
            arguments: assignment.arguments
        };

        let score = assignment.score;
        let legal = true;
        let previous: GlyphDefinition = operator;

        for (const { definition: modifier, index } of modifierEntries.sort((a, b) => a.index - b.index)) {
            const input = modifier.inputs?.[0];
            if (!input || !matches(ast, input.accepts)) {
                legal = false;
                failure ??= {
                    code: "INVALID",
                    glyphId: modifier.id,
                    message: `${modifier.displayName} cannot modify what ${previous.displayName} produces (${ast.outputType}); place ${previous.displayName} after it.`
                };
                break;
            }

            const distance = Math.max(1, index - operatorIndex);
            score += 100 + (distance === 1 ? 20 : Math.max(0, 10 - distance));
            ast = makeModifier(modifier, ast);
            previous = modifier;
        }

        if (legal) {
            candidates.push({ ast, score });
        }
    }

    return candidates.length > 0 ? { candidates } : { candidates, ...(failure ? { failure } : {}) };
}

function postfixOnlyCandidates(definitions: GlyphDefinition[], registry: GlyphRegistry): CandidateSearch {
    const operators = [...registry.values()].filter((definition) => definition.attachment === "operator");
    const modifier = definitions.find((definition) => definition.attachment === "postfix");

    if (definitions.length === 2) {
        const [value, postfix] = definitions;
        if (value && postfix && value.attachment === "value" && postfix.attachment === "postfix") {
            const node = valueNode(value);
            const port = postfix.inputs?.[0];
            if (port && matches(node, port.accepts)) {
                return {
                    candidates: [{
                        ast: makeModifier(postfix, node),
                        score: 120 + semanticBonus(port, node)
                    }]
                };
            }
        }
    }

    // No action glyph: nothing executes (spec §7, "value glyphs do not
    // execute by themselves"). Name the actions that would.
    if (modifier) {
        return {
            candidates: [],
            failure: {
                code: "INVALID",
                glyphId: modifier.id,
                message: `${modifier.displayName} needs an action to modify: add ${names(operators)}.`
            }
        };
    }
    return {
        candidates: [],
        failure: {
            code: "INVALID",
            message: `${names(definitions)} need an action to act through: add ${names(operators)}.`
        }
    };
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

    const search = operatorIndexes.length === 1
        ? operatorCandidates(definitions, operatorIndexes[0]!, registry)
        : postfixOnlyCandidates(definitions, registry);
    const candidates = search.candidates;

    if (candidates.length === 0) {
        return invalid(definitions, [search.failure ?? missingInputDiagnostic(definitions)]);
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
