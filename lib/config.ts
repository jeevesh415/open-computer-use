import {
  FileText,
  Code2,
  Search,
  PenTool,
  Wrench,
  GraduationCap,
} from "lucide-react"

export const AUTH_DAILY_MESSAGE_LIMIT = 100
export const REMAINING_QUERY_ALERT_THRESHOLD = 3
export const DAILY_FILE_UPLOAD_LIMIT = 5
export const DAILY_LIMIT_PRO_MODELS = 100

export const NON_AUTH_ALLOWED_MODELS = ["amazon.nova-lite-v1:0"]

export const FREE_MODELS_IDS = [
  "amazon.nova-lite-v1:0",
]

// Model is controlled by backend BEDROCK_DEFAULT_MODEL env var.
// This value is only used as a placeholder ID for the frontend request.
export const MODEL_DEFAULT = "bedrock-default"

export const APP_NAME = "Coasty"
export const APP_DOMAIN = "https://coasty.ai"

// Suggestion category keys — labels/highlights come from i18n ("suggestions" namespace)
// Items (prompts) are kept in English since they're sent to the AI model
export const SUGGESTION_KEYS = ["summary", "code", "research", "create", "solve", "learn"] as const

export const SUGGESTIONS_DATA = [
  {
    key: "summary" as const,
    prompt: `Summarize`,
    items: [
      "Find and summarize today's top AI breakthroughs with sources",
      "Search for and summarize this week's major tech acquisitions",
      "Get the latest EV market data and summarize key trends",
      "Research and summarize current climate policy changes globally",
    ],
    icon: FileText,
  },
  {
    key: "code" as const,
    prompt: `Build`,
    items: [
      "Build a React component for infinite scroll with TypeScript",
      "Create a Python FastAPI endpoint with authentication",
      "Write a SQL query to analyze user engagement metrics",
      "Implement a debounce function in JavaScript with examples",
    ],
    icon: Code2,
  },
  {
    key: "research" as const,
    prompt: `Analyze`,
    items: [
      "Search and analyze 2025 travel trends with data and statistics",
      "Find and compare top 5 programming frameworks released this year",
      "Research latest AI regulations and analyze their impact",
      "Investigate renewable energy costs vs fossil fuels with current data",
    ],
    icon: Search,
  },
  {
    key: "create" as const,
    prompt: `Generate`,
    items: [
      "Generate a marketing strategy for a SaaS startup in 2025",
      "Create a comprehensive project plan for mobile app development",
      "Design a color scheme and typography for modern web app",
      "Build a content calendar for tech blog with trending topics",
    ],
    icon: PenTool,
  },
  {
    key: "solve" as const,
    prompt: `Debug`,
    items: [
      "Debug this React useEffect infinite loop issue",
      "Fix Python async function not awaiting properly",
      "Resolve CORS error in Next.js API route",
      "Troubleshoot Docker container networking problem",
    ],
    icon: Wrench,
  },
  {
    key: "learn" as const,
    prompt: `Explain`,
    items: [
      "Explain transformers in AI with visual examples",
      "Break down microservices vs monolithic architecture",
      "Clarify WebSockets vs Server-Sent Events with use cases",
      "Compare SQL vs NoSQL databases with decision matrix",
    ],
    icon: GraduationCap,
  },
]

// Legacy export for backward compatibility — consumers should migrate to SUGGESTIONS_DATA + useTranslations("suggestions")
export const SUGGESTIONS = SUGGESTIONS_DATA.map(s => ({
  label: s.key.charAt(0).toUpperCase() + s.key.slice(1),
  highlight: s.prompt,
  prompt: s.prompt,
  items: s.items,
  icon: s.icon,
}))

// Import centralized system prompts
import { getSystemPromptDefault } from "./prompts/system-prompts";

// Legacy export for backward compatibility - will dynamically generate
export const SYSTEM_PROMPT_DEFAULT = getSystemPromptDefault();

export const MESSAGE_MAX_LENGTH = 10000
