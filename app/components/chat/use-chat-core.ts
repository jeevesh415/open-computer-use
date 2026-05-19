import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { toast } from "@/components/ui/toast"
import { MESSAGE_MAX_LENGTH } from "@/lib/config"
import { SystemPrompts } from "@/lib/prompts/system-prompts"
import { API_ROUTE_CHAT } from "@/lib/routes"
import type { UserProfile } from "@/lib/user/types"
import type { Message } from "@ai-sdk/react"
import { useChat } from "@ai-sdk/react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { insertMessageToDb } from "@/lib/chat-store/messages/api"
import { InsufficientCreditsModal } from "@/app/components/credits/insufficient-credits-modal"
import { isSigningOut } from "@/lib/user-store/sign-out-state"

// Attachment type matching backend expectations
type Attachment = {
  name: string
  type: string  // Backend expects 'type', not 'contentType'
  size: number  // Backend requires size field
  url?: string
  vmPath?: string  // Our custom field for VM path tracking
}

type UseChatCoreProps = {
  initialMessages: Message[]
  draftValue: string
  cacheAndAddMessage: (message: Message) => void
  chatId: string | null
  user: UserProfile | null
  // File upload props
  files: File[]
  createOptimisticAttachments: (
    files: File[]
  ) => Array<{ name: string; type: string; size: number; url: string }>
  setFiles: (files: File[]) => void
  checkLimitsAndNotify: (uid: string) => Promise<boolean>
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  ensureChatExists: (uid: string, input: string) => Promise<string | null>
  handleFileUploads: (
    uid: string,
    chatId: string
  ) => Promise<Attachment[] | null>
  selectedModel: string
  selectedVMId: string | null
  clearDraft: () => void
  bumpChat: (chatId: string) => void
}

