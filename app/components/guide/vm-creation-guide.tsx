"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAccountDialog } from "@/lib/account-dialog-store"
import { motion, AnimatePresence } from "motion/react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { X, ArrowRight, ArrowLeft, Desktop, Sparkle, Check, Mouse, CircleNotch, HandGrabbing, Monitor, User } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"

interface VMCreationGuideProps {
  isOpen: boolean
  onClose: () => void
}

const guideSteps = [
  {
    id: "welcome",
    title: "Welcome to Coasty!",
    description: "So glad to have you as our early customer! We appreciate your feedback. Let me guide you through creating your own AI-controlled virtual machine.",
    icon: Sparkle,
    targetElement: null,
    action: null,
    position: "center" as const,
    showNext: true,
  },
  {
    id: "open-selector",
    title: "Click the VM Selector",
    description: "Click the highlighted dropdown button to see available virtual machines.",
    icon: Mouse,
    targetElement: "#vm-selector-button",
    action: "Click the VM selector",
    position: "top" as const,
    showNext: false,
  },
  {
    id: "create-machine",
    title: "Click 'Create Machine'",
    description: "Now click 'Create Machine' to start creating your virtual desktop.",
    icon: Mouse,
    targetElement: "#create-machine-button",
    action: "Click 'Create Machine'",
    position: "top" as const,
    requiresDropdownOpen: true,
    showNext: false,
    autoAdvanceOnClick: true,
  },
  {
    id: "show-machines-tab",
    title: "Machines in Sidebar",
    description: "Here's where you can find your Machines in the sidebar. You can access all your virtual desktops from here.",
    icon: Monitor,
    targetElement: "#sidebar-machines-link",
    action: null,
    position: "right" as const,
    showNext: false,
    showDone: true,
    expandSidebar: true,
    openAccountSection: "billing" as const,
  },
]

