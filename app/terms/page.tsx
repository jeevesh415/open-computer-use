"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { ArrowLeft, Shield, Scale, FileText, Users, AlertCircle, Globe, Ban, Clock, Gavel, Heart, HelpCircle, Mail, ChevronRight, Zap, BookOpen } from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion, AnimatePresence } from "framer-motion"

const termsSections = [
  {
    id: "acceptance",
    title: "Acceptance of Terms",
    icon: Shield,
    content: "By accessing and using Coasty, your AI employee that collaborates with everyone, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our service."
  },
  {
    id: "service-description",
    title: "Service Description",
    icon: Zap,
    subsections: [
      {
        title: "What We Provide",
        items: [
          "AI-powered virtual machines and desktop environments",
          "Multi-model AI chat capabilities (OpenAI, Anthropic, Google, etc.)",
          "Collaborative AI workspace features",
          "Code execution and automation tools",
          "Web search and research capabilities"
        ]
      },
      {
        title: "Service Availability",
        items: [
          "Services are provided on an 'as available' basis",
          "We strive for 99.9% uptime but do not guarantee uninterrupted service",
          "Scheduled maintenance will be announced in advance when possible",
          "Features may be added, modified, or removed at our discretion"
        ]
      }
    ]
  },
  {
    id: "user-responsibilities",
    title: "User Responsibilities",
    icon: Users,
    subsections: [
      {
        title: "Account Security",
        items: [
          "You are responsible for maintaining the confidentiality of your account",
          "You must notify us immediately of any unauthorized access",
          "You are responsible for all activities under your account",
          "You must provide accurate and current information"
        ]
      },
      {
        title: "Acceptable Use",
        items: [
          "Use the service in compliance with all applicable laws",
          "Do not use for any illegal or unauthorized purpose",
          "Do not attempt to bypass any security measures",
          "Do not interfere with or disrupt the service",
          "Respect intellectual property rights"
        ]
      },
      {
        title: "Content Guidelines",
        items: [
          "You retain ownership of content you create",
          "You grant us license to use content for service operation",
          "Do not upload malicious code or harmful content",
          "Ensure you have rights to all content you share"
        ]
      }
    ]
  },
  {
    id: "prohibited-uses",
    title: "Prohibited Uses",
    icon: Ban,
    items: [
      "Mining cryptocurrency or any computationally intensive operations unrelated to legitimate use",
      "Launching attacks on other systems or networks",
      "Distributing malware, viruses, or harmful code",
      "Violating privacy of others or collecting personal data without consent",
      "Circumventing usage limits or authentication mechanisms",
      "Using the service for spam or unsolicited communications",
      "Engaging in activities that violate laws or regulations",
      "Reselling or redistributing the service without authorization"
    ]
  },
  {
    id: "virtual-machines",
    title: "Virtual Machines & AI Agents",
    icon: Globe,
    subsections: [
      {
        title: "Resource Limits",
        description: "Virtual machines are subject to the following limitations:",
        items: [
          "Maximum session duration based on your subscription tier",
          "CPU, memory, and storage limits as specified in your plan",
          "Automatic termination after idle timeout",
          "No persistent storage between sessions unless explicitly provided"
        ]
      },
      {
        title: "AI Agent Usage",
        description: "When using AI agents to control virtual machines:",
        items: [
          "You are responsible for all actions performed by AI agents",
          "Monitor AI agent activities to ensure compliance",
          "We log all AI agent actions for security and audit purposes",
          "Automated actions must comply with all terms of service"
        ]
      }
    ]
  },
  {
    id: "payment-billing",
    title: "Payment & Billing",
    icon: Scale,
    subsections: [
      {
        title: "Subscription Terms",
        items: [
          "Subscriptions are billed monthly or annually in advance",
          "Prices may change with 30 days notice",
          "No refunds for partial months or unused resources",
          "You can cancel anytime, effective at end of billing period"
        ]
      },
      {
        title: "Usage-Based Billing",
        items: [
          "Additional usage beyond plan limits will be billed separately",
          "Usage is calculated based on resource consumption",
          "Billing occurs monthly for usage-based charges",
          "Disputes must be raised within 30 days of billing"
        ]
      }
    ]
  },
  {
    id: "usage-quotas",
    title: "Usage Quotas & Unlimited Plans",
    icon: Zap,
    subsections: [
      {
        title: "Starter Plan ($19/month)",
        description: "The Starter plan includes the following monthly quotas:",
        items: [
          "200 credits of AI agent usage per month",
          "Fair usage policy applies to prevent abuse",
          "Usage resets at the beginning of each billing cycle",
          "Overage may result in temporary throttling or suspension"
        ]
      },
      {
        title: "Unlimited Plan ($249/month)",
        description: "The Unlimited plan includes the following monthly quotas:",
        items: [
          "Unlimited AI agent usage per month, subject to the fair usage policy",
          "Priority resource allocation and higher limits",
          "Enhanced fair usage policy with higher thresholds",
          "Usage resets at the beginning of each billing cycle",
          "Premium support for quota-related inquiries"
        ]
      },
      {
        title: "Fair Usage Policy",
        description: "All unlimited plans are subject to reasonable usage limitations:",
        items: [
          "Plans are designed for legitimate business and personal use",
          "Automated high-frequency usage may be subject to review",
          "We reserve the right to suspend accounts for abuse",
          "Users will be notified before any quota-related actions",
          "Contact support for quota increase requests"
        ]
      }
    ]
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    icon: BookOpen,
    subsections: [
      {
        title: "Our Property",
        description: "Coasty and its original content, features, and functionality are owned by us and are protected by international copyright, trademark, and other intellectual property laws."
      },
      {
        title: "Your Content",
        description: "You retain all rights to content you create using our service. By using Coasty, you grant us a worldwide, non-exclusive license to use, reproduce, and distribute your content solely for providing and improving our services."
      },
      {
        title: "AI-Generated Content",
        description: "Content generated by AI models belongs to you, subject to the terms of the underlying AI providers. We make no claims to AI-generated content created through our platform."
      }
    ]
  },
  {
    id: "limitation-liability",
    title: "Limitation of Liability",
    icon: AlertCircle,
    content: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, Coasty SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU IN THE PAST TWELVE MONTHS.",
    highlight: true
  },
  {
    id: "indemnification",
    title: "Indemnification",
    icon: Heart,
    content: "You agree to indemnify and hold harmless Coasty, its affiliates, and their respective officers, directors, employees, and agents from any claims, damages, losses, liabilities, costs, and expenses arising from your use of the service or violation of these terms."
  },
  {
    id: "termination",
    title: "Termination",
    icon: Clock,
    subsections: [
      {
        title: "Termination by You",
        description: "You may terminate your account at any time through your account settings or by contacting support."
      },
      {
        title: "Termination by Us",
        description: "We may terminate or suspend your account immediately, without prior notice, for:",
        items: [
          "Violation of these Terms of Service",
          "Conduct that we believe harms our service or users",
          "Extended period of inactivity",
          "Request by law enforcement or government agencies"
        ]
      },
      {
        title: "Effect of Termination",
        description: "Upon termination, your right to use the service ceases immediately. We may delete your data after a reasonable period, except where required to retain it by law."
      }
    ]
  },
  {
    id: "governing-law",
    title: "Governing Law",
    icon: Gavel,
    content: "These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions. You agree to submit to the personal jurisdiction of the courts located in the United States for the resolution of any disputes."
  },
  {
    id: "changes",
    title: "Changes to Terms",
    icon: FileText,
    content: "We reserve the right to modify these terms at any time. We will notify users of any material changes via email or through the service. Your continued use of Coasty after such modifications constitutes acceptance of the updated terms."
  },
  {
    id: "contact",
    title: "Contact Information",
    icon: Mail,
    content: "If you have any questions about these Terms of Service, please contact us through our GitHub repository or support channels. We aim to respond to all inquiries within 48 hours.",
    cta: true
  }
]

