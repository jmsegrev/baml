/**
 * Zod 4 JSON Schema to BAML TypeBuilder Converter
 *
 * This module converts JSON Schema output from Zod 4's `z.toJSONSchema()`
 * into BAML TypeBuilder types for use with BAML functions.
 *
 * @example
 * ```typescript
 * import * as z from 'zod';
 * import { fromZodSchema } from '@boundaryml/baml/zod';
 * import TypeBuilder from './baml_client/type_builder';
 *
 * const UserSchema = z.object({
 *   name: z.string(),
 *   age: z.number().int(),
 *   email: z.string().email().optional(),
 * });
 *
 * const tb = new TypeBuilder();
 * const userType = fromZodSchema(z.toJSONSchema(UserSchema), tb, 'User');
 *
 * // Use with BAML function
 * const result = await b.ExtractUser("...", { tb });
 * ```
 */

/**
 * FieldType interface - matches the BAML TypeBuilder FieldType
 * This is defined here to avoid circular dependencies with native module
 */
export interface FieldType {
  optional(): FieldType
  list(): FieldType
  equals(other: FieldType): boolean
}

/**
 * JSON Schema types as produced by Zod 4's toJSONSchema()
 */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  enum?: (string | number | boolean | null)[]
  const?: string | number | boolean | null
  $ref?: string
  $defs?: Record<string, JsonSchema>
  definitions?: Record<string, JsonSchema>
  title?: string
  description?: string
  default?: unknown
  examples?: unknown[]
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  nullable?: boolean
}

/**
 * Interface for TypeBuilder to allow flexibility in implementation
 */
export interface TypeBuilderLike {
  string(): FieldType
  int(): FieldType
  float(): FieldType
  bool(): FieldType
  null(): FieldType
  literalString(value: string): FieldType
  literalInt(value: number): FieldType
  literalBool(value: boolean): FieldType
  list(type: FieldType): FieldType
  map(keyType: FieldType, valueType: FieldType): FieldType
  union(types: FieldType[]): FieldType
  addClass<Name extends string>(name: Name): ClassBuilderLike
  addEnum<Name extends string>(name: Name): EnumBuilderLike
}

export interface ClassBuilderLike {
  addProperty(name: string, type: FieldType): PropertyBuilderLike
  type(): FieldType
}

export interface PropertyBuilderLike {
  description(desc: string | null): PropertyBuilderLike
  alias(alias: string | null): PropertyBuilderLike
}

export interface EnumBuilderLike {
  addValue(name: string): EnumValueBuilderLike
  type(): FieldType
}

export interface EnumValueBuilderLike {
  alias(alias: string | null): EnumValueBuilderLike
  description(desc: string | null): EnumValueBuilderLike
}

/**
 * Options for schema conversion
 */
export interface FromZodSchemaOptions {
  /**
   * Name prefix for generated classes to avoid conflicts
   * @default ''
   */
  namePrefix?: string

  /**
   * How to handle unrepresentable types (e.g., formats like 'email', 'uri')
   * - 'ignore': Treat as the base type (e.g., 'email' → string)
   * - 'description': Add format info to description
   * @default 'description'
   */
  formatHandling?: 'ignore' | 'description'

  /**
   * Whether to preserve title metadata as aliases
   * @default true
   */
  useTitleAsAlias?: boolean

  /**
   * Custom name generator for anonymous objects
   * @default (index) => `AnonymousObject${index}`
   */
  anonymousObjectName?: (index: number) => string
}

/**
 * Context for tracking state during conversion
 */
interface ConversionContext {
  tb: TypeBuilderLike
  options: Required<FromZodSchemaOptions>
  defs: Record<string, JsonSchema>
  resolvedRefs: Map<string, FieldType>
  anonymousCounter: number
  createdClasses: Set<string>
  createdEnums: Set<string>
}

