/**
 * Tests for the Zod 4 JSON Schema to BAML TypeBuilder converter
 */

import { fromZodSchema, type JsonSchema, type TypeBuilderLike, type ClassBuilderLike, type EnumBuilderLike, type PropertyBuilderLike, type EnumValueBuilderLike } from '../typescript_src/zod_to_baml';

// Mock FieldType for testing
class MockFieldType {
  constructor(
    public readonly typeName: string,
    public readonly isOptional: boolean = false,
    public readonly inner?: MockFieldType
  ) {}

  optional(): MockFieldType {
    return new MockFieldType(this.typeName, true, this.inner);
  }

  list(): MockFieldType {
    return new MockFieldType('list', false, this);
  }

  equals(other: MockFieldType): boolean {
    return this.typeName === other.typeName && this.isOptional === other.isOptional;
  }

  toString(): string {
    const base = this.inner ? `${this.typeName}<${this.inner.toString()}>` : this.typeName;
    return this.isOptional ? `${base}?` : base;
  }
}

// Mock PropertyBuilder
class MockPropertyBuilder implements PropertyBuilderLike {
  public descriptionValue: string | null = null;
  public aliasValue: string | null = null;

  description(desc: string | null): PropertyBuilderLike {
    this.descriptionValue = desc;
    return this;
  }

  alias(alias: string | null): PropertyBuilderLike {
    this.aliasValue = alias;
    return this;
  }
}

// Mock EnumValueBuilder
class MockEnumValueBuilder implements EnumValueBuilderLike {
  public descriptionValue: string | null = null;
  public aliasValue: string | null = null;

  constructor(public readonly name: string) {}

  description(desc: string | null): EnumValueBuilderLike {
    this.descriptionValue = desc;
    return this;
  }

  alias(alias: string | null): EnumValueBuilderLike {
    this.aliasValue = alias;
    return this;
  }
}

// Mock ClassBuilder
class MockClassBuilder implements ClassBuilderLike {
  public properties: Map<string, { type: MockFieldType; builder: MockPropertyBuilder }> = new Map();

  constructor(public readonly name: string) {}

  addProperty(name: string, type: any): PropertyBuilderLike {
    const builder = new MockPropertyBuilder();
    this.properties.set(name, { type, builder });
    return builder;
  }

  type(): MockFieldType {
    return new MockFieldType(`class:${this.name}`);
  }
}

// Mock EnumBuilder
class MockEnumBuilder implements EnumBuilderLike {
  public values: Map<string, MockEnumValueBuilder> = new Map();

  constructor(public readonly name: string) {}

  addValue(name: string): EnumValueBuilderLike {
    const builder = new MockEnumValueBuilder(name);
    this.values.set(name, builder);
    return builder;
  }

  type(): MockFieldType {
    return new MockFieldType(`enum:${this.name}`);
  }
}

// Mock TypeBuilder
class MockTypeBuilder implements TypeBuilderLike {
  public classes: Map<string, MockClassBuilder> = new Map();
  public enums: Map<string, MockEnumBuilder> = new Map();
  public unions: MockFieldType[][] = [];

  string(): MockFieldType {
    return new MockFieldType('string');
  }

  int(): MockFieldType {
    return new MockFieldType('int');
  }

  float(): MockFieldType {
    return new MockFieldType('float');
  }

  bool(): MockFieldType {
    return new MockFieldType('bool');
  }

  null(): MockFieldType {
    return new MockFieldType('null');
  }

  literalString(value: string): MockFieldType {
    return new MockFieldType(`literal:"${value}"`);
  }

  literalInt(value: number): MockFieldType {
    return new MockFieldType(`literal:${value}`);
  }

  literalBool(value: boolean): MockFieldType {
    return new MockFieldType(`literal:${value}`);
  }

  list(type: any): MockFieldType {
    return new MockFieldType('list', false, type);
  }

  map(keyType: any, valueType: any): MockFieldType {
    return new MockFieldType(`map<${keyType.typeName},${valueType.typeName}>`);
  }

  union(types: any[]): MockFieldType {
    this.unions.push(types);
    const typeNames = types.map((t: MockFieldType) => t.typeName).join('|');
    return new MockFieldType(`union(${typeNames})`);
  }

  addClass<Name extends string>(name: Name): MockClassBuilder {
    const builder = new MockClassBuilder(name);
    this.classes.set(name, builder);
    return builder as any;
  }

  addEnum<Name extends string>(name: Name): MockEnumBuilder {
    const builder = new MockEnumBuilder(name);
    this.enums.set(name, builder);
    return builder as any;
  }
}

