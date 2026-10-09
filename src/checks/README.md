# Checks

Each module exports `id`, `title`, `applies`, and `check` (R7.2).
The built-in registry has no enabled checks. A caller must select each check.
`runContentChecks(snapshot, ids, context)` runs pure checks over stored content.
It rejects unknown and duplicate ids. It does not capture, crawl or read files.
The context supplies targetId, viewportId, expectedLanguage, a prior snapshot (`before`), and explicit stored final HTTP responses (`responses`).
Unknown and incomplete evidence produces an informational finding with `evidence.state`.
The language check compares declared metadata. It does not detect a language.
The alt check accepts deliberate empty alt. It reports a missing attribute, whitespace-only alt, or an empty alt with an explicit img role.
Stored link responses use path and query. Fragment checks are not implemented.
