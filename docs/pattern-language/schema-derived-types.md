# SCHEMA-DERIVED TYPES ★★

**consider first**: [INDEPENDENTLY INVOCABLE UNITS](independently-invocable-units.md),
[ERRORS AS VALUES](errors-as-values.md)

**forces**: you need runtime validation (external data is untrustworthy)
AND compile-time types (internal code needs type safety). maintaining
both separately means they drift apart — change the type, forget the
validator. the shape of data is a requirement that should be declared
once, not maintained in two places.

**therefore**: define schema once; derive type from schema. single source
of truth for shape and type. validation and type inference from the same
artifact.

**intended consequences**:

- ✓ types and validation always in sync
- ✓ detailed error messages for free
- ✓ the schema IS the documentation of data shape
- △ schema library API may be less widely known

---

## in this codebase

**library**: arktype for runtime schema validation.

```typescript
export const MemoryEntryMetaSchema = type({
  id: type("string").matching(ID_PATTERN),
  title: "string >= 1",
  "tags?": "string[]",
  status: "'captured' | 'consolidated' | 'promoted'",
  used: "number >= 0",
  last_used: "string",
  pinned: "boolean",
  createdAt: "number",
  updatedAt: "number",
  "sources?": MemorySourcesSchema,
});

export type MemoryEntryMeta = typeof MemoryEntryMetaSchema.infer;

const validated = MemoryEntryMetaSchema(data);
if (validated instanceof type.errors) {
  return err({ _tag: "memory.persist.write", path: id, message: validated.summary });
}
```

**files**: 
- `src/schema.ts` — `JournalQueueEntrySchema`, `MemoryEntryMetaSchema`
- `src/config.ts` — `ConfigSchema` for configuration validation
- `src/persist/filesystem.ts` — validates entries on write
