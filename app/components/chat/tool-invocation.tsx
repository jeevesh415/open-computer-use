"use client"

import type { ToolInvocationUIPart } from "@ai-sdk/ui-utils"
import { cn } from "@/lib/utils"
import {
  CaretUp,
  CaretDown,
  Monitor,
} from "@phosphor-icons/react"
import { AnimatePresence, motion } from "framer-motion"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useState, useMemo, useEffect } from "react"

interface ToolInvocationProps {
  toolInvocations: ToolInvocationUIPart[]
  className?: string
  defaultOpen?: boolean
  fullyRounded?: boolean
}

export function ToolInvocation({
  toolInvocations,
  fullyRounded,
}: ToolInvocationProps) {
  const { isOpen, setIsOpen } = useProjectNavigator()
  const [previousScreenshot, setPreviousScreenshot] = useState<string | null>(null)

  // Check environment variable for showing additional info
  const envValue = typeof window !== 'undefined' ?
    process.env.NEXT_PUBLIC_PROJECT_SHOW_ADDITIONAL_INFO : 'false'
  const showAdditionalInfo = envValue === 'true'

  const toolInvocationsData = Array.isArray(toolInvocations)
    ? toolInvocations
    : [toolInvocations]

  // Check if any tools are still loading
  const hasLoadingTools = toolInvocationsData.some(
    (tool) => tool.toolInvocation.state === "call" || tool.toolInvocation.state === "partial-call"
  )
  const allToolsCompleted = toolInvocationsData.every(
    (tool) => tool.toolInvocation.state === "result"
  )

  const isLoadingState = hasLoadingTools && !allToolsCompleted

  // Count unique tools and extract task information
  const toolCount = toolInvocationsData.length
  const completedCount = toolInvocationsData.filter(
    (tool) => tool.toolInvocation.state === "result"
  ).length

  // Function to get descriptive action sentence based on tool type
  const getToolActionDescription = (toolName: string, state: string, args?: any) => {
    const isActive = state === 'call' || state === 'partial-call'

    // Browser tools
    if (toolName.toLowerCase().startsWith('browser')) {
      return isActive ? 'Navigating through web pages to gather information' : 'Successfully retrieved web content'
    }

    // Terminal tools
    if (toolName.toLowerCase().startsWith('terminal')) {
      const terminalCommand = toolName.replace('terminal_', '').toLowerCase()
      switch (terminalCommand) {
        case 'connect':
          return isActive ? 'Establishing terminal session' : 'Terminal session established'
        case 'execute':
          return isActive ? 'Processing command in terminal environment' : 'Command processed successfully'
        case 'read':
          return isActive ? 'Reading terminal output' : 'Terminal output captured'
        case 'clear':
          return isActive ? 'Clearing terminal display' : 'Terminal display cleared'
        case 'close':
          return '' // Don't show terminal close messages
        default:
          return isActive ? 'Processing terminal operation' : 'Terminal operation completed'
      }
    }

    // File tools
    if (toolName.toLowerCase().startsWith('file_')) {
      const fileCommand = toolName.replace('file_', '').toLowerCase()
      switch (fileCommand) {
        case 'read':
          return isActive ? 'Reading file contents from the system' : 'File contents retrieved'
        case 'write':
          return isActive ? 'Writing data to file system' : 'File successfully written'
        case 'edit':
          return isActive ? 'Modifying file contents' : 'File modifications saved'
        case 'delete':
          return isActive ? 'Removing file from system' : 'File removed successfully'
        case 'exists':
          return isActive ? 'Checking file existence' : 'File check completed'
        case 'append':
          return isActive ? 'Appending content to file' : 'Content appended successfully'
        default:
          return isActive ? 'Processing file operation' : 'File operation completed'
      }
    }

    // Directory tools
    if (toolName.toLowerCase().includes('directory') || toolName.toLowerCase().includes('dir')) {
      return isActive ? 'Navigating directory structure' : 'Directory navigation completed'
    }

    // Search tools
    if (toolName === 'webSearch' || toolName === 'googleSearch') {
      return isActive ? 'Searching the web for relevant information' : 'Web search results obtained'
    }

    // Code execution
    if (toolName === 'codeExecution') {
      return isActive ? 'Executing code in isolated environment' : 'Code execution completed'
    }

    // Image search
    if (toolName === 'imageSearch') {
      return isActive ? 'Searching for relevant images' : 'Image search completed'
    }

    // URL scraper
    if (toolName === 'urlScraper') {
      return isActive ? 'Extracting content from webpage' : 'Webpage content extracted'
    }

    // VM tools
    if (toolName === 'vmScreenshot') {
      return isActive ? 'Capturing virtual machine screen' : 'Screen capture completed'
    }
    if (toolName === 'vmAction') {
      return isActive ? 'Performing action on virtual machine' : 'Virtual machine action completed'
    }

    // Default
    return isActive ? 'Processing action' : 'Action completed'
  }

  // Extract detailed task information from tool invocations
  const taskInfo = useMemo(() => {
    const tasks = toolInvocationsData.map(tool => {
      const { toolName, args, state, result } = tool.toolInvocation as any

      // Use descriptive sentences when not showing additional info
      if (!showAdditionalInfo) {
        const description = getToolActionDescription(toolName, state, args)
        // Skip empty descriptions (like terminal close)
        if (!description) {
          return null
        }
        return {
          action: description,
          target: '', // Empty target since it's included in the description
          state,
          resultInfo: null
        }
      }

      let action = state === 'result' ? 'Processed' : 'Processing'
      let target = 'task'

      switch (toolName) {
        case 'webSearch':
        case 'googleSearch':
          action = state === 'result' ? 'Searched' : 'Searching'
          target = args?.query ? `"${args.query.substring(0, 30)}${args.query.length > 30 ? '...' : ''}"` : 'the web'
          break
        case 'codeExecution':
          action = state === 'result' ? 'Executed' : 'Executing'
          target = args?.language ? `${args.language} code` : 'code'
          break
        case 'urlScraper':
          action = state === 'result' ? 'Read' : 'Reading'
          if (args?.url) {
            try {
              const url = new URL(args.url)
              target = url.hostname.replace('www.', '')
            } catch {
              target = 'webpage'
            }
          } else {
            target = 'webpage'
          }
          break
        case 'imageSearch':
          action = state === 'result' ? 'Found' : 'Finding'
          target = args?.query ? `images of "${args.query.substring(0, 25)}${args.query.length > 25 ? '...' : ''}"` : 'images'
          break
        case 'vmScreenshot':
          action = state === 'result' ? 'Captured' : 'Capturing'
          target = 'VM screenshot'
          break
        case 'vmAction':
          action = state === 'result' ? 'Performed' : 'Performing'
          if (args?.action) {
            switch (args.action) {
              case 'click':
                target = `click at (${args.x}, ${args.y})`
                break
              case 'type':
                target = `typing text`
                break
              case 'key':
                target = `key press: ${args.key}`
                break
              case 'scroll':
                target = `scroll action`
                break
              default:
                target = `${args.action} action`
            }
          } else {
            target = 'VM action'
          }
          break
        default:
          target = toolName
      }

      // Check for results count
      let resultInfo = null
      if (state === 'result' && result) {
        if (Array.isArray(result)) {
          resultInfo = `${result.length} results`
        } else if (result.success !== undefined) {
          resultInfo = result.success ? 'Success' : 'Failed'
        }
      }

      return { action, target, state, resultInfo }
    }).filter(task => task !== null)  // Filter out null tasks (like terminal close)

    // Get the most recent or most important task
    const primaryTask = tasks[tasks.length - 1] || tasks[0]

    // Summarize all tasks
    const summary = tasks.length > 1
      ? `Running ${tasks.length} tasks`
      : primaryTask ? `${primaryTask.action} ${primaryTask.target}` : 'Processing'

    return { tasks, primaryTask, summary }
  }, [toolInvocationsData, showAdditionalInfo])

  // Extract web search thumbnails for composite display
  const webSearchThumbnails = useMemo(() => {
    // Check all completed tools for web search results (in reverse order to get most recent)
    for (let i = toolInvocationsData.length - 1; i >= 0; i--) {
      const tool = toolInvocationsData[i]

      if (tool.toolInvocation.state === "result" && tool.toolInvocation.result) {
        const toolName = tool.toolInvocation.toolName

        // Check if this is a web search tool
        if (toolName === 'webSearch' || toolName === 'googleSearch') {
          const result = tool.toolInvocation.result

          // Try to parse the result
          let parsedResult = result
          if (result && typeof result === 'object' && 'content' in result) {
            if (Array.isArray(result.content)) {
              const textContent = result.content.find((item: any) => item.type === 'text')
              if (textContent?.text) {
                try {
                  parsedResult = JSON.parse(textContent.text)
                } catch {
                  parsedResult = null
                }
              }
            } else if (typeof result.content === 'string') {
              try {
                parsedResult = JSON.parse(result.content)
              } catch {
                parsedResult = null
              }
            }
          } else if (typeof result === 'string') {
            try {
              parsedResult = JSON.parse(result)
            } catch {
              parsedResult = null
            }
          }

          // Extract thumbnails from search results
          if (Array.isArray(parsedResult)) {
            const thumbnails = parsedResult
              .filter((item: any) => item && typeof item === 'object' && (item.image || item.thumbnail))
              .slice(0, 4) // Get up to 4 images
              .map((item: any) => item.image || item.thumbnail)

            if (thumbnails.length > 0) {
              return thumbnails
            }
          }
        }
      }
    }

    return null
  }, [toolInvocationsData])

  // Extract screenshot from tool results (check all tools, use the most recent screenshot)
  // Returns a full data URI string ready to use as img src
  // Checks both: result.frontendScreenshot (streaming) and toolInvocation.frontendScreenshot (DB persisted)
  const latestScreenshot = useMemo(() => {
    function toDataUri(raw: string): string | null {
      const clean = raw.trim()
      if (!clean) return null
      if (clean.startsWith('data:image/')) return clean
      if (clean.startsWith('/9j/')) return `data:image/jpeg;base64,${clean}`
      if (clean.startsWith('iVBOR')) return `data:image/png;base64,${clean}`
      return `data:image/jpeg;base64,${clean}`
    }

    for (let i = toolInvocationsData.length - 1; i >= 0; i--) {
      const inv = toolInvocationsData[i].toolInvocation as any

      // 1. Check toolInvocation.frontendScreenshot (DB-persisted format)
      if (inv.frontendScreenshot && typeof inv.frontendScreenshot === 'string') {
        const uri = toDataUri(inv.frontendScreenshot)
        if (uri) return uri
      }

      // 2. Check result.frontendScreenshot (streaming format)
      if (inv.state === "result" && inv.result && typeof inv.result === 'object' && 'frontendScreenshot' in inv.result) {
        const uri = toDataUri(inv.result.frontendScreenshot)
        if (uri) return uri
      }
    }
    return null
  }, [toolInvocationsData])

  // Track screenshot changes
  useEffect(() => {
    if (latestScreenshot && latestScreenshot !== previousScreenshot) {
      // Small delay to allow for smooth transition
      setTimeout(() => {
        setPreviousScreenshot(latestScreenshot)
      }, 50)
    }
  }, [latestScreenshot, previousScreenshot])

  // Determine the thumbnail source and extra count for web search
  const thumbnailSrc = webSearchThumbnails?.[0] || latestScreenshot || null
  const webSearchExtra = webSearchThumbnails && webSearchThumbnails.length > 1 ? webSearchThumbnails.length - 1 : 0

  // Progress ratio
  const progressRatio = toolCount > 0 ? completedCount / toolCount : 0

  // Primary action text (truncated for single line)
  const actionText = taskInfo.primaryTask
    ? (taskInfo.primaryTask.target
        ? `${taskInfo.primaryTask.action} ${taskInfo.primaryTask.target}`
        : taskInfo.primaryTask.action)
    : (isLoadingState ? 'Processing' : 'Completed')

  const countText = isLoadingState
    ? `${completedCount}/${toolCount} tasks`
    : `${toolCount} ${toolCount === 1 ? 'task' : 'tasks'} done`

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="overflow-hidden"
      >
        <motion.button
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          whileTap={{ scale: 0.995 }}
          className={cn(
            "group relative w-full",
            fullyRounded ? "rounded-2xl" : "rounded-t-2xl rounded-b-none",
            "bg-gradient-to-b from-neutral-300/90 to-neutral-100 dark:from-neutral-600/90 dark:to-neutral-800",
            "px-4 py-3",
            "cursor-pointer"
          )}
        >
          <div className="flex items-center gap-3">
            {/* Screenshot thumbnail */}
            <motion.div
              className="relative h-11 w-[4.5rem] flex-shrink-0 rounded-lg overflow-hidden ring-1 ring-black/5 dark:ring-white/10 bg-neutral-200 dark:bg-neutral-700 transition-transform duration-200 ease-out group-hover:scale-125"
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
            >
              <AnimatePresence mode="wait">
                {thumbnailSrc ? (
                  <motion.div
                    key={thumbnailSrc.substring(0, 30)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0"
                  >
                    <img
                      src={thumbnailSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                    {isLoadingState && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        style={{ width: "100%" }}
                      />
                    )}
                    {webSearchExtra > 0 && (
                      <div className="absolute bottom-0.5 right-0.5 bg-black/60 backdrop-blur-sm rounded text-[9px] text-white/80 font-medium px-1 leading-tight">
                        +{webSearchExtra}
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <Monitor className="h-5 w-5 text-muted-foreground/40" weight="duotone" />
                    {isLoadingState && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 dark:via-white/10 to-transparent"
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        style={{ width: "100%" }}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Text block — two clean lines */}
            <div className="flex-1 min-w-0">
              {/* Line 1: Action description */}
              <motion.p
                className={cn(
                  "text-sm font-medium text-foreground truncate leading-tight",
                  isLoadingState && "shimmer-text"
                )}
                animate={isLoadingState ? { backgroundPosition: ['200% 0', '-200% 0'] } : {}}
                transition={{ duration: 1.5, repeat: isLoadingState ? Infinity : 0, ease: "linear" }}
                style={isLoadingState ? {
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                } : {}}
              >
                {actionText}
              </motion.p>
              {/* Line 2: Count + hint */}
              <p className="text-[11px] leading-tight mt-1 truncate">
                <span className="text-muted-foreground">{countText}</span>
                <span className="text-muted-foreground/30 mx-1">&middot;</span>
                <span className="text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
                  {isOpen ? 'Click to minimize' : 'Click to view details'}
                </span>
              </p>
            </div>

            {/* Right side: progress pill + caret */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Progress pill */}
              <div className="h-1.5 w-10 rounded-full bg-neutral-300/40 dark:bg-neutral-600/30 overflow-hidden relative">
                <motion.div
                  className="h-full rounded-full relative overflow-hidden"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(progressRatio * 100, isLoadingState ? 12 : 0)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                >
                  <div className={cn(
                    "absolute inset-0 rounded-full",
                    allToolsCompleted
                      ? "bg-gradient-to-r from-emerald-500/60 to-green-400/50"
                      : "bg-gradient-to-r from-neutral-500/50 to-neutral-400/40 dark:from-neutral-400/50 dark:to-neutral-300/40"
                  )} />
                  {isLoadingState && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 dark:via-white/20 to-transparent"
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                </motion.div>
              </div>

              {/* Divider + caret */}
              <div className="w-px h-4 bg-border/30" />
              <AnimatePresence mode="wait" initial={false}>
                {isOpen ? (
                  <motion.div
                    key="up"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <CaretUp className="h-3.5 w-3.5 text-muted-foreground" weight="bold" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="down"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <CaretDown className="h-3.5 w-3.5 text-muted-foreground" weight="bold" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  )
}