/**
 * Convert a JSON Schema (from Zod 4's toJSONSchema) to a BAML FieldType
 *
 * @param schema - The JSON Schema object from z.toJSONSchema()
 * @param tb - A TypeBuilder instance
 * @param rootName - Name for the root type if it's an object
 * @param options - Conversion options
 * @returns The constructed FieldType
 *
 * @example
 * ```typescript
 * import * as z from 'zod';
 *
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.number().int(),
 * });
 *
 * const tb = new TypeBuilder();
 * const type = fromZodSchema(z.toJSONSchema(schema), tb, 'Person');
 * ```
 */
export function fromZodSchema(
  schema: JsonSchema,
  tb: TypeBuilderLike,
  rootName?: string,
  options: FromZodSchemaOptions = {},
): FieldType {
  const ctx: ConversionContext = {
    tb,
    options: {
      namePrefix: options.namePrefix ?? '',
      formatHandling: options.formatHandling ?? 'description',
      useTitleAsAlias: options.useTitleAsAlias ?? true,
      anonymousObjectName: options.anonymousObjectName ?? ((i) => `AnonymousObject${i}`),
    },
    defs: { ...schema.$defs, ...schema.definitions },
    resolvedRefs: new Map(),
    anonymousCounter: 0,
    createdClasses: new Set(),
    createdEnums: new Set(),
  }

  return convertSchema(schema, ctx, rootName)
}

/**
 * Convert a JSON Schema node to a FieldType
 */
function convertSchema(schema: JsonSchema, ctx: ConversionContext, suggestedName?: string): FieldType {
  // Handle $ref first
  if (schema.$ref) {
    return resolveRef(schema.$ref, ctx)
  }

  // Handle nullable types (anyOf with null)
  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf || schema.oneOf || []
    return convertUnion(variants, ctx, suggestedName)
  }

  // Handle allOf (intersection) - merge properties
  if (schema.allOf) {
    return convertAllOf(schema.allOf, ctx, suggestedName)
  }

  // Handle const (literal values)
  if (schema.const !== undefined) {
    return convertConst(schema.const, ctx)
  }

  // Handle enum
  if (schema.enum) {
    return convertEnum(schema.enum, ctx, suggestedName || schema.title)
  }

  // Handle type-based conversion
  const types = normalizeType(schema.type)

  // Check for nullable pattern: ["string", "null"] or similar
  if (types.length === 2 && types.includes('null')) {
    const nonNullType = types.find((t) => t !== 'null')!
    const innerSchema = { ...schema, type: nonNullType }
    return convertSchema(innerSchema, ctx, suggestedName).optional()
  }

  // Single type or no type
  const type = types[0]

  switch (type) {
    case 'string':
      return convertString(schema, ctx)
    case 'integer':
      return ctx.tb.int()
    case 'number':
      return ctx.tb.float()
    case 'boolean':
      return ctx.tb.bool()
    case 'null':
      return ctx.tb.null()
    case 'array':
      return convertArray(schema, ctx, suggestedName)
    case 'object':
      return convertObject(schema, ctx, suggestedName)
    default:
      // Unknown type - default to string
      return ctx.tb.string()
  }
}

/**
 * Normalize type to an array of type strings
 */
function normalizeType(type: string | string[] | undefined): string[] {
  if (!type) return []
  return Array.isArray(type) ? type : [type]
}

/**
 * Convert a string schema, handling formats
 */
function convertString(schema: JsonSchema, ctx: ConversionContext): FieldType {
  // For now, we treat all string formats as strings
  // The format information can be added as description metadata
  return ctx.tb.string()
}

/**
 * Convert an array schema
 */
function convertArray(schema: JsonSchema, ctx: ConversionContext, suggestedName?: string): FieldType {
  if (!schema.items) {
    // Array of any - use string as fallback
    return ctx.tb.list(ctx.tb.string())
  }

  const itemName = suggestedName ? `${suggestedName}Item` : undefined
  const itemType = convertSchema(schema.items, ctx, itemName)
  return ctx.tb.list(itemType)
}

/**
 * Convert an object schema to a BAML class
 */
