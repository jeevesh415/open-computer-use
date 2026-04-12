"use client"

import { useCallback, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Globe,
  Eye,
  EyeOff,
  ShieldAlert,
  Loader2,
  FileUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PLATFORM_CONFIGS, parseCSV, parseCSVHeaders, detectPlatform } from "@/lib/import-credentials"
import type { ImportPlatform, ParsedCredential } from "@/types/secrets.types"

/* ─── Platform logos via favicon service + known domains ─── */

const PLATFORM_LOGO_DOMAINS: Record<ImportPlatform, string> = {
  chrome: "chrome.google.com",
  firefox: "firefox.com",
  "1password": "1password.com",
  bitwarden: "bitwarden.com",
  lastpass: "lastpass.com",
  keepass: "keepass.info",
}

function PlatformLogo({ platform, size = 32 }: { platform: ImportPlatform; size?: number }) {
  const domain = PLATFORM_LOGO_DOMAINS[platform]
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt={PLATFORM_CONFIGS[platform].label}
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  )
}

/* ─── Types ─── */

type Step = "platform" | "instructions" | "upload" | "preview" | "importing" | "done"

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

/* ─── Animation config ─── */

const ease = [0.22, 1, 0.36, 1] as const
const fadeSlide = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3, ease },
}

/* ─── Component ─── */

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [step, setStep] = useState<Step>("platform")
  const [platform, setPlatform] = useState<ImportPlatform | null>(null)
  const [isGenericUpload, setIsGenericUpload] = useState(false)
  const [detectedPlatform, setDetectedPlatform] = useState<ImportPlatform | null>(null)
  const [credentials, setCredentials] = useState<ParsedCredential[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState(0)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [revealedRows, setRevealedRows] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStep("platform")
    setPlatform(null)
    setIsGenericUpload(false)
    setDetectedPlatform(null)
    setCredentials([])
    setDragOver(false)
    setParseError(null)
    setImportProgress(0)
    setImportResult(null)
    setRevealedRows(new Set())
  }, [])

  function handleOpenChange(open: boolean) {
    if (!open) reset()
    onOpenChange(open)
  }

  function selectPlatform(p: ImportPlatform) {
    setPlatform(p)
    setIsGenericUpload(false)
    setStep("instructions")
  }

  function selectGenericUpload() {
    setIsGenericUpload(true)
    setPlatform(null)
    setStep("upload")
  }

  function processFile(file: File, targetPlatform: ImportPlatform | null) {
    if (!file.name.endsWith(".csv")) {
      setParseError("Please select a CSV file")
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) {
        setParseError("Could not read the file")
        return
      }

      let effectivePlatform = targetPlatform

      // Auto-detect if no platform specified (generic upload)
      if (!effectivePlatform) {
        const headers = parseCSVHeaders(text)
        const detected = detectPlatform(headers)
        if (!detected) {
          setParseError("Could not detect the format. Make sure the CSV was exported from a supported password manager (Chrome, Firefox, 1Password, Bitwarden, LastPass, or KeePass).")
          return
        }
        effectivePlatform = detected
        setDetectedPlatform(detected)
        setPlatform(detected)
      }

      const parsed = parseCSV(text, effectivePlatform)
      if (parsed.length === 0) {
        setParseError("No credentials found in this file. Make sure it matches the expected format.")
        return
      }

      setCredentials(parsed)
      setParseError(null)
      setStep("preview")
    }
    reader.onerror = () => setParseError("Failed to read the file")
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file, isGenericUpload ? null : platform)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file, isGenericUpload ? null : platform)
    e.target.value = ""
  }

  async function handleImport() {
    const validCreds = credentials.filter((c) => c.valid)
    if (validCreds.length === 0) {
      toast.error("No valid credentials to import")
      return
    }

    setStep("importing")
    setImportProgress(0)

    const batchSize = 50
    let totalImported = 0
    let totalSkipped = 0
    const totalBatches = Math.ceil(validCreds.length / batchSize)

    for (let i = 0; i < totalBatches; i++) {
      const batch = validCreds.slice(i * batchSize, (i + 1) * batchSize)

      try {
        const res = await fetch("/api/secrets/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credentials: batch.map((c) => ({
              name: c.name,
              service: c.service,
              username: c.username,
              password: c.password,
              notes: c.notes,
            })),
          }),
        })

        if (res.ok) {
          const data = await res.json()
          totalImported += data.imported ?? 0
          totalSkipped += data.skipped ?? 0
        } else {
          totalSkipped += batch.length
        }
      } catch {
        totalSkipped += batch.length
      }

      setImportProgress(Math.round(((i + 1) / totalBatches) * 100))
    }

    const invalidCount = credentials.filter((c) => !c.valid).length
    setImportResult({ imported: totalImported, skipped: totalSkipped + invalidCount })
    setStep("done")
  }

  function toggleReveal(idx: number) {
    setRevealedRows((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function handleBack() {
    if (step === "instructions") { setStep("platform"); setPlatform(null) }
    else if (step === "upload") { setStep("platform"); setPlatform(null); setIsGenericUpload(false) }
    else if (step === "preview") {
      setCredentials([])
      setDetectedPlatform(null)
      if (isGenericUpload) setStep("upload")
      else setStep("instructions")
    }
  }

  const validCount = credentials.filter((c) => c.valid).length
  const invalidCount = credentials.filter((c) => !c.valid).length
  const config = platform ? PLATFORM_CONFIGS[platform] : null

  /* ─── Upload zone (shared between instructions step and generic upload step) ─── */
  const uploadZone = (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 px-6 cursor-pointer transition-all duration-200",
          dragOver
            ? "border-foreground/40 bg-foreground/[0.04]"
            : "border-border/40 bg-card/30 hover:border-border/60 hover:bg-card/50",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          className="hidden"
        />
        <div className={cn(
          "flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
          dragOver ? "bg-foreground/[0.08]" : "bg-muted/60",
        )}>
          <Upload className={cn(
            "h-5 w-5 transition-colors",
            dragOver ? "text-foreground" : "text-muted-foreground",
          )} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {dragOver ? "Drop your file here" : "Drop your CSV file here"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
      </div>

      {parseError && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{parseError}</p>
        </motion.div>
      )}
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn(
        "sm:max-w-2xl overflow-hidden",
        step === "preview" && "sm:max-w-3xl",
      )}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {step !== "platform" && step !== "importing" && step !== "done" && (
              <button
                onClick={handleBack}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <DialogTitle>
              {step === "platform" && "Import Credentials"}
              {step === "instructions" && `Import from ${config?.label}`}
              {step === "upload" && "Upload CSV File"}
              {step === "preview" && "Review & Import"}
              {step === "importing" && "Importing..."}
              {step === "done" && "Import Complete"}
            </DialogTitle>
          </div>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {/* ─── Step 1: Platform Select ─── */}
          {step === "platform" && (
            <motion.div key="platform" {...fadeSlide} className="py-2">
              <p className="text-sm text-muted-foreground mb-5">
                Select where you want to import passwords from
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(Object.keys(PLATFORM_CONFIGS) as ImportPlatform[]).map((key, i) => {
                  const cfg = PLATFORM_CONFIGS[key]
                  return (
                    <motion.button
                      key={key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: 0.03 + i * 0.04, ease }}
                      onClick={() => selectPlatform(key)}
                      className={cn(
                        "group relative flex flex-col items-center gap-3 rounded-xl p-5 transition-all duration-200",
                        "border border-border/30 bg-card/50",
                        "hover:bg-card/80 hover:border-border/50 hover:shadow-md hover:shadow-foreground/[0.03]",
                        "active:scale-[0.97]",
                      )}
                    >
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="h-10 w-10 flex items-center justify-center">
                        <PlatformLogo platform={key} size={32} />
                      </div>
                      <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                        {cfg.label}
                      </span>
                    </motion.button>
                  )
                })}

                {/* Generic CSV upload option */}
                <motion.button
                  key="csv"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.03 + 6 * 0.04, ease }}
                  onClick={selectGenericUpload}
                  className={cn(
                    "group relative flex flex-col items-center gap-3 rounded-xl p-5 transition-all duration-200",
                    "border border-border/30 bg-card/50",
                    "hover:bg-card/80 hover:border-border/50 hover:shadow-md hover:shadow-foreground/[0.03]",
                    "active:scale-[0.97]",
                  )}
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted/60">
                    <FileUp className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                    CSV File
                  </span>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ─── Step 2a: Instructions + Upload (platform-specific) ─── */}
          {step === "instructions" && config && platform && (
            <motion.div key="instructions" {...fadeSlide} className="py-2 space-y-5">
              <div className="relative rounded-xl border border-border/30 bg-card/30 overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-3">
                    <PlatformLogo platform={platform} size={20} />
                    <p className="text-xs font-medium text-muted-foreground">
                      How to export from {config.label}
                    </p>
                  </div>
                  <ol className="space-y-2.5">
                    {config.instructions.map((instruction, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted/60 text-[11px] font-semibold text-muted-foreground mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-foreground/80 leading-relaxed">{instruction}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {uploadZone}
            </motion.div>
          )}

          {/* ─── Step 2b: Generic CSV Upload ─── */}
          {step === "upload" && (
            <motion.div key="upload" {...fadeSlide} className="py-2 space-y-5">
              <div className="relative rounded-xl border border-border/30 bg-card/30 overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
                <div className="px-5 py-4">
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    Upload a CSV file exported from any supported password manager. We&apos;ll automatically detect the format from the column headers.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(Object.keys(PLATFORM_CONFIGS) as ImportPlatform[]).map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        <PlatformLogo platform={key} size={12} />
                        {PLATFORM_CONFIGS[key].label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {uploadZone}
            </motion.div>
          )}

          {/* ─── Step 3: Preview ─── */}
          {step === "preview" && (
            <motion.div key="preview" {...fadeSlide} className="py-2 space-y-4">
              {/* Stats bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Show detected platform badge */}
                {platform && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
                    <PlatformLogo platform={platform} size={14} />
                    <span className="text-sm font-medium">{PLATFORM_CONFIGS[platform].label}</span>
                    {detectedPlatform && (
                      <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">auto-detected</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{credentials.length} found</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{validCount} valid</span>
                </div>
                {invalidCount > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">{invalidCount} skipped</span>
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="relative rounded-xl border border-border/30 overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
                <div className="max-h-[320px] overflow-y-auto scrollbar-invisible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/30 bg-muted/20 sticky top-0">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-[180px]">Service</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Username</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-[160px]">Password</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground w-[70px]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credentials.slice(0, 200).map((cred, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border/20 last:border-0 transition-colors",
                            !cred.valid && "opacity-50",
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate font-medium">{cred.name}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate pl-[22px]">{cred.service}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs truncate block">{cred.username || "\u2014"}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs truncate flex-1">
                                {revealedRows.has(i) ? cred.password : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                              </span>
                              {cred.password && (
                                <button
                                  onClick={() => toggleReveal(i)}
                                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                >
                                  {revealedRows.has(i) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {cred.valid ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                            ) : (
                              <span title={cred.error}>
                                <AlertTriangle className="h-4 w-4 text-amber-500 mx-auto" />
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {credentials.length > 200 && (
                  <div className="border-t border-border/30 px-4 py-2 bg-muted/20">
                    <p className="text-xs text-muted-foreground text-center">
                      Showing first 200 of {credentials.length} credentials
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleImport} disabled={validCount === 0}>
                  Import {validCount} credential{validCount !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </motion.div>
          )}

          {/* ─── Step 4: Importing ─── */}
          {step === "importing" && (
            <motion.div key="importing" {...fadeSlide} className="py-8 flex flex-col items-center gap-5">
              <div className="relative h-12 w-12">
                <Loader2 className="h-12 w-12 text-foreground/20 animate-spin" />
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium">Encrypting and saving credentials...</p>
                <p className="text-xs text-muted-foreground">{importProgress}% complete</p>
              </div>
              <div className="w-full max-w-xs">
                <Progress value={importProgress} className="h-1.5" />
              </div>
            </motion.div>
          )}

          {/* ─── Step 5: Done ─── */}
          {step === "done" && importResult && (
            <motion.div key="done" {...fadeSlide} className="py-6 flex flex-col items-center gap-5">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, ease }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10"
              >
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </motion.div>

              <div className="text-center space-y-1">
                <p className="text-lg font-semibold">
                  {importResult.imported} credential{importResult.imported !== 1 ? "s" : ""} imported
                </p>
                {importResult.skipped > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {importResult.skipped} skipped (invalid or duplicate)
                  </p>
                )}
              </div>

              {/* Security reminder */}
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 max-w-sm">
                <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  For security, delete the exported CSV file from your computer now — it contains your passwords in plain text.
                </p>
              </div>

              <DialogFooter className="w-full">
                <Button
                  onClick={() => {
                    handleOpenChange(false)
                    onImported()
                  }}
                  className="w-full"
                >
                  Done
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
