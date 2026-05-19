export interface UserMachine {
  id: string;
  userId: string;
  containerName: string;
  displayName: string;
  status: MachineStatus;
  statusMessage?: string;
  
  // Azure details
  azureResourceGroup: string;
  azureContainerGroup: string;
  azureResourceId?: string;
  azureLocation: string;
  
  // Connection details
  publicIpAddress?: string;
  vncPassword: string;
  vncPort: number;
  websocketPort: number;
  aiAgentPort?: number; // Port for AI agent (typically 8080)
  sshPort?: number;
  
  // Resources
  cpuCores: number;
  memoryGb: number;
  storageGb: number;
  gpuEnabled: boolean;
  
  // Timestamps
  createdAt: string;
  startedAt?: string;
  lastActiveAt: string;
  autoShutdownAt?: string;
  autoShutdownMinutes: number;
  
  // Settings
  settings: MachineSettings;
}

export type MachineStatus = 
  | "creating"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "deleting";

export interface MachineSettings {
  theme?: "light" | "dark";
  resolution?: string;
  autoSave?: boolean;
  allowClipboardSync?: boolean;
  customSoftware?: string[];
  isLocal?: boolean;
  provider?: 'azure' | 'aws' | 'docker' | 'local' | 'electron';
  osType?: 'linux' | 'windows';
  // Electron machine metadata
  platform?: string;   // win32, darwin, linux
  hostname?: string;
  username?: string;
  ports?: {
    vnc?: number;
    websocket?: number;
    agent?: number;
  };
  // AWS-specific
  awsInstanceId?: string;
  awsRegion?: string;
  awsKeyPairName?: string;
  awsSecurityGroupId?: string;
  sshPrivateKey?: string;
  sshUsername?: string;
  awsInstanceType?: string;
  desktopEnabled?: boolean;
  desktopInitStatus?: 'installing' | 'ready' | 'failed';
  // Snapshot restore
  restoredFromSnapshot?: string;
  restoredAt?: string;
  // Agent email identity (WorkMail)
  email_identity?: {
    email: string;
    password: string;
    workmailUserId: string;
  };
}

export interface MachineSession {
  id: string;
  machineId: string;
  userId: string;
  sessionType: SessionType;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  actionsPerformed: AIAction[];
  screenshotsCaptured: number;
  commandsExecuted: number;
  errorsEncountered: number;
  aiModel?: string;
  aiObjective?: string;
  aiCompletionStatus?: AICompletionStatus;
}

export type SessionType = "user_controlled";
export type AICompletionStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface MachineLimits {
  userId: string;
  tier: UserTier;
  maxMachines: number;
  maxRunningMachines: number;
  maxCpuCores: number;
  maxMemoryGb: number;
  maxStorageGb: number;
  gpuAccess: boolean;
  maxHoursPerMonth: number;
  maxSessionsPerDay: number;
  allowInternetAccess: boolean;
  allowedDomains: string[];
  allowPersistence: boolean;
  allowSnapshots: boolean;
  allowCustomSoftware: boolean;
  updatedAt: string;
}

/**
 * Canonical subscription tier vocabulary.
 * See supabase/migrations/011_unify_tier_vocabulary.sql and
 * supabase/migrations/017_add_unlimited_tier.sql (adds 'unlimited').
 * Display names: lite=Lite, starter=Starter, professional=Plus,
 * unlimited=Unlimited, enterprise=Pro.
 */
export type UserTier =
  | "free"
  | "lite"
  | "starter"
  | "professional"
  | "unlimited"
  | "enterprise";

/** Tiers eligible for API access (lite folds into free). */
export const API_ELIGIBLE_TIERS = ["starter", "professional", "unlimited", "enterprise"] as const;

/** Tiers eligible for persistent swarm machines. */
export const PERSISTENT_SWARM_TIERS = ["starter", "professional", "unlimited", "enterprise"] as const;

export interface MachineUsage {
  id: string;
  userId: string;
  machineId: string;
  periodStart: string;
  periodEnd: string;
  cpuSeconds: number;
  memoryGbSeconds: number;
  storageGbHours: number;
  networkGbTransferred: number;
  estimatedCost: number;
}

export interface MachineSnapshot {
  id: string;
  machineId: string;
  userId: string;
  snapshotName: string;
  snapshotType: "manual" | "auto" | "pre_shutdown";
  storageLocation: string;
  sizeGb: number;
  osState: Record<string, any>;
  installedSoftware: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface AIAction {
  id: string;
  sessionId: string;
  machineId: string;
  actionType: AIActionType;
  actionTarget?: string;
  actionParameters: Record<string, any>;
  executedAt: string;
  executionTimeMs: number;
  success: boolean;
  errorMessage?: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  aiReasoning?: string;
}

export type AIActionType = 
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "key_press"
  | "key_combo"
  | "drag"
  | "scroll"
  | "open_application"
  | "close_window"
  | "switch_window"
  | "take_screenshot"
  | "wait"
  | "execute_command";

// API Request/Response types
export interface CreateMachineRequest {
  displayName: string;
  provider?: 'azure' | 'aws';
  osType?: 'linux' | 'windows';
  cpuCores?: number;
  memoryGb?: number;
  storageGb?: number;
  desktopEnabled?: boolean;
  restoreFromSnapshot?: boolean;
}

export interface CreateMachineResponse {
  machine: UserMachine;
  connectionDetails: {
    vncUrl?: string;
    websocketUrl?: string;
    password?: string;
    sshHost?: string;
    sshPort?: number;
    sshUsername?: string;
    sshPrivateKey?: string;
  };
}

export interface MachineActionRequest {
  action: "start" | "stop" | "restart" | "delete" | "snapshot";
}

export interface StartSessionRequest {
  machineId: string;
  sessionType: SessionType;
  aiObjective?: string;
  aiModel?: string;
}

export interface ExecuteAICommandRequest {
  sessionId: string;
  command: string;
  context?: string;
  screenshot?: boolean;
}

export interface ExecuteAICommandResponse {
  success: boolean;
  actions: AIAction[];
  result?: string;
  screenshot?: string;
  error?: string;
}

// WebSocket message types
export interface VNCWebSocketMessage {
  type: "auth" | "framebuffer" | "input" | "clipboard" | "resize";
  data: any;
}

export interface AIAgentMessage {
  type: "command" | "status" | "result" | "error" | "screenshot";
  sessionId: string;
  data: any;
}