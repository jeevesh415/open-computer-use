import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { WebSocket, WebSocketServer } from "ws";
import net from "net";
import { verifySecureToken } from "@/lib/utils/encryption";

// This is a WebSocket endpoint for VNC proxy
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: machineId } = await params;
  
  // Verify WebSocket upgrade request
  const upgrade = request.headers.get("upgrade");
  if (upgrade !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  try {
    // Extract token from query params
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    
    if (!token) {
      return new Response("Missing authentication token", { status: 401 });
    }

    // Verify token cryptographically (HMAC-SHA256 signed JWT)
    let tokenData: { userId: string; sessionId: string; machineId: string };
    try {
      tokenData = verifySecureToken(token);
    } catch {
      return new Response("Invalid or expired token", { status: 401 });
    }

    // Ensure the token was issued for this specific machine
    if (tokenData.machineId !== machineId) {
      return new Response("Token not valid for this machine", { status: 403 });
    }

    // Get machine details
    const supabase = await createClient();
    if (!supabase) {
      return new Response("Database connection failed", { status: 500 });
    }
    const { data: machine, error: machineError } = await supabase
      .from("user_machines")
      .select("*")
      .eq("id", machineId)
      .eq("user_id", tokenData.userId)
      .single();

    if (machineError || !machine) {
      return new Response("Machine not found", { status: 404 });
    }

    if (machine.status !== "running") {
      return new Response("Machine not running", { status: 400 });
    }

    // Verify active session
    const { data: session } = await supabase
      .from("machine_sessions")
      .select("*")
      .eq("id", tokenData.sessionId)
      .eq("machine_id", machineId)
      .is("ended_at", null)
      .single();

    if (!session) {
      return new Response("No active session", { status: 403 });
    }

    // Create WebSocket proxy to VNC server
    const vncHost = machine.public_ip_address;
    const vncPort = machine.vnc_port;

    // This would be handled by a WebSocket server implementation
    // For Next.js, we need to use a custom server or API route handler
    // This is a simplified example - in production, use a proper WebSocket server

    return new Response(
      JSON.stringify({
        message: "WebSocket proxy would be established here",
        vncHost,
        vncPort,
        note: "Implement with custom server or Edge Runtime WebSocket support",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in VNC WebSocket handler:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

// Note: For production implementation, you would need:
// 1. A custom Node.js server with WebSocket support
// 2. Or use Next.js custom server
// 3. Or deploy a separate WebSocket proxy service
// 
// Example implementation with custom server:
/*
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import net from "net";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    const url = parse(req.url!, true);
    
    if (url.pathname?.startsWith("/api/machines/") && url.pathname.endsWith("/vnc")) {
      // Handle VNC proxy
      const machineId = extractMachineId(url.pathname);
      const token = url.query.token as string;
      
      // Verify token and get machine details...
      
      // Create TCP connection to VNC server
      const vncSocket = net.connect({
        host: vncHost,
        port: vncPort,
      });

      // Proxy data between WebSocket and VNC
      ws.on("message", (data) => {
        vncSocket.write(data);
      });

      vncSocket.on("data", (data) => {
        ws.send(data);
      });

      // Handle disconnections
      ws.on("close", () => {
        vncSocket.end();
      });

      vncSocket.on("close", () => {
        ws.close();
      });

      // Handle errors
      ws.on("error", console.error);
      vncSocket.on("error", console.error);
    }
  });

  server.listen(3000, () => {
    console.log("> Ready on http://localhost:3000");
  });
});
*/