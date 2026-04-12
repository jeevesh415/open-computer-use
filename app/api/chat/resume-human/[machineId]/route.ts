import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyBearerToken } from '@/lib/supabase/bearer-auth';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    // Authenticate user — try cookies first (web), then Bearer token (Electron)
    let userId: string | null = null;

    const supabase = await createClient();
    if (supabase) {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && authData?.user) {
        userId = authData.user.id;
      }
    }

    // Fallback: Bearer token auth (Electron desktop app)
    if (!userId) {
      const bearer = await verifyBearerToken(req);
      if (bearer.user) {
        userId = bearer.user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { machineId } = await params;

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/chat/resume-human/${machineId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId,
          ...(INTERNAL_API_KEY && { 'X-Internal-Key': INTERNAL_API_KEY }),
        },
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error resuming from human:', error);
    return NextResponse.json({ error: 'Failed to resume agent execution' }, { status: 500 });
  }
}