describe('fromZodSchema', () => {
  describe('Primitive Types', () => {
    it('should convert string type', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: 'string' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('string');
      expect(result.isOptional).toBe(false);
    });

    it('should convert integer type', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: 'integer' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('int');
    });

    it('should convert number type to float', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: 'number' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('float');
    });

    it('should convert boolean type', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: 'boolean' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('bool');
    });

    it('should convert null type', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: 'null' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('null');
    });
  });

  describe('Nullable Types', () => {
    it('should convert nullable string (type array)', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { type: ['string', 'null'] };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('string');
      expect(result.isOptional).toBe(true);
    });

    it('should convert nullable via anyOf', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        anyOf: [
          { type: 'string' },
          { type: 'null' }
        ]
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('string');
      expect(result.isOptional).toBe(true);
    });
  });

  describe('Array Types', () => {
    it('should convert array of strings', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'array',
        items: { type: 'string' }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('list');
      expect(result.inner?.typeName).toBe('string');
    });

    it('should convert array of integers', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'array',
        items: { type: 'integer' }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('list');
      expect(result.inner?.typeName).toBe('int');
    });
  });

  describe('Object Types', () => {
    it('should convert simple object to class', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' }
        },
        required: ['name', 'age']
      };

      const result = fromZodSchema(schema, tb as any, 'User') as MockFieldType;

      expect(result.typeName).toBe('class:User');
      expect(tb.classes.has('User')).toBe(true);

      const userClass = tb.classes.get('User')!;
      expect(userClass.properties.has('name')).toBe(true);
      expect(userClass.properties.has('age')).toBe(true);

      const nameType = userClass.properties.get('name')!.type as MockFieldType;
      expect(nameType.typeName).toBe('string');
      expect(nameType.isOptional).toBe(false);
    });

    it('should mark non-required properties as optional', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' }
        },
        required: ['name']
      };

      fromZodSchema(schema, tb as any, 'User');

      const userClass = tb.classes.get('User')!;
      const nameType = userClass.properties.get('name')!.type as MockFieldType;
      const emailType = userClass.properties.get('email')!.type as MockFieldType;

      expect(nameType.isOptional).toBe(false);
      expect(emailType.isOptional).toBe(true);
    });

    it('should add description from schema', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The user\'s full name'
          }
        },
        required: ['name']
      };

      fromZodSchema(schema, tb as any, 'User');

      const userClass = tb.classes.get('User')!;
      const nameBuilder = userClass.properties.get('name')!.builder;
      expect(nameBuilder.descriptionValue).toBe('The user\'s full name');
    });

    it('should use title as alias', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            title: 'Full Name'
          }
        },
        required: ['name']
      };

      fromZodSchema(schema, tb as any, 'User');

      const userClass = tb.classes.get('User')!;
      const nameBuilder = userClass.properties.get('name')!.builder;
      expect(nameBuilder.aliasValue).toBe('Full Name');
    });
  });

  describe('Map Types', () => {
    it('should convert object with additionalProperties to map', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        additionalProperties: { type: 'string' }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('map<string,string>');
    });

    it('should convert object with additionalProperties of different type', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        additionalProperties: { type: 'integer' }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('map<string,int>');
    });
  });

  describe('Union Types', () => {
    it('should convert anyOf to union', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        anyOf: [
          { type: 'string' },
          { type: 'integer' }
        ]
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toContain('union');
      expect(tb.unions.length).toBe(1);
      expect(tb.unions[0].length).toBe(2);
    });

    it('should convert oneOf to union', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        oneOf: [
          { type: 'string' },
          { type: 'boolean' }
        ]
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toContain('union');
    });
  });

  describe('Enum Types', () => {
    it('should convert string enum', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        enum: ['RED', 'GREEN', 'BLUE']
      };

      const result = fromZodSchema(schema, tb as any, 'Color') as MockFieldType;

      expect(result.typeName).toBe('enum:Color');
      expect(tb.enums.has('Color')).toBe(true);

      const colorEnum = tb.enums.get('Color')!;
      expect(colorEnum.values.has('RED')).toBe(true);
      expect(colorEnum.values.has('GREEN')).toBe(true);
      expect(colorEnum.values.has('BLUE')).toBe(true);
    });

    it('should convert enum with special characters and add alias', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        enum: ['in-progress', 'not started', 'completed']
      };

      fromZodSchema(schema, tb as any, 'Status');

      const statusEnum = tb.enums.get('Status')!;
      expect(statusEnum.values.has('IN_PROGRESS')).toBe(true);
      expect(statusEnum.values.has('NOT_STARTED')).toBe(true);
      expect(statusEnum.values.has('COMPLETED')).toBe(true);

      // Check that original values are set as aliases
      expect(statusEnum.values.get('IN_PROGRESS')?.aliasValue).toBe('in-progress');
      expect(statusEnum.values.get('NOT_STARTED')?.aliasValue).toBe('not started');
    });

    it('should convert mixed enum to union of literals', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        enum: ['active', 1, true]
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toContain('union');
    });
  });

  describe('Const (Literal) Types', () => {
    it('should convert string const to literal', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { const: 'hello' };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('literal:"hello"');
    });

    it('should convert integer const to literal', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { const: 42 };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('literal:42');
    });

    it('should convert boolean const to literal', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = { const: true };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('literal:true');
    });
  });

  describe('References ($ref)', () => {
    it('should resolve $ref to $defs', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        $ref: '#/$defs/Address',
        $defs: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' }
            },
            required: ['street', 'city']
          }
        }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('class:Address');
      expect(tb.classes.has('Address')).toBe(true);
    });

    it('should resolve $ref to definitions (legacy format)', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        $ref: '#/definitions/Address',
        definitions: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' }
            },
            required: ['street']
          }
        }
      };

      const result = fromZodSchema(schema, tb as any) as MockFieldType;

      expect(result.typeName).toBe('class:Address');
    });

    it('should handle nested $ref in properties', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          address: { $ref: '#/$defs/Address' }
        },
        required: ['address'],
        $defs: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' }
            },
            required: ['street']
          }
        }
      };

      fromZodSchema(schema, tb as any, 'User');

      expect(tb.classes.has('User')).toBe(true);
      expect(tb.classes.has('Address')).toBe(true);
    });
  });

  describe('Complex Nested Types', () => {
    it('should handle nested objects', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          }
        },
        required: ['user']
      };

      fromZodSchema(schema, tb as any, 'Response');

      expect(tb.classes.has('Response')).toBe(true);
      expect(tb.classes.has('ResponseUser')).toBe(true);
    });

    it('should handle array of objects', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' }
          },
          required: ['id', 'name']
        }
      };

      const result = fromZodSchema(schema, tb as any, 'Users') as MockFieldType;

      expect(result.typeName).toBe('list');
      expect(tb.classes.has('UsersItem')).toBe(true);
    });
  });

  describe('Options', () => {
    it('should apply name prefix', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        required: ['name']
      };

      fromZodSchema(schema, tb as any, 'User', { namePrefix: 'API' });

      expect(tb.classes.has('APIUser')).toBe(true);
    });

    it('should use custom anonymous object name generator', () => {
      const tb = new MockTypeBuilder();
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          data: { type: 'string' }
        },
        required: ['data']
      };

      fromZodSchema(schema, tb as any, undefined, {
        anonymousObjectName: (i) => `CustomObject${i}`
      });

      expect(tb.classes.has('CustomObject0')).toBe(true);
    });
  });
});

