/**
 * Next.js proxy for per-chat schedule CRUD and actions.
 *
 * POST   /api/schedules/:chatId          → Create/update schedule
 * GET    /api/schedules/:chatId          → Get schedule
 * DELETE /api/schedules/:chatId          → Delete schedule
 * POST   /api/schedules/:chatId?action=run-now  → Trigger immediate run
 * PATCH  /api/schedules/:chatId?action=pause    → Pause/resume
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

// UUID v4 format — reject anything else to prevent path traversal
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) return null
  return data.user.id
}

/** Verify the authenticated user owns the chat. */
async function verifyChatOwnership(
  chatId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient()
  if (!supabase) return false
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .single()
  return !error && !!data
}

function buildHeaders(userId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-ID': userId,
  }
  if (INTERNAL_API_KEY) {
    headers['X-Internal-Key'] = INTERNAL_API_KEY
  }
  return headers
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const userId = await getAuthUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId } = await params
    if (!UUID_RE.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat ID' }, { status: 400 })
    }
    if (!(await verifyChatOwnership(chatId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/schedules/${chatId}`,
      { method: 'GET', headers: buildHeaders(userId) }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Get schedule error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const userId = await getAuthUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId } = await params
    if (!UUID_RE.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat ID' }, { status: 400 })
    }
    if (!(await verifyChatOwnership(chatId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    let backendUrl: string
    let body: string | undefined

    if (action === 'run-now') {
      backendUrl = `${PYTHON_BACKEND_URL}/api/schedules/${chatId}/run-now`
    } else {
      backendUrl = `${PYTHON_BACKEND_URL}/api/schedules/${chatId}`
      body = JSON.stringify(await req.json())
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: buildHeaders(userId),
      body,
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Create schedule error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const userId = await getAuthUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId } = await params
    if (!UUID_RE.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat ID' }, { status: 400 })
    }
    if (!(await verifyChatOwnership(chatId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/schedules/${chatId}`,
      { method: 'DELETE', headers: buildHeaders(userId) }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Delete schedule error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const userId = await getAuthUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId } = await params
    if (!UUID_RE.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat ID' }, { status: 400 })
    }
    if (!(await verifyChatOwnership(chatId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/schedules/${chatId}/pause`,
      { method: 'PATCH', headers: buildHeaders(userId) }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Toggle pause error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const userId = await getAuthUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId } = await params
    if (!UUID_RE.test(chatId)) {
      return NextResponse.json({ error: 'Invalid chat ID' }, { status: 400 })
    }
    if (!(await verifyChatOwnership(chatId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = JSON.stringify(await req.json())

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/schedules/${chatId}/triggers`,
      { method: 'PUT', headers: buildHeaders(userId), body }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Update triggers error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
