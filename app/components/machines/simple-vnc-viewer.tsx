"use client";

import { useState, useEffect } from "react";
import { MousePointer, Copy, CheckCircle, AlertCircle, Monitor, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { UserMachine, MachineSession } from "@/types/machines.types";

interface SimpleVNCViewerProps {
  machine: UserMachine;
  session?: MachineSession | null;
}

export function SimpleVNCViewer({ machine, session }: SimpleVNCViewerProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [currentMachine, setCurrentMachine] = useState(machine);
  
  // Update current machine when prop changes
  useEffect(() => {
    setCurrentMachine(machine);
  }, [machine]);
  
  // Auto-refresh if IP is not assigned
  useEffect(() => {
    if (!currentMachine.publicIpAddress && currentMachine.status === 'running') {
      const timer = setTimeout(() => {
        refreshMachineStatus();
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [currentMachine.publicIpAddress, currentMachine.status]);
  
  const refreshMachineStatus = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/machines/${machine.id}/status`);
      if (response.ok) {
        const data = await response.json();
        
        // Fetch full machine data to get updated info
        const machineResponse = await fetch(`/api/machines/${machine.id}`);
        if (machineResponse.ok) {
          const machineData = await machineResponse.json();
          setCurrentMachine(machineData.machine);
          
          if (machineData.machine.publicIpAddress) {
            toast.success("Machine is ready with IP: " + machineData.machine.publicIpAddress);
          } else {
            toast.info("Machine is running but IP not yet assigned. Try again in a few seconds.");
          }
        }
      }
    } catch (error) {
      toast.error("Failed to refresh machine status");
    } finally {
      setRefreshing(false);
    }
  };
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  const openNoVNC = () => {
    // Always use HTTP for VNC connection
    const protocol = 'http:';
    const websocketPort = currentMachine.websocketPort || 6080;
    
    // VNC protocol truncates passwords to 8 characters.
    // Windows VMs use TightVNC which enforces this strictly.
    const vncPassword = currentMachine.vncPassword?.substring(0, 8) || '';
    const encodedPassword = encodeURIComponent(vncPassword);
    
    const url = `${protocol}//${currentMachine.publicIpAddress}:${websocketPort}/vnc.html?autoconnect=1&resize=scale&password=${encodedPassword}`;
    window.open(url, '_blank');
  };

  if (!currentMachine.publicIpAddress) {
    return (
      <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Connection Not Ready
            </CardTitle>
            <CardDescription>
              The machine is running but waiting for network configuration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                {currentMachine.settings?.provider === 'aws'
                  ? 'Your instance is starting up. A public IP address will be assigned shortly.'
                  : 'Azure is assigning a public IP address to your container. This usually takes 30-60 seconds after the container starts.'}
              </AlertDescription>
            </Alert>
            
            <div className="text-sm text-muted-foreground">
              <p>Machine Status: <span className="font-medium text-foreground">{currentMachine.status}</span></p>
              <p>Container: <span className="font-mono text-xs">{currentMachine.containerName}</span></p>
            </div>
            
            <Button 
              onClick={refreshMachineStatus} 
              disabled={refreshing}
              className="w-full"
            >
              {refreshing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Check for IP Address
                </>
              )}
            </Button>
          </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
        {/* Quick Connect */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Quick Connect
            </CardTitle>
            <CardDescription>
              Click below to open the remote desktop in a new window
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Mobile Warning */}
            <div className="block sm:hidden">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  VNC connections work best on desktop browsers. For mobile access, consider using a VNC app instead.
                </AlertDescription>
              </Alert>
            </div>
            <Button onClick={openNoVNC} size="default" className="w-full">
              <MousePointer className="h-4 w-4 mr-2" />
              Connect to Desktop
            </Button>
            
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs">
                <strong>VNC Password:</strong> The VNC connection password is: <span className="font-mono font-bold">{currentMachine.vncPassword}</span>
                {currentMachine.settings?.provider !== 'aws' && (
                  <>
                    <br />
                    <strong>Desktop Login:</strong> If you see a desktop login screen, use username &quot;desktop&quot; with password: <span className="font-mono font-bold">desktop</span>
                  </>
                )}
              </AlertDescription>
            </Alert>
            {machine.status === "running" && !machine.startedAt && (
              <Alert className="mt-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>First time connection?</strong> If the password doesn't work, try stopping and starting the machine once. This ensures the VNC server is properly configured.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

    </div>
  );
}