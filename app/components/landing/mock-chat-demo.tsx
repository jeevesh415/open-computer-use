"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Paperclip, 
  Send, 
  Sparkles, 
  Monitor,
  Server,
  Globe,
  Cpu,
  HardDrive,
  Activity,
  ChevronDown
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { motion } from "framer-motion"

const dummyMachines = [
  {
    id: "vm-1",
    name: "Personal Workspace",
    status: "running",
    region: "US East",
    specs: "4 vCPUs • 16GB RAM • Ubuntu 22.04",
    icon: Server,
    color: "text-green-500",
  },
  {
    id: "vm-2", 
    name: "AI Assistant Desktop",
    status: "running",
    region: "EU West",
    specs: "8 vCPUs • 32GB RAM • GPU Enabled",
    icon: Cpu,
    color: "text-blue-500",
  },
]

const placeholderMessages = [
  "Build me a React dashboard with real-time data...",
  "Analyze this CSV and create visualizations...",
  "Help me debug this Python script...",
  "Deploy a Node.js API to production...",
  "Create a machine learning model for...",
  "Set up a CI/CD pipeline with GitHub Actions...",
  "Optimize my SQL database queries...",
  "Build a mobile app with React Native...",
]

export function MockChatDemo() {
  const router = useRouter()
  const [selectedMachine, setSelectedMachine] = useState(dummyMachines[0])
  const [placeholder, setPlaceholder] = useState(placeholderMessages[0])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isSmallMobile, setIsSmallMobile] = useState(false)
  
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768)
      setIsSmallMobile(window.innerWidth < 480)
    }
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Rotate placeholder text
  useState(() => {
    const interval = setInterval(() => {
      setPlaceholder(prev => {
        const currentIndex = placeholderMessages.indexOf(prev)
        const nextIndex = (currentIndex + 1) % placeholderMessages.length
        return placeholderMessages[nextIndex]
      })
    }, 3000)
    
    return () => clearInterval(interval)
  })

  const handleInputFocus = () => {
    setIsTyping(true)
  }

  const handleInputBlur = () => {
    if (!inputValue) {
      setIsTyping(false)
    }
  }

  const handleSendClick = () => {
    // Redirect to auth page when user tries to send a message
    router.push('/auth')
  }

  const handleEnterPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && inputValue.trim()) {
      e.preventDefault()
      router.push('/auth')
    }
  }

  return (
    <div className={cn(
      "w-full mx-auto space-y-4",
      isMobile ? "max-w-full px-2" : "max-w-4xl"
    )}>
      {/* Mock Chat Input - Matching Real Design */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative"
      >
        <div className={cn(
          "relative bg-card shadow-sm transition-all duration-300",
          isMobile ? "rounded-xl" : "rounded-2xl",
          isTyping 
            ? "shadow-lg ring-2 ring-primary/20" 
            : "hover:shadow-lg"
        )}>
          
          {/* Main input area */}
          <div className="relative">
            {/* Textarea section */}
            <div className="relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleEnterPress}
                placeholder={isMobile ? "Tell AI what to do..." : "Tell your AI what to do on the computer..."}
                className={cn(
                  "w-full min-h-[44px] bg-transparent outline-none leading-[1.3] placeholder:text-muted-foreground/60 resize-none",
                  isMobile ? "pt-2.5 px-3 pb-1.5 text-sm" : "pt-3 px-4 pb-2 text-base"
                )}
                rows={1}
                style={{ maxHeight: '200px' }}
              />
            </div>

            {/* Bottom actions bar */}
            <div className={cn(
              "w-full flex justify-between items-center",
              isMobile ? "mt-3 px-2 pb-2" : "mt-5 px-3 pb-3"
            )}>
              {/* Left side - File attachment, Research depth and VM selector */}
              <div className={cn(
                "flex items-center",
                isSmallMobile ? "gap-1" : "gap-2"
              )}>
                {/* File Attachment Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "rounded-full hover:bg-secondary transition-all",
                    isMobile ? "size-8" : "size-9"
                  )}
                  disabled
                >
                  <Paperclip className={cn(
                    "text-muted-foreground",
                    isMobile ? "h-3.5 w-3.5" : "h-4 w-4"
                  )} />
                </Button>
                {/* Research Depth Button - Hide on small mobile */}
                {!isSmallMobile && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "font-normal border-0 hover:bg-secondary transition-all",
                      isMobile ? "h-8 text-[11px] px-2" : "h-9 text-xs"
                    )}
                    disabled
                  >
                    <Globe className={cn(
                      isMobile ? "h-3 w-3 mr-1" : "h-3.5 w-3.5 mr-1.5"
                    )} />
                    {isMobile ? "Search" : "Standard Search"}
                    <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                  </Button>
                )}

                {/* VM Selector Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "font-normal border-0 hover:bg-secondary transition-all",
                        isMobile ? "h-8 text-[11px] px-2" : "h-9 text-xs"
                      )}
                    >
                      <selectedMachine.icon className={cn(
                        selectedMachine.color,
                        isMobile ? "h-3 w-3 mr-1" : "h-3.5 w-3.5 mr-1.5"
                      )} />
                      <span className={isSmallMobile ? "max-w-[80px] truncate" : ""}>
                        {isSmallMobile ? selectedMachine.name.split(" ")[0] : selectedMachine.name}
                      </span>
                      <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent 
                    className={cn(
                      "rounded-xl shadow-xl",
                      "bg-white dark:bg-zinc-950",
                      "backdrop-blur-none",
                      isMobile ? "w-64" : "w-72",
                      "z-[9999]"
                    )}
                    align="start"
                    sideOffset={5}
                  >
                    <DropdownMenuLabel className={cn(
                      "font-medium",
                      isMobile ? "text-[11px] py-1.5" : "text-xs py-2"
                    )}>My Computers</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-border/50" />
                    {dummyMachines.map((machine) => (
                      <DropdownMenuItem
                        key={machine.id}
                        onClick={() => setSelectedMachine(machine)}
                        className={cn(
                          "cursor-pointer",
                          "hover:bg-gray-100 dark:hover:bg-zinc-800",
                          "focus:bg-gray-100 dark:focus:bg-zinc-800",
                          isMobile ? "py-1.5" : "py-2"
                        )}
                      >
                        <div className={cn(
                          "flex items-start w-full",
                          isMobile ? "gap-2" : "gap-2.5"
                        )}>
                          <machine.icon className={cn(
                            "mt-0.5", 
                            machine.color,
                            isMobile ? "h-3.5 w-3.5" : "h-4 w-4"
                          )} />
                          <div className="flex-1 space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "font-medium",
                                isMobile ? "text-xs" : "text-sm"
                              )}>{machine.name}</span>
                              <Badge 
                                variant="secondary" 
                                className={cn(
                                  "px-1.5 py-0 border-0",
                                  isMobile ? "text-[9px]" : "text-[10px]",
                                  machine.status === "running" && "bg-green-500/10 text-green-500",
                                  machine.status === "idle" && "bg-orange-500/10 text-orange-500",
                                  machine.status === "processing" && "bg-purple-500/10 text-purple-500"
                                )}
                              >
                                {machine.status}
                              </Badge>
                            </div>
                            <p className={cn(
                              "text-muted-foreground",
                              isMobile ? "text-[10px]" : "text-[11px]"
                            )}>{isMobile && machine.specs.length > 30 ? machine.specs.substring(0, 30) + "..." : machine.specs}</p>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Right side - Send button */}
              <Button
                size="sm"
                className={cn(
                  "rounded-full transition-all duration-300 ease-out",
                  isMobile ? "size-8" : "size-9",
                  inputValue 
                    ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                    : "bg-muted text-muted-foreground"
                )}
                disabled={!inputValue}
                onClick={handleSendClick}
              >
                <Send className={isMobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

    </div>
  )
}