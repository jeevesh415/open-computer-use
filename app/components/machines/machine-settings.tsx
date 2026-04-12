"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Save, Loader2, Shield, Key, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { UserMachine } from "@/types/machines.types";

interface MachineSettingsProps {
  machine: UserMachine;
  onUpdate: () => void;
}

export function MachineSettings({ machine, onUpdate }: MachineSettingsProps) {
  const t = useTranslations("machineSettings");
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(machine.displayName);
  const handleSave = async () => {
    setSaving(true);
    
    try {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.split("=")[1];
      const response = await fetch(`/api/machines/${machine.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf || "" },
        body: JSON.stringify({ displayName }),
      });

      if (!response.ok) {
        throw new Error("Failed to update settings");
      }

      toast.success("Settings updated successfully");
      onUpdate();
    } catch (error) {
      toast.error("Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t("generalSettings")}</CardTitle>
          <CardDescription>
            {t("generalDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">{t("displayName")}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("defaultName")}
            />
          </div>

          <div className="flex items-center justify-between">
            <Button
              onClick={handleSave}
              disabled={saving || displayName === machine.displayName}
              size="sm"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {t("saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t("security")}</CardTitle>
          <CardDescription>
            {t("securityDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {machine.settings?.provider === 'aws' ? (
            <>
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-blue-500" />
                  <p className="text-sm font-medium">{t("sshAuth")}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t("username")} <span className="font-mono">{machine.settings?.sshUsername || 'ubuntu'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("keyPair")} <span className="font-mono">{machine.settings?.awsKeyPairName || 'N/A'}</span>
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/machines/${machine.id}/ssh-key`);
                    if (!response.ok) throw new Error("Failed to download key");
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${machine.settings?.awsKeyPairName || 'key'}.pem`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast.success(t("sshKeyDownloaded"));
                  } catch {
                    toast.error(t("sshKeyFailed"));
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t("downloadSshKey")}
              </Button>
            </>
          ) : (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-medium">{t("vncPassword")}</p>
              </div>
              <p className="text-sm text-muted-foreground font-mono">
                {machine.vncPassword}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("vncPasswordHint")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}