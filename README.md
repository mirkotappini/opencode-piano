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

`<project root>/.agents/plan.md`, a plain markdown checklist. The root is the git
repository when there is one, otherwise the nearest directory that already contains
`.agents/plan.md` (a game design folder, a document set):

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
| `- [ ]` | pending (`·`, light blue) |
| `- [~]` | in progress, or the next pending step (`▸`, amber) |
| `- [x]` | done (`✓`, green) |
| `- [!]` | blocked (`!`) |

The counter is `done/total`. Markdown emphasis (`**bold**`, backticks) is stripped
for display; everything else is rendered as text. Steps keep their file order, and
`/plan done N` / `/plan start N` use the position in that order (the panel shows
the numbers).

## How a session gets its plan

Only two sources, both deterministic:

1. an explicit link for that session (`/plan use <repo>`, persisted);
2. the project root that contains the session's working directory.

There is no guessing from "recently edited files" or "last repo touched": those
heuristics link a session to work that belongs to another conversation. Otherwise the
sidebar stays empty. Links are stored in the plugin's own state
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