function convertObject(schema: JsonSchema, ctx: ConversionContext, suggestedName?: string): FieldType {
  // Handle map type (object with additionalProperties and no fixed properties)
  if (schema.additionalProperties && !schema.properties) {
    const valueSchema =
      typeof schema.additionalProperties === 'object' ? schema.additionalProperties : { type: 'string' as const }
    const valueType = convertSchema(valueSchema, ctx)
    return ctx.tb.map(ctx.tb.string(), valueType)
  }

  // Generate class name
  const className = generateClassName(schema, ctx, suggestedName)

  // Check if already created
  if (ctx.createdClasses.has(className)) {
    // Return reference to existing class
    // Note: TypeBuilder doesn't have a direct way to reference existing classes,
    // so we need to recreate it or track it differently
    return ctx.tb.addClass(className + '_duplicate_' + ctx.anonymousCounter++).type()
  }

  ctx.createdClasses.add(className)
  const classBuilder = ctx.tb.addClass(className)

  const properties = schema.properties || {}
  const required = new Set(schema.required || [])

  for (const [propName, propSchema] of Object.entries(properties)) {
    const propTypeName = `${className}${capitalize(propName)}`
    let propType = convertSchema(propSchema, ctx, propTypeName)

    // Make optional if not in required array
    if (!required.has(propName)) {
      propType = propType.optional()
    }

    const propBuilder = classBuilder.addProperty(propName, propType)

    // Add description if available
    if (propSchema.description) {
      propBuilder.description(propSchema.description)
    }

    // Add title as alias if enabled and available
    if (ctx.options.useTitleAsAlias && propSchema.title && propSchema.title !== propName) {
      propBuilder.alias(propSchema.title)
    }
  }

  return classBuilder.type()
}

/**
 * Convert a union (anyOf/oneOf) schema
 */
function convertUnion(variants: JsonSchema[], ctx: ConversionContext, suggestedName?: string): FieldType {
  // Check for nullable pattern: [type, {type: "null"}]
  const nullIndex = variants.findIndex(
    (v) => v.type === 'null' || (Array.isArray(v.type) && v.type.length === 1 && v.type[0] === 'null'),
  )

  if (nullIndex !== -1 && variants.length === 2) {
    const nonNullVariant = variants[nullIndex === 0 ? 1 : 0]
    return convertSchema(nonNullVariant, ctx, suggestedName).optional()
  }

  // Filter out null variants for the union and track if nullable
  const nonNullVariants = variants.filter(
    (v) => v.type !== 'null' && !(Array.isArray(v.type) && v.type.length === 1 && v.type[0] === 'null'),
  )
  const isNullable = nonNullVariants.length < variants.length

  // Convert each variant
  const convertedVariants = nonNullVariants.map((variant, index) => {
    const variantName = suggestedName ? `${suggestedName}Variant${index}` : undefined
    return convertSchema(variant, ctx, variantName)
  })

  if (convertedVariants.length === 0) {
    return ctx.tb.null()
  }

  if (convertedVariants.length === 1) {
    return isNullable ? convertedVariants[0].optional() : convertedVariants[0]
  }

  const unionType = ctx.tb.union(convertedVariants)
  return isNullable ? unionType.optional() : unionType
}

/**
 * Convert an allOf (intersection) schema - merge properties
 */
function convertAllOf(schemas: JsonSchema[], ctx: ConversionContext, suggestedName?: string): FieldType {
  // Merge all object schemas into one
  const mergedSchema: JsonSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  for (const schema of schemas) {
    // Resolve refs first
    const resolved = schema.$ref ? resolveRefSchema(schema.$ref, ctx) : schema

    if (resolved.properties) {
      mergedSchema.properties = { ...mergedSchema.properties, ...resolved.properties }
    }
    if (resolved.required) {
      mergedSchema.required = [...(mergedSchema.required || []), ...resolved.required]
    }
    if (resolved.title && !mergedSchema.title) {
      mergedSchema.title = resolved.title
    }
    if (resolved.description && !mergedSchema.description) {
      mergedSchema.description = resolved.description
    }
  }

  return convertObject(mergedSchema, ctx, suggestedName)
}

/**
 * Convert a const value to a literal type
 */
