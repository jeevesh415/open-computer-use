import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyBearerToken } from '@/lib/supabase/bearer-auth';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    // Authenticate user — try cookies first (web), then Bearer token (Electron).
    // The Electron desktop app sends `Authorization: Bearer <supabase_jwt>`
    // because it doesn't have access to the browser's cookie jar. Without
    // the Bearer fallback, every machine-status call from Electron 401s
    // and the yellow "Override & Run" pre-check silently fails (the user
    // never sees the busy-state UI even when the backend already knows the
    // machine is busy).
    let userId: string | null = null;

    const supabase = await createClient();
    if (supabase) {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && authData?.user) {
        userId = authData.user.id;
      }
    }

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
      `${PYTHON_BACKEND_URL}/api/chat/machine-status/${machineId}`,
      {
        method: 'GET',
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
    console.error('Error checking machine status:', error);
    return NextResponse.json({ error: 'Failed to check machine status' }, { status: 500 });
  }
}
