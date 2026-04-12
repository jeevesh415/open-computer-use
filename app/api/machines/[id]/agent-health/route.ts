import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import WebSocket from "ws";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

// GET /api/machines/[id]/agent-health - Quick ping to check if agent is responding
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ agentReady: false, error: "Database connection failed" }, { status: 500 });
    }

    const { id: machineId } = await params;

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ agentReady: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: machine, error: machineError } = await supabase
      .from("user_machines")
      .select("status, public_ip_address, settings")
      .eq("id", machineId)
      .eq("user_id", authData.user.id)
      .single();

    if (machineError || !machine) {
      return NextResponse.json({ agentReady: false, error: "Machine not found" }, { status: 404 });
    }

    const settings = machine.settings as any;

    // Electron machines: check connection status via backend instead of WebSocket ping
    if (settings?.provider === "electron") {
      try {
        const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001";
        const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
        const res = await fetch(
          `${PYTHON_BACKEND_URL}/api/electron/machines/${machineId}/health`,
          {
            headers: {
              "X-User-ID": authData.user.id,
              ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json({ agentReady: data.agentReady, isElectron: true });
        }
      } catch {
        // Fall through to not ready
      }
      return NextResponse.json({ agentReady: false, isElectron: true });
    }

    if (machine.status !== "running" || !machine.public_ip_address) {
      return NextResponse.json({ agentReady: false, reason: "not_running" });
    }

    const agentPort = settings?.agent_port || 8080;

    // Quick WebSocket ping — 3 second timeout
    const ready = await pingAgent(machine.public_ip_address, agentPort);

    return NextResponse.json({ agentReady: ready });
  } catch (error) {
    console.error("Error in GET /api/machines/[id]/agent-health:", error);
    return NextResponse.json({ agentReady: false, error: "Health check failed" }, { status: 500 });
  }
}

function pingAgent(ipAddress: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${ipAddress}:${port}`);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve(false);
      }
    }, 3000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "ping" }));
    });

    ws.on("message", (data: Buffer) => {
      if (settled) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pong") {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      } catch {
        // ignore non-JSON
      }
    });

    ws.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}
