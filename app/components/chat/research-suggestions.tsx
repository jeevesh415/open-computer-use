"use client"

import { motion } from "motion/react"
import { Sparkles } from "lucide-react"
import { getRandomQuestions } from "@/lib/trending-questions"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface ResearchSuggestionsProps {
  onSelectSuggestion: (suggestion: string) => void
  className?: string
}

export function ResearchSuggestions({ onSelectSuggestion, className }: ResearchSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isPaused, setIsPaused] = useState(false)
  
  useEffect(() => {
    // Get random questions and duplicate for infinite scroll
    const questions = getRandomQuestions(10)
    // Duplicate the array for seamless infinite scroll
    setSuggestions([...questions, ...questions])
  }, [])
  
  // Beautiful color combinations for pills - simple and elegant
  const pillColors = [
    { 
      bg: "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20", 
      hover: "hover:from-blue-100 hover:to-indigo-100 dark:hover:from-blue-900/30 dark:hover:to-indigo-900/30", 
      text: "text-blue-600 dark:text-blue-400", 
      border: "border-blue-200/50 dark:border-blue-700/30",
      shadow: "hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20"
    },
    { 
      bg: "bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20", 
      hover: "hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/30 dark:hover:to-purple-900/30", 
      text: "text-violet-600 dark:text-violet-400", 
      border: "border-violet-200/50 dark:border-violet-700/30",
      shadow: "hover:shadow-violet-100/50 dark:hover:shadow-violet-900/20"
    },
    { 
      bg: "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20", 
      hover: "hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-900/30 dark:hover:to-teal-900/30", 
      text: "text-emerald-600 dark:text-emerald-400", 
      border: "border-emerald-200/50 dark:border-emerald-700/30",
      shadow: "hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20"
    },
    { 
      bg: "bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20", 
      hover: "hover:from-rose-100 hover:to-pink-100 dark:hover:from-rose-900/30 dark:hover:to-pink-900/30", 
      text: "text-rose-600 dark:text-rose-400", 
      border: "border-rose-200/50 dark:border-rose-700/30",
      shadow: "hover:shadow-rose-100/50 dark:hover:shadow-rose-900/20"
    },
    { 
      bg: "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20", 
      hover: "hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/30 dark:hover:to-orange-900/30", 
      text: "text-amber-600 dark:text-amber-400", 
      border: "border-amber-200/50 dark:border-amber-700/30",
      shadow: "hover:shadow-amber-100/50 dark:hover:shadow-amber-900/20"
    },
    { 
      bg: "bg-gradient-to-r from-cyan-50 to-sky-50 dark:from-cyan-950/20 dark:to-sky-950/20", 
      hover: "hover:from-cyan-100 hover:to-sky-100 dark:hover:from-cyan-900/30 dark:hover:to-sky-900/30", 
      text: "text-cyan-600 dark:text-cyan-400", 
      border: "border-cyan-200/50 dark:border-cyan-700/30",
      shadow: "hover:shadow-cyan-100/50 dark:hover:shadow-cyan-900/20"
    },
  ]
  
  // Function to truncate text elegantly
  const truncateText = (text: string, maxLength: number = 50) => {
    if (text.length <= maxLength) return text
    // Find the last space before maxLength to avoid cutting words
    const lastSpace = text.lastIndexOf(' ', maxLength)
    const cutoff = lastSpace > 0 ? lastSpace : maxLength
    return text.slice(0, cutoff) + "..."
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("w-full overflow-hidden", className)}
    >
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-2 px-8 sm:px-0">
        <Sparkles className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[11px] text-muted-foreground/60 font-medium">Trending research</span>
      </div>
      
      {/* Infinite scrolling container */}
      <div 
        className="relative overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Mobile: Infinite auto-scroll (same as desktop) */}
        <div className="sm:hidden relative">
          <motion.div
            className="flex gap-2"
            animate={{
              x: isPaused ? 0 : "-50%",
            }}
            transition={{
              x: {
                repeat: Infinity,
                repeatType: "loop",
                duration: 40,
                ease: "linear",
              },
            }}
          >
            {suggestions.map((suggestion, index) => {
              const colorScheme = pillColors[index % pillColors.length]
              return (
                <button
                  key={`mobile-${index}`}
                  onClick={() => onSelectSuggestion(suggestion)}
                  onTouchStart={() => setIsPaused(true)}
                  onTouchEnd={() => setIsPaused(false)}
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-medium transition-all active:scale-95",
                    "border backdrop-blur-sm whitespace-nowrap",
                    colorScheme.bg,
                    colorScheme.hover,
                    colorScheme.text,
                    colorScheme.border
                  )}
                >
                  <Sparkles className="h-2.5 w-2.5 mr-1.5 opacity-70" />
                  <span>{truncateText(suggestion, 45)}</span>
                </button>
              )
            })}
          </motion.div>
          
          {/* Mobile gradient edges */}
          <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
        </div>
        
        {/* Desktop: Infinite auto-scroll */}
        <div className="hidden sm:block relative">
          <motion.div
            className="flex gap-2"
            animate={{
              x: isPaused ? 0 : "-50%",
            }}
            transition={{
              x: {
                repeat: Infinity,
                repeatType: "loop",
                duration: 30,
                ease: "linear",
              },
            }}
          >
            {suggestions.map((suggestion, index) => {
              const colorScheme = pillColors[index % pillColors.length]
              return (
                <motion.button
                  key={`desktop-${index}`}
                  onClick={() => onSelectSuggestion(suggestion)}
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 hover:scale-105",
                    "border backdrop-blur-sm whitespace-nowrap",
                    "hover:shadow-md cursor-pointer",
                    colorScheme.bg,
                    colorScheme.hover,
                    colorScheme.text,
                    colorScheme.border,
                    colorScheme.shadow
                  )}
                >
                  <Sparkles className="h-3 w-3 mr-1.5 opacity-70" />
                  <span className="font-medium">{truncateText(suggestion, 60)}</span>
                </motion.button>
              )
            })}
          </motion.div>
          
          {/* Gradient edges for desktop */}
          <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
        </div>
      </div>
    </motion.div>
  )
}