function convertConst(value: string | number | boolean | null, ctx: ConversionContext): FieldType {
  if (typeof value === 'string') {
    return ctx.tb.literalString(value)
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return ctx.tb.literalInt(value)
    }
    // Float literals not directly supported, use float type
    return ctx.tb.float()
  }
  if (typeof value === 'boolean') {
    return ctx.tb.literalBool(value)
  }
  return ctx.tb.null()
}

/**
 * Convert an enum schema
 */
function convertEnum(
  values: (string | number | boolean | null)[],
  ctx: ConversionContext,
  suggestedName?: string,
): FieldType {
  // Check if all values are strings - can use BAML enum
  const allStrings = values.every((v) => typeof v === 'string')

  if (allStrings && suggestedName) {
    const enumName = generateEnumName(suggestedName, ctx)

    if (!ctx.createdEnums.has(enumName)) {
      ctx.createdEnums.add(enumName)
      const enumBuilder = ctx.tb.addEnum(enumName)

      for (const value of values as string[]) {
        // Convert to valid enum value name (uppercase, replace spaces/special chars)
        const enumValue = toEnumValue(value)
        const valueBuilder = enumBuilder.addValue(enumValue)

        // Add original value as alias if different
        if (enumValue !== value) {
          valueBuilder.alias(value)
        }
      }

      return enumBuilder.type()
    }
  }

  // Mixed types or no name - use union of literals
  const literals = values.map((value) => convertConst(value, ctx))
  return literals.length === 1 ? literals[0] : ctx.tb.union(literals)
}

/**
 * Resolve a $ref to its schema
 */
function resolveRefSchema(ref: string, ctx: ConversionContext): JsonSchema {
  // Handle standard JSON Schema refs: #/$defs/Name or #/definitions/Name
  const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/)
  if (match) {
    const defName = match[2]
    const schema = ctx.defs[defName]
    if (schema) {
      return schema
    }
  }

  // Fallback - return empty schema
  return {}
}

/**
 * Resolve a $ref and convert to FieldType
 */
function resolveRef(ref: string, ctx: ConversionContext): FieldType {
  // Check cache
  if (ctx.resolvedRefs.has(ref)) {
    return ctx.resolvedRefs.get(ref)!
  }

  // Extract name from ref
  const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/)
  if (!match) {
    // Unknown ref format - return string as fallback
    return ctx.tb.string()
  }

  const defName = match[2]
  const schema = ctx.defs[defName]

  if (!schema) {
    return ctx.tb.string()
  }

  // Convert with the definition name as the suggested name
  const result = convertSchema(schema, ctx, defName)
  ctx.resolvedRefs.set(ref, result)

  return result
}

/**
 * Generate a unique class name
 */
function generateClassName(schema: JsonSchema, ctx: ConversionContext, suggestedName?: string): string {
  const baseName = schema.title || suggestedName || ctx.options.anonymousObjectName(ctx.anonymousCounter++)
  return ctx.options.namePrefix + baseName
}

/**
 * Generate a unique enum name
 */
function generateEnumName(suggestedName: string, ctx: ConversionContext): string {
  return ctx.options.namePrefix + suggestedName
}

/**
 * Convert a string to a valid BAML enum value (UPPER_SNAKE_CASE)
 */
function toEnumValue(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_') || 'VALUE'
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Convenience function to convert a Zod schema directly to BAML FieldType
 * Requires Zod 4's toJSONSchema function
 *
 * @example
 * ```typescript
 * import * as z from 'zod';
 * import { zodToBAML } from '@boundaryml/baml/zod';
 *
 * const UserSchema = z.object({
 *   name: z.string(),
 *   age: z.number().int(),
 * });
 *
 * const tb = new TypeBuilder();
 * const userType = zodToBAML(UserSchema, tb, 'User', z.toJSONSchema);
 * ```
 */
export function zodToBAML<T>(
  zodSchema: T,
  tb: TypeBuilderLike,
  name: string,
  toJSONSchema: (schema: T) => JsonSchema,
  options?: FromZodSchemaOptions,
): FieldType {
  const jsonSchema = toJSONSchema(zodSchema)
  return fromZodSchema(jsonSchema, tb, name, options)
}

export default fromZodSchema
