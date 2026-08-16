'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { registerMultiRowLinkProvider } from '@/lib/term-links'
import { keydownToSeq } from '@/lib/term-keys'
import { selectionRange, type CellPos } from '@/lib/term-select'
import { TerminalClient, type ConnState } from '@/lib/terminal-client'
import type { WindowInfo } from '@podbay/shared/protocol'
import KeyBar from './key-bar'
import PasteBox from './paste-box'
import TermStats from './term-stats'

const THEME = {
  background: '#0b1220',
  foreground: '#eef2f8',
  cursor: '#2f6bff',
  selectionBackground: '#3a5686',
  // Force selected glyphs to repaint in a set color — without it the canvas
  // renderer can drop a glyph under a programmatic selection (a char goes blank).
  selectionForeground: '#eef2f8',
}

export interface PodTerminalProps {
  podId: string
  /** The pod's display name (null when unnamed → the slug stands alone). */
  podName?: string | null
  gatewayUrl: string
  /** The pod has been onboarded before (it has a Claude login). Then this is a
   * RECONNECT to a running pod, not a first boot — so we don't show the
   * "starting the agent CLI" first-boot banner (it's misleading), and we nudge a
   * repaint so the live screen shows instead of a blank pane. */
  bootedBefore?: boolean
  /** The machine was already running at page load (not cold-starting). Then the
   * WS-connect banner says "Reconnecting…" instead of "booting the machine (~15–30s
   * on first launch)" — nothing is booting, we're just dialing a live pod. */
  machineUp?: boolean
}

const AGENT_LABELS: Record<string, string> = { 'claude-code': 'Claude', codex: 'Codex' }
/** Tab label: the agent's name when the window hosts one, else the tmux window name. */
function windowLabel(w: WindowInfo): string {
  if (w.agent) return AGENT_LABELS[w.agent] ?? w.agent
  return w.name || `win ${w.index}`
}