export function VMCreationGuide({ isOpen, onClose }: VMCreationGuideProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [highlightBox, setHighlightBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [machineCreated, setMachineCreated] = useState(false)
  const [isWaitingForMachine, setIsWaitingForMachine] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const { isOpen: navigatorOpen, toggleNavigator } = useProjectNavigator()
  const animationFrameRef = useRef<number | undefined>(undefined)
  const machineCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const currentStepRef = useRef(currentStep)
  
  const currentGuideStep = guideSteps[currentStep]
  const isFirstStep = currentStep === 0
  
  // Keep ref in sync with state
  useEffect(() => {
    currentStepRef.current = currentStep
  }, [currentStep])

  // Define startMachineCreationCheck early to avoid reference errors
  const startMachineCreationCheck = useCallback(() => {
    console.log("Starting machine creation check")
    // Clear any existing interval
    if (machineCheckIntervalRef.current) {
      clearInterval(machineCheckIntervalRef.current)
    }
    
    // Check every second if the dialog is closed (machine created)
    machineCheckIntervalRef.current = setInterval(() => {
      const dialog = document.querySelector(".create-machine-dialog")
      console.log("Checking for dialog, found:", !!dialog)
      if (!dialog) {
        // Dialog closed, assume machine was created or cancelled
        console.log("Dialog closed, advancing to final step")
        setMachineCreated(true)
        setIsWaitingForMachine(false)
        // Auto-advance to next step (step 3 is the last step, index 3)
        setCurrentStep(3) // Move to "show-machines-tab" step which is the last step
        // Clear the interval
        if (machineCheckIntervalRef.current) {
          clearInterval(machineCheckIntervalRef.current)
          machineCheckIntervalRef.current = null
        }
      }
    }, 1000)
  }, [])

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Calculate highlight box position
  const updateHighlightBox = useCallback(() => {
    console.log(`[updateHighlightBox] Called for step ${currentStep}`, currentGuideStep)
    
    // Special case for configure-machine step - highlight the dialog if it exists
    if (currentGuideStep.id === "configure-machine") {
      // Look for the create machine dialog
      const dialog = document.querySelector('.create-machine-dialog') || 
                    document.querySelector('[role="dialog"]')
      if (dialog) {
        const rect = dialog.getBoundingClientRect()
        setHighlightBox({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        })
        console.log("[updateHighlightBox] Set highlight for dialog:", rect)
        return
      } else {
        // No dialog found, no highlight
        setHighlightBox(null)
        // Try again in a moment as dialog might be opening
        setTimeout(updateHighlightBox, 100)
        return
      }
    }
    
    if (!currentGuideStep.targetElement) {
      console.log("[updateHighlightBox] No target element, clearing highlight")
      setHighlightBox(null)
      return
    }

    // Special handling for full screen highlight
    if ((currentGuideStep as any).fullScreenHighlight) {
      const box = {
        top: 20,
        left: 20,
        width: window.innerWidth - 40,
        height: window.innerHeight - 40,
      }
      setHighlightBox(box)
      console.log("[updateHighlightBox] Set full screen highlight:", box)
      return
    }

    // For step 3 (Machines tab), try both collapsed and expanded selectors
    let element = null
    if (currentStep === 3) {
      element = document.querySelector('#sidebar-machines-link') || 
                document.querySelector('#sidebar-machines-link-collapsed')
      console.log("[updateHighlightBox] Looking for Machines link (expanded or collapsed):", {
        expanded: !!document.querySelector('#sidebar-machines-link'),
        collapsed: !!document.querySelector('#sidebar-machines-link-collapsed'),
        found: !!element
      })
    } else {
      element = document.querySelector(currentGuideStep.targetElement)
      console.log(`[updateHighlightBox] Looking for element: ${currentGuideStep.targetElement}`, {
        found: !!element,
        element
      })
    }
    
    if (element) {
      const rect = element.getBoundingClientRect()
      const box = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
      setHighlightBox(box)
      console.log("[updateHighlightBox] Set highlight box:", box)
    } else {
      console.log(`[updateHighlightBox] Element not found: ${currentStep === 3 ? 'Machines link' : currentGuideStep.targetElement}`)
      // If element not found, try again in a moment (for dropdown items)
      if (currentGuideStep.requiresDropdownOpen) {
        setTimeout(updateHighlightBox, 100)
      } else {
        // For step 1, keep trying to find VM selector
        if (currentStep === 1) {
          console.log("[updateHighlightBox] Retrying to find VM selector...")
          setTimeout(updateHighlightBox, 200)
        }
        // For step 2, keep trying to find Create Machine button
        if (currentStep === 2) {
          console.log("[updateHighlightBox] Retrying to find Create Machine button...")
          setTimeout(updateHighlightBox, 200)
        }
        // For step 3, keep trying to find Machines link
        if (currentStep === 3) {
          console.log("[updateHighlightBox] Retrying to find Machines link...")
          setTimeout(updateHighlightBox, 200)
        }
      }
    }
  }, [currentGuideStep, currentStep])

  // Update highlight box on step change and window resize
  useEffect(() => {
    if (!isOpen) return

    // Force update highlight box when step changes
    updateHighlightBox()
    
    // For step 1, keep checking until VM selector is found and highlighted
    if (currentStep === 1) {
      const checkInterval = setInterval(() => {
        const vmSelector = document.querySelector('#vm-selector-button')
        if (vmSelector) {
          console.log("[Step 1] Found VM selector, updating highlight")
          updateHighlightBox()
          clearInterval(checkInterval)
        } else {
          console.log("[Step 1] VM selector not found yet, retrying...")
        }
      }, 100)
      
      // Clear after 5 seconds to prevent infinite loop
      setTimeout(() => clearInterval(checkInterval), 5000)
      
      // Also update immediately and after delays
      setTimeout(updateHighlightBox, 100)
      setTimeout(updateHighlightBox, 300)
      setTimeout(updateHighlightBox, 500)
    }
    
    // For step 2, keep checking until Create Machine button is found and highlighted
    if (currentStep === 2) {
      const checkInterval = setInterval(() => {
        const createButton = document.querySelector('#create-machine-button')
        if (createButton) {
          console.log("[Step 2] Found Create Machine button, updating highlight")
          updateHighlightBox()
          clearInterval(checkInterval)
        } else {
          console.log("[Step 2] Create Machine button not found yet, retrying...")
        }
      }, 100)
      
      // Clear after 5 seconds to prevent infinite loop
      setTimeout(() => clearInterval(checkInterval), 5000)
      
      // Also update immediately and after delays
      setTimeout(updateHighlightBox, 100)
      setTimeout(updateHighlightBox, 300)
      setTimeout(updateHighlightBox, 500)
    }
    
    // For step 3, keep checking until Machines link is found and highlighted
    if (currentStep === 3) {
      const checkInterval = setInterval(() => {
        const machinesLink = document.querySelector('#sidebar-machines-link') || 
                            document.querySelector('#sidebar-machines-link-collapsed')
        if (machinesLink) {
          console.log("[Step 3] Found Machines link, updating highlight")
          updateHighlightBox()
          clearInterval(checkInterval)
        } else {
          console.log("[Step 3] Machines link not found yet, retrying...")
        }
      }, 100)
      
      // Clear after 5 seconds to prevent infinite loop
      setTimeout(() => clearInterval(checkInterval), 5000)
      
      // Also update immediately and after delays
      setTimeout(updateHighlightBox, 100)
      setTimeout(updateHighlightBox, 300)
      setTimeout(updateHighlightBox, 500)
    }
    
    const handleResize = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      animationFrameRef.current = requestAnimationFrame(updateHighlightBox)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isOpen, currentStep, updateHighlightBox])

  // Reset guide when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0)
      setIsDropdownOpen(false)
      setMachineCreated(false)
      setIsWaitingForMachine(false)
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "auto"
      // Clear machine check interval if exists
      if (machineCheckIntervalRef.current) {
        clearInterval(machineCheckIntervalRef.current)
        machineCheckIntervalRef.current = null
      }
    }
    
    return () => {
      document.body.style.overflow = "auto"
      if (machineCheckIntervalRef.current) {
        clearInterval(machineCheckIntervalRef.current)
        machineCheckIntervalRef.current = null
      }
    }
  }, [isOpen])
  
  // Ensure dropdown is open when on step 2
  useEffect(() => {
    if (!isOpen || currentStep !== 2) return
    
    console.log("Step 2 active - ensuring dropdown is open")
    
    // Function to check and open dropdown
    const ensureDropdownOpen = () => {
      const listbox = document.querySelector('[role="listbox"]')
      const vmSelectorButton = document.querySelector('#vm-selector-button') as HTMLElement
      
      if (!listbox && vmSelectorButton) {
        console.log("Dropdown not visible, attempting to open")
        // Simulate a click on the VM selector to open dropdown
        vmSelectorButton.click()
        setIsDropdownOpen(true)
      } else if (listbox) {
        console.log("Dropdown is already open")
        setIsDropdownOpen(true)
      }
    }
    
    // Check immediately and after delays to ensure dropdown opens
    ensureDropdownOpen()
    const timer1 = setTimeout(ensureDropdownOpen, 100)
    const timer2 = setTimeout(ensureDropdownOpen, 300)
    const timer3 = setTimeout(ensureDropdownOpen, 500)
    
    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [isOpen, currentStep])
  
  // Expand sidebar when guide is open (for all steps except welcome)
  useEffect(() => {
    if (!isOpen || currentStep === 0) return
    
    console.log(`Step ${currentStep} active - ensuring sidebar is expanded`)
    
    // Function to expand sidebar
    const expandSidebar = () => {
      // Try to find and click the sidebar toggle button
      const sidebarToggle = document.querySelector('[data-sidebar-toggle]') as HTMLElement
      const sidebar = document.querySelector('[data-sidebar]') as HTMLElement
      
      if (sidebarToggle) {
        // Check if sidebar is collapsed
        const isCollapsed = sidebar?.getAttribute('data-state') === 'collapsed'
        if (isCollapsed) {
          console.log("Sidebar is collapsed, expanding it")
          sidebarToggle.click()
        } else {
          console.log("Sidebar is already expanded")
        }
      }
    }
    
    // Expand immediately and after delays
    expandSidebar()
    const timer1 = setTimeout(expandSidebar, 100)
    const timer2 = setTimeout(expandSidebar, 300)
    
    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
    }
  }, [isOpen, currentStep])
  
  // Set up click handlers based on current step
  useEffect(() => {
    if (!isOpen) return
    
    console.log(`[Guide] Setting up click handlers for step ${currentStep}`)
    
    const handleTargetClick = (e: Event) => {
      const target = e.target as HTMLElement
      console.log(`[Guide Step ${currentStep}] Click detected:`, {
        target,
        targetId: target.id,
        targetClass: target.className,
        targetTagName: target.tagName,
        currentStep,
        eventPhase: e.eventPhase,
        bubbles: e.bubbles
      })
      
      // Step 1: VM Selector clicked - advance to step 2
      if (currentStep === 1) {
        // Try multiple ways to find the VM selector
        const vmSelectorButton = document.querySelector('#vm-selector-button')
        const vmSelectorByRole = document.querySelector('[role="combobox"]')
        const vmSelectorByClass = document.querySelector('button[id*="vm-selector"]')
        
        // Log for debugging
        console.log("[Step 1] Checking for VM selector click:", {
          vmSelectorFound: !!vmSelectorButton,
          vmSelectorByRoleFound: !!vmSelectorByRole,
          clickedElement: target,
          clickedId: target.id,
          clickedClass: target.className,
          parentId: target.parentElement?.id,
          parentClass: target.parentElement?.className
        })
        
        // Check if click is on or within the VM selector using multiple strategies
        let isVMSelectorClick = false
        
        // Strategy 1: Check by ID
        if (vmSelectorButton) {
          try {
            isVMSelectorClick = 
              target === vmSelectorButton ||
              (vmSelectorButton.contains && vmSelectorButton.contains(target)) ||
              target.id === 'vm-selector-button'
          } catch (e) {
            console.log("[Step 1] Error checking vmSelectorButton:", e)
          }
        }
        
        // Strategy 2: Check by role attribute
        if (!isVMSelectorClick && vmSelectorByRole) {
          try {
            isVMSelectorClick = 
              target === vmSelectorByRole ||
              (vmSelectorByRole.contains && vmSelectorByRole.contains(target))
          } catch (e) {
            console.log("[Step 1] Error checking vmSelectorByRole:", e)
          }
        }
        
        // Strategy 3: Check using closest
        if (!isVMSelectorClick) {
          try {
            const closestButton = target.closest('button')
            isVMSelectorClick = !!(
              closestButton?.id === 'vm-selector-button' ||
              target.closest('#vm-selector-button') ||
              target.closest('[role="combobox"]')
            )
          } catch (e) {
            console.log("[Step 1] Error checking with closest:", e)
          }
        }
        
        console.log("[Step 1] VM selector click detection result:", isVMSelectorClick)
        
        if (isVMSelectorClick) {
          console.log("[Step 1] ✓ VM selector clicked! Advancing to step 2...")
          e.stopPropagation()
          setIsDropdownOpen(true)
          
          // Advance to step 2 after a short delay
          setTimeout(() => {
            setCurrentStep(2)
            console.log("[Step 1] Advanced to step 2")
            
            // Try to keep dropdown open
            setTimeout(() => {
              const listbox = document.querySelector('[role="listbox"]')
              if (!listbox) {
                const btn = document.querySelector('#vm-selector-button')
                if (btn && typeof (btn as any).click === 'function') {
                  console.log("[Step 2] Reopening dropdown")
                  try {
                    (btn as any).click()
                  } catch (e) {
                    console.log("[Step 2] Error clicking button:", e)
                  }
                }
              }
            }, 100)
          }, 200)
          return
        } else {
          console.log("[Step 1] Not a VM selector click")
        }
      }
      
      // Step 2: VM Selector clicked again or Create Machine clicked - advance to step 3
      if (currentStep === 2) {
        console.log("Step 2 - Checking for clicks:", {
          targetId: target.id,
          targetText: target.textContent,
          targetClass: target.className,
        })
        
        // Check if VM selector was clicked
        const vmSelectorButton = document.querySelector('#vm-selector-button')
        const isVMSelectorClick = 
          vmSelectorButton && (
            target === vmSelectorButton ||
            vmSelectorButton.contains(target) ||
            target.closest('#vm-selector-button') !== null ||
            target.closest('[role="combobox"]') === vmSelectorButton
          )
        
        // Check if Create Machine was clicked
        const createMachineButton = document.querySelector('#create-machine-button')
        const isCreateMachineClick = 
          target.id === 'create-machine-button' ||
          target.closest('#create-machine-button') !== null ||
          target.closest('[data-value="create"]') !== null ||
          (createMachineButton && createMachineButton.contains(target)) ||
          (target.textContent && target.textContent.includes('Create Machine'))
        
        console.log("Step 2 click detection:", {
          isVMSelectorClick,
          isCreateMachineClick
        })
        
        // Advance to step 3 if either VM selector or Create Machine is clicked
        if (isVMSelectorClick || isCreateMachineClick) {
          console.log("Step 2: Click detected, advancing to step 3")
          e.stopPropagation() // Prevent any other handlers
          // Delay to let dialog open or action complete
          setTimeout(() => {
            setCurrentStep(3)
            setIsWaitingForMachine(true)
            startMachineCreationCheck()
          }, 300)
          return
        }
      }
      
      // Step 3: Machine creation dialog - wait for dialog to close or machine to be created
      // This is handled by startMachineCreationCheck
      
      // No step 4 click handling needed - it's the final step
    }
    
    // Use both capture and bubble phase to catch the event
    document.addEventListener('click', handleTargetClick, true) // Capture phase
    document.addEventListener('click', handleTargetClick, false) // Bubble phase
    
    return () => {
      document.removeEventListener('click', handleTargetClick, true)
      document.removeEventListener('click', handleTargetClick, false)
    }
  }, [isOpen, currentStep, startMachineCreationCheck])

  const handleNext = useCallback(() => {
    const nextStep = currentStep + 1
    const nextGuideStep = guideSteps[nextStep]
    
    // Handle account dialog if the next step has an openAccountSection property
    if (nextGuideStep?.openAccountSection) {
      useAccountDialog.getState().open(nextGuideStep.openAccountSection)
      setCurrentStep(nextStep)
    } else {
      // Normal step advancement
      setCurrentStep(nextStep)
    }
    
    console.log(`Moving from step ${currentStep} to step ${nextStep}`)
  }, [currentStep, router])

  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      // Close dropdown if going back from create machine step
      if (currentGuideStep.id === "create-machine") {
        // Close the dropdown by clicking outside or pressing escape
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        document.dispatchEvent(event)
        setIsDropdownOpen(false)
      }
      // Reset waiting state if going back from configure step
      if (currentGuideStep.id === "configure-machine") {
        setIsWaitingForMachine(false)
        setMachineCreated(false)
        if (machineCheckIntervalRef.current) {
          clearInterval(machineCheckIntervalRef.current)
          machineCheckIntervalRef.current = null
        }
      }
      setCurrentStep(currentStep - 1)
    }
  }, [currentStep, currentGuideStep])

  const handleSkip = () => {
    // Close any open dropdowns
    if (isDropdownOpen) {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(event)
    }
    onClose()
  }

  const handleComplete = () => {
    // Open account dialog for the last step
    if (currentGuideStep?.openAccountSection) {
      useAccountDialog.getState().open(currentGuideStep.openAccountSection)
    }
    onClose()
  }

  if (!isOpen) return null

  // Calculate card position based on highlight box
  const getCardPosition = () => {
    // For configure-machine step, always center the card
    if (currentGuideStep.id === "configure-machine") {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }
    
    // On mobile, always center the card on screen
    if (isMobile || !highlightBox || currentGuideStep.position === "center") {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }

    // Desktop card dimensions
    const cardWidth = 400
    const cardHeight = 280
    const safeDistance = 40
    const viewportPadding = 20

    // Element boundaries with safe zone
    const elementBounds = {
      top: highlightBox.top - safeDistance,
      bottom: highlightBox.top + highlightBox.height + safeDistance,
      left: highlightBox.left - safeDistance,
      right: highlightBox.left + highlightBox.width + safeDistance,
      centerX: highlightBox.left + highlightBox.width / 2,
      centerY: highlightBox.top + highlightBox.height / 2
    }

    // Available spaces around the element
    const spaces = {
      above: highlightBox.top - viewportPadding - cardHeight,
      below: window.innerHeight - (highlightBox.top + highlightBox.height) - viewportPadding - cardHeight,
      left: highlightBox.left - viewportPadding - cardWidth,
      right: window.innerWidth - (highlightBox.left + highlightBox.width) - viewportPadding - cardWidth
    }

    let finalPosition = { top: 0, left: 0 }
    let transform = ''

    // Determine best position based on available space
    // Priority: Below > Above > Right > Left
    
    if (spaces.below >= 0) {
      // Position below the element
      finalPosition.top = elementBounds.bottom
      finalPosition.left = Math.max(
        viewportPadding + cardWidth / 2,
        Math.min(
          elementBounds.centerX,
          window.innerWidth - viewportPadding - cardWidth / 2
        )
      )
      transform = 'translateX(-50%)'
    } else if (spaces.above >= 0) {
      // Position above the element
      finalPosition.top = elementBounds.top - cardHeight
      finalPosition.left = Math.max(
        viewportPadding + cardWidth / 2,
        Math.min(
          elementBounds.centerX,
          window.innerWidth - viewportPadding - cardWidth / 2
        )
      )
      transform = 'translateX(-50%)'
    } else if (spaces.right >= 0) {
      // Position to the right of the element
      finalPosition.left = elementBounds.right
      finalPosition.top = Math.max(
        viewportPadding,
        Math.min(
          elementBounds.centerY - cardHeight / 2,
          window.innerHeight - viewportPadding - cardHeight
        )
      )
      transform = ''
    } else if (spaces.left >= 0) {
      // Position to the left of the element
      finalPosition.left = elementBounds.left - cardWidth
      finalPosition.top = Math.max(
        viewportPadding,
        Math.min(
          elementBounds.centerY - cardHeight / 2,
          window.innerHeight - viewportPadding - cardHeight
        )
      )
      transform = ''
    } else {
      // Fallback: Find the position with least overlap
      // Try bottom-right corner if element is top-left
      if (elementBounds.centerX < window.innerWidth / 2 && elementBounds.centerY < window.innerHeight / 2) {
        finalPosition.left = window.innerWidth - viewportPadding - cardWidth
        finalPosition.top = window.innerHeight - viewportPadding - cardHeight
      }
      // Try top-right corner if element is bottom-left
      else if (elementBounds.centerX < window.innerWidth / 2) {
        finalPosition.left = window.innerWidth - viewportPadding - cardWidth
        finalPosition.top = viewportPadding
      }
      // Try bottom-left corner if element is top-right
      else if (elementBounds.centerY < window.innerHeight / 2) {
        finalPosition.left = viewportPadding
        finalPosition.top = window.innerHeight - viewportPadding - cardHeight
      }
      // Try top-left corner
      else {
        finalPosition.left = viewportPadding
        finalPosition.top = viewportPadding
      }
      transform = ''
    }

    // Double-check for any remaining overlap and adjust if necessary
    const cardBounds = {
      top: finalPosition.top,
      bottom: finalPosition.top + cardHeight,
      left: transform === 'translateX(-50%)' ? finalPosition.left - cardWidth / 2 : finalPosition.left,
      right: transform === 'translateX(-50%)' ? finalPosition.left + cardWidth / 2 : finalPosition.left + cardWidth
    }

    // Check if there's still overlap
    const hasOverlap = !(
      cardBounds.bottom < elementBounds.top ||
      cardBounds.top > elementBounds.bottom ||
      cardBounds.right < elementBounds.left ||
      cardBounds.left > elementBounds.right
    )

    if (hasOverlap) {
      // Emergency repositioning - place far below or above
      if (window.innerHeight - elementBounds.bottom > cardHeight + viewportPadding) {
        finalPosition.top = elementBounds.bottom + 10
      } else {
        finalPosition.top = Math.max(viewportPadding, elementBounds.top - cardHeight - 10)
      }
      
      // Center horizontally but ensure it fits
      finalPosition.left = window.innerWidth / 2
      transform = 'translateX(-50%)'
    }

    return {
      top: `${finalPosition.top}px`,
      left: `${finalPosition.left}px`,
      transform,
    }
  }

  const cardPosition = getCardPosition()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile: Flexbox container for perfect centering */}
          {isMobile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100000] flex items-center justify-center p-5 bg-black/80"
              onClick={(e) => {
                // Only close if clicking the backdrop, not the card
                if (e.target === e.currentTarget) handleSkip()
              }}
            >
              {/* Mobile Card - centered with flexbox */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Card className="relative border shadow-2xl bg-background overflow-hidden flex flex-col max-h-[85vh]">
                  {/* Subtle gradient background */}
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-100/50 via-transparent to-gray-200/50 dark:from-gray-800/50 dark:via-transparent dark:to-gray-900/50" />
                  
                  <div className="relative flex flex-col p-3">
                    {/* Close button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 h-6 w-6"
                      onClick={handleSkip}
                    >
                      <X className="h-3 w-3" />
                    </Button>

                    {/* Scrollable content wrapper for mobile */}
                    <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
                      {/* Step indicator - more compact */}
                      <div className="flex items-center gap-1 mb-2">
                        {guideSteps.map((_, index) => (
                          <motion.div
                            key={index}
                            className={cn(
                              "rounded-full transition-all duration-300 h-0.5",
                              index === currentStep 
                                ? "bg-foreground" 
                                : index < currentStep
                                ? "bg-foreground/50"
                                : "bg-muted"
                            )}
                            initial={false}
                            animate={{
                              width: index === currentStep ? 20 : 8,
                            }}
                          />
                        ))}
                      </div>

                      {/* Header with icon and title in same row */}
                      <div className="flex items-start gap-2 mb-2">
                        <motion.div
                          key={currentStep}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                          className="flex-shrink-0"
                        >
                          <div className="relative inline-flex">
                            <div className="absolute inset-0 bg-foreground/10 blur-md" />
                            <div className="relative flex items-center justify-center rounded-lg bg-foreground h-8 w-8">
                              <currentGuideStep.icon className="h-4 w-4 text-background" />
                            </div>
                          </div>
                        </motion.div>

                        {/* Title */}
                        <motion.h3
                          key={`title-${currentStep}`}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 }}
                          className="font-semibold leading-tight break-words flex-1 text-sm pt-1"
                        >
                          {currentGuideStep.title}
                        </motion.h3>
                      </div>

                      {/* Content */}
                      <motion.div
                        key={`content-${currentStep}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                      >
                        <p className="text-muted-foreground break-words text-xs mb-2 leading-normal">
                          {currentGuideStep.description}
                        </p>
                        
                        {currentGuideStep.action && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2, duration: 0.3 }}
                            className="flex items-center gap-2 rounded-md bg-muted/50 border border-border p-1.5"
                          >
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground flex-shrink-0">
                              <motion.span 
                                className="text-[10px] text-background font-bold"
                                animate={{ opacity: [0.5, 1, 0.5] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                              >
                                !
                              </motion.span>
                            </div>
                            <span className="font-medium text-[11px]">{currentGuideStep.action}</span>
                          </motion.div>
                        )}
                      </motion.div>
                    </div>

                    {/* Navigation buttons - keep outside scroll on mobile */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handlePrevious}
                        disabled={isFirstStep}
                        className={cn(
                          "h-6 px-1.5 text-[10px] transition-all",
                          isFirstStep && "opacity-0 pointer-events-none"
                        )}
                      >
                        <ArrowLeft className="h-2.5 w-2.5" />
                      </Button>

                      <span className="text-muted-foreground text-[9px]">
                        {currentStep + 1} / {guideSteps.length}
                      </span>

                      {currentGuideStep.showDone ? (
                        <Button
                          size="sm"
                          onClick={handleComplete}
                          className="bg-foreground hover:bg-foreground/90 text-background h-6 px-2 text-[10px]"
                        >
                          Go to Billing
                          <ArrowRight className="ml-1 h-2.5 w-2.5" />
                        </Button>
                      ) : currentGuideStep.showNext ? (
                        <Button
                          size="sm"
                          onClick={handleNext}
                          className="bg-foreground hover:bg-foreground/90 text-background h-6 px-2 text-[10px]"
                        >
                          {currentStep === 0 ? "Get Started" : "Next"}
                          <ArrowRight className="ml-1 h-2.5 w-2.5" />
                        </Button>
                      ) : (
                        <div className="h-6 px-2" /> // Empty space to maintain layout
                      )}
                    </div>

                    {/* Skip button - show for all steps except welcome and final */}
                    {!currentGuideStep.showNext && !currentGuideStep.showDone && (
                      <div className="text-center mt-2">
                        <button
                          onClick={handleSkip}
                          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                        >
                          Skip tutorial
                        </button>
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          )}
          
          {/* Desktop: Original overlay with cutout - FIXED pointer-events */}
          {!isMobile && (
            <>
              {/* Overlay parts that block clicks */}
              {highlightBox && (
                <>
                  {/* Top overlay */}
                  <div 
                    className="fixed bg-black/60 backdrop-blur-sm z-[100000]"
                    style={{
                      top: 0,
                      left: 0,
                      right: 0,
                      height: Math.max(0, highlightBox.top - 8),
                      pointerEvents: 'auto'
                    }}
                    onClick={handleSkip}
                  />
                  {/* Bottom overlay */}
                  <div 
                    className="fixed bg-black/60 backdrop-blur-sm z-[100000]"
                    style={{
                      top: highlightBox.top + highlightBox.height + 8,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      pointerEvents: 'auto'
                    }}
                    onClick={handleSkip}
                  />
                  {/* Left overlay */}
                  <div 
                    className="fixed bg-black/60 backdrop-blur-sm z-[100000]"
                    style={{
                      top: highlightBox.top - 8,
                      left: 0,
                      width: Math.max(0, highlightBox.left - 8),
                      height: highlightBox.height + 16,
                      pointerEvents: 'auto'
                    }}
                    onClick={handleSkip}
                  />
                  {/* Right overlay */}
                  <div 
                    className="fixed bg-black/60 backdrop-blur-sm z-[100000]"
                    style={{
                      top: highlightBox.top - 8,
                      left: highlightBox.left + highlightBox.width + 8,
                      right: 0,
                      height: highlightBox.height + 16,
                      pointerEvents: 'auto'
                    }}
                    onClick={handleSkip}
                  />
                </>
              )}
              {/* Full overlay when no highlight */}
              {!highlightBox && (
                <div 
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100000]"
                  style={{ pointerEvents: 'auto' }}
                  onClick={handleSkip}
                />
              )}
            </>
          )}

          {/* Highlight outline with glowing beam effect */}
          {highlightBox && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-[100001] pointer-events-none"
              style={{
                top: highlightBox.top - 8,
                left: highlightBox.left - 8,
                width: highlightBox.width + 16,
                height: highlightBox.height + 16,
              }}
            >
              {/* Main glowing border */}
              <div className="absolute inset-0 rounded-lg">
                <motion.div
                  className="absolute inset-0 rounded-lg border-2 border-foreground dark:border-white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  style={{
                    boxShadow: `
                      0 0 20px rgba(128, 128, 128, 0.5),
                      0 0 40px rgba(128, 128, 128, 0.3),
                      0 0 60px rgba(128, 128, 128, 0.2),
                      inset 0 0 20px rgba(128, 128, 128, 0.1)
                    `,
                  }}
                />
              </div>
              
              {/* Animated beam effect */}
              <motion.div
                className="absolute inset-0 rounded-lg overflow-hidden"
              >
                <motion.div
                  className="absolute inset-0 opacity-50"
                  style={{
                    background: `linear-gradient(90deg, 
                      transparent 0%, 
                      rgba(128, 128, 128, 0.2) 50%, 
                      transparent 100%)`,
                  }}
                  animate={{
                    x: ["-100%", "200%"],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </motion.div>
              
              {/* Pulsing glow animation */}
              <motion.div
                className="absolute inset-0 rounded-lg border-2 border-foreground/50 dark:border-white/50"
                animate={{
                  opacity: [0.3, 0.8, 0.3],
                  scale: [1, 1.02, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{
                  boxShadow: `
                    0 0 30px rgba(128, 128, 128, 0.4),
                    0 0 50px rgba(128, 128, 128, 0.2)
                  `,
                }}
              />
              
              {/* Corner accents */}
              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-foreground dark:border-white rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-foreground dark:border-white rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-foreground dark:border-white rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-foreground dark:border-white rounded-br-lg" />
            </motion.div>
          )}
          
          {/* Invisible click zone for step 1 - directly over VM selector to ensure clicks work */}
          {currentStep === 1 && highlightBox && !isMobile && (
            <div 
              className="fixed z-[99999] cursor-pointer"
              style={{
                top: highlightBox.top,
                left: highlightBox.left,
                width: highlightBox.width,
                height: highlightBox.height,
                pointerEvents: 'auto'
              }}
              onClick={(e) => {
                console.log("[Step 1 CRITICAL] VM Selector clicked via click zone!")
                e.stopPropagation()
                
                // First click the actual VM selector to open dropdown
                const vmButton = document.querySelector('#vm-selector-button') as HTMLElement
                if (vmButton && typeof vmButton.click === 'function') {
                  console.log("[Step 1 CRITICAL] Clicking actual VM button")
                  vmButton.click()
                }
                
                setIsDropdownOpen(true)
                
                // Advance to step 2
                setTimeout(() => {
                  setCurrentStep(2)
                  console.log("[Step 1 CRITICAL] Advanced to step 2!")
                }, 300)
              }}
              onMouseDown={(e) => {
                console.log("[Step 1 CRITICAL] Mouse down on click zone")
              }}
            />
          )}
          
          {/* Invisible click zone for step 2 - over Create Machine button */}
          {currentStep === 2 && highlightBox && !isMobile && (
            <div 
              className="fixed z-[99999] cursor-pointer"
              style={{
                top: highlightBox.top,
                left: highlightBox.left,
                width: highlightBox.width,
                height: highlightBox.height,
                pointerEvents: 'auto'
              }}
              onClick={(e) => {
                console.log("[Step 2 CRITICAL] Create Machine clicked via click zone!")
                e.stopPropagation()
                
                // Click the create machine option
                const createButton = document.querySelector('#create-machine-button') as HTMLElement
                if (createButton && typeof createButton.click === 'function') {
                  console.log("[Step 2 CRITICAL] Clicking create machine button")
                  createButton.click()
                }
                
                // Advance to step 3 (Machines tab in sidebar)
                setTimeout(() => {
                  setCurrentStep(3)
                  console.log("[Step 2 CRITICAL] Advanced to step 3 (Machines tab)!")
                }, 300)
              }}
              onMouseDown={(e) => {
                console.log("[Step 2 CRITICAL] Mouse down on create machine zone")
              }}
            />
          )}
          

          {/* Desktop Guide Card */}
          {!isMobile && (
            <motion.div
              drag
              dragMomentum={false}
              dragElastic={0}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="fixed z-[100002]"
              style={{
                ...cardPosition,
                width: 'min(400px, 90vw)',
                maxWidth: '400px',
                cursor: isDragging ? 'grabbing' : 'auto',
              }}
              whileDrag={{ scale: 1.02 }}
              onDragStart={() => setIsDragging(true)}
              onDragEnd={() => setIsDragging(false)}
            >
            <Card className="relative border shadow-2xl bg-background/98 backdrop-blur-sm overflow-visible">
              {/* Subtle gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-blue-500/5" />
              
              <div className={cn(
                "relative flex flex-col",
                isMobile ? "p-3" : "p-4"
              )}>
                {/* Drag handle info for desktop */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 pointer-events-none">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/90 px-2.5 py-1 rounded-full border border-border shadow-sm">
                    <HandGrabbing className="h-3 w-3" />
                    <span>Drag to move</span>
                  </div>
                </div>
                
                {/* Close button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-6 w-6 z-10"
                  onClick={handleSkip}
                >
                  <X className="h-3 w-3" />
                </Button>

                {/* Scrollable content wrapper for mobile */}
                <div className={cn(
                  isMobile ? "max-h-[50vh] overflow-y-auto overscroll-contain" : ""
                )}>
                {/* Step indicator - more compact */}
                <div className={cn("flex items-center gap-1", isMobile ? "mb-2" : "mb-3")}>
                  {guideSteps.map((_, index) => (
                    <motion.div
                      key={index}
                      className={cn(
                        "rounded-full transition-all duration-300",
                        isMobile ? "h-0.5" : "h-1",
                        index === currentStep 
                          ? "bg-foreground" 
                          : index < currentStep
                          ? "bg-foreground/50"
                          : "bg-muted"
                      )}
                      initial={false}
                      animate={{
                        width: index === currentStep ? (isMobile ? 20 : 24) : (isMobile ? 8 : 12),
                      }}
                    />
                  ))}
                </div>

                {/* Header with icon and title in same row */}
                <div className={cn("flex items-start gap-2", isMobile ? "mb-2" : "gap-3 mb-3")}>
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="flex-shrink-0"
                  >
                    <div className="relative inline-flex">
                      <div className="absolute inset-0 bg-foreground/10 blur-md" />
                      <div className={cn(
                        "relative flex items-center justify-center rounded-lg bg-foreground",
                        isMobile ? "h-8 w-8" : "h-9 w-9"
                      )}>
                        <currentGuideStep.icon className={isMobile ? "h-4 w-4 text-background" : "h-5 w-5 text-background"} />
                      </div>
                    </div>
                  </motion.div>

                  {/* Title */}
                  <motion.h3
                    key={`title-${currentStep}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className={cn(
                      "font-semibold leading-tight break-words flex-1",
                      isMobile ? "text-sm pt-1" : "text-base pt-1.5"
                    )}
                  >
                    {currentGuideStep.title}
                  </motion.h3>
                </div>

                {/* Content */}
                <motion.div
                  key={`content-${currentStep}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <p className={cn(
                    "text-muted-foreground break-words",
                    isMobile ? "text-xs mb-2 leading-normal" : "text-sm mb-3 leading-relaxed"
                  )}>
                    {currentGuideStep.description}
                  </p>
                  
                  {currentGuideStep.action && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.3 }}
                      className={cn(
                        "flex items-center gap-2 rounded-md bg-muted/50 border border-border",
                        isMobile ? "p-1.5" : "p-2"
                      )}
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground flex-shrink-0">
                        <motion.span 
                          className="text-[10px] text-background font-bold"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        >
                          !
                        </motion.span>
                      </div>
                      <span className={cn("font-medium", isMobile ? "text-[11px]" : "text-xs")}>{currentGuideStep.action}</span>
                    </motion.div>
                  )}
                </motion.div>
                </div> {/* End scrollable wrapper */}

                {/* Navigation buttons - more compact - keep outside scroll on mobile */}
                <div className={cn(
                  "flex items-center justify-between",
                  isMobile ? "mt-2 pt-2 border-t" : "mt-4"
                )}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePrevious}
                    disabled={isFirstStep}
                    className={cn(
                      isMobile ? "h-6 px-1.5 text-[10px]" : "h-7 px-2 text-xs",
                      "transition-all",
                      isFirstStep && "opacity-0 pointer-events-none"
                    )}
                  >
                    <ArrowLeft className={cn("mr-1", isMobile ? "h-2.5 w-2.5" : "h-3 w-3")} />
                    {!isMobile && "Back"}
                  </Button>

                  <span className={cn("text-muted-foreground", isMobile ? "text-[9px]" : "text-[10px]")}>
                    {currentStep + 1} / {guideSteps.length}
                  </span>

                  {currentGuideStep.showDone ? (
                    <Button
                      size="sm"
                      onClick={handleComplete}
                      className={cn(
                        "bg-foreground hover:bg-foreground/90 text-background",
                        isMobile ? "h-6 px-2 text-[10px]" : "h-7 px-3 text-xs"
                      )}
                    >
                      Go to Billing
                      <ArrowRight className={cn("ml-1", isMobile ? "h-2.5 w-2.5" : "h-3 w-3")} />
                    </Button>
                  ) : currentGuideStep.showNext ? (
                    <Button
                      size="sm"
                      onClick={handleNext}
                      className={cn(
                        "bg-foreground hover:bg-foreground/90 text-background",
                        isMobile ? "h-6 px-2 text-[10px]" : "h-7 px-3 text-xs"
                      )}
                    >
                      {currentStep === 0 ? "Get Started" : "Next"}
                      <ArrowRight className={cn("ml-1", isMobile ? "h-2.5 w-2.5" : "h-3 w-3")} />
                    </Button>
                  ) : (
                    <div className={cn(isMobile ? "h-6 px-2" : "h-7 px-3")} /> // Empty space to maintain layout
                  )}
                </div>

                {/* Skip button - show for all steps except welcome and final */}
                {!currentGuideStep.showNext && !currentGuideStep.showDone && (
                  <div className="text-center mt-2">
                    <button
                      onClick={handleSkip}
                      className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      Skip tutorial
                    </button>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  )
}