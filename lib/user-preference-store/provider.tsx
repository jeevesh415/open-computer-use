"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, ReactNode, useContext, useEffect, useState } from "react"
import {
  convertFromApiFormat,
  convertToApiFormat,
  defaultPreferences,
  type ChatBackground,
  type LayoutType,
  type SidebarStyle,
  type UserPreferences,
} from "./utils"

export {
  type ChatBackground,
  type LayoutType,
  type SidebarStyle,
  type UserPreferences,
  convertFromApiFormat,
  convertToApiFormat,
}

const PREFERENCES_STORAGE_KEY = "user-preferences"
const LAYOUT_STORAGE_KEY = "preferred-layout"

interface UserPreferencesContextType {
  preferences: UserPreferences
  setLayout: (layout: LayoutType) => void
  setSidebarStyle: (style: SidebarStyle) => void
  setChatBackground: (background: ChatBackground) => void
  setPromptSuggestions: (enabled: boolean) => void
  setShowToolInvocations: (enabled: boolean) => void
  setShowConversationPreviews: (enabled: boolean) => void
  setMultiModelEnabled: (enabled: boolean) => void
  toggleModelVisibility: (modelId: string) => void
  isModelHidden: (modelId: string) => boolean
  isLoading: boolean
}

const UserPreferencesContext = createContext<
  UserPreferencesContextType | undefined
>(undefined)

async function fetchUserPreferences(): Promise<UserPreferences> {
  const response = await fetch("/api/user-preferences")
  if (!response.ok) {
    throw new Error("Failed to fetch user preferences")
  }
  const data = await response.json()
  const fromApi = convertFromApiFormat(data)

  // sidebarStyle is client-only — DB schema doesn't have a column for it.
  // Hydrate from localStorage so the user's choice survives across reloads
  // and across React Query refetches that would otherwise reset it.
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.sidebarStyle === "horizontal" || parsed?.sidebarStyle === "vertical") {
          fromApi.sidebarStyle = parsed.sidebarStyle
        }
      }
    } catch {
      // ignore — fall back to default
    }
  }

  return fromApi
}

async function updateUserPreferences(
  update: Partial<UserPreferences>
): Promise<UserPreferences> {
  const response = await fetch("/api/user-preferences", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(convertToApiFormat(update)),
  })

  if (!response.ok) {
    throw new Error("Failed to update user preferences")
  }

  const data = await response.json()
  return convertFromApiFormat(data)
}

function getLocalStoragePreferences(): UserPreferences {
  if (typeof window === "undefined") return defaultPreferences

  const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      // fallback to legacy layout storage if JSON parsing fails
    }
  }

  const layout = localStorage.getItem(LAYOUT_STORAGE_KEY) as LayoutType | null
  return {
    ...defaultPreferences,
    ...(layout ? { layout } : {}),
  }
}

function saveToLocalStorage(preferences: UserPreferences) {
  if (typeof window === "undefined") return

  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  localStorage.setItem(LAYOUT_STORAGE_KEY, preferences.layout)
}

