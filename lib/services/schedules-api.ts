/**
 * Frontend API client for employee scheduling.
 *
 * Calls the Next.js proxy routes which forward to the Python backend.
 *
 * # Error handling
 *
 * All non-OK responses go through `sanitizeBackendError` so the UI sees
 * a user-friendly message rather than backend internals (header names,
 * middleware names, exception class names).  This was the fix for the
 * "CSRF token missing" string showing up in the schedule dialog.  See
 * `lib/services/error-passthrough.ts` for the full rationale.
 */

import { sanitizeBackendError, type SanitizeOptions } from "./error-passthrough"

export interface ScheduleConfig {
  frequency: string
  cron?: string
  timezone: string
  machineId: string
  time?: string
  dayOfWeek?: number
  dayOfMonth?: number
  taskPrompt?: string
}

export interface TriggerConfig {
  id?: string
  target_chat_id: string
  event: 'on_complete' | 'on_failure' | 'on_any'
  pass_output: boolean
  enabled: boolean
}

export interface ScheduleResponse {
  chat_id: string
  title: string | null
  enabled: boolean
  frequency: string
  cron: string
  timezone: string
  machine_id: string
  last_run_at: string | null
  next_run_at: string | null
  consecutive_failures: number
  paused_reason: string | null
  run_count: number
  created_at: string | null
  task_prompt: string | null
  triggers: TriggerConfig[] | null
  team_hub_id: string | null
  last_output_summary: string | null
}

export interface TeamMember {
  chat_id: string
  title: string
  added_at: string
}

export interface TeamResponse {
  hub_id: string
  name: string
  instructions: string | null
  members: TeamMember[]
  shared_memory_keys: string[]
  created_at: string
}

export interface SharedMemoryEntry {
  key: string
  value: string
  written_by: string
  updated_at: string
}

export interface ScheduleHistoryEntry {
  id: string
  chat_id: string
  status: string
  trigger: string
  duration_seconds: number | null
  credits_charged: number | null
  error: string | null
  executed_at: string
}

export interface DelegateConfig {
  chat_id: string
  title: string
  role: string
  added_at?: string
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  sanitize: SanitizeOptions = {},
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    // Always sanitize: even when the backend message looks user-friendly
    // it can carry middleware names ("CSRF token missing") that confuse
    // users and brittle-couple the UI to backend internals.  The helper
    // logs the raw body to console.error so engineers can still debug.
    throw await sanitizeBackendError(res, sanitize)
  }

  return res
}

export async function createSchedule(
  chatId: string,
  config: ScheduleConfig
): Promise<ScheduleResponse> {
  const res = await fetchWithAuth(
    `/api/schedules/${chatId}`,
    { method: 'POST', body: JSON.stringify(config) },
    {
      action: "create the schedule",
      404: "Couldn't find the chat to schedule.",
      // No 403 override here: the allowlist passthrough catches the
      // genuinely user-friendly 403 cases ("Schedule limit reached",
      // "Insufficient credits") so the user sees the actionable
      // billing message.  Unsafe 403s ("CSRF token missing") fall
      // through to the status-coded default, which is what we want.
      passthroughIfSafe: true,
    },
  )
  const data = await res.json()
  return data.schedule
}

export async function getSchedule(
  chatId: string
): Promise<ScheduleResponse | null> {
  const res = await fetchWithAuth(`/api/schedules/${chatId}`, {}, {
    action: "load the schedule",
  })
  const data = await res.json()
  return data.schedule ?? null
}

export async function deleteSchedule(chatId: string): Promise<void> {
  await fetchWithAuth(
    `/api/schedules/${chatId}`,
    { method: 'DELETE' },
    {
      // The bug case.  Status-specific overrides keep the message
      // recoverable and friendly even when the backend returns a
      // 403 with "CSRF token missing" (the symptom this whole audit
      // exists to prevent from ever reaching the UI again).
      action: "remove the schedule",
      403: "Couldn't remove the schedule. Please refresh the page and try again.",
      404: "This schedule no longer exists.",
    },
  )
}

export async function listSchedules(): Promise<ScheduleResponse[]> {
  const res = await fetchWithAuth('/api/schedules')
  const data = await res.json()
  return data.schedules ?? []
}

export async function getScheduleHistory(
  chatId?: string,
  limit = 50
): Promise<ScheduleHistoryEntry[]> {
  const params = new URLSearchParams()
  params.set('history', 'true')
  if (chatId) params.set('chatId', chatId)
  params.set('limit', String(limit))

  const res = await fetchWithAuth(`/api/schedules?${params}`)
  const data = await res.json()
  return data.history ?? []
}

