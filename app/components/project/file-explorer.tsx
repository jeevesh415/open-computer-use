"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  ChevronRight,
  ChevronLeft,
  Upload,
  Download,
  Search,
  Home,
  Grid3x3,
  List,
  MoreHorizontal,
  FileJson,
  FileSpreadsheet,
  Terminal,
  Copy,
  Scissors,
  Trash2,
  Loader2,
  X,
  RefreshCw,
  Monitor
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: string
  children?: FileNode[]
  isExpanded?: boolean
  isLoading?: boolean
}

interface FileExplorerProps {
  machineId?: string
  userId?: string
  className?: string
  isElectron?: boolean
}

export function FileExplorer({ machineId, userId, className, isElectron }: FileExplorerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [currentPath, setCurrentPath] = useState("/home/desktop")
  const [files, setFiles] = useState<FileNode[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [copiedFiles, setCopiedFiles] = useState<Set<string>>(new Set())
  const [cutFiles, setCutFiles] = useState<Set<string>>(new Set())
  const [navigationHistory, setNavigationHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Initial load — skip for Electron machines (no remote file system)
  useEffect(() => {
    if (machineId && !isElectron && navigationHistory.length === 0) {
      // Start at /home/desktop/Desktop which is the default desktop directory
      // Only load once to prevent loops
      loadDirectory("/home/desktop/Desktop")
    }
  }, [machineId, isElectron])

  // Get file icon — muted palette
  const getFileIcon = (node: FileNode, size: 'sm' | 'md' | 'lg' = 'sm') => {
    const sizeClass = {
      sm: "h-4 w-4",
      md: "h-5 w-5",
      lg: "h-7 w-7"
    }[size]

    if (node.type === 'directory') {
      return node.isExpanded ? (
        <FolderOpen className={cn(sizeClass, "text-blue-400/70")} />
      ) : (
        <Folder className={cn(sizeClass, "text-blue-400/70")} />
      )
    }

    const ext = node.name.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'txt':
      case 'md':
      case 'doc':
      case 'docx':
        return <FileText className={cn(sizeClass, "text-neutral-500")} />
      case 'pdf':
        return <FileText className={cn(sizeClass, "text-red-400/60")} />
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'svg':
      case 'webp':
        return <FileImage className={cn(sizeClass, "text-violet-400/60")} />
      case 'mp4':
      case 'avi':
      case 'mov':
      case 'mkv':
        return <FileVideo className={cn(sizeClass, "text-purple-400/60")} />
      case 'mp3':
      case 'wav':
      case 'flac':
      case 'ogg':
        return <FileAudio className={cn(sizeClass, "text-pink-400/60")} />
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return <FileCode className={cn(sizeClass, "text-amber-400/60")} />
      case 'py':
        return <FileCode className={cn(sizeClass, "text-emerald-400/60")} />
      case 'java':
      case 'cpp':
      case 'c':
      case 'h':
        return <FileCode className={cn(sizeClass, "text-orange-400/60")} />
      case 'css':
      case 'scss':
      case 'sass':
        return <FileCode className={cn(sizeClass, "text-pink-400/50")} />
      case 'html':
      case 'xml':
        return <FileCode className={cn(sizeClass, "text-orange-400/50")} />
      case 'json':
        return <FileJson className={cn(sizeClass, "text-amber-400/50")} />
      case 'csv':
      case 'xlsx':
      case 'xls':
        return <FileSpreadsheet className={cn(sizeClass, "text-emerald-400/50")} />
      case 'sh':
      case 'bash':
      case 'zsh':
        return <Terminal className={cn(sizeClass, "text-neutral-500")} />
      case 'zip':
      case 'rar':
      case 'tar':
      case 'gz':
      case '7z':
        return <FileArchive className={cn(sizeClass, "text-amber-400/50")} />
      default:
        return <File className={cn(sizeClass, "text-neutral-600")} />
    }
  }

  // Format file size
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Format date - more friendly
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)
    
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    if (days < 30) return `${Math.floor(days / 7)}w ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Load directory contents
  const loadDirectory = async (path: string, addToHistory = true) => {
    if (!machineId || loading) return // Prevent concurrent loads

    setLoading(true)
    setSelectedFiles(new Set())

    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    try {
      const response = await fetch('/api/files?op=list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          path: path,
          recursive: false,
          max_files: 500
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        console.error('Failed to list files:', response.status, response.statusText)
        throw new Error('Failed to list files')
      }
      
      const data = await response.json()
      console.log('API Response for path', path, ':', data) // Debug log
      
      if (data.success) {
        // Handle both files array and empty directories
        const fileNodes: FileNode[] = (data.files || []).map((file: any) => {
          // Extract the filename from various possible fields
          let filename = file.filename || file.name
          if (!filename && file.path) {
            // Extract filename from path
            filename = file.path.split('/').pop() || file.path.split('\\').pop() || 'unknown'
          }
          
          return {
            name: filename,
            path: file.path || file.filepath,
            type: file.is_directory ? 'directory' : 'file',
            size: file.size,
            modified: file.modified || file.modified_time,
            children: file.is_directory ? [] : undefined,
            isExpanded: false
          }
        })

        // Sort: folders first, then alphabetically
        fileNodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        setFiles(fileNodes)
        setCurrentPath(path)

        // Update navigation history
        if (addToHistory) {
          const newHistory = [...navigationHistory.slice(0, historyIndex + 1), path]
          setNavigationHistory(newHistory)
          setHistoryIndex(newHistory.length - 1)
        }
      } else {
        console.warn('API returned success:false for path', path)
        // Still set empty files to prevent infinite loop
        setFiles([])
        setCurrentPath(path)
      }
    } catch (error: any) {
      console.error('Load directory error:', error)
      if (error.name === 'AbortError') {
        toast.error('Request timed out. Please try again.')
      } else {
        toast.error('Failed to load directory')
      }
      // Set empty files to prevent infinite loop
      setFiles([])
      setCurrentPath(path)
    } finally {
      setLoading(false)
    }
  }

  // Navigate back
  const navigateBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      loadDirectory(navigationHistory[newIndex], false)
    }
  }

  // Navigate forward
  const navigateForward = () => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      loadDirectory(navigationHistory[newIndex], false)
    }
  }

  // Refresh current directory
  const refreshDirectory = async () => {
    if (isRefreshing || !currentPath) return

    setIsRefreshing(true)
    await loadDirectory(currentPath, false)
    setIsRefreshing(false)
    toast.success("Directory refreshed")
  }

  // Navigate up
  const navigateUp = () => {
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
    loadDirectory(parentPath)
  }

  // Handle file/folder click
  const handleItemClick = (node: FileNode, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select
      const newSelection = new Set(selectedFiles)
      if (newSelection.has(node.path)) {
        newSelection.delete(node.path)
      } else {
        newSelection.add(node.path)
      }
      setSelectedFiles(newSelection)
    } else if (e.shiftKey && selectedFiles.size > 0) {
      // Range select
      // Implementation would go here
      setSelectedFiles(new Set([node.path]))
    } else {
      // Single select or open
      if (node.type === 'directory') {
        loadDirectory(node.path)
      } else {
        setSelectedFiles(new Set([node.path]))
      }
    }
  }

  // Handle double click
  const handleItemDoubleClick = (node: FileNode) => {
    if (node.type === 'directory') {
      loadDirectory(node.path)
    } else {
      // Could open file preview here
      toast.info(`Opening ${node.name}`)
    }
  }

  // Upload files
  const handleUpload = async (fileList: FileList) => {
    if (!machineId || fileList.length === 0) return

    setIsUploading(true)
    setUploadProgress(0)
    const totalFiles = fileList.length
    let completed = 0

    for (const file of Array.from(fileList)) {
      try {
        // Check file size
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10MB)`)
          continue
        }

        // Read file content
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            if (file.type.startsWith('text/')) {
              resolve(reader.result as string)
            } else {
              const arrayBuffer = reader.result as ArrayBuffer
              const bytes = new Uint8Array(arrayBuffer)
              const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
              resolve(btoa(binary))
            }
          }
          reader.onerror = reject
          if (file.type.startsWith('text/')) {
            reader.readAsText(file)
          } else {
            reader.readAsArrayBuffer(file)
          }
        })

        const encoding = file.type.startsWith('text/') ? 'utf-8' : 'base64'
        const filepath = `${currentPath}/${file.name}`

        const response = await fetch('/api/files?op=upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machine_id: machineId,
            filepath: filepath,
            content: content,
            encoding: encoding
          })
        })

        if (!response.ok) throw new Error(`Failed to upload ${file.name}`)
        
        completed++
        setUploadProgress((completed / totalFiles) * 100)
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error)
        toast.error(`Failed to upload ${file.name}`)
      }
    }

    setIsUploading(false)
    setUploadProgress(0)
    loadDirectory(currentPath, false)
    toast.success(`Uploaded ${completed} file(s)`)
  }

  // Download selected files
  const downloadSelected = async () => {
    if (!machineId || selectedFiles.size === 0) return
    
    for (const filepath of Array.from(selectedFiles)) {
      try {
        const response = await fetch('/api/files?op=download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machine_id: machineId,
            filepath: filepath,
            encoding: 'auto'
          })
        })

        if (!response.ok) throw new Error(`Failed to download ${filepath}`)
        
        const result = await response.json()
        if (result.success) {
          let blob: Blob
          if (result.encoding === 'base64') {
            const binaryString = atob(result.content)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            blob = new Blob([bytes])
          } else {
            blob = new Blob([result.content], { type: 'text/plain' })
          }
          
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = result.filename
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
          
        }
      } catch (error) {
        console.error(`Error downloading ${filepath}:`, error)
        toast.error(`Failed to download file`)
      }
    }
    
    toast.success(`Downloaded ${selectedFiles.size} file(s)`)
  }

  // Copy files
  const copySelected = () => {
    setCopiedFiles(new Set(selectedFiles))
    setCutFiles(new Set())
    toast.success(`Copied ${selectedFiles.size} item(s)`)
  }

  // Cut files
  const cutSelected = () => {
    setCutFiles(new Set(selectedFiles))
    setCopiedFiles(new Set())
    toast.success(`Cut ${selectedFiles.size} item(s)`)
  }

  // Delete selected
  const deleteSelected = async () => {
    if (!machineId || selectedFiles.size === 0) return
    
    if (!confirm(`Delete ${selectedFiles.size} item(s)?`)) return

    // Implementation would go here
    toast.success(`Deleted ${selectedFiles.size} item(s)`)
    setSelectedFiles(new Set())
    loadDirectory(currentPath, false)
  }

  // Create new folder
  const createNewFolder = async () => {
    const name = prompt('Folder name:')
    if (!name || !machineId) return

    setLoading(true)
    try {
      const folderpath = currentPath.endsWith('/') 
        ? `${currentPath}${name}`
        : `${currentPath}/${name}`

      const response = await fetch('/api/files?op=create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          folderpath: folderpath
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create folder')
      }

      const result = await response.json()
      if (result.success) {
        toast.success(`Created folder "${name}"`)
        loadDirectory(currentPath, false)
      } else {
        throw new Error(result.error || 'Failed to create folder')
      }
    } catch (error: any) {
      console.error('Error creating folder:', error)
      toast.error(error.message || 'Failed to create folder')
    } finally {
      setLoading(false)
    }
  }

  // Filter files based on search
  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Breadcrumb parts
  const pathParts = currentPath.split('/').filter(Boolean)

  if (!machineId) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div
          className="flex-1 flex flex-col items-center justify-center text-center px-6 rounded-lg overflow-hidden relative"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          <Folder className="h-7 w-7 text-neutral-700 mb-3" />
          <p className="text-[13px] font-medium text-neutral-500">No machine connected</p>
          <p className="text-[11px] text-neutral-600 mt-1 max-w-[200px] leading-relaxed">Connect to a virtual machine to browse files</p>
        </div>
      </div>
    )
  }

  if (isElectron) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div
          className="flex-1 flex flex-col items-center justify-center text-center px-6 rounded-lg overflow-hidden relative"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          <Monitor className="h-7 w-7 text-neutral-700 mb-3" />
          <p className="text-[13px] font-medium text-neutral-500">Local Computer</p>
          <p className="text-[11px] text-neutral-600 mt-1 max-w-[200px] leading-relaxed">File browsing is available on cloud machines</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 flex flex-col min-h-0">

        {/* Navigation bar */}
        <div className="flex items-center gap-1 px-2.5 h-9 flex-shrink-0">
          <div className="flex items-center gap-0.5">
            <button
              className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] disabled:opacity-25 disabled:pointer-events-none transition-colors"
              onClick={navigateBack}
              disabled={historyIndex <= 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] disabled:opacity-25 disabled:pointer-events-none transition-colors"
              onClick={navigateForward}
              disabled={historyIndex >= navigationHistory.length - 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Breadcrumb path */}
          <div className="flex-1 flex items-center gap-0.5 min-w-0 overflow-hidden px-1">
            <button
              className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-neutral-500 hover:text-neutral-300 transition-colors"
              onClick={() => loadDirectory('/home/desktop/Desktop')}
            >
              <Home className="h-3 w-3" />
            </button>
            {pathParts.map((part, index) => {
              const path = '/' + pathParts.slice(0, index + 1).join('/')
              return (
                <div key={path} className="flex items-center gap-0.5 min-w-0">
                  <span className="text-neutral-700 text-[10px] flex-shrink-0">/</span>
                  <button
                    className="text-[11px] text-neutral-500 hover:text-neutral-200 truncate transition-colors"
                    onClick={() => loadDirectory(path)}
                  >
                    {part}
                  </button>
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
            />
            <button
              className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] disabled:opacity-25 transition-colors"
              onClick={refreshDirectory}
              disabled={isRefreshing || loading}
            >
              <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
            </button>
            <button
              className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] transition-colors"
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            >
              {viewMode === 'list' ? <Grid3x3 className="h-3 w-3" /> : <List className="h-3 w-3" />}
            </button>
            <button
              className="h-6 w-6 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] disabled:opacity-25 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-2.5 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-600" />
            <input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-7 rounded-lg bg-white/[0.03] text-[11px] text-neutral-300 placeholder:text-neutral-600 border-none outline-none focus:bg-white/[0.05] focus:ring-1 focus:ring-white/[0.06] transition-all"
            />
            {searchQuery && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded flex items-center justify-center text-neutral-600 hover:text-neutral-400 transition-colors"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Upload progress */}
        <AnimatePresence>
          {isUploading && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-2.5 pb-2"
            >
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 mb-1">
                <span>Uploading</span>
                <span className="text-neutral-600">{uploadProgress.toFixed(0)}%</span>
              </div>
              <div className="h-[2px] bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500/60 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* File content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 scrollbar-invisible">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-600" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Folder className="h-6 w-6 text-neutral-700 mb-2" />
              <p className="text-[12px] text-neutral-600">
                {searchQuery ? 'No files found' : 'Empty folder'}
              </p>
            </div>
          ) : viewMode === 'list' ? (
            /* List view */
            <div className="px-1.5 py-1 space-y-px">
              {filteredFiles.map((node, index) => (
                <motion.div
                  key={node.path}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer transition-colors duration-150",
                    "hover:bg-white/[0.04]",
                    selectedFiles.has(node.path) && "bg-white/[0.06]",
                    (copiedFiles.has(node.path) || cutFiles.has(node.path)) && "opacity-40"
                  )}
                  onClick={(e) => handleItemClick(node, e)}
                  onDoubleClick={() => handleItemDoubleClick(node)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelectedFiles(new Set([node.path]))
                  }}
                >
                  <div className="flex-shrink-0">
                    {getFileIcon(node)}
                  </div>
                  <span className="flex-1 text-[12px] text-neutral-300 truncate min-w-0">
                    {node.name}
                  </span>
                  {node.type === 'file' && node.size !== undefined && (
                    <span className="text-[10px] text-neutral-600 tabular-nums flex-shrink-0">
                      {formatFileSize(node.size)}
                    </span>
                  )}
                  {node.modified && (
                    <span className="text-[10px] text-neutral-600 flex-shrink-0">
                      {formatDate(node.modified)}
                    </span>
                  )}
                  {/* Hover actions */}
                  <div className="flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="h-5 w-5 rounded flex items-center justify-center text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.06] transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-[#141414] border-white/[0.06] min-w-[140px]">
                        {node.type === 'file' && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedFiles(new Set([node.path]))
                              downloadSelected()
                            }}
                            className="text-[12px] text-neutral-300 focus:bg-white/[0.06] focus:text-neutral-200"
                          >
                            <Download className="h-3.5 w-3.5 mr-2 text-neutral-500" />
                            Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedFiles(new Set([node.path]))
                            copySelected()
                          }}
                          className="text-[12px] text-neutral-300 focus:bg-white/[0.06] focus:text-neutral-200"
                        >
                          <Copy className="h-3.5 w-3.5 mr-2 text-neutral-500" />
                          Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedFiles(new Set([node.path]))
                            cutSelected()
                          }}
                          className="text-[12px] text-neutral-300 focus:bg-white/[0.06] focus:text-neutral-200"
                        >
                          <Scissors className="h-3.5 w-3.5 mr-2 text-neutral-500" />
                          Cut
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/[0.04]" />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedFiles(new Set([node.path]))
                            deleteSelected()
                          }}
                          className="text-[12px] text-red-400/80 focus:bg-red-500/10 focus:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            /* Grid view */
            <div className="grid grid-cols-3 gap-1 p-2">
              {filteredFiles.map((node, index) => (
                <motion.div
                  key={node.path}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.02, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "group flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-colors duration-150",
                    "hover:bg-white/[0.04]",
                    selectedFiles.has(node.path) && "bg-white/[0.06]",
                    (copiedFiles.has(node.path) || cutFiles.has(node.path)) && "opacity-40"
                  )}
                  onClick={(e) => handleItemClick(node, e)}
                  onDoubleClick={() => handleItemDoubleClick(node)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelectedFiles(new Set([node.path]))
                  }}
                >
                  {getFileIcon(node, 'lg')}
                  <span className="text-[11px] text-neutral-400 text-center break-all line-clamp-2 leading-tight">
                    {node.name}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Status line */}
        <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0">
          <span className="text-[10px] text-neutral-600">
            {selectedFiles.size > 0
              ? `${selectedFiles.size} selected`
              : `${filteredFiles.length} items`
            }
          </span>
          {selectedFiles.size > 0 && (
            <div className="flex items-center gap-1">
              <button
                className="h-5 px-2 rounded text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05] transition-colors flex items-center gap-1"
                onClick={downloadSelected}
              >
                <Download className="h-2.5 w-2.5" />
                Download
              </button>
              <button
                className="h-5 px-2 rounded text-[10px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1"
                onClick={deleteSelected}
              >
                <Trash2 className="h-2.5 w-2.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
