export type LayoutType = "sidebar" | "fullscreen"

export type ChatBackground =
  | "none"
  | "constellation"
  | "aurora"
  | "isometric"
  | "dotmatrix"
  | "seigaiha"
  | "blueprint"
  | "zellige"
  | "sashiko"
  | "kolam"
  | "celtic"
  | "arabesque"
  | "kente"
  | "mayan"
  | "scandinavian"
  | "paisley"
  | "batik"

export type UserPreferences = {
  layout: LayoutType
  chatBackground: ChatBackground
  promptSuggestions: boolean
  showToolInvocations: boolean
  showConversationPreviews: boolean
  multiModelEnabled: boolean
  hiddenModels: string[]
}

export const defaultPreferences: UserPreferences = {
  layout: "sidebar",
  chatBackground: "aurora",
  promptSuggestions: true,
  showToolInvocations: true,
  showConversationPreviews: true,
  multiModelEnabled: false,
  hiddenModels: [],
}

// Helper functions to convert between API format (snake_case) and frontend format (camelCase)
export function convertFromApiFormat(apiData: any): UserPreferences {
  return {
    layout: apiData.layout || "fullscreen",
    chatBackground: apiData.chat_background || "aurora",
    promptSuggestions: apiData.prompt_suggestions ?? true,
    showToolInvocations: apiData.show_tool_invocations ?? true,
    showConversationPreviews: apiData.show_conversation_previews ?? true,
    multiModelEnabled: apiData.multi_model_enabled ?? false,
    hiddenModels: apiData.hidden_models || [],
  }
}

export function convertToApiFormat(preferences: Partial<UserPreferences>) {
  const apiData: any = {}
  if (preferences.layout !== undefined) apiData.layout = preferences.layout
  if (preferences.chatBackground !== undefined)
    apiData.chat_background = preferences.chatBackground
  if (preferences.promptSuggestions !== undefined)
    apiData.prompt_suggestions = preferences.promptSuggestions
  if (preferences.showToolInvocations !== undefined)
    apiData.show_tool_invocations = preferences.showToolInvocations
  if (preferences.showConversationPreviews !== undefined)
    apiData.show_conversation_previews = preferences.showConversationPreviews
  if (preferences.multiModelEnabled !== undefined)
    apiData.multi_model_enabled = preferences.multiModelEnabled
  if (preferences.hiddenModels !== undefined)
    apiData.hidden_models = preferences.hiddenModels
  return apiData
}