export async function triggerScheduleNow(chatId: string): Promise<void> {
  await fetchWithAuth(
    `/api/schedules/${chatId}?action=run-now`,
    { method: 'POST' },
    {
      action: "run the schedule",
      // 409 = "already running" — surface that as the actual conflict.
      409: "This schedule is already running. Wait for it to finish.",
      passthroughIfSafe: true,
    },
  )
}

export async function pauseSchedule(chatId: string): Promise<{ enabled: boolean }> {
  const res = await fetchWithAuth(
    `/api/schedules/${chatId}?action=pause`,
    { method: 'PATCH' },
    {
      action: "pause the schedule",
      404: "This schedule no longer exists.",
    },
  )
  const data = await res.json()
  return { enabled: data.enabled }
}

export const FREQUENCY_OPTIONS = [
  { value: 'every_15_minutes', label: 'Every 15 minutes' },
  { value: 'every_30_minutes', label: 'Every 30 minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'every_6_hours', label: 'Every 6 hours' },
  { value: 'every_12_hours', label: 'Every 12 hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom (cron)' },
] as const

export function formatFrequency(frequency: string): string {
  const opt = FREQUENCY_OPTIONS.find((o) => o.value === frequency)
  return opt?.label ?? frequency
}

export function formatNextRun(nextRunAt: string | null): string {
  if (!nextRunAt) return 'Not assigned'
  const d = new Date(nextRunAt)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()

  if (diffMs < 0) return 'Overdue'
  if (diffMs < 60_000) return 'Less than a minute'
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)} minutes`
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)} hours`
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Triggers ───

export async function updateTriggers(
  chatId: string,
  triggers: TriggerConfig[]
): Promise<TriggerConfig[]> {
  const res = await fetchWithAuth(`/api/schedules/${chatId}`, {
    method: 'PUT',
    body: JSON.stringify({ triggers }),
  })
  const data = await res.json()
  return data.triggers ?? []
}

// ─── Delegates ───

export async function getDelegates(chatId: string): Promise<DelegateConfig[]> {
  const res = await fetchWithAuth(`/api/schedules/${chatId}/delegates`)
  const data = await res.json()
  return data.delegates ?? []
}

export async function updateDelegates(
  chatId: string,
  delegates: DelegateConfig[]
): Promise<DelegateConfig[]> {
  const res = await fetchWithAuth(`/api/schedules/${chatId}/delegates`, {
    method: 'PUT',
    body: JSON.stringify({ delegates }),
  })
  const data = await res.json()
  return data.delegates ?? []
}

// ─── Teams ───

export async function createTeam(
  name: string,
  instructions?: string,
  memberChatIds?: string[]
): Promise<TeamResponse> {
  const res = await fetchWithAuth('/api/schedules/teams/create', {
    method: 'POST',
    body: JSON.stringify({
      name,
      instructions: instructions || '',
      member_chat_ids: memberChatIds || [],
    }),
  })
  const data = await res.json()
  return data.team
}

export async function listTeams(): Promise<TeamResponse[]> {
  const res = await fetchWithAuth('/api/schedules/teams/list')
  const data = await res.json()
  return data.teams ?? []
}

export async function getTeam(hubId: string): Promise<TeamResponse> {
  const res = await fetchWithAuth(`/api/schedules/teams/${hubId}`)
  const data = await res.json()
  return data.team
}

export async function updateTeam(
  hubId: string,
  updates: { name?: string; instructions?: string }
): Promise<void> {
  await fetchWithAuth(`/api/schedules/teams/${hubId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteTeam(hubId: string): Promise<void> {
  await fetchWithAuth(`/api/schedules/teams/${hubId}`, { method: 'DELETE' })
}

export async function addTeamMember(
  hubId: string,
  chatId: string
): Promise<void> {
  await fetchWithAuth(
    `/api/schedules/teams/${hubId}/members?chat_id=${chatId}`,
    { method: 'POST' }
  )
}

export async function removeTeamMember(
  hubId: string,
  chatId: string
): Promise<void> {
  await fetchWithAuth(
    `/api/schedules/teams/${hubId}/members?chat_id=${chatId}`,
    { method: 'DELETE' }
  )
}

export async function getTeamSharedMemory(
  hubId: string
): Promise<SharedMemoryEntry[]> {
  const res = await fetchWithAuth(`/api/schedules/teams/${hubId}/memory`)
  const data = await res.json()
  return data.memory ?? []
}
