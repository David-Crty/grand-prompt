# StateBlock

Empty, loading and error states for pages, cards and the viewer.

**Provide**: `kind` (`empty`, `loading`, `error`), `title`, `text`, optional `action`.

- Empty: say what will appear and how ("No events yet. Run `pnpm bench event run <name>` and publish it.").
- Error: say what failed and what to do. Version mismatch, missing file, decode error, WebGL unavailable (then offer the 2D map view).
- Loading: skeletons in the final layout; replays show a download bar with size ("Loading replay · 2.1 of 4.8 MB").

Maps to `<StateBlock>`.
