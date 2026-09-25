export type GlyphFamily =
    | "essence"
    | "action"
    | "target"
    | "modifier"
    | "timing"
    | "boundary"
    | "logic"
    | "resource"
    | "state"
    | "identity";

export type SemanticType =
    | "EntityRef"
    | "RegionRef"
    | "SpellRef"
    | "BoundaryRef"
    | "Essence"
    | "State"
    | "Resource"
    | "Event"
    | "Count"
    | "Identity"
    | "Condition"
    | "InstantEffect"
    | "PersistentEffect"
    | "ReactionEffect"
    | "TriggeredEffect"
    | "QueryEffect"
    | "TransformEffect";

export type Attachment = "value" | "prefix" | "postfix" | "infix" | "operator";

export type Port = {
    name: string;
    accepts: SemanticType[];
    optional?: boolean;
    variadic?: boolean;
};

export type GlyphDefinition = {
    id: string;
    displayName: string;
    family: GlyphFamily;
    produces: SemanticType[];
    inputs?: Port[];
    baseFocusCost: number;
    precedence: number;
    attachment: Attachment;
    inverseOf?: string;
    cancelsTags?: string[];
    blockedByTags?: string[];
    tags: string[];
    canonStatus: "canon-anchor" | "canon-inspired" | "game-original";
};

export type ValueNode = {
    kind: "value";
    glyphId: string;
    outputType: SemanticType;
};

export type OperatorNode = {
    kind: "operator";
    glyphId: string;
    outputType: SemanticType;
    arguments: Record<string, SpellNode | SpellNode[]>;
};

export type ModifierNode = {
    kind: "modifier";
    glyphId: string;
    outputType: SemanticType;
    child: SpellNode;
};

export type SpellNode = ValueNode | OperatorNode | ModifierNode;

export type ParseDiagnostic = {
    code: "UNKNOWN_GLYPH" | "INVALID" | "AMBIGUOUS" | "ORPHAN_GLYPH" | "MISSING_INPUT";
    message: string;
    glyphId?: string;
};

export type ParseResult = {
    status: "valid" | "invalid" | "ambiguous";
    ast?: SpellNode;
    focusCost: number;
    complexity: number;
    diagnostics: ParseDiagnostic[];
};