export function UserPreferencesProvider({
  children,
  userId,
  initialPreferences,
}: {
  children: ReactNode
  userId?: string
  initialPreferences?: UserPreferences
}) {
  const isAuthenticated = !!userId
  const queryClient = useQueryClient()
  const [hasMounted, setHasMounted] = useState(false)

  // Track when component has mounted to avoid hydration issues
  useEffect(() => {
    setHasMounted(true)
  }, [])

  // Always use server-provided initial preferences or defaults for initial render
  // This ensures consistent state between server and client
  const getInitialData = (): UserPreferences => {
    if (initialPreferences && isAuthenticated) {
      return initialPreferences
    }

    // For unauthenticated users, always start with defaults to avoid hydration mismatch
    // localStorage will be read after hydration
    return defaultPreferences
  }

  // Query for user preferences
  const { data: preferences = getInitialData(), isLoading } =
    useQuery<UserPreferences>({
      queryKey: ["user-preferences", userId],
      queryFn: async () => {
        if (!isAuthenticated) {
          return getLocalStoragePreferences()
        }

        try {
          return await fetchUserPreferences()
        } catch (error) {
          console.error(
            "Failed to fetch user preferences, falling back to localStorage:",
            error
          )
          return getLocalStoragePreferences()
        }
      },
      enabled: hasMounted, // Only enable after component has mounted
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: (failureCount, error) => {
        // Only retry for authenticated users and network errors
        return isAuthenticated && failureCount < 2
      },
      // Use initial data to ensure consistent hydration
      initialData: getInitialData(),
    })

  // Mutation for updating preferences
  const mutation = useMutation({
    mutationFn: async (update: Partial<UserPreferences>) => {
      const updated = { ...preferences, ...update }

      if (!isAuthenticated) {
        saveToLocalStorage(updated)
        return updated
      }

      try {
        return await updateUserPreferences(update)
      } catch (error) {
        console.error(
          "Failed to update user preferences in database, falling back to localStorage:",
          error
        )
        saveToLocalStorage(updated)
        return updated
      }
    },
    onMutate: async (update) => {
      const queryKey = ["user-preferences", userId]
      await queryClient.cancelQueries({ queryKey })

      const previous = queryClient.getQueryData<UserPreferences>(queryKey)
      const optimistic = { ...previous, ...update }
      queryClient.setQueryData(queryKey, optimistic)

      return { previous }
    },
    onError: (_err, _update, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user-preferences", userId], context.previous)
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["user-preferences", userId], data)
    },
  })

  const updatePreferences = mutation.mutate

  const setLayout = (layout: LayoutType) => {
    if (isAuthenticated || layout === "fullscreen") {
      updatePreferences({ layout })
    }
  }

  // sidebarStyle is client-only: persisted to localStorage, not Supabase.
  // We update the React Query cache directly and write through to
  // localStorage, bypassing the API mutation entirely.
  const setSidebarStyle = (sidebarStyle: SidebarStyle) => {
    const queryKey = ["user-preferences", userId]
    const previous = queryClient.getQueryData<UserPreferences>(queryKey)
    const updated: UserPreferences = { ...(previous ?? preferences), sidebarStyle }
    queryClient.setQueryData(queryKey, updated)
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(updated))
      } catch {
        // ignore quota / serialization errors
      }
    }
  }

  const setChatBackground = (chatBackground: ChatBackground) => {
    updatePreferences({ chatBackground })
  }

  const setPromptSuggestions = (enabled: boolean) => {
    updatePreferences({ promptSuggestions: enabled })
  }

  const setShowToolInvocations = (enabled: boolean) => {
    updatePreferences({ showToolInvocations: enabled })
  }

  const setShowConversationPreviews = (enabled: boolean) => {
    updatePreferences({ showConversationPreviews: enabled })
  }

  const setMultiModelEnabled = (enabled: boolean) => {
    updatePreferences({ multiModelEnabled: enabled })
  }

  const toggleModelVisibility = (modelId: string) => {
    const currentHidden = preferences.hiddenModels || []
    const isHidden = currentHidden.includes(modelId)
    const newHidden = isHidden
      ? currentHidden.filter((id) => id !== modelId)
      : [...currentHidden, modelId]

    updatePreferences({ hiddenModels: newHidden })
  }

  const isModelHidden = (modelId: string) => {
    return (preferences.hiddenModels || []).includes(modelId)
  }

  return (
    <UserPreferencesContext.Provider
      value={{
        preferences,
        setLayout,
        setSidebarStyle,
        setChatBackground,
        setPromptSuggestions,
        setShowToolInvocations,
        setShowConversationPreviews,
        setMultiModelEnabled,
        toggleModelVisibility,
        isModelHidden,
        isLoading,
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  )
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error(
      "useUserPreferences must be used within UserPreferencesProvider"
    )
  }
  return context
}
