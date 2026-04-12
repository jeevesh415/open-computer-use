import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/electron/machines/[id]/approvals — list pending approval requests
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ approvals: [] }, { status: 500 });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ approvals: [] }, { status: 401 });
    }

    const { id: machineId } = await params;

    const res = await fetch(`${PYTHON_BACKEND_URL}/api/electron/machines/${machineId}/approvals`, {
      headers: {
        "X-User-ID": authData.user.id,
        ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ approvals: [] }, { status: 500 });
  }
}
