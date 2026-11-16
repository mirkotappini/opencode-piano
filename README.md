# opencode-piano

A durable work-plan panel for the [OpenCode](https://opencode.ai) TUI.

The built-in todo list belongs to one session, disappears when the session has no
pending items, and dies with the session. `opencode-piano` reads a markdown file
**committed in your repo** (`.agents/plan.md`) and shows the plan of the session
you are looking at: what is done, what is in progress, what comes next.

- **Sidebar section**: `PIANO · OrcaPad 4/13` plus the three closest steps.
  `/plan expand` opens the full list (done steps included) in a scrollable box.
- **Panel**: `/plan` opens the numbered list, with the full path of the plan file.
- **Commands**: `/plan done N`, `/plan start N`, `/plan add text`,
  `/plan expand`, `/plan collapse`, `/plan use <repo>`, `/plan off`.

Nothing is shown for a session that has no plan: the panel never borrows the plan
of another session.

## Install

This is a TUI-only plugin: one `tui.tsx` file, no build step.

```sh
git clone https://github.com/mirkotappini/opencode-piano \
  ~/.config/opencode/plugins/opencode-piano
```

OpenCode discovers every directory under `<global-config>/plugins/` that exposes a
`tui.tsx` (or `tui.ts`), so nothing else is needed. Reload the TUI if it was
already running (`/reload`, or restart it).

If you prefer an explicit entry, point `cli.json` at the directory:

```json title="~/.config/opencode/cli.json"
{
  "plugins": ["./plugins/opencode-piano/tui.tsx"]
}
```

Requirements: OpenCode 2.x with the TUI plugin API (`solid-js` is provided by the
host).

## The plan file

`<git root>/.agents/plan.md`, a plain markdown checklist:

```md
# Piano — OrcaPad (Android + iOS)

## Adesso
- [~] Checklist on-device dei piatti (repo `docs/PLATES.md` §4)
- [ ] Decidere `applicationId` e package Java

## Fatto
- [x] App rinominata e branding rimosso
- [x] Schermata Licenze su Android

## Dopo
- [ ] Parità iOS
- [!] Bloccato: serve il dispositivo collegato
```

| Marker | Meaning in the panel |
| ------ | -------------------- |
| `- [ ]` | pending (`·`) |
| `- [~]` | in progress (`▸`, highlighted) |
| `- [x]` | done (`✓`, counted only) |
| `- [!]` | blocked (`!`) |

The counter is `done/total`. Markdown emphasis (`**bold**`, backticks) is stripped
for display; everything else is rendered as text. Steps keep their file order, and
`/plan done N` / `/plan start N` use the position in that order (the panel shows
the numbers).

## How a session gets its plan

In order, first match wins:

1. an explicit link for that session (`/plan use <repo>`, persisted);
2. the repo where that session's most recent file writes happened (at least two
   writes, only evaluated for the focused session);
3. the git repository containing the session directory.

Otherwise the sidebar stays empty. Links are stored in the plugin's own state
(`plugin.piano.links.json`, managed by OpenCode), one entry per session id, so a
plan never leaks into an unrelated conversation. `/plan off` clears the link.

## Notes

- UI strings are in Italian; the plan format is language-agnostic.
- The plugin only writes to the plan file (`done`, `start`, `add`); the agent
  normally keeps it updated while it works.
- `tui.tsx` is the whole implementation. It is deliberately small: read the file
  on a 1.5 s timer, no caches to invalidate, no dependencies beyond the host.

## License

MIT — see [LICENSE](./LICENSE).
