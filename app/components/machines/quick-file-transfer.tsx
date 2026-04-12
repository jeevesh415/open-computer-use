"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Download, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface QuickFileTransferProps {
  machineId?: string;
  onFileUpload?: (filename: string) => void;
  onFileDownload?: (filename: string) => void;
}

export function QuickFileTransfer({
  machineId,
  onFileUpload,
  onFileDownload
}: QuickFileTransferProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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

  const handleFileUpload = async (files: FileList) => {
    if (!machineId || !userId || files.length === 0) return;

    setUploading(true);
    
    for (const file of Array.from(files)) {
      try {
        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10MB)`);
          continue;
        }
        
        // Read file content
        const content = await readFileContent(file);
        const encoding = file.type.startsWith('text/') ? 'utf-8' : 'base64';
        
        // Upload via chat API
        const chatId = `quick-upload-${Date.now()}-${file.name}`;
        const message = {
          role: 'user' as const,
          content: `Upload file: ${file.name}`
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

        if (!response.ok) throw new Error(`Failed to upload ${file.name}`);
        
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
                  toast.success(`Uploaded ${file.name} to VM`);
                  onFileUpload?.(file.name);
                }
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    
    setUploading(false);
  };

  const readFileContent = (file: File): Promise<string> => {
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
  };

  const handleQuickDownload = async (filename: string) => {
    if (!machineId || !userId) return;
    
    try {
      const chatId = `quick-download-${Date.now()}-${filename}`;
      const message = {
        role: 'user' as const,
        content: `Download file: ${filename}`
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

      if (!response.ok) throw new Error(`Failed to download ${filename}`);
      
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
                
                // Create download link
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
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                toast.success(`Downloaded ${result.filename}`);
                onFileDownload?.(result.filename);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error downloading ${filename}:`, error);
      toast.error(`Failed to download ${filename}`);
    }
  };

  if (!machineId) {
    return null;
  }

  return (
    <div className="flex gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
      />
      
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload File
          </>
        )}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Quick Download
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Common Files</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleQuickDownload("screenshot.png")}>
            screenshot.png
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickDownload("output.txt")}>
            output.txt
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickDownload("data.json")}>
            data.json
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickDownload("report.pdf")}>
            report.pdf
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleQuickDownload("Downloads/")}>
            Downloads folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickDownload("Documents/")}>
            Documents folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}