export default function PodTerminal({
  podId,
  podName,
  gatewayUrl,
  bootedBefore = false,
  machineUp = false,
}: PodTerminalProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const clientRef = useRef<TerminalClient | null>(null)
  const knownUrlsRef = useRef<string[]>([])
  /** ?agent= from the URL — a one-shot "open on this agent's tab" request. Read
   * lazily from location (not useSearchParams — no Suspense requirement). */
  const wantedAgentRef = useRef<string | null>(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("agent"),
  )
  const ctrlRef = useRef(false)
  const [state, setState] = useState<ConnState>('connecting')
  const [everConnected, setEverConnected] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  // Cold-start signal from the agent: paneChars ≈ 0 while the CLI hasn't
  // painted anything yet (the tmux status line is not part of the pane).
  const [agentPainted, setAgentPainted] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [copied, setCopied] = useState(false)
  // Cheap-tabs: the pod's tmux windows. One tab per window; shown only when >1
  // (a single-agent pod stays chromeless). docs/plans/multi-agent-plan.md.
  const [windows, setWindows] = useState<WindowInfo[]>([])
  // 1s tick to drive the elapsed counters in the hints.
  const [now, setNow] = useState(() => Date.now())
  const mountedAt = useRef(Date.now())
  const connectedAt = useRef<number | null>(null)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Mobile keyboard handling: size the terminal to the VISUAL viewport (which
  // shrinks when the on-screen keyboard opens) and pin it to the visible region.
  // Without this the page keeps its full height and the keyboard floats over the
  // agent input; the user has to scroll it into view. `.term-wrap` is
  // position:fixed so the layout-viewport scroll can't slide it under the keyboard.
  useEffect(() => {
    const vv = window.visualViewport
    const wrap = wrapRef.current
    if (!vv || !wrap) return
    const apply = () => {
      wrap.style.height = `${vv.height}px`
      wrap.style.transform = `translateY(${vv.offsetTop}px)`
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      wrap.style.height = ''
      wrap.style.transform = ''
    }
  }, [])

  useEffect(() => {
    // Self-host has no gateway to proxy the PTY WebSocket (browser→gateway→pod-agent),
    // so there is nothing to connect to — skip it rather than spin on "Reconnecting…".
    if (!mountRef.current || !gatewayUrl) return
    const term = new Terminal({
      fontSize: 15,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 5000,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Make URLs clickable. Two layers: the row-join heuristic linkifies wrapped
    // URLs, and — since even a partially-detected fragment should open the right
    // link — we resolve the clicked text against the FULL urls the agent extracts
    // (tmux -J joins wrapped output correctly). So the first row of a wrapped
    // preview URL opens the complete URL, not a truncated one.
    const resolveUrl = (fragment: string): string => {
      const matches = knownUrlsRef.current.filter(
        (u) => u.startsWith(fragment) || fragment.startsWith(u),
      )
      return matches.sort((a, b) => b.length - a.length)[0] ?? fragment
    }
    registerMultiRowLinkProvider(term, (uri) =>
      window.open(resolveUrl(uri), '_blank', 'noopener,noreferrer'),
    )
    // Editing shortcuts xterm doesn't emit usefully: Shift/Alt+Enter newline,
    // Alt+←/→ word motion, Cmd+←/→ line start/end. Returning false stops xterm
    // (and the browser) from also acting on the key.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const seq = keydownToSeq(e)
      if (seq == null) return true
      e.preventDefault()
      clientRef.current?.sendInput(seq)
      return false
    })

    term.open(mountRef.current)
    // Fit after the browser has laid out the element — a synchronous fit at
    // open measures a not-yet-final box and can miscount rows. Focus here too so
    // the keyboard is live immediately (incl. after a refresh) without a click.
    requestAnimationFrame(() => {
      fit.fit()
      term.focus()
    })

    // Fix "scrolling rotates my input history": in a full-screen TUI (alt buffer,
    // e.g. Claude Code's input UI) with no mouse tracking there's no scrollback to
    // scroll, so xterm converts wheel/touch scroll into arrow-key presses — which
    // the agent's prompt reads as command-history navigation. Suppress the wheel
    // there. When the app tracks the mouse (vim, htop) or we're in the normal
    // buffer with real scrollback, let xterm handle it as usual.
    term.attachCustomWheelEventHandler(() => {
      const inAltBuffer = term.buffer.active.type === 'alternate'
      const appTracksMouse = term.modes.mouseTrackingMode !== 'none'
      return !(inAltBuffer && !appTracksMouse)
    })

    // OSC 52 → system clipboard.
    term.parser.registerOscHandler(52, (data) => {
      const b64 = data.split(';').pop() ?? ''
      try {
        void navigator.clipboard?.writeText(atob(b64))
      } catch {
        /* ignore */
      }
      return true
    })

    const client = new TerminalClient({ gatewayUrl, podId })
    clientRef.current = client

    client.on('output', (d) => term.write(d))
    client.on('links', (urls) => {
      knownUrlsRef.current = urls
    })
    client.on('status', (s) => {
      if (typeof s.paneChars === 'number' && s.paneChars > 40)
        setAgentPainted(true)
    })
    client.on('windows', (w) => {
      setWindows(w)
      // ?agent= deep-link (agent cards' "Finish sign-in" lands on that agent's
      // tab). Honored once, on the first windows frame that has the window —
      // afterwards the user's own tab clicks win.
      const want = wantedAgentRef.current
      if (want) {
        const target = w.find((x) => x.agent === want)
        if (target) {
          wantedAgentRef.current = null
          client.selectWindow(target.index)
        }
      }
    })
    client.on('state', (s) => {
      setState(s)
      if (s === 'connected') {
        setEverConnected(true)
        connectedAt.current ??= Date.now()
        client.sendResize(term.cols, term.rows)
        // The agent only streams NEW output, so a reconnect/refresh shows a blank
        // pane until the app next paints. Nudge tmux to redraw the CURRENT screen
        // with a one-row size wiggle (SIGWINCH → full repaint), so a live pod's
        // terminal appears immediately instead of looking stuck "starting".
        setTimeout(() => {
          client.sendResize(term.cols, Math.max(2, term.rows - 1))
          setTimeout(() => client.sendResize(term.cols, term.rows), 90)
        }, 120)
      }
    })

    // Input: apply the sticky Ctrl toggle to the next character.
    term.onData((d) => {
      if (ctrlRef.current && d.length === 1) {
        const code = d.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) {
          client.sendInput(String.fromCharCode(code - 64))
          ctrlRef.current = false
          setCtrl(false)
          return
        }
      }
      client.sendInput(d)
    })
    term.onResize(({ cols, rows }) => client.sendResize(cols, rows))

    // Refit whenever the terminal's box changes (hints appearing/disappearing,
    // window resizes, mobile viewport). Debounced ~200ms then rAF: each PTY
    // resize makes the agent (Ink) repaint its whole UI, which piles duplicate
    // frames into scrollback — so we collapse the burst of events a mobile
    // keyboard open/close fires into a single fit after it settles, and skip the
    // fit entirely when the grid didn't actually change.
    let fitRaf = 0
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    const refit = () => {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        cancelAnimationFrame(fitRaf)
        fitRaf = requestAnimationFrame(() => {
          const dims = fit.proposeDimensions()
          if (dims && (dims.cols !== term.cols || dims.rows !== term.rows)) fit.fit()
        })
      }, 200)
    }
    const ro = new ResizeObserver(refit)
    ro.observe(mountRef.current)
    window.visualViewport?.addEventListener('resize', refit)

    client.connect()

    // Mobile touch: a quick drag SCROLLS the xterm viewport (the same lever the
    // scrollbar uses — the only thing that moves history here, since the app
    // tracks the mouse and ignores forwarded wheel). A LONG-PRESS-then-drag
    // SELECTS via xterm's selection API (which bypasses the app's mouse mode)
    // and copies on release. A plain tap falls through to xterm/the app.
    // Map a viewport point to an absolute buffer cell (col + scrolled row).
    const pointToCell = (x: number, y: number): CellPos | null => {
      const screen = mountRef.current?.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen) return null
      const r = screen.getBoundingClientRect()
      const col = Math.max(0, Math.min(term.cols - 1, Math.floor(((x - r.left) / r.width) * term.cols)))
      const row = Math.max(0, Math.min(term.rows - 1, Math.floor(((y - r.top) / r.height) * term.rows)))
      return { col, row: term.buffer.active.viewportY + row }
    }

    let mode: 'idle' | 'pending' | 'scroll' | 'select' = 'idle'
    let startX = 0
    let lastY = 0
    let scrollAccum = 0
    let anchor: CellPos | null = null
    let pressTimer: ReturnType<typeof setTimeout> | null = null
    const clearPress = () => {
      if (pressTimer) clearTimeout(pressTimer)
      pressTimer = null
    }

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      startX = t.clientX
      lastY = t.clientY
      scrollAccum = 0
      mode = 'pending'
      const sx = t.clientX
      const sy = t.clientY
      clearPress()
      pressTimer = setTimeout(() => {
        if (mode !== 'pending') return
        mode = 'select'
        anchor = pointToCell(sx, sy)
        if (anchor) term.select(anchor.col, anchor.row, 1)
        navigator.vibrate?.(10)
        setSelecting(true)
      }, 450)
    }
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const y = t.clientY
      if (mode === 'pending' && Math.hypot(t.clientX - startX, y - lastY) > 10) {
        clearPress()
        mode = 'scroll'
      }
      if (mode === 'scroll') {
        e.preventDefault()
        // Scroll xterm's own scrollback (px→lines via cell height) — the same
        // history the desktop scrollbar shows.
        const screen = mountRef.current?.querySelector('.xterm-screen') as HTMLElement | null
        const cellH = screen ? screen.getBoundingClientRect().height / term.rows : 18
        scrollAccum += y - lastY // finger down (grows) reveals older output
        const lines = Math.trunc(scrollAccum / cellH)
        if (lines !== 0) {
          term.scrollLines(-lines) // negative = toward older
          scrollAccum -= lines * cellH
        }
        lastY = y
      } else if (mode === 'select' && anchor) {
        e.preventDefault()
        const cur = pointToCell(t.clientX, y)
        if (cur) {
          const s = selectionRange(anchor, cur, term.cols)
          term.select(s.col, s.row, s.length)
        }
      }
    }
    const onTouchEnd = () => {
      clearPress()
      if (mode === 'select') {
        const text = term.getSelection()
        if (text) {
          void navigator.clipboard?.writeText(text).catch(() => {})
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        }
        setSelecting(false)
        term.clearSelection()
      }
      mode = 'idle'
      anchor = null
    }
    const mountEl = mountRef.current
    mountEl.addEventListener('touchstart', onTouchStart, { passive: true })
    mountEl.addEventListener('touchmove', onTouchMove, { passive: false })
    mountEl.addEventListener('touchend', onTouchEnd, { passive: true })
    mountEl.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      mountEl.removeEventListener('touchstart', onTouchStart)
      mountEl.removeEventListener('touchmove', onTouchMove)
      mountEl.removeEventListener('touchend', onTouchEnd)
      mountEl.removeEventListener('touchcancel', onTouchEnd)
      clearPress()
      if (fitTimer) clearTimeout(fitTimer)
      cancelAnimationFrame(fitRaf)
      ro.disconnect()
      window.visualViewport?.removeEventListener('resize', refit)
      client.close()
      term.dispose()
    }
  }, [podId, gatewayUrl])

  const toggleCtrl = () => {
    ctrlRef.current = !ctrlRef.current
    setCtrl(ctrlRef.current)
  }
  // Desktop: read the clipboard directly. Mobile (iOS/Android block
  // clipboard.readText outside a trusted gesture): fall back to a paste box the
  // OS lets the user paste into. Either way the text is written to the PTY.
  const paste = async () => {
    try {
      const t = await navigator.clipboard?.readText()
      if (t) {
        clientRef.current?.sendInput(t)
        termRef.current?.focus()
        return
      }
    } catch {
      /* clipboard read blocked — fall through to the paste box */
    }
    setPasteOpen(true)
  }
  const submitPaste = (text: string) => {
    setPasteOpen(false)
    if (text) clientRef.current?.sendInput(text)
    termRef.current?.focus()
  }

  return (
    // ph-no-capture: never let session replay record this. What renders here is the
    // owner's code and their agent conversation — see instrumentation-client.ts.
    <div className="term-wrap ph-no-capture" ref={wrapRef}>
      <div className="term-bar">
        <span className="term-bar-left">
          <span className={`term-state ${gatewayUrl ? `term-state-${state}` : 'term-state-selfhost'}`}>
            {gatewayUrl ? state : 'self-host'}
          </span>
          <span className="term-pod" title={podName ? `${podName} (${podId})` : podId}>
            {podName || podId}
            {podName && podName !== podId && <span className="term-pod-id"> ({podId})</span>}
          </span>
        </span>
        {/* Desktop-only live stats, true-centered by the equal-flex sides (hidden on phones). */}
        <TermStats podId={podId} />
        <span className="term-bar-right">
          <a className="term-bar-link" href="/dashboard">
            Dashboard
          </a>
        </span>
      </div>
      {(() => {
        const bootingSecs = Math.floor((now - mountedAt.current) / 1000)
        const cliSecs = connectedAt.current
          ? Math.floor((now - connectedAt.current) / 1000)
          : 0
        // Self-host: no gateway proxies the PTY, so the live web terminal can't connect.
        // Say so with the real alternatives instead of spinning on "Reconnecting…".
        if (!gatewayUrl) {
          return (
            <div className="term-hint">
              <span>
                The live web terminal isn’t available in self-host yet — it needs the gateway. Attach
                from your machine with <code>docker exec -it -u dev podbay-{podId} tmux attach -t main</code>,
                or open this pod in the Claude app.
              </span>
            </div>
          )
        }
        // Gave up auto-reconnecting: the pod is likely suspended or removed. Stop
        // the spinner and offer a manual retry instead of looping forever.
        if (state === 'lost') {
          return (
            <div className="term-hint">
              <span>Connection lost — the pod may have been suspended or removed.</span>
              <button
                type="button"
                className="term-hint-btn"
                onClick={() => clientRef.current?.reconnect()}
              >
                Reconnect
              </button>
            </div>
          )
        }
        if (state !== 'connected') {
          return (
            <div className="term-hint">
              <span className="term-hint-spin" />
              {everConnected || machineUp || bootedBefore
                ? 'Reconnecting to your pod…'
                : `Starting your pod — booting the machine and agent (~15–30s on first launch)… ${bootingSecs}s`}
            </div>
          )
        }
        // First-boot banner only — never on a reconnect to an already-onboarded
        // pod (where the CLI is already running; a blank pane is just the
        // not-yet-repainted screen, which the connect nudge fills).
        if (!agentPainted && !bootedBefore && cliSecs < 90) {
          return (
            <div className="term-hint">
              <span className="term-hint-spin" />
              {`Connected — starting the agent CLI (up to ~60s on a pod's first boot)… ${cliSecs}s`}
            </div>
          )
        }
        return null
      })()}
      {windows.length > 0 && (
        <div className="term-tabs" role="tablist">
          {windows.map((w) => (
            <button
              key={w.index}
              type="button"
              role="tab"
              aria-selected={w.active}
              className={`term-tab${w.active ? ' term-tab-active' : ''}`}
              onClick={() => {
                clientRef.current?.selectWindow(w.index)
                termRef.current?.focus() // type into the switched-to window without a click
              }}
            >
              {windowLabel(w)}
            </button>
          ))}
          {/* "+" — a new tmux window. No-op on pods too old to know the message. */}
          <button
            type="button"
            className="term-tab-add"
            aria-label="New window"
            title="New window"
            onClick={() => {
              clientRef.current?.createWindow()
              termRef.current?.focus() // land the cursor in the new window immediately
            }}
          >
            +
          </button>
        </div>
      )}
      <div className="term" ref={mountRef} />
      {selecting && <div className="term-toast">Selecting — release to copy</div>}
      {copied && <div className="term-toast">Copied ✓</div>}
      <KeyBar
        onSeq={(s) => {
          clientRef.current?.sendInput(s)
          termRef.current?.focus() // keep focus so the mobile keyboard stays up
        }}
        ctrlActive={ctrl}
        onToggleCtrl={() => {
          toggleCtrl()
          termRef.current?.focus()
        }}
        onPaste={paste}
      />
      {pasteOpen && <PasteBox onSubmit={submitPaste} onCancel={() => setPasteOpen(false)} />}
    </div>
  )
}
