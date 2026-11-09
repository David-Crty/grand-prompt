# CodeView

The program a model wrote, with its stats: the most interesting part of an LLM benchmark, shown plainly.

**Provide**: `source`, `path`, `stats` (lines, bytes, driver hash, similarity to the DDK baseline), optional `highlight` ranges.

- Read-only, mono, line numbers, minimal highlighting (keywords and comments only).
- Above it, the approach summary and "x% similar to the baseline" (a line diff ratio against `ddk/baseline-driver.js`).
- Long files scroll inside the card; the page never scrolls sideways on phones.

Maps to `<CodeView>`.
