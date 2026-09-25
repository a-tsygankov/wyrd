import { glyphRegistryByDisplayName } from "../../wyrd-content/src/glyphs.js";
import type { GlyphDefinition, ParseDiagnostic, ParseResult, SemanticType, SpellNode, ValueNode } from "./types.js";

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

    if (accepted.includes("SpellRef") && effectTypes.has(node.outputType)) {
        return true;
    }

    return false;
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

function parsePostfixOnly(definitions: GlyphDefinition[]): ParseResult | undefined {
    if (definitions.length !== 2) {
        return undefined;
    }

    const [value, modifier] = definitions;
    if (!value || !modifier || value.attachment !== "value" || modifier.attachment !== "postfix") {
        return undefined;
    }

    const node = valueNode(value);
    const port = modifier.inputs?.[0];
    if (!port || !matches(node, port.accepts)) {
        return undefined;
    }

    const ast = makeModifier(modifier, node);
    return {
        status: "valid",
        ast,
        focusCost: focusCost(definitions),
        complexity: complexity(ast, definitions.length),
        diagnostics: []
    };
}

function parseOperatorSequence(definitions: GlyphDefinition[]): ParseResult | undefined {
    const operatorIndexes = definitions
        .map((definition, index) => definition.attachment === "operator" ? index : -1)
        .filter((index) => index >= 0);

    if (operatorIndexes.length !== 1) {
        return undefined;
    }

    const operatorIndex = operatorIndexes[0]!;
    const operator = definitions[operatorIndex]!;
    const before = definitions.slice(0, operatorIndex).map(valueNode);
    const afterDefinitions = definitions.slice(operatorIndex + 1);

    const modifiers: GlyphDefinition[] = [];
    const afterValues: ValueNode[] = [];
    for (const definition of afterDefinitions) {
        if (definition.attachment === "postfix") {
            modifiers.push(definition);
        } else if (definition.attachment === "value") {
            afterValues.push(valueNode(definition));
        } else {
            return undefined;
        }
    }

    const candidates = [...before, ...afterValues];
    const used = new Set<number>();
    const args: Record<string, SpellNode | SpellNode[]> = {};

    for (const port of operator.inputs ?? []) {
        const matchesForPort = candidates
            .map((node, index) => ({ node, index }))
            .filter(({ node, index }) => !used.has(index) && matches(node, port.accepts));

        if (matchesForPort.length === 0) {
            if (port.optional) {
                continue;
            }
            return undefined;
        }

        if (port.variadic) {
            args[port.name] = matchesForPort.map(({ node, index }) => {
                used.add(index);
                return node;
            });
            continue;
        }

        matchesForPort.sort((a, b) => {
            const posA = definitions.findIndex((definition) => definition.id === a.node.glyphId);
            const posB = definitions.findIndex((definition) => definition.id === b.node.glyphId);
            const distA = Math.abs(posA - operatorIndex);
            const distB = Math.abs(posB - operatorIndex);
            if (distA !== distB) {
                return distA - distB;
            }
            const aRight = posA > operatorIndex ? 0 : 1;
            const bRight = posB > operatorIndex ? 0 : 1;
            return aRight - bRight;
        });

        const chosen = matchesForPort[0]!;
        used.add(chosen.index);
        args[port.name] = chosen.node;
    }

    if (used.size !== candidates.length) {
        return undefined;
    }

    let ast: SpellNode = {
        kind: "operator",
        glyphId: operator.id,
        outputType: operator.produces[0]!,
        arguments: args
    };

    for (const modifier of modifiers) {
        const input = modifier.inputs?.[0];
        if (!input || !matches(ast, input.accepts)) {
            return undefined;
        }
        ast = makeModifier(modifier, ast);
    }

    return {
        status: "valid",
        ast,
        focusCost: focusCost(definitions),
        complexity: complexity(ast, definitions.length),
        diagnostics: []
    };
}

export function parseSpell(tokens: string[]): ParseResult {
    const diagnostics: ParseDiagnostic[] = [];
    const definitions: GlyphDefinition[] = [];

    for (const rawToken of tokens) {
        const token = normalizeToken(rawToken);
        const glyph = glyphRegistryByDisplayName.get(token);
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

    const candidates = [
        parseOperatorSequence(definitions),
        parsePostfixOnly(definitions)
    ].filter((candidate): candidate is ParseResult => candidate !== undefined);

    if (candidates.length === 0) {
        return invalid(definitions, [{
            code: "INVALID",
            message: "The glyph sequence does not form a complete typed spell."
        }]);
    }

    if (candidates.length > 1) {
        return {
            status: "ambiguous",
            focusCost: focusCost(definitions),
            complexity: definitions.length,
            diagnostics: [{
                code: "AMBIGUOUS",
                message: "Multiple equally valid parses were found."
            }]
        };
    }

    return candidates[0]!;
}
