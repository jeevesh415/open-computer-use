"use client";

import { useState } from "react";
import { Send, Loader2, History, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { MachineSession, AIAction } from "@/types/machines.types";

interface AICommandPanelProps {
  session: MachineSession;
  onCommand: (command: string) => void;
}

interface CommandExample {
  title: string;
  command: string;
  category: string;
}

const commandExamples: CommandExample[] = [
  {
    title: "Open browser",
    command: "Open Firefox and go to google.com",
    category: "Navigation",
  },
  {
    title: "Create document",
    command: "Open a text editor and create a new document with meeting notes",
    category: "Productivity",
  },
  {
    title: "Install software",
    command: "Open terminal and install VS Code",
    category: "System",
  },
  {
    title: "Take screenshot",
    command: "Take a screenshot of the current screen",
    category: "Utility",
  },
];

export function AICommandPanel({ session, onCommand }: AICommandPanelProps) {
  const [command, setCommand] = useState("");
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [actions, setActions] = useState<AIAction[]>([]);
  const t = useTranslations("aiCommandPanel");

  const handleExecute = async () => {
    if (!command.trim()) return;

    setExecuting(true);
    const currentCommand = command.trim();
    setCommand("");
    setHistory([currentCommand, ...history]);

    try {
      const response = await fetch("/api/machines/ai/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          command: currentCommand,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Command execution failed");
      }

      const result = await response.json();
      
      if (result.actions) {
        setActions([...result.actions, ...actions]);
      }

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Command executed successfully");
      }

      onCommand(currentCommand);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleExampleClick = (example: CommandExample) => {
    setCommand(example.command);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* Command Examples */}
      <div className="p-4 border-b">
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <History className="h-4 w-4" />
          {t("quickCommands")}
        </h3>
        <div className="space-y-2">
          {commandExamples.map((example, index) => (
            <button
              key={index}
              onClick={() => handleExampleClick(example)}
              className="w-full text-left p-2 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{example.title}</span>
                <Badge variant="secondary" className="text-xs">
                  {example.category}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {example.command}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Action History */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("noActions")}
            </p>
          ) : (
            actions.map((action) => (
              <Card key={action.id} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{action.actionType}</p>
                    {action.actionTarget && (
                      <p className="text-xs text-muted-foreground">
                        Target: {action.actionTarget}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={action.success ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {action.success ? t("success") : t("failed")}
                  </Badge>
                </div>
                {action.errorMessage && (
                  <p className="text-xs text-destructive mt-1">
                    {action.errorMessage}
                  </p>
                )}
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Command Input */}
      <div className="p-4 border-t space-y-2">
        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              handleExecute();
            }
          }}
          placeholder={t("placeholder")}
          className="min-h-[80px]"
          disabled={executing}
        />
        <Button
          onClick={handleExecute}
          disabled={executing || !command.trim()}
          className="w-full"
        >
          {executing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("executing")}
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              {t("executeCommand")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}