export default function TermsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1
      }
    }
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        duration: 0.4,
        ease: "easeOut" as const
      }
    }
  }

  return (
    <div className="min-h-screen bg-background relative">
      <LandingHeader />

      {/* Main Content */}
      <main className={cn(
        "relative",
        isMobile ? "pt-16" : "pt-20"
      )}>
        {/* Hero Section */}
        <section className={cn(
          "flex items-center justify-center",
          isMobile ? "px-7 py-12" : "px-10 py-20"
        )}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="w-full max-w-6xl"
          >
            <motion.div variants={itemVariants} className="text-center mb-12">
              <Badge variant="outline" className="mb-4">
                <Scale className="mr-1 h-3 w-3" />
                Legal Agreement
              </Badge>
              <h1 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-4xl" : "text-5xl sm:text-6xl"
              )}>
                <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Terms of Service
                </span>
              </h1>
              <p className={cn(
                "text-muted-foreground mx-auto",
                isMobile ? "mt-4 text-base max-w-md" : "mt-6 text-lg sm:text-xl max-w-2xl"
              )}>
                Please read these terms carefully before using Coasty, your AI employee that collaborates with everyone.
              </p>
              <p className="text-sm text-muted-foreground mt-4">
                Effective Date: August 1, 2025
              </p>
            </motion.div>
          </motion.div>
        </section>

        {/* Terms Sections */}
        <section className={cn(
          "py-12",
          isMobile ? "px-7" : "px-10"
        )}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            className="max-w-5xl mx-auto"
          >
            <div className="space-y-6">
              {termsSections.map((section, index) => {
                const Icon = section.icon
                const isActive = activeSection === section.id

                return (
                  <motion.div
                    key={section.id}
                    variants={itemVariants}
                    transition={{ duration: 0.2 }}
                    className="transition-transform duration-200 hover:scale-[1.01]"
                  >
                    <Card 
                      className={cn(
                        "border-muted/50 transition-all cursor-pointer",
                        isActive && "border-primary shadow-xl",
                        section.highlight && "border-orange-500/50 bg-gradient-to-br from-orange-500/5 to-transparent",
                        section.cta && "border-primary/50 bg-gradient-to-br from-primary/5 to-transparent"
                      )}
                      onClick={() => setActiveSection(isActive ? null : section.id)}
                    >
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "p-2 rounded-lg transition-colors",
                              isActive ? "bg-primary text-primary-foreground" : 
                              section.highlight ? "bg-orange-500/10 text-orange-500" : "bg-primary/10"
                            )}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <CardTitle className="text-2xl">
                              {section.title}
                            </CardTitle>
                          </div>
                          <motion.div
                            animate={{ rotate: isActive ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </motion.div>
                        </div>
                      </CardHeader>
                      
                      <AnimatePresence>
                        {isActive && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <CardContent className="pt-0">
                              {/* Simple content */}
                              {section.content && (
                                <p className={cn(
                                  "leading-relaxed",
                                  section.highlight ? "font-mono text-sm text-orange-600 dark:text-orange-400" : "text-muted-foreground"
                                )}>
                                  {section.content}
                                </p>
                              )}

                              {/* Subsections */}
                              {section.subsections && (
                                <div className="space-y-6 mt-4">
                                  {section.subsections.map((subsection, idx) => (
                                    <div 
                                      key={idx}
                                      className="rounded-xl p-4 border bg-background/50 border-border/30"
                                    >
                                      <h3 className="font-semibold mb-3">
                                        {subsection.title}
                                      </h3>
                                      {'description' in subsection && subsection.description && (
                                        <p className="text-sm text-muted-foreground mb-3">
                                          {subsection.description}
                                        </p>
                                      )}
                                      {'items' in subsection && subsection.items && (
                                        <ul className="space-y-2">
                                          {subsection.items.map((item, itemIdx) => (
                                            <li key={itemIdx} className="flex items-start gap-2">
                                              <span className="text-primary mt-1">•</span>
                                              <span className="text-sm text-muted-foreground">{item}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Simple items list */}
                              {section.items && (
                                <ul className="space-y-3 mt-4">
                                  {section.items.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                                      <span className="text-muted-foreground">{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {/* CTA Button */}
                              {section.cta && (
                                <div className="mt-6 flex gap-4">
                                  <Button asChild>
                                    <Link href="https://github.com/coasty-ai" target="_blank">
                                      <Mail className="mr-2 h-4 w-4" />
                                      Contact via GitHub
                                    </Link>
                                  </Button>
                                  <Button variant="outline" asChild>
                                    <Link href="/support">
                                      <HelpCircle className="mr-2 h-4 w-4" />
                                      Support Center
                                    </Link>
                                  </Button>
                                </div>
                              )}
                            </CardContent>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Card>
                  </motion.div>
                )
              })}
            </div>

            {/* Agreement Section */}
            <motion.div 
              variants={itemVariants}
              className="mt-12 p-6 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent"
            >
              <div className="text-center space-y-4">
                <Shield className="h-8 w-8 text-primary mx-auto" />
                <h3 className="text-lg font-semibold">By using Coasty, you agree to these Terms of Service</h3>
                <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                  These terms constitute a legally binding agreement between you and Coasty. 
                  If you do not agree to these terms, you must not use our service.
                </p>
              </div>
            </motion.div>

            {/* Quick Actions */}
            <motion.div 
              variants={itemVariants}
              className="mt-12 text-center"
            >
              <div className="inline-flex flex-col sm:flex-row gap-4">
                <Button variant="outline" size="lg" asChild>
                  <Link href="/">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Home
                  </Link>
                </Button>
                <Button size="lg" asChild>
                  <Link href="/auth">
                    I Agree - Get Started
                  </Link>
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </section>

        <LandingFooter />
      </main>
    </div>
  )
}