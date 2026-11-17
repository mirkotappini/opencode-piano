// Piano — stato di un piano durevole, per repo, legato alla singola sessione.
//
// Fonte di verità: <repo>/.agents/plan.md con checkbox markdown:
//   - [ ] da fare      - [~] in corso      - [x] fatto      - [!] bloccato
//
// A quale repo appartiene la sessione? Non alla sua cwd (spesso è $HOME), non
// all'ultimo repo toccato in assoluto: si guardano i file che *questa* sessione
// ha aperto o modificato nei suoi tool. Se non basta, `/plan use <repo>`
// collega il piano a mano (e resta collegato).

import { For, Show, createMemo, createSignal } from "solid-js"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join } from "node:path"

const PLAN_REL = join(".agents", "plan.md")
const POLL_MS = 1500
const SCAN_MESSAGES = 120

type Status = "pending" | "active" | "done" | "blocked"

type Step = { line: number; status: Status; text: string }

type Plan = {
  root: string
  title?: string
  steps: Step[]
  done: number
  total: number
  remaining: number
  current?: Step
}

const STEP_RE = /^\s*[-*]\s*\[([ xX~!])\]\s+(.*\S)\s*$/
const TITLE_RE = /^#\s+(.*\S)\s*$/
const GLYPH: Record<Status, string> = { done: "✓", active: "▸", pending: "·", blocked: "!" }

function toStatus(ch: string): Status {
  if (ch === "x" || ch === "X") return "done"
  if (ch === "~") return "active"
  if (ch === "!") return "blocked"
  return "pending"
}

function planTitle(text: string) {
  const heading = text.split("\n").find((line) => TITLE_RE.test(line))
  if (!heading) return undefined
  const title = TITLE_RE.exec(heading)![1].replace(/^piano\s*[—:-]\s*/i, "")
  return title || undefined
}

function parsePlan(text: string, root: string): Plan {
  const steps: Step[] = []
  text.split("\n").forEach((line, index) => {
    const match = STEP_RE.exec(line)
    if (!match) return
    steps.push({ line: index, status: toStatus(match[1]), text: match[2] })
  })
  const done = steps.filter((step) => step.status === "done").length
  return {
    root,
    title: planTitle(text),
    steps,
    done,
    total: steps.length,
    remaining: steps.length - done,
    current:
      steps.find((step) => step.status === "active") ?? steps.find((step) => step.status === "pending"),
  }
}

const rootCache = new Map<string, string | undefined>()

function gitRoot(directory?: string): string | undefined {
  if (!directory) return undefined
  if (rootCache.has(directory)) return rootCache.get(directory)
  let current = directory
  let found: string | undefined
  for (let depth = 0; depth < 16; depth += 1) {
    if (existsSync(join(current, ".git"))) {
      found = current
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  rootCache.set(directory, found)
  return found
}

function planPath(root: string) {
  return join(root, PLAN_REL)
}

// Radice del piano: la radice git, oppure la prima cartella che contiene già un
// .agents/plan.md (progetti non ancora sotto git: un gioco, un documento).
function planRoot(directory?: string): string | undefined {
  if (!directory) return undefined
  const root = gitRoot(directory)
  if (root) return root
  let current = directory
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, PLAN_REL))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

function modified(file: string) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function readPlanAt(root: string): Plan | undefined {
  const file = planPath(root)
  if (!existsSync(file)) return undefined
  try {
    const plan = parsePlan(readFileSync(file, "utf8"), root)
    return plan.total > 0 ? plan : undefined
  } catch {
    return undefined
  }
}

function clip(value: string, width = 34) {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= width) return text
  return text.slice(0, Math.max(1, width - 1)).trimEnd() + "…"
}

// Le checkbox arrivano da markdown: asterischi e backtick sono rumore in una
// riga di sidebar.
function plain(value: string) {
  return value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim()
}

