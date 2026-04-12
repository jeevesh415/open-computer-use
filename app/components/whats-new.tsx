"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sparkles, Search, Globe, Users, Brain, Calendar, Rocket, FileText, Megaphone, Target } from "lucide-react"
import { useTranslations } from "next-intl"

interface Feature {
  title: string
  description: string
  date: string
  type: "major" | "minor" | "improvement"
  icon: React.ReactNode
}

const features: Feature[] = [
  {
    title: "AI Landing Page Generator",
    description: "Launch stunning landing pages in minutes with our AI-powered builder. Just describe your product and watch the magic happen.",
    date: "2025-07-26",
    type: "major",
    icon: <Rocket className="h-4 w-4" />
  },
  {
    title: "AI Employee Collaboration",
    description: "Your AI employee now collaborates seamlessly with your entire team, understanding context and adapting to workflows.",
    date: "2025-07-20",
    type: "major",
    icon: <Target className="h-4 w-4" />
  },
  {
    title: "Press Release Writer",
    description: "Generate professional press releases optimized for tech publications and Product Hunt launches.",
    date: "2025-07-15",
    type: "major", 
    icon: <Megaphone className="h-4 w-4" />
  },
  {
    title: "SEO Content Engine",
    description: "Create SEO-optimized blog posts and documentation that drives organic traffic to your product.",
    date: "2025-07-10",
    type: "major",
    icon: <FileText className="h-4 w-4" />
  },
  {
    title: "Multi-Model Support",
    description: "Compare outputs from ChatGPT, Claude, Gemini and more to get the best content for your launch.",
    date: "2025-07-05",
    type: "major",
    icon: <Brain className="h-4 w-4" />
  }
]

const getTypeColor = (type: Feature["type"]) => {
  switch (type) {
    case "major":
      return "bg-foreground text-background"
    case "minor":
      return "bg-muted-foreground text-background"
    case "improvement":
      return "bg-secondary text-secondary-foreground"
    default:
      return "bg-border text-foreground"
  }
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
}

export function WhatsNew() {
  const t = useTranslations("whatsNew")
  const [open, setOpen] = useState(false)
  const latestFeature = features[0]
  const daysSinceLatest = Math.floor((Date.now() - new Date(latestFeature.date).getTime()) / (1000 * 60 * 60 * 24))
  const isRecent = daysSinceLatest <= 7

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="group relative flex w-full items-center rounded-md text-xs font-medium transition-all bg-muted border border-border hover:bg-muted/80 hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring gap-1.5 px-2 py-1"
        >
          <Sparkles size={14} className="shrink-0" />
          <span className="truncate">{t("trigger")}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl h-[min(85vh,600px)] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 bg-gradient-to-b from-background to-background/80 border-b">
          <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
            <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-sm">
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
              <div className="absolute inset-0 rounded-xl bg-primary/20 blur-xl opacity-50" />
            </div>
            <div className="flex items-center gap-2">
              {t("title")}
              <Badge
                variant="outline"
                className="ml-2 text-[10px] border-primary/30 text-primary bg-primary/5"
              >
                {t("updateCount", { count: features.length })}
              </Badge>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-gradient-to-b from-background/80 to-background">
          <ScrollArea className="h-full px-6 pb-6">
            <div className="space-y-4 pr-4 pt-4">
              {features.map((feature, index) => (
                <div 
                  key={feature.title} 
                  className="relative animate-in slide-in-from-bottom-4 fade-in-50 duration-500"
                  style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'backwards' }}
                >
                  <Card className="relative overflow-hidden hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group border-muted-foreground/10 hover:border-primary/20">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <CardContent className="p-5 relative">
                      <div className="flex items-start gap-4">
                        <div className="relative z-10 shrink-0">
                          <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 group-hover:border-primary/30 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                            <div className="text-primary group-hover:animate-pulse">
                              {feature.icon}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-base text-foreground group-hover:text-primary transition-colors duration-300">
                              {feature.title}
                            </h3>
                            <Badge 
                              variant="secondary" 
                              className={`${getTypeColor(feature.type)} border-0 font-medium px-2.5 py-0.5 text-xs shadow-sm`}
                            >
                              {feature.type === "major" ? t("tagNew") :
                               feature.type === "minor" ? t("tagUpdate") : t("tagFix")}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-sm leading-relaxed mb-3 group-hover:text-muted-foreground/90 transition-colors duration-300">
                            {feature.description}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 group-hover:text-muted-foreground transition-colors duration-300">
                            <Calendar className="h-3 w-3" />
                            {formatDate(feature.date)}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))}
              <div className="relative mt-8 mb-4">
                <Separator className="absolute inset-x-0 top-1/2 -translate-y-1/2" />
                <div className="relative text-center">
                  <span className="bg-background px-4 text-xs text-muted-foreground/70 font-medium">
                    {t("stayTuned")}
                  </span>
                </div>
              </div>
              <div className="text-center pb-4">
                <div className="inline-flex items-center gap-2 text-xs text-muted-foreground/60">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  <span>{t("tagline")}</span>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}