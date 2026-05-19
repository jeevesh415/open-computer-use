"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { ArrowLeft, Shield, Lock, Database, Globe, Users, Clock, Mail, FileText, Eye, Download, Trash2, Settings, Baby, Code, Edit, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion, AnimatePresence } from "framer-motion"

const privacySections = [
  {
    id: "introduction",
    title: "Introduction",
    icon: Shield,
    content: "Welcome to Coasty. We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, and safeguard your data when you use your AI employee that collaborates with everyone in your organization."
  },
  {
    id: "data-collection",
    title: "Information We Collect",
    icon: Database,
    subsections: [
      {
        title: "Account Information",
        items: [
          "Email address (when you create an account)",
          "Username or display name (optional)",
          "Profile picture (optional)"
        ]
      },
      {
        title: "Usage Data",
        items: [
          "Virtual machine usage and session data",
          "AI agent interactions and task history",
          "Model preferences and settings",
          "API keys (encrypted with your personal encryption key)"
        ]
      },
      {
        title: "Technical Information",
        items: [
          "IP address",
          "Browser type and version",
          "Device information",
          "Usage patterns and preferences"
        ]
      }
    ]
  },
  {
    id: "data-usage",
    title: "How We Use Your Information",
    icon: Settings,
    items: [
      "Provide and maintain our AI agent and virtual machine services",
      "Store your task history and session data",
      "Enable collaborative features when you choose to use them",
      "Monitor and optimize resource allocation",
      "Ensure security and prevent abuse",
      "Comply with legal obligations"
    ]
  },
  {
    id: "security",
    title: "Data Storage and Security",
    icon: Lock,
    subsections: [
      {
        title: "Encryption",
        description: "All API keys are encrypted using AES-256-GCM encryption with a unique encryption key per user. We never store your API keys in plain text.",
        highlight: true
      },
      {
        title: "Infrastructure Security",
        description: "Your virtual machines run in isolated Azure Container Instances with strict resource limits and security boundaries.",
        items: [
          "Isolated container environments",
          "No data persistence between sessions",
          "Automatic session termination",
          "Resource usage monitoring and limits"
        ]
      },
      {
        title: "Data Storage",
        description: "Your data is stored using Supabase with industry-standard security measures:",
        items: [
          "Row Level Security (RLS) to ensure data isolation",
          "SSL/TLS encryption for data in transit",
          "Regular security audits and updates",
          "Automatic backups and disaster recovery"
        ]
      }
    ]
  },
  {
    id: "third-party",
    title: "Third-Party Services",
    icon: Globe,
    description: "We use Microsoft Azure for all infrastructure and AI model processing. Azure does not store or use your data for training or improvement of their services.",
    features: [
      "Your data is processed transiently and not stored by Azure",
      "Azure does not use customer data to improve their models",
      "All data transmission is encrypted using industry-standard protocols",
      "Azure complies with major privacy regulations including GDPR, HIPAA, and SOC 2"
    ]
  },
  {
    id: "rights",
    title: "Your Rights and Choices",
    icon: Users,
    rights: [
      "Access your personal data",
      "Update or correct your information",
      "Delete your account and associated data",
      "Export your session history",
      "Opt-out of certain features",
      "Control resource allocation limits"
    ]
  },
  {
    id: "retention",
    title: "Data Retention",
    icon: Clock,
    content: "We retain your data as long as your account is active. Virtual machine sessions are automatically terminated after the allocated time, and no data persists on the VMs. You can delete your account data at any time through your account settings."
  },
  {
    id: "children",
    title: "Children's Privacy",
    icon: Baby,
    content: "Our service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13."
  },
  {
    id: "open-source",
    title: "Open Source Considerations",
    icon: Code,
    content: "Coasty is your AI employee that works with your entire team. While the official hosted version follows this privacy policy, we respect your data ownership. All content generated by your AI agents belongs to you, and we will never use it to train our models or share it without your explicit permission."
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    icon: Edit,
    content: "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the \"Last updated\" date."
  },
  {
    id: "contact",
    title: "Contact Us",
    icon: Mail,
    content: "If you have any questions about this Privacy Policy or our data practices, please contact us through our GitHub repository or the contact information provided in the application.",
    cta: true
  }
]

export default function PrivacyPolicyPage() {
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
                <Shield className="mr-1 h-3 w-3" />
                Privacy First
              </Badge>
              <h1 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-4xl" : "text-5xl sm:text-6xl"
              )}>
                <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Your Privacy Matters
                </span>
              </h1>
              <p className={cn(
                "text-muted-foreground mx-auto",
                isMobile ? "mt-4 text-base max-w-md" : "mt-6 text-lg sm:text-xl max-w-2xl"
              )}>
                We take your privacy seriously. Learn how we protect your data while delivering powerful AI agent capabilities.
              </p>
              <p className="text-sm text-muted-foreground mt-4">
                Last updated: August 1, 2025
              </p>
            </motion.div>
          </motion.div>
        </section>

        {/* Privacy Sections */}
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
              {privacySections.map((section, index) => {
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
                        section.cta && "border-primary/50 bg-gradient-to-br from-primary/5 to-transparent"
                      )}
                      onClick={() => setActiveSection(isActive ? null : section.id)}
                    >
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "p-2 rounded-lg transition-colors",
                              isActive ? "bg-primary text-primary-foreground" : "bg-primary/10"
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
                                <p className="text-muted-foreground leading-relaxed">
                                  {section.content}
                                </p>
                              )}

                              {/* Description with features */}
                              {section.description && (
                                <div className="space-y-4">
                                  <p className="text-muted-foreground leading-relaxed">
                                    {section.description}
                                  </p>
                                  {section.features && (
                                    <div className="grid gap-3 mt-4">
                                      {section.features.map((feature, idx) => (
                                        <div key={idx} className="flex items-start gap-3 bg-background/50 rounded-lg p-3 border border-border/30">
                                          <Shield className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                                          <span className="text-sm text-muted-foreground">{feature}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Subsections */}
                              {section.subsections && (
                                <div className="space-y-6 mt-4">
                                  {section.subsections.map((subsection, idx) => (
                                    <div 
                                      key={idx}
                                      className={cn(
                                        "rounded-xl p-4 border",
                                        'highlight' in subsection && subsection.highlight 
                                          ? "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20" 
                                          : "bg-background/50 border-border/30"
                                      )}
                                    >
                                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                                        {'highlight' in subsection && subsection.highlight && <Lock className="h-4 w-4 text-primary" />}
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
                                      <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                      <span className="text-muted-foreground">{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {/* Rights grid */}
                              {section.rights && (
                                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                                  {section.rights.map((right, idx) => {
                                    const icons = [Eye, Download, Trash2, Settings, Edit, Database]
                                    const RightIcon = icons[idx % icons.length]
                                    return (
                                      <div key={idx} className="flex items-center gap-3 bg-gradient-to-br from-primary/5 to-transparent rounded-lg p-3 border border-primary/10">
                                        <RightIcon className="h-4 w-4 text-primary shrink-0" />
                                        <span className="text-sm text-muted-foreground">{right}</span>
                                      </div>
                                    )
                                  })}
                                </div>
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
                    Get Started
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