function color(api: any, status: Status) {
  const text = api.theme?.text
  if (status === "active") return text?.feedback?.warning?.base ?? text?.base
  if (status === "blocked") return text?.feedback?.error?.base ?? text?.base
  if (status === "done") return text?.feedback?.success?.base ?? text?.muted
  return text?.feedback?.info?.base ?? text?.muted ?? text?.base
}

function available(root: string): string[] {
  const out: string[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
      const child = join(root, entry.name)
      if (existsSync(join(child, ".git")) && existsSync(planPath(child))) out.push(child)
    }
  } catch {}
  return out.sort((a, b) => modified(planPath(b)) - modified(planPath(a)))
}

export default {
  id: "piano",
  async setup(api: any) {
    const [refresh, setRefresh] = createSignal(0)
    const [links, setLinks] = api.storage.store("links", { initial: {} as Record<string, string> })
    const [expanded, setExpanded] = createSignal(false)
    const timer = setInterval(() => setRefresh((value) => value + 1), POLL_MS)
    const activity = new Map<string, { count: number; root?: string }>()

    function directoryOf(sessionID?: string): string | undefined {
      try {
        const session = sessionID ? api.data.session.get(sessionID) : undefined
        const directory = session?.location?.directory ?? session?.directory
        if (directory) return directory
      } catch {}
      try {
        const location = api.location ?? api.data.location.default()
        if (location?.directory) return location.directory
      } catch {}
      return undefined
    }

    function resolveRoot(sessionID?: string): string | undefined {
      const linked = sessionID ? links[sessionID] : undefined
      if (linked && existsSync(planPath(linked))) return linked
      // Nessuna euristica: il piano è quello della cartella della sessione.
      // Se la sessione non è dentro un progetto, non c'è piano da mostrare.
      const root = planRoot(directoryOf(sessionID))
      if (root && existsSync(planPath(root))) return root
      return undefined
    }

    function read(sessionID?: string): Plan | undefined {
      const root = resolveRoot(sessionID)
      return root ? readPlanAt(root) : undefined
    }

    function write(sessionID: string | undefined, mutate: (lines: string[], root: string) => string[]) {
      const root = resolveRoot(sessionID)
      if (!root) return undefined
      const file = planPath(root)
      const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : ["# Piano", ""]
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, mutate(lines, root).join("\n"), "utf8")
      setRefresh((value) => value + 1)
      return root
    }

    function activeSession() {
      try {
        const route = api.ui.router.current()
        if (route?.type === "session") return route.sessionID
      } catch {}
      return undefined
    }

    function link(sessionID: string | undefined, argument: string) {
      const directory = directoryOf(sessionID)
      const name = argument.replace(/\/+$/, "")
      let target: string | undefined
      if (isAbsolute(name)) target = existsSync(planPath(name)) ? name : gitRoot(name)
      if (!target && directory) {
        const direct = join(directory, name)
        if (existsSync(planPath(direct))) target = direct
        else if (gitRoot(direct) && existsSync(planPath(gitRoot(direct)!))) target = gitRoot(direct)
      }
      if (!target && directory) target = available(directory).find((path) => basename(path) === name)
      if (!target || !existsSync(planPath(target)))
        return api.ui.toast.show({ message: `Piano: nessun piano per «${argument}»`, variant: "error" })
      if (sessionID) setLinks((draft: Record<string, string>) => void (draft[sessionID] = target!))
      api.ui.toast.show({ message: `Piano: questa sessione segue ${basename(target)}`, variant: "success" })
      setRefresh((value) => value + 1)
    }

    async function command(input?: string) {
      const sessionID = activeSession()
      const argument = (input ?? "").trim()
      if (!argument) return api.ui.panel.open("piano")
      const [verb, ...rest] = argument.split(/\s+/)
      if (verb === "use" || verb === "usa") {
        const name = rest.join(" ").trim()
        if (!name) return api.ui.toast.show({ message: "Uso: /plan use <repo>", variant: "error" })
        return link(sessionID, name)
      }
      if (verb === "expand" || verb === "piu" || verb === "collapse" || verb === "meno") {
        const open = verb === "expand" || verb === "piu"
        setExpanded(open)
        return api.ui.toast.show({ message: `Piano: ${open ? "espanso" : "compresso"}`, variant: "success" })
      }
      if (verb === "off" || verb === "scollega") {
        if (sessionID) setLinks((draft: Record<string, string>) => void delete draft[sessionID])
        return api.ui.toast.show({ message: "Piano: sessione scollegata", variant: "success" })
      }
      if (verb === "add" || verb === "aggiungi") {
        const text = rest.join(" ").trim()
        if (!text) return api.ui.toast.show({ message: "Uso: /plan add <testo>", variant: "error" })
        const root = write(sessionID, (lines) => {
          const body = [...lines]
          while (body.length > 0 && body[body.length - 1].trim() === "") body.pop()
          return [...body, `- [ ] ${text}`, ""]
        })
        return api.ui.toast.show({
          message: root ? `Piano: aggiunto «${text}»` : "Piano: nessun piano collegato a questa sessione",
          variant: root ? "success" : "error",
        })
      }
      if (verb === "done" || verb === "fatto" || verb === "start" || verb === "inizia") {
        const position = Number.parseInt(rest[0] ?? "", 10)
        if (!Number.isFinite(position))
          return api.ui.toast.show({ message: `Uso: /plan ${verb} N`, variant: "error" })
        const next = verb === "done" || verb === "fatto" ? "x" : "~"
        let seen = 0
        let touched = false
        const root = write(sessionID, (lines) =>
          lines.map((line) => {
            if (!STEP_RE.test(line)) return line
            seen += 1
            if (seen !== position) return line
            touched = true
            return line.replace(/\[[ xX~!]\]/, `[${next}]`)
          }),
        )
        return api.ui.toast.show({
          message: !root
            ? "Piano: nessun piano collegato a questa sessione"
            : touched
              ? `Piano: passo ${position} → ${next === "x" ? "fatto" : "in corso"}`
              : `Piano: passo ${position} inesistente`,
          variant: root && touched ? "success" : "error",
        })
      }
      api.ui.toast.show({ message: "Uso: /plan [use repo | off | done N | start N | add testo]", variant: "error" })
    }

    function Sidebar(props: { sessionID: string }) {
      const plan = createMemo(() => {
        refresh()
        return read(props.sessionID)
      })
      const steps = createMemo(() => {
        const value = plan()
        if (!value) return []
        // Compresso: i 3 passi più vicini, col passo in corso in cima (il file
        // può avere da fare prima di quello su cui si sta lavorando).
        if (expanded()) return value.steps
        const pending = value.steps.filter((step) => step.status !== "done")
        const current = value.current
        if (!current) return pending.slice(0, 3)
        const first = pending[0]
        const ordered =
          first && first.line !== current.line ? [current, ...pending.filter((step) => step.line !== current.line)] : pending
        return ordered.slice(0, 3)
      })
      const currentLine = createMemo(() => plan()?.current?.line)
      const glyph = (step: { line: number; status: Status }) =>
        step.line === currentLine() ? "▸" : GLYPH[step.status]
      const hidden = createMemo(() => {
        const value = plan()
        if (!value || expanded()) return 0
        return Math.max(0, value.remaining - steps().length)
      })
      const header = createMemo(() => {
        const value = plan()
        if (!value) return ""
        const name = clip(plain(value.title ?? basename(value.root)), 20)
        return `${expanded() ? "▼" : "▶"} PIANO · ${name}  ${value.done}/${value.total}`
      })
      const toggle = () => setExpanded(!expanded())
      return (
        <Show when={plan() && plan()!.remaining > 0}>
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" onMouseDown={toggle}>
              <text fg={api.theme?.text?.muted}>{header()}</text>
            </box>
            <Show
              when={expanded()}
              fallback={
                <For each={steps()}>
                  {(step, index) => (
                    <text fg={step.line === currentLine() ? color(api, "active") : color(api, step.status)}>
                      {`${glyph(step)} ${clip(plain(step.text), 32)}`}
                    </text>
                  )}
                </For>
              }
            >
              <scrollbox height={Math.min(Math.max(steps().length, 1), 16)} flexDirection="column">
                <For each={steps()}>
                  {(step) => (
                    <text fg={step.line === currentLine() ? color(api, "active") : color(api, step.status)}>
                      {`${glyph(step)} ${clip(plain(step.text), 32)}`}
                    </text>
                  )}
                </For>
              </scrollbox>
            </Show>
            <Show when={hidden() > 0}>
              <box flexDirection="row" onMouseDown={toggle}>
                <text fg={api.theme?.text?.muted}>{`  +${hidden()} altri · /plan expand`}</text>
              </box>
            </Show>
          </box>
        </Show>
      )
    }

    function Panel(props: { panel: any }) {
      api.keymap.layer(() => ({
        commands: [
          { id: "piano.panel.close", title: "Chiudi il piano", bind: "escape", run: () => props.panel.close() },
          { id: "piano.panel.fullscreen", title: "Piano a schermo intero", bind: "f", run: () => props.panel.toggleFullscreen() },
        ],
      }))
      const plan = createMemo(() => {
        refresh()
        return read(props.panel.sessionID)
      })
      const others = createMemo(() => {
        const root = plan()?.root ?? directoryOf(props.panel.sessionID)
        return root ? available(root).filter((path) => path !== plan()?.root) : []
      })
      const width = createMemo(() => {
        const value = Number(props.panel.width ?? 0)
        return value > 20 ? value : 60
      })
      return (
        <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={1}>
          <Show
            when={plan()}
            fallback={
              <box flexDirection="column" gap={1}>
                <text fg={api.theme?.text?.base}>Questa sessione non ha un piano.</text>
                <text fg={api.theme?.text?.muted}>
                  {"Si collega al repo in cui stai lavorando: /plan use <repo>. Il file è <repo>/.agents/plan.md."}
                </text>
                <For each={others()}>
                  {(path) => <text fg={api.theme?.text?.muted}>{`· ${basename(path)}  →  /plan use ${basename(path)}`}</text>}
                </For>
              </box>
            }
          >
            <text fg={api.theme?.text?.base}>
              {`Piano · ${plan()!.title ?? basename(plan()!.root)}  ${plan()!.done}/${plan()!.total}  ·  ${plan()!.remaining} da fare`}
            </text>
            <text fg={api.theme?.text?.muted}>{plan()!.root}</text>
            <text fg={api.theme?.text?.muted}>{"─".repeat(Math.min(width(), 48))}</text>
            <For each={plan()!.steps}>
              {(step, index) => (
                <text fg={color(api, step.status)}>
                  {`${String(index() + 1).padStart(2)} ${GLYPH[step.status]} ${clip(plain(step.text), Math.min(width(), 90))}`}
                </text>
              )}
            </For>
          </Show>
          <text fg={api.theme?.text?.muted}>
            "/plan done N · /plan start N · /plan add testo · /plan use repo · esc chiude"
          </text>
        </box>
      )
    }

    api.ui.slot({
      append: "sidebar.content",
      render: (input: any) => <Sidebar sessionID={input.sessionID} />,
    })

    api.ui.slot({
      append: "session.panel",
      render: (panel: any) => (
        <Show when={panel.name === "piano"}>
          <Panel panel={panel} />
        </Show>
      ),
    })

    api.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "piano.open",
          title: "Piano: apri il piano del progetto",
          group: "Piano",
          palette: true,
          slash: { name: "plan", aliases: ["piano"], arguments: true },
          run: async (input?: string) => command(input),
        },
      ],
    }))

    return () => clearInterval(timer)
  },
}
