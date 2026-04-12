export interface UserSecret {
  id: string
  name: string
  service: string
  username: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface UserSecretWithPassword extends UserSecret {
  password: string
}

export interface CreateSecretRequest {
  name: string
  service: string
  username: string
  password: string
  notes?: string
}

export interface UpdateSecretRequest {
  name?: string
  service?: string
  username?: string
  password?: string
  notes?: string
}

export type ImportPlatform = "chrome" | "firefox" | "1password" | "bitwarden" | "lastpass" | "keepass"

export interface ParsedCredential {
  name: string
  service: string
  username: string
  password: string
  notes: string
  valid: boolean
  error?: string
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}
