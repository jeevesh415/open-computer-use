import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface FileTransferOptions {
  machineId?: string;
  onUploadComplete?: (filename: string, filepath: string) => void;
  onDownloadComplete?: (filename: string, content: string) => void;
  onError?: (error: Error) => void;
}

export function useFileTransfer({
  machineId,
  onUploadComplete,
  onDownloadComplete,
  onError
}: FileTransferOptions) {
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // Get authenticated user ID on mount
  useEffect(() => {
    const fetchUserId = async () => {
      const supabase = createClient();
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        setUserId(data?.user?.id ?? null);
      }
    };
    fetchUserId();
  }, []);

  // Upload file to VM
  const uploadFile = useCallback(async (
    file: File | { name: string; content: string; type?: string }
  ) => {
    if (!machineId || !userId) {
      const error = new Error("No machine ID or user ID");
      onError?.(error);
      toast.error("Not initialized");
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      let content: string;
      let encoding: string;
      let filename: string;

      if (file instanceof File) {
        // Handle File object
        filename = file.name;
        
        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`File too large (max 10MB)`);
        }

        // Read file content
        content = await readFileContent(file);
        encoding = file.type.startsWith('text/') ? 'utf-8' : 'base64';
      } else {
        // Handle plain object with content
        filename = file.name;
        content = file.content;
        encoding = file.type?.startsWith('text/') ? 'utf-8' : 'utf-8';
      }

      // Send upload command
      const chatId = `file-upload-${Date.now()}-${filename}`;
      const message = {
        role: 'user' as const,
        content: `Upload file: ${filename}`
      };
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [message],
          model: 'gpt-4',
          chatId: chatId,
          userId: userId,
          machineId: machineId,
          isAuthenticated: true,
          enableSearch: false
        })
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      // Parse streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'tool_result' && data.result?.success) {
                const filepath = data.result.filepath || filename;
                toast.success(`File uploaded: ${filename}`);
                onUploadComplete?.(filename, filepath);
                setProgress(100);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Upload error:', err);
      toast.error(err.message);
      onError?.(err);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [machineId, onUploadComplete, onError]);

  // Download file from VM
  const downloadFile = useCallback(async (filepath: string) => {
    if (!machineId) {
      const error = new Error("No machine ID provided");
      onError?.(error);
      toast.error("No VM selected");
      return;
    }

    setDownloading(true);
    setProgress(0);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          model: 'gpt-4',
          machineId,
          vmCommand: 'file_download',
          vmParameters: {
            filepath: filepath,
            encoding: 'auto'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      // Parse streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'tool_result' && data.result?.success) {
                const result = data.result;
                
                // Create download blob
                let blob: Blob;
                if (result.encoding === 'base64') {
                  // Binary file
                  const binaryString = atob(result.content);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  blob = new Blob([bytes]);
                } else {
                  // Text file
                  blob = new Blob([result.content], { type: 'text/plain' });
                }

                // Create download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                toast.success(`File downloaded: ${result.filename}`);
                onDownloadComplete?.(result.filename, result.content);
                setProgress(100);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Download error:', err);
      toast.error(err.message);
      onError?.(err);
    } finally {
      setDownloading(false);
      setProgress(0);
    }
  }, [machineId, onDownloadComplete, onError]);

  // List files in VM directory
  const listFiles = useCallback(async (dirpath = "/home/desktop/Desktop") => {
    if (!machineId) {
      return { success: false, files: [], error: "No machine ID" };
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          model: 'gpt-4',
          machineId,
          vmCommand: 'file_list_downloads',
          vmParameters: {
            dirpath: dirpath,
            recursive: false,
            max_files: 100
          }
        })
      });

      if (!response.ok) {
        throw new Error(`List files failed: ${response.statusText}`);
      }

      // Parse streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'tool_result' && data.result?.files) {
                return {
                  success: true,
                  files: data.result.files,
                  directory: data.result.directory
                };
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }

      return { success: false, files: [], error: "No files found" };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('List files error:', err);
      return { success: false, files: [], error: err.message };
    }
  }, [machineId]);

  return {
    uploadFile,
    downloadFile,
    listFiles,
    uploading,
    downloading,
    progress
  };
}

// Helper function to read file content
async function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => {
      if (file.type.startsWith('text/')) {
        resolve(reader.result as string);
      } else {
        // Convert binary to base64
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        const binary = bytes.reduce((data, byte) => data + String.fromCharCode(byte), '');
        const base64 = btoa(binary);
        resolve(base64);
      }
    };
    
    reader.onerror = reject;
    
    if (file.type.startsWith('text/')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
}