describe('Complex Zod 4 Schema Examples', () => {
  it('should handle a typical Zod user schema', () => {
    // This simulates what z.toJSONSchema() might produce for:
    // z.object({
    //   id: z.string().uuid(),
    //   name: z.string(),
    //   email: z.string().email(),
    //   age: z.number().int().positive().optional(),
    //   role: z.enum(['admin', 'user', 'guest']),
    //   tags: z.array(z.string()),
    // });

    const tb = new MockTypeBuilder();
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        age: { type: 'integer', minimum: 1 },
        role: { enum: ['admin', 'user', 'guest'] },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'name', 'email', 'role', 'tags']
    };

    const result = fromZodSchema(schema, tb as any, 'User') as MockFieldType;

    expect(result.typeName).toBe('class:User');

    const userClass = tb.classes.get('User')!;
    expect(userClass.properties.size).toBe(6);

    // Check role is converted to enum
    expect(tb.enums.has('UserRole')).toBe(true);
    const roleEnum = tb.enums.get('UserRole')!;
    expect(roleEnum.values.has('ADMIN')).toBe(true);
    expect(roleEnum.values.has('USER')).toBe(true);
    expect(roleEnum.values.has('GUEST')).toBe(true);

    // Check tags is a list
    const tagsType = userClass.properties.get('tags')!.type as MockFieldType;
    expect(tagsType.typeName).toBe('list');

    // Check age is optional
    const ageType = userClass.properties.get('age')!.type as MockFieldType;
    expect(ageType.isOptional).toBe(true);
  });

  it('should handle discriminated unions', () => {
    // Simulates z.discriminatedUnion('type', [
    //   z.object({ type: z.literal('email'), email: z.string() }),
    //   z.object({ type: z.literal('sms'), phone: z.string() }),
    // ]);

    const tb = new MockTypeBuilder();
    const schema: JsonSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            type: { const: 'email' },
            email: { type: 'string' }
          },
          required: ['type', 'email']
        },
        {
          type: 'object',
          properties: {
            type: { const: 'sms' },
            phone: { type: 'string' }
          },
          required: ['type', 'phone']
        }
      ]
    };

    const result = fromZodSchema(schema, tb as any, 'Notification') as MockFieldType;

    expect(result.typeName).toContain('union');
    expect(tb.classes.has('NotificationVariant0')).toBe(true);
    expect(tb.classes.has('NotificationVariant1')).toBe(true);
  });
});
