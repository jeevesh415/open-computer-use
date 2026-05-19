"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TERMINAL_MONO_STACK } from "@/lib/fonts";
import "@xterm/xterm/css/xterm.css";

interface SshTerminalProps {
  machineId: string;
}

type TerminalStatus = "connecting" | "connected" | "disconnected" | "error";

// Safe base64 encode that handles large data (no spread operator)
function toBase64(str: string): string {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function SshTerminal({ machineId }: SshTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("disconnected");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputBufferRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const hasConnectedRef = useRef(false);
  const machineIdRef = useRef(machineId);
  machineIdRef.current = machineId;

  const cleanupSession = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (sessionIdRef.current) {
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      fetch(
        `/api/machines/${machineIdRef.current}/terminal?sessionId=${sid}`,
        { method: "DELETE" }
      ).catch(() => {});
    }
  }, []);

  const flushInput = useCallback(async () => {
    const data = inputBufferRef.current;
    if (!data || !sessionIdRef.current) return;
    inputBufferRef.current = "";

    try {
      await fetch(`/api/machines/${machineIdRef.current}/terminal/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          data: toBase64(data),
        }),
      });
    } catch (err) {
      console.error("Failed to send terminal input:", err);
    }
  }, []);

  const queueInput = useCallback(
    (data: string) => {
      inputBufferRef.current += data;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushInput, 20);
    },
    [flushInput]
  );

  const connectToSSH = useCallback(
    async (term: any) => {
      cleanupSession();
      hasConnectedRef.current = true;
      setStatus("connecting");
      setErrorMsg(null);
      term.clear();
      term.writeln("\x1b[33mConnecting to SSH...\x1b[0m");

      try {
        const { cols, rows } = term;
        const res = await fetch(
          `/api/machines/${machineIdRef.current}/terminal`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cols, rows }),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create session");
        }

        const { sessionId } = await res.json();
        sessionIdRef.current = sessionId;

        // Connect SSE stream for output
        const es = new EventSource(
          `/api/machines/${machineIdRef.current}/terminal/stream?sessionId=${sessionId}`
        );
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "output" && msg.data) {
              const binary = atob(msg.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              term.write(bytes);
            } else if (msg.type === "connected") {
              setStatus("connected");
              term.focus();
            } else if (msg.type === "disconnect") {
              setStatus("disconnected");
              term.writeln("\r\n\x1b[33mSession ended.\x1b[0m");
              es.close();
              eventSourceRef.current = null;
            }
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          if (!mountedRef.current) return;
          es.close();
          eventSourceRef.current = null;
          setStatus((prev) => (prev === "connected" ? "disconnected" : prev));
          term.writeln("\r\n\x1b[31mConnection lost.\x1b[0m");
        };
      } catch (err: any) {
        if (!mountedRef.current) return;
        setErrorMsg(err.message);
        setStatus("error");
        term.writeln(`\x1b[31mConnection failed: ${err.message}\x1b[0m`);
      }
    },
    [cleanupSession]
  );

  // Initialize terminal and auto-connect
  useEffect(() => {
    mountedRef.current = true;
    let term: any = null;

    const init = async () => {
      if (!containerRef.current) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (!mountedRef.current || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: TERMINAL_MONO_STACK,
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          selectionBackground: "#264f78",
          black: "#484f58",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39c5cf",
          white: "#b1bac4",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#56d364",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#56d4dd",
          brightWhite: "#f0f6fc",
        },
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(containerRef.current);
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Send keystrokes to SSH session
      term.onData((data: string) => {
        queueInput(data);
      });

      // Show prompt to connect
      term.writeln("\x1b[90mPress 'Connect' to start an SSH session.\x1b[0m");
    };

    init();

    return () => {
      mountedRef.current = false;
      cleanupSession();
      term?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current) return;
      fitAddonRef.current.fit();
      const { cols, rows } = xtermRef.current;
      if (sessionIdRef.current) {
        fetch(`/api/machines/${machineIdRef.current}/terminal/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            cols,
            rows,
          }),
        }).catch(() => {});
      }
    };

    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, []);

  const handleReconnect = () => {
    if (xtermRef.current) {
      connectToSSH(xtermRef.current);
    }
  };

  const handleDisconnect = () => {
    cleanupSession();
    setStatus("disconnected");
    xtermRef.current?.writeln("\r\n\x1b[33mDisconnected.\x1b[0m");
  };

  const statusColor =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-orange-500";

  const statusText =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : status === "error"
          ? errorMsg || "Connection failed"
          : "Disconnected";

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(status === "disconnected" || status === "error") && (
            <Button size="sm" variant="outline" onClick={handleReconnect}>
              <RotateCcw className="h-3 w-3 mr-1" />
              {hasConnectedRef.current ? "Reconnect" : "Connect"}
            </Button>
          )}
          {status === "connecting" && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Connecting
            </Button>
          )}
          {status === "connected" && (
            <Button size="sm" variant="ghost" onClick={handleDisconnect}>
              <XCircle className="h-3 w-3 mr-1" />
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        onClick={() => xtermRef.current?.focus()}
        className="rounded-md overflow-hidden border border-border cursor-text"
        style={{ height: "400px", background: "#0d1117" }}
      />
    </div>
  );
}