export function useChatCore({
  initialMessages,
  draftValue,
  cacheAndAddMessage,
  chatId,
  user,
  // File upload parameters
  files,
  createOptimisticAttachments,
  setFiles,
  checkLimitsAndNotify,
  cleanupOptimisticAttachments,
  ensureChatExists,
  handleFileUploads,
  selectedModel,
  selectedVMId,
  clearDraft,
  bumpChat,
}: UseChatCoreProps) {
  // State management
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  const [creditsModalOpen, setCreditsModalOpen] = useState(false)
  const [creditsModalData, setCreditsModalData] = useState<{
    currentBalance?: number
    requiredCredits?: number
    estimatedRuntime?: number
    errorMessage?: string
  }>({})
  const enableSearch = true // Always enable search
  const forceSearch = true // Always force search to run

  // Refs and derived state
  const hasSentFirstMessageRef = useRef(false)
  const prevChatIdRef = useRef<string | null>(chatId)
  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])
  const systemPrompt = useMemo(
    () => user?.system_prompt || SystemPrompts.main(),
    [user?.system_prompt]
  )

  // Search params handling
  const searchParams = useSearchParams()
  const prompt = searchParams.get("prompt")
  const autoSubmit = searchParams.get("autoSubmit") === "true"

  // Handle errors directly in onError callback
  const handleError = useCallback((error: Error) => {
    // Sign-out tear-down: while the user is being signed out, the auth
    // cookie is cleared and any in-flight chat stream gets killed by
    // the server, surfacing here as `error.message === "An error
    // occurred"` (the AI SDK's generic stream-failure message). Without
    // this guard, the user sees a red "Something went wrong" toast for
    // 50–200ms before the page navigates to /. We log it for diagnostics
    // but stay silent in the UI — the user is intentionally going away.
    if (isSigningOut()) {
      console.warn("[chat] Suppressing in-flight error during sign-out:", error.message)
      return
    }

    console.error("Chat error:", error)
    console.error("Error message:", error.message)

    // Check if this is a 402 Payment Required error (insufficient credits)
    const errorMsg = error.message || "Something went wrong."
    
    // Parse error message to check for insufficient credits
    if (errorMsg.includes("Insufficient credits") || errorMsg.includes("402")) {
      // Extract credit information from error message if available
      const balanceMatch = errorMsg.match(/You have (\d+) credits/)
      const requiredMatch = errorMsg.match(/need at least (\d+)/)
      
      setCreditsModalData({
        currentBalance: balanceMatch ? parseInt(balanceMatch[1]) : 0,
        requiredCredits: requiredMatch ? parseInt(requiredMatch[1]) : 10,
        estimatedRuntime: balanceMatch ? Math.floor(parseInt(balanceMatch[1]) / 10) : 0,
      })
      setCreditsModalOpen(true)
      
      // Don't show a toast for credit errors, the modal handles it
      return
    }

    // Handle other errors normally
    let displayMsg = errorMsg
    if (errorMsg === "An error occurred" || errorMsg === "fetch failed") {
      displayMsg = "Something went wrong. Please try again."
    }

    toast({
      title: displayMsg,
      status: "error",
    })
  }, [])

  // Initialize useChat
  const {
    messages,
    input,
    handleSubmit,
    status,
    error,
    reload,
    stop: originalStop,
    setMessages,
    setInput,
    append,
  } = useChat({
    api: API_ROUTE_CHAT,
    initialMessages,
    initialInput: draftValue,
    onFinish: (message) => {
      console.log('use-chat-core - onFinish received message:', message)
      cacheAndAddMessage(message)
    },
    onError: handleError,
  })

  // Stop function that aborts the stream
  // The backend handles saving partial messages when stream is cancelled
  const stop = useCallback(() => {
    console.log("Stopping chat stream...")
    
    // Call the original stop function to abort the stream
    // The backend will detect the cancellation and save the partial message
    // with "[Response stopped by user]" appended and send a finish event
    originalStop()
  }, [originalStop])

  // Handle search params on mount
  useEffect(() => {
    if (prompt && typeof window !== "undefined") {
      requestAnimationFrame(() => setInput(prompt))
    }
  }, [prompt, setInput])

  // Reset messages when navigating from a chat to home
  useEffect(() => {
    if (
      prevChatIdRef.current !== null &&
      chatId === null &&
      messages.length > 0
    ) {
      setMessages([])
    }
    prevChatIdRef.current = chatId
  }, [chatId, messages.length, setMessages])

  // Submit action
  const submit = useCallback(async () => {
    setIsSubmitting(true)

    const uid = (user?.id ?? null)
    if (!uid) {
      setIsSubmitting(false)
      return
    }

    const optimisticId = `optimistic-${Date.now().toString()}`
    const optimisticAttachments =
      files.length > 0 ? createOptimisticAttachments(files) : []

    // Build message content with file paths appended
    let messageContent = input
    // Note: We'll append the actual VM paths after upload in the submit function

    // Don't manually add optimistic message - let useChat handle it
    // This prevents duplicate messages in collaborative rooms
    const tempMessage = {
      id: optimisticId,
      content: messageContent,
      role: "user" as const,
      createdAt: new Date(),
      experimental_attachments:
        optimisticAttachments.length > 0 ? optimisticAttachments : undefined,
    }

    // Store the input value before clearing
    const originalInput = input
    
    // Clear input immediately for better UX
    setInput("")

    const submittedFiles = [...files]
    setFiles([])

    try {
      const allowed = await checkLimitsAndNotify(uid)
      if (!allowed) {
        cleanupOptimisticAttachments(tempMessage.experimental_attachments)
        return
      }

      const currentChatId = await ensureChatExists(uid, originalInput)
      if (!currentChatId) {
        cleanupOptimisticAttachments(tempMessage.experimental_attachments)
        return
      }

      if (originalInput.length > MESSAGE_MAX_LENGTH) {
        toast({
          title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
          status: "error",
        })
        cleanupOptimisticAttachments(tempMessage.experimental_attachments)
        return
      }

      let attachments: Attachment[] | null = []
      if (submittedFiles.length > 0) {
        attachments = await handleFileUploads(uid, currentChatId)
        if (attachments === null) {
          cleanupOptimisticAttachments(tempMessage.experimental_attachments)
          return
        }
      }


      // Build message with VM file paths using special tags
      let finalMessage = originalInput
      if (attachments && attachments.length > 0) {
        const fileTags = attachments.map((a: any) => {
          // VM uploads always have vmPath
          const path = a.vmPath || `/home/desktop/Desktop/${a.name}`
          // Include size attribute if available
          const sizeAttr = a.size ? ` size="${a.size}"` : ''
          return `<file-attachment name="${a.name}" path="${path}"${sizeAttr} />`
        }).join('')
        // Add file tags at the beginning of the message
        finalMessage = fileTags + (originalInput ? '\n' + originalInput : '')
      }

      const options = {
        body: {
          chatId: currentChatId,
          userId: uid,
          model: selectedModel,
          isAuthenticated,
          systemPrompt: systemPrompt || SystemPrompts.main(),
          enableSearch,
          forceSearch,

          machineId: selectedVMId,
        },
        experimental_attachments: (attachments || []).filter(a => a.url) as any,
      }

      
      // Use append instead of handleSubmit to ensure custom content is used
      append(
        { 
          content: finalMessage, 
          role: 'user' 
        },
        options
      )
      
      // useChat will handle adding the message
      cleanupOptimisticAttachments(tempMessage.experimental_attachments)
      clearDraft()
      
      // Log messages after submission
      setTimeout(() => {
        console.log('use-chat-core - Messages after submission:', messages)
      }, 100)

      if (messages.length > 0) {
        bumpChat(currentChatId)
      }
    } catch {
      cleanupOptimisticAttachments(tempMessage.experimental_attachments)
      toast({ title: "Failed to send message", status: "error" })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    user,
    files,
    createOptimisticAttachments,
    input,
    setMessages,
    setInput,
    setFiles,
    checkLimitsAndNotify,
    cleanupOptimisticAttachments,
    ensureChatExists,
    handleFileUploads,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    enableSearch,
    forceSearch,

    selectedVMId,
    handleSubmit,
    cacheAndAddMessage,
    clearDraft,
    messages.length,
    bumpChat,
    setIsSubmitting,
  ])

  // Handle auto-submit for discover prompts
  useEffect(() => {
    if (autoSubmit && prompt && prompt.trim() && typeof window !== "undefined") {
      // Wait a bit to ensure input is set and chat is ready
      const timeoutId = setTimeout(() => {
        // Only auto-submit if there are no existing messages to avoid duplicate submissions
        if (messages.length === 0 && !hasSentFirstMessageRef.current && !isSubmitting) {
          hasSentFirstMessageRef.current = true
          submit()
        }
      }, 300) // Increased timeout to ensure everything is ready

      return () => clearTimeout(timeoutId)
    }
  }, [autoSubmit, prompt, messages.length, isSubmitting, submit])

  // Handle suggestion
  const handleSuggestion = useCallback(
    async (suggestion: string) => {
      setIsSubmitting(true)
      const optimisticId = `optimistic-${Date.now().toString()}`
      const optimisticMessage = {
        id: optimisticId,
        content: suggestion,
        role: "user" as const,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, optimisticMessage])

      try {
        const uid = (user?.id ?? null)

        if (!uid) {
          setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
          return
        }

        const allowed = await checkLimitsAndNotify(uid)
        if (!allowed) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
          return
        }

        const currentChatId = await ensureChatExists(uid, suggestion)

        if (!currentChatId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
          return
        }

        const options = {
          body: {
            chatId: currentChatId,
            userId: uid,
            model: selectedModel,
            isAuthenticated,
            systemPrompt: SystemPrompts.main(),
            enableSearch, // Always enable search for suggestions
            forceSearch, // Always force search for suggestions
  
          },
        }

        append(
          {
            role: "user",
            content: suggestion,
          },
          options
        )
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
      } catch {
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
        toast({ title: "Failed to send suggestion", status: "error" })
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      ensureChatExists,
      selectedModel,
      user,
      append,
      checkLimitsAndNotify,
      isAuthenticated,
      enableSearch,
      forceSearch,
  
      setMessages,
      setIsSubmitting,
    ]
  )

  // Handle reload
  const handleReload = useCallback(async () => {
    const uid = (user?.id ?? null)
    if (!uid) {
      return
    }

    const options = {
      body: {
        chatId,
        userId: uid,
        model: selectedModel,
        isAuthenticated,
        systemPrompt: systemPrompt || SystemPrompts.main(),
        enableSearch, // Always enable search for regenerate
        forceSearch, // Always force search for regenerate
    
      },
    }

    reload(options)
  }, [user, chatId, selectedModel, isAuthenticated, systemPrompt, enableSearch, forceSearch, reload])

  // Handle input change - now with access to the real setInput function!
  const { setDraftValue } = useChatDraft(chatId)
  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value)
      setDraftValue(value)
    },
    [setInput, setDraftValue]
  )

  return {
    // Chat state
    messages,
    input,
    handleSubmit,
    status,
    error,
    reload,
    stop,
    setMessages,
    setInput,
    append,
    isAuthenticated,
    systemPrompt,
    hasSentFirstMessageRef,

    // Component state
    isSubmitting,
    setIsSubmitting,
    hasDialogAuth,
    setHasDialogAuth,
    enableSearch,
    
    // Credits modal state
    creditsModalOpen,
    setCreditsModalOpen,
    creditsModalData,

    // Actions
    submit,
    handleSuggestion,
    handleReload,
    handleInputChange,
  }
}
