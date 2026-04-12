"use client"

import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion"
import { TRANSITION_SUGGESTIONS } from "@/lib/motion"
import { AnimatePresence, motion } from "motion/react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { SUGGESTIONS_DATA } from "../../../lib/config"
import { useTranslations } from "next-intl"

type SuggestionsProps = {
  onValueChange: (value: string) => void
  onSuggestion: (suggestion: string) => void
  value?: string
}

const MotionPromptSuggestion = motion.create(PromptSuggestion)

export const Suggestions = memo(function Suggestions({
  onValueChange,
  onSuggestion,
  value,
}: SuggestionsProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const ts = useTranslations("suggestions")

  if (!value && activeCategory !== null) {
    setActiveCategory(null)
  }

  // Build translated suggestions
  const SUGGESTIONS_CONFIG = useMemo(() =>
    SUGGESTIONS_DATA.map(s => ({
      ...s,
      label: ts(`${s.key}.label`),
      highlight: ts(`${s.key}.highlight`),
    })),
    [ts]
  )

  const activeCategoryData = SUGGESTIONS_CONFIG.find(
    (group) => group.label === activeCategory
  )

  const showCategorySuggestions =
    activeCategoryData && activeCategoryData.items.length > 0

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      setActiveCategory(null)
      onSuggestion(suggestion)
      onValueChange("")
    },
    [onSuggestion, onValueChange]
  )

  const handleCategoryClick = useCallback(
    (suggestion: { label: string; prompt: string }) => {
      setActiveCategory(suggestion.label)
      onValueChange(suggestion.prompt)
    },
    [onValueChange]
  )

  const suggestionsGrid = useMemo(
    () => (
      <motion.div
        key="suggestions-grid"
        className="flex w-full max-w-full flex-nowrap justify-start gap-1.5 overflow-x-auto px-1 md:mx-auto md:max-w-2xl md:flex-wrap md:justify-center md:px-0"
        initial="initial"
        animate="animate"
        variants={{
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
        }}
        transition={TRANSITION_SUGGESTIONS}
        style={{
          scrollbarWidth: "none",
        }}
      >
        {SUGGESTIONS_CONFIG.map((suggestion, index) => (
          <MotionPromptSuggestion
            key={suggestion.label}
            onClick={() => handleCategoryClick(suggestion)}
            className="capitalize rounded-xl border-neutral-200/60 dark:border-neutral-700/40 bg-neutral-100/60 dark:bg-neutral-800/40 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors duration-200"
            variant="outline"
            initial="initial"
            animate="animate"
            transition={{
              ...TRANSITION_SUGGESTIONS,
              delay: index * 0.03,
            }}
            variants={{
              initial: { opacity: 0, y: 4 },
              animate: { opacity: 1, y: 0 },
            }}
          >
            <suggestion.icon className="size-3.5 opacity-50" strokeWidth={1.5} />
            {suggestion.label}
          </MotionPromptSuggestion>
        ))}
      </motion.div>
    ),
    [handleCategoryClick, SUGGESTIONS_CONFIG]
  )

  const suggestionsList = useMemo(
    () => (
      <motion.div
        className="flex w-full flex-col gap-0.5 rounded-2xl bg-neutral-100/60 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/30 p-1.5 backdrop-blur-sm md:mx-auto md:max-w-2xl"
        key={activeCategoryData?.label}
        initial="initial"
        animate="animate"
        variants={{
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
        }}
        transition={TRANSITION_SUGGESTIONS}
      >
        {activeCategoryData?.items.map((suggestion: string, index: number) => (
          <MotionPromptSuggestion
            key={`${activeCategoryData?.label}-${suggestion}-${index}`}
            highlight={activeCategoryData.highlight}
            type="button"
            onClick={() => handleSuggestionClick(suggestion)}
            className="block h-full text-left rounded-xl hover:bg-neutral-200/50 dark:hover:bg-neutral-700/30 transition-colors duration-150"
            initial="initial"
            animate="animate"
            variants={{
              initial: { opacity: 0, x: -4 },
              animate: { opacity: 1, x: 0 },
            }}
            transition={{
              ...TRANSITION_SUGGESTIONS,
              delay: index * 0.04,
            }}
          >
            {suggestion}
          </MotionPromptSuggestion>
        ))}
      </motion.div>
    ),
    [
      handleSuggestionClick,
      activeCategoryData?.highlight,
      activeCategoryData?.items,
      activeCategoryData?.label,
    ]
  )

  return (
    <AnimatePresence mode="wait">
      {showCategorySuggestions ? suggestionsList : suggestionsGrid}
    </AnimatePresence>
  )
})
