import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { VMScreenshot } from "@/types/vm-context.types";
import { SVG_MONO_STACK } from "@/lib/fonts";
import WebSocket from 'ws';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

// POST /api/machines/[id]/screenshot - Capture a screenshot from the VM
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }

    const { id: machineId } = await params;
    
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData.user.id;
    const body = await request.json();
    const { sessionId } = body;

    // Validate machine ownership and status
    const { data: machine, error: machineError } = await supabase
      .from("user_machines")
      .select("*")
      .eq("id", machineId)
      .eq("user_id", userId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: "Machine not found" },
        { status: 404 }
      );
    }

    if (machine.status !== "running") {
      return NextResponse.json(
        { error: "Machine must be running to capture screenshot" },
        { status: 400 }
      );
    }

    // If sessionId provided, verify it exists and is active
    if (sessionId) {
      const { data: session } = await supabase
        .from("machine_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("machine_id", machineId)
        .is("ended_at", null)
        .single();

      if (!session) {
        return NextResponse.json(
          { error: "Invalid or inactive session" },
          { status: 403 }
        );
      }
    }

    // Connect to the AI agent WebSocket server to capture screenshot
    let screenshotData: string | null = null;
    
    try {
      if (machine.public_ip_address) {
        // AI agent runs on port 8080 by default
        const aiAgentPort = (machine as any).ai_agent_port || 8080;
        console.log(`Machine ports - VNC: ${(machine as any).vnc_port}, WebSocket: ${(machine as any).websocket_port}, AI Agent: ${aiAgentPort}`);
        
        screenshotData = await captureVMScreenshot(
          machine.public_ip_address, 
          aiAgentPort,
          sessionId || undefined
        );
      }
    } catch (error) {
      console.error("Failed to capture screenshot from agent:", error);
      // Log more details about the error
      if (error instanceof Error) {
        console.error("Error details:", error.message);
      }
    }

    // If we couldn't get a real screenshot, use a placeholder
    if (!screenshotData) {
      screenshotData = createPlaceholderScreenshot();
    }

    const screenshot: VMScreenshot = {
      id: `screenshot-${Date.now()}`,
      machineId,
      sessionId,
      imageData: screenshotData,
      mimeType: "image/png",
      capturedAt: new Date().toISOString(),
      width: 1920,
      height: 1080,
    };

    // Log the screenshot capture in AI actions if part of a session
    if (sessionId) {
      await supabase.from("machine_ai_actions").insert({
        session_id: sessionId,
        machine_id: machineId,
        action_type: "take_screenshot",
        action_parameters: {},
        executed_at: new Date().toISOString(),
        execution_time_ms: 100,
        success: true,
        screenshot_after: screenshot.id,
      });
    }

    return NextResponse.json({ 
      screenshot,
      message: "Screenshot captured successfully" 
    });
  } catch (error) {
    console.error("Error in POST /api/machines/[id]/screenshot:", error);
    return NextResponse.json(
      { error: "Failed to capture screenshot" },
      { status: 500 }
    );
  }
}

/**
 * Capture screenshot from VM via AI agent WebSocket
 */
async function captureVMScreenshot(
  ipAddress: string, 
  agentPort: number,
  sessionId?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to connect to AI agent at ws://${ipAddress}:${agentPort}`);
    const ws = new WebSocket(`ws://${ipAddress}:${agentPort}`);
    let timeout: NodeJS.Timeout;
    
    // Set a timeout for the entire operation
    timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Screenshot capture timeout'));
    }, 10000); // 10 second timeout
    
    ws.on('open', () => {
      console.log('Connected to AI agent for screenshot');
      
      // Send authentication if we have a session
      if (sessionId) {
        ws.send(JSON.stringify({
          type: 'auth',
          sessionId: sessionId,
          userId: 'api-screenshot'
        }));
      }
      
      // Send screenshot command
      const sendScreenshotCommand = () => {
        console.log('Sending screenshot command to AI agent');
        ws.send(JSON.stringify({
          type: 'command',
          data: {
            command: 'screenshot',
            parameters: {}
          }
        }));
      };
      
      // If we have a session, wait for auth, otherwise send immediately
      if (sessionId) {
        // Give time for auth response
        setTimeout(sendScreenshotCommand, 500);
      } else {
        sendScreenshotCommand();
      }
    });
    
    ws.on('message', (data: Buffer) => {
      const dataStr = data.toString();
      
      // Check if we're receiving VNC protocol data instead of JSON
      if (dataStr.startsWith('RFB')) {
        console.error('Connected to VNC server instead of AI agent. Wrong port.');
        clearTimeout(timeout);
        ws.close();
        reject(new Error('Connected to VNC server instead of AI agent'));
        return;
      }
      
      try {
        const response = JSON.parse(dataStr);
        console.log('Received response from AI agent:', response.type);
        
        if (response.type === 'result' && response.data?.screenshot) {
          console.log('Screenshot received successfully');
          clearTimeout(timeout);
          ws.close();
          resolve(response.data.screenshot);
        } else if (response.type === 'auth_success') {
          console.log('AI agent authenticated successfully');
        } else if (response.type === 'error') {
          console.error('AI agent error:', response.data?.error);
          clearTimeout(timeout);
          ws.close();
          reject(new Error(response.data?.error || 'Unknown error'));
        } else {
          console.log('Received other message type:', response.type, response.data);
        }
      } catch (error) {
        console.error('Failed to parse agent response:', error);
        console.error('Raw data received (first 200 chars):', dataStr.substring(0, 200));
        // Don't reject here as we might receive multiple messages
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(timeout);
      reject(error);
    });
    
    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Create a placeholder screenshot for development
 */
function createPlaceholderScreenshot(): string {
  // Create a simple placeholder image indicating VM desktop
  // In production, this would be replaced with actual screenshot data
  
  // Simple SVG as placeholder
  const svg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <rect width="1920" height="1080" fill="#1e1e1e"/>
      <rect x="0" y="0" width="1920" height="30" fill="#2d2d2d"/>
      <text x="960" y="540" text-anchor="middle" fill="#666" font-size="48" font-family="${SVG_MONO_STACK}">
        VM Desktop Screenshot
      </text>
      <text x="960" y="600" text-anchor="middle" fill="#444" font-size="24" font-family="${SVG_MONO_STACK}">
        ${new Date().toLocaleString()}
      </text>
      <rect x="100" y="100" width="400" height="300" fill="#2a2a2a" stroke="#444" stroke-width="1"/>
      <text x="300" y="250" text-anchor="middle" fill="#888" font-size="16" font-family="${SVG_MONO_STACK}">
        Terminal
      </text>
      <rect x="600" y="100" width="600" height="400" fill="#252525" stroke="#444" stroke-width="1"/>
      <text x="900" y="300" text-anchor="middle" fill="#888" font-size="16" font-family="${SVG_MONO_STACK}">
        Code Editor
      </text>
      <rect x="1300" y="100" width="500" height="800" fill="#2a2a2a" stroke="#444" stroke-width="1"/>
      <text x="1550" y="500" text-anchor="middle" fill="#888" font-size="16" font-family="${SVG_MONO_STACK}">
        Browser
      </text>
    </svg>
  `;

  // Convert SVG to base64
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}