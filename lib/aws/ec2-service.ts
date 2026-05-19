import zlib from "zlib";
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  CreateKeyPairCommand,
  DeleteKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  DescribeImagesCommand,
  CreateImageCommand,
  DeregisterImageCommand,
  DescribeSnapshotsCommand,
  DeleteSnapshotCommand,
  type Instance,
  type _InstanceType,
  type RunInstancesCommandInput,
} from "@aws-sdk/client-ec2";

export interface EC2InstanceConfig {
  name?: string;
  instanceType?: string;
  amiId?: string;
  storageGb?: number;
  desktopEnabled?: boolean;
  vncPassword?: string;
  /** AMI ID from a previous machine snapshot — restores full machine state */
  snapshotAmiId?: string;
  /** Operating system type — 'linux' (default, ARM64 Ubuntu) or 'windows' (x86_64 Windows Server) */
  osType?: 'linux' | 'windows';
}

export interface EC2InstanceStatus {
  state: "creating" | "running" | "stopped" | "failed";
  ipAddress?: string;
  publicDnsName?: string;
  message?: string;
}

export interface EC2CreateResult {
  instanceId: string;
  keyPairName: string;
  privateKeyPem: string;
}

export class AwsEc2Service {
  private client: EC2Client;
  private region: string;
  private cachedSecurityGroupIds: Map<string, string> = new Map();
  private cachedAmiId: string | null = null;
  private cachedWindowsAmiId: string | null = null;

  constructor() {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || "us-east-1";

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are required"
      );
    }

    this.region = region;
    this.client = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async createInstance(
    userId: string,
    config: EC2InstanceConfig
  ): Promise<EC2CreateResult> {
    const maxRetries = 3;
    const baseDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.createInstanceInternal(userId, config);
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;

        if (!this.isRetryableError(error) || isLastAttempt) {
          console.error(
            `AWS EC2 instance creation failed after ${attempt} attempts:`,
            error
          );
          throw error;
        }

        const delay =
          baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(
          `AWS EC2 creation failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms...`,
          { error: error.message, code: error.code }
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error("EC2 instance creation failed after all retry attempts");
  }

  private async createInstanceInternal(
    userId: string,
    config: EC2InstanceConfig
  ): Promise<EC2CreateResult> {
    const isWindows = config.osType === 'windows';

    // Instance type selection:
    // - Windows: x86_64 t3 instances (ARM64 not available for Windows)
    // - Linux: ARM64 t4g instances (cheaper Graviton2)
    let instanceType: string;
    if (isWindows) {
      instanceType = config.instanceType || process.env.AWS_EC2_WINDOWS_INSTANCE_TYPE || "t3.small";
    } else {
      instanceType = config.instanceType || process.env.AWS_EC2_INSTANCE_TYPE || "t4g.nano";
      if (config.desktopEnabled) {
        instanceType = "t4g.small";
      }
    }

    // Windows needs more storage (OS alone uses ~15GB)
    const storageGb = config.storageGb || (isWindows ? 30 : (config.desktopEnabled ? 16 : 8));

    // Ensure security group exists
    const securityGroupId = await this.ensureSecurityGroup(config.desktopEnabled, isWindows);

    // Generate key pair
    const keyPrefix = process.env.AWS_EC2_KEY_PREFIX || "llmhub";
    const shortId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const keyPairName = `${keyPrefix}-${userId.substring(0, 8)}-${shortId}`;

    const createKeyResult = await this.client.send(
      new CreateKeyPairCommand({
        KeyName: keyPairName,
        // Windows uses RSA key pairs (ed25519 not supported for Windows password decryption)
        KeyType: isWindows ? "rsa" : "ed25519",
      })
    );

    const privateKeyPem = createKeyResult.KeyMaterial;
    if (!privateKeyPem) {
      throw new Error("Failed to generate SSH key pair: no key material returned");
    }

    // Resolve AMI — snapshot AMI (user's saved state) > golden AMI > stock OS
    const snapshotAmiId = config.snapshotAmiId;
    let amiId: string;
    let goldenAmiId: string | undefined;

    if (isWindows) {
      goldenAmiId = process.env.AWS_EC2_WINDOWS_GOLDEN_AMI_ID || undefined;
      amiId = snapshotAmiId || goldenAmiId || config.amiId || process.env.AWS_EC2_WINDOWS_AMI_ID || (await this.resolveWindowsAmi());
    } else {
      goldenAmiId = process.env.AWS_EC2_GOLDEN_AMI_ID || undefined;
      amiId = snapshotAmiId || goldenAmiId || config.amiId || process.env.AWS_EC2_AMI_ID || (await this.resolveUbuntuAmi());
    }

    // Build instance name tag
    const instanceName = config.name || `llmhub-${userId.substring(0, 8)}-${shortId}`;

    // Build RunInstances input
    const runInput: RunInstancesCommandInput = {
      ImageId: amiId,
      InstanceType: instanceType as _InstanceType,
      MinCount: 1,
      MaxCount: 1,
      KeyName: keyPairName,
      SecurityGroupIds: [securityGroupId],
      BlockDeviceMappings: [
        {
          DeviceName: isWindows ? "/dev/sda1" : "/dev/sda1",
          Ebs: {
            VolumeSize: storageGb,
            VolumeType: "gp3",
            DeleteOnTermination: true,
          },
        },
      ],
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [
            { Key: "Name", Value: instanceName },
            { Key: "UserId", Value: userId },
            { Key: "ManagedBy", Value: "llmhub" },
            { Key: "DesktopEnabled", Value: config.desktopEnabled ? "true" : "false" },
            { Key: "OsType", Value: isWindows ? "windows" : "linux" },
          ],
        },
      ],
    };

    // Add UserData
    if (isWindows && config.vncPassword) {
      // Windows: PowerShell UserData wrapped in <powershell> tags
      const useSlimUserData = snapshotAmiId || goldenAmiId;
      runInput.UserData = useSlimUserData
        ? this.generateWindowsGoldenUserData(config.vncPassword)
        : this.generateWindowsDesktopUserData(config.vncPassword);
    } else if (config.desktopEnabled && config.vncPassword) {
      // Linux: bash cloud-init UserData
      const useSlimUserData = snapshotAmiId || goldenAmiId;
      runInput.UserData = useSlimUserData
        ? this.generateGoldenAmiUserData(config.vncPassword)
        : this.generateDesktopUserData(config.vncPassword);
    }

    // Launch instance
    const runResult = await this.client.send(
      new RunInstancesCommand(runInput)
    );

    const instanceId = runResult.Instances?.[0]?.InstanceId;
    if (!instanceId) {
      // Clean up key pair if instance launch failed
      await this.client.send(
        new DeleteKeyPairCommand({ KeyName: keyPairName })
      ).catch(() => {});
      throw new Error("Failed to launch EC2 instance: no instance ID returned");
    }

    return {
      instanceId,
      keyPairName,
      privateKeyPem,
    };
  }

  async getInstanceStatus(instanceId: string): Promise<EC2InstanceStatus> {
    try {
      const result = await this.client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = result.Reservations?.[0]?.Instances?.[0];
      if (!instance) {
        return { state: "failed", message: "Instance not found" };
      }

      return this.mapInstanceState(instance);
    } catch (error: any) {
      if (error.name === "InvalidInstanceID.NotFound") {
        return { state: "failed", message: "Instance not found" };
      }
      throw error;
    }
  }

  async startInstance(instanceId: string): Promise<void> {
    await this.client.send(
      new StartInstancesCommand({
        InstanceIds: [instanceId],
      })
    );
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.client.send(
      new StopInstancesCommand({
        InstanceIds: [instanceId],
      })
    );
  }

  async terminateInstance(
    instanceId: string,
    keyPairName?: string
  ): Promise<void> {
    await this.client.send(
      new TerminateInstancesCommand({
        InstanceIds: [instanceId],
      })
    );

    // Clean up key pair
    if (keyPairName) {
      try {
        await this.client.send(
          new DeleteKeyPairCommand({ KeyName: keyPairName })
        );
      } catch (error) {
        console.error("Failed to delete key pair:", error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Machine Snapshots (AMI-based)
  // ---------------------------------------------------------------------------

  /**
   * Create an AMI from a running or stopped instance.
   * This captures the full machine state including all files, browser data, etc.
   *
   * Returns `null` if the instance has already been terminated or is in a
   * transient state that EC2 won't snapshot from. The previous behaviour was
   * to surface AWS's `InvalidParameterValue: Instance is not in state
   * 'running' or 'stopping' or 'stopped'` directly to the caller — a problem
   * for the 6-hour `runPeriodicSnapshots` loop, which races against
   * lite-machine cleanup that calls `TerminateInstancesCommand` on the same
   * instance. The race produced one full-stack `Error: [Object]` traceback
   * per audit window with no actual user impact (the snapshot was no longer
   * needed anyway). Resolving the race in code rather than logs:
   *   1. `DescribeInstances` first — cheap one-RPC pre-check
   *   2. Skip with a single info-level log if state is terminating/terminated/pending
   *   3. Fall back to the existing AWS error path only if the state check itself fails
   *      (so we never silently swallow a genuine snapshot failure)
   */
  async createMachineImage(
    instanceId: string,
    userId: string,
    machineName?: string
  ): Promise<{ amiId: string; name: string } | null> {
    // Pre-flight: confirm the instance is in a snapshottable state.
    // EC2 only allows CreateImage when state ∈ {running, stopping, stopped}.
    // {pending, shutting-down, terminated} all reject with InvalidParameterValue.
    let preflightState: string | undefined;
    try {
      const describe = await this.client.send(
        new DescribeInstancesCommand({ InstanceIds: [instanceId] })
      );
      preflightState = describe.Reservations?.[0]?.Instances?.[0]?.State?.Name;
    } catch (err: any) {
      // If the instance is already gone, AWS returns InvalidInstanceID.NotFound.
      // Treat as "no snapshot needed" rather than as an error.
      if (err?.name === "InvalidInstanceID.NotFound") {
        console.log(
          `[snapshot] Skipping ${instanceId}: instance not found (already terminated)`
        );
        return null;
      }
      // For any other DescribeInstances error, fall through to the original
      // CreateImage path so we get a real failure signal — never silently swallow.
      console.warn(
        `[snapshot] DescribeInstances pre-check failed for ${instanceId} ` +
          `(${err?.name}: ${err?.message}); attempting CreateImage anyway.`
      );
    }

    if (preflightState && !["running", "stopping", "stopped"].includes(preflightState)) {
      console.log(
        `[snapshot] Skipping ${instanceId}: state='${preflightState}' is not snapshottable ` +
          `(must be running/stopping/stopped). Likely race with cleanup termination.`
      );
      return null;
    }

    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    // Defense-in-depth: even with the cross-replica cron lock holding most of
    // the line, we still append a per-call random hex jitter so two callers
    // racing in the same wall-clock second can never collide on the AMI Name
    // (`InvalidAMIName.Duplicate`). 6 hex chars = 16M space, ample for the
    // ~handful of CreateImage calls per second in production.
    const jitter = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
    const name = `coasty-snapshot-${userId.substring(0, 8)}-${ts}-${jitter}`;

    try {
      const result = await this.client.send(
        new CreateImageCommand({
          InstanceId: instanceId,
          Name: name,
          Description: `Snapshot of ${machineName || instanceId} for user ${userId.substring(0, 8)}`,
          NoReboot: true, // don't interrupt the running instance
          TagSpecifications: [
            {
              ResourceType: "image",
              Tags: [
                { Key: "Name", Value: name },
                { Key: "UserId", Value: userId },
                { Key: "ManagedBy", Value: "coasty-snapshot" },
                { Key: "SourceInstance", Value: instanceId },
              ],
            },
          ],
        })
      );

      const amiId = result.ImageId;
      if (!amiId) {
        throw new Error("CreateImage returned no image ID");
      }

      console.log(`Created snapshot AMI ${amiId} (${name}) from instance ${instanceId}`);
      return { amiId, name };
    } catch (err: any) {
      // TOCTOU: instance state changed between DescribeInstances and CreateImage.
      // The pre-flight check eliminates ~99% of these but the window is non-zero.
      // Treat the same as the pre-flight skip rather than propagating.
      if (
        err?.name === "InvalidParameterValue" &&
        typeof err?.message === "string" &&
        /Instance is not in state/i.test(err.message)
      ) {
        console.log(
          `[snapshot] Skipping ${instanceId}: TOCTOU race — instance state changed ` +
            `between pre-flight and CreateImage (${err.message})`
        );
        return null;
      }
      if (err?.name === "InvalidInstanceID.NotFound") {
        console.log(
          `[snapshot] Skipping ${instanceId}: instance terminated between pre-flight and CreateImage`
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * Find the latest snapshot AMI for a user.
   */
  async findLatestUserSnapshot(userId: string): Promise<string | null> {
    const info = await this.findLatestUserSnapshotInfo(userId);
    return info?.amiId ?? null;
  }

  async findLatestUserSnapshotInfo(userId: string): Promise<{ amiId: string; createdAt: string } | null> {
    try {
      const result = await this.client.send(
        new DescribeImagesCommand({
          Owners: ["self"],
          Filters: [
            { Name: "tag:UserId", Values: [userId] },
            { Name: "tag:ManagedBy", Values: ["coasty-snapshot"] },
            { Name: "state", Values: ["available"] },
          ],
        })
      );

      const images = result.Images || [];
      if (images.length === 0) return null;

      // Sort by creation date descending, pick latest
      images.sort((a, b) =>
        (b.CreationDate || "").localeCompare(a.CreationDate || "")
      );

      const latestAmi = images[0].ImageId!;
      const createdAt = images[0].CreationDate || new Date().toISOString();
      console.log(`Found snapshot AMI ${latestAmi} for user ${userId.substring(0, 8)}`);
      return { amiId: latestAmi, createdAt };
    } catch (error) {
      console.error("Failed to find user snapshots:", error);
      return null;
    }
  }

  /**
   * Clean up old snapshot AMIs for a user, keeping only the latest `keepCount`.
   */
  async cleanupOldSnapshots(userId: string, keepCount: number = 2): Promise<void> {
    try {
      const result = await this.client.send(
        new DescribeImagesCommand({
          Owners: ["self"],
          Filters: [
            { Name: "tag:UserId", Values: [userId] },
            { Name: "tag:ManagedBy", Values: ["coasty-snapshot"] },
          ],
        })
      );

      const images = result.Images || [];
      if (images.length <= keepCount) return;

      // Sort by creation date descending, delete everything after keepCount
      images.sort((a, b) =>
        (b.CreationDate || "").localeCompare(a.CreationDate || "")
      );

      const toDelete = images.slice(keepCount);
      for (const img of toDelete) {
        try {
          // Get associated EBS snapshots before deregistering the AMI
          const snapshotIds = (img.BlockDeviceMappings || [])
            .map((b) => b.Ebs?.SnapshotId)
            .filter(Boolean) as string[];

          // Deregister the AMI
          await this.client.send(
            new DeregisterImageCommand({ ImageId: img.ImageId! })
          );

          // Delete the underlying EBS snapshots
          for (const snapId of snapshotIds) {
            await this.client.send(
              new DeleteSnapshotCommand({ SnapshotId: snapId })
            ).catch(() => {});
          }

          console.log(`Deleted old snapshot AMI ${img.ImageId} (${img.Name})`);
        } catch (err) {
          console.warn(`Failed to delete snapshot AMI ${img.ImageId}:`, err);
        }
      }
    } catch (error) {
      console.error("Failed to cleanup snapshots:", error);
    }
  }

  private async ensureSecurityGroup(desktopEnabled?: boolean, isWindows?: boolean): Promise<string> {
    let sgName: string;
    if (isWindows) {
      sgName = process.env.AWS_EC2_WINDOWS_SG_NAME || "llmhub-ec2-windows-desktop";
    } else if (desktopEnabled) {
      sgName = process.env.AWS_EC2_DESKTOP_SG_NAME || "llmhub-ec2-desktop";
    } else {
      sgName = process.env.AWS_EC2_SECURITY_GROUP_NAME || "llmhub-ec2-ssh";
    }

    const cached = this.cachedSecurityGroupIds.get(sgName);
    if (cached) {
      return cached;
    }

    // Required ports for this SG type
    // Windows: 3389 (RDP admin fallback) + 6080 (noVNC) + 8080 (agent)
    let requiredPorts: number[];
    if (isWindows) {
      requiredPorts = [3389, 6080, 8080];
    } else if (desktopEnabled) {
      requiredPorts = [22, 6080, 8080];
    } else {
      requiredPorts = [22];
    }

    const portDescriptions: Record<number, string> = {
      22: "SSH access",
      3389: "RDP access",
      6080: "noVNC web access",
      8080: "AI agent WebSocket",
    };

    // Check if security group exists
    let groupId: string | undefined;
    try {
      const describeResult = await this.client.send(
        new DescribeSecurityGroupsCommand({
          Filters: [
            { Name: "group-name", Values: [sgName] },
          ],
        })
      );

      if (describeResult.SecurityGroups && describeResult.SecurityGroups.length > 0) {
        const sg = describeResult.SecurityGroups[0];
        groupId = sg.GroupId!;

        // Check which required ports are already open
        const openPorts = new Set<number>();
        for (const perm of sg.IpPermissions || []) {
          if (perm.IpProtocol === "tcp" && perm.FromPort === perm.ToPort) {
            openPorts.add(perm.FromPort!);
          }
        }

        // Add any missing rules
        const missingPorts = requiredPorts.filter((p) => !openPorts.has(p));
        if (missingPorts.length > 0) {
          console.log(`Adding missing SG rules to ${sgName}: ports ${missingPorts.join(", ")}`);
          await this.client.send(
            new AuthorizeSecurityGroupIngressCommand({
              GroupId: groupId,
              IpPermissions: missingPorts.map((port) => ({
                IpProtocol: "tcp",
                FromPort: port,
                ToPort: port,
                IpRanges: [{ CidrIp: "0.0.0.0/0", Description: portDescriptions[port] || `Port ${port}` }],
              })),
            })
          );
        }

        this.cachedSecurityGroupIds.set(sgName, groupId);
        return groupId;
      }
    } catch (error) {
      // Group doesn't exist, fall through to create it
    }

    // Create security group
    const createResult = await this.client.send(
      new CreateSecurityGroupCommand({
        GroupName: sgName,
        Description: desktopEnabled
          ? "LLMHub EC2 SSH + Desktop (noVNC) access"
          : "LLMHub EC2 SSH access",
      })
    );

    groupId = createResult.GroupId;
    if (!groupId) {
      throw new Error("Failed to create security group");
    }

    // Add all required inbound rules
    await this.client.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: requiredPorts.map((port) => ({
          IpProtocol: "tcp",
          FromPort: port,
          ToPort: port,
          IpRanges: [{ CidrIp: "0.0.0.0/0", Description: portDescriptions[port] || `Port ${port}` }],
        })),
      })
    );

    this.cachedSecurityGroupIds.set(sgName, groupId);
    return groupId;
  }

  /**
   * Strips pure-comment lines and collapses blank-line runs in a bash script,
   * preserving heredoc bodies VERBATIM. Used to slim UserData before gzip
   * since AWS RunInstances limits raw user data to 16384 bytes after base64
   * decode. Source code stays readable; only the wire format is compact.
   */
  private minifyBash(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
    let inHeredoc: string | null = null;
    let lastBlank = false;
    for (const line of lines) {
      if (inHeredoc !== null) {
        out.push(line);
        if (line.trim() === inHeredoc) inHeredoc = null;
        continue;
      }
      const hd = line.match(/<<\s*['"]?(\w+)['"]?/);
      if (hd) {
        out.push(line);
        inHeredoc = hd[1];
        continue;
      }
      if (line.startsWith("#!")) {
        out.push(line);
        lastBlank = false;
        continue;
      }
      if (/^\s*#/.test(line)) continue; // pure comment
      const blank = line.trim() === "";
      if (blank && lastBlank) continue;
      lastBlank = blank;
      out.push(line);
    }
    return out.join("\n");
  }

  /**
   * Strips pure-comment lines and collapses blank-line runs in Python source.
   * Conservative: only touches lines that are entirely a comment (after
   * leading whitespace) and consecutive blank lines. Does NOT strip
   * docstrings or inline comments — too risky to do without a real parser.
   */
  private minifyPython(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
    let lastBlank = false;
    for (const line of lines) {
      // Preserve shebang
      if (line.startsWith("#!")) {
        out.push(line);
        lastBlank = false;
        continue;
      }
      // Pure-comment line (after any indentation)
      if (/^\s*#/.test(line)) continue;
      const blank = line.trim() === "";
      if (blank && lastBlank) continue;
      lastBlank = blank;
      out.push(line);
    }
    return out.join("\n");
  }

  /**
   * Strips pure-comment lines and collapses blank-line runs in a PowerShell
   * script, preserving here-string (@"..."@ / @'...'@) bodies VERBATIM.
   */
  private minifyPowerShell(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
    let inHereString: '"' | "'" | null = null;
    let lastBlank = false;
    for (const line of lines) {
      if (inHereString !== null) {
        out.push(line);
        // PowerShell here-string close marker MUST be at column 0
        if (line === inHereString + "@") inHereString = null;
        continue;
      }
      // Detect here-string opens that DON'T close on the same line
      const opensDouble = line.includes('@"') && !/@"[\s\S]*"@/.test(line);
      const opensSingle = line.includes("@'") && !/@'[\s\S]*'@/.test(line);
      if (opensDouble) {
        out.push(line);
        inHereString = '"';
        continue;
      }
      if (opensSingle) {
        out.push(line);
        inHereString = "'";
        continue;
      }
      if (/^\s*#/.test(line)) continue; // pure comment
      const blank = line.trim() === "";
      if (blank && lastBlank) continue;
      lastBlank = blank;
      out.push(line);
    }
    return out.join("\n");
  }

  /**
   * Returns the Python AI agent source code, shared by both full and golden AMI UserData.
   */
  private getAgentSource(): string {
    return `#!/usr/bin/env python3
import asyncio,base64,io,json,os,subprocess,tempfile,time
import urllib.request,urllib.parse
from typing import Any,Dict
try:
 import mss;_HAS_MSS=True
except:_HAS_MSS=False
try:
 import pyautogui;pyautogui.FAILSAFE=False;_HAS_PAG=True
except:_HAS_PAG=False
try:
 import pytesseract;_HAS_OCR=True
except:_HAS_OCR=False
try:
 from selenium import webdriver
 from selenium.webdriver.firefox.options import Options as FFOptions
 from selenium.webdriver.firefox.service import Service as FFService
 from selenium.webdriver.common.by import By
 _HAS_SEL=True
except:_HAS_SEL=False
from PIL import Image
import websockets
DISPLAY=os.environ.get("DISPLAY",":1")
VNC_PASSWORD=os.environ.get("VNC_PASSWORD","")
PORT=int(os.environ.get("AGENT_PORT","8080"))
HOST=os.environ.get("AGENT_HOST","0.0.0.0")
_browser_instance=None
# Country (ISO-3166 alpha-2) -> primary BCP 47 language tag for matched browser locale.
# Used when geo lookup returns a country but no explicit COASTY_LANG override.
_COUNTRY_LANG={"US":"en-US","GB":"en-GB","CA":"en-CA","AU":"en-AU","NZ":"en-NZ","IE":"en-IE","ZA":"en-ZA","IN":"en-IN","DE":"de-DE","FR":"fr-FR","ES":"es-ES","IT":"it-IT","NL":"nl-NL","SE":"sv-SE","NO":"nb-NO","DK":"da-DK","FI":"fi-FI","PL":"pl-PL","PT":"pt-PT","BR":"pt-BR","MX":"es-MX","AR":"es-AR","JP":"ja-JP","KR":"ko-KR","CN":"zh-CN","TW":"zh-TW","HK":"zh-HK","SG":"en-SG","RU":"ru-RU","TR":"tr-TR","SA":"ar-SA","AE":"ar-AE","IL":"he-IL","ID":"id-ID","TH":"th-TH","VN":"vi-VN","PH":"en-PH","MY":"en-MY"}
_LOCALE=None
def _resolve_locale():
 # Returns {"tz":..., "lang":..., "accept":..., "country":...} matched to the egress IP.
 # Uses HTTPS_PROXY/https_proxy when set so the geo reflects the proxy, not the EC2 host.
 # Operator overrides: COASTY_TZ pins timezone, COASTY_LANG pins BCP 47 lang tag.
 global _LOCALE
 if _LOCALE is not None:return _LOCALE
 tz=os.environ.get("COASTY_TZ","").strip()
 lang=os.environ.get("COASTY_LANG","").strip()
 country=""
 if not(tz and lang):
  try:
   proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
   req=urllib.request.Request("https://ipinfo.io/json",headers={"User-Agent":"coasty/1"})
   op=urllib.request.build_opener(urllib.request.ProxyHandler({"https":proxy,"http":proxy})) if proxy else urllib.request.build_opener()
   resp=op.open(req,timeout=4);d=json.loads(resp.read().decode())
   if not tz:tz=(d.get("timezone") or "").strip()
   country=(d.get("country") or "").strip().upper()
  except Exception as e:print(f"[locale] geo lookup failed: {e}",flush=True)
 if not lang:lang=_COUNTRY_LANG.get(country,"en-US")
 if not tz:tz="America/New_York"
 base=lang.split("-")[0]
 _LOCALE={"tz":tz,"lang":lang,"accept":lang+","+base+";q=0.9","country":country}
 print(f"[locale] tz={tz} lang={lang} country={country or '?'} accept={_LOCALE['accept']}",flush=True)
 return _LOCALE
def _apply_tz():
 # Sets TZ env + tzset so this Python process AND its child processes
 # (geckodriver -> Firefox) inherit the matched timezone. Firefox reads
 # TZ via libc tzset() and exposes it via Intl.DateTimeFormat resolvedOptions.
 loc=_resolve_locale();os.environ["TZ"]=loc["tz"]
 try:time.tzset()
 except:pass
 return loc
def _xdo(*a):
 env={**os.environ,"DISPLAY":DISPLAY}
 r=subprocess.run(["xdotool"]+list(a),capture_output=True,text=True,env=env,timeout=10)
 return r.stdout.strip()
# ===== Behavioral mimicry & stealth =====
# Bigram dwell-time table approximated from CMU keystroke dynamics + KeyRecs
# datasets — common digrams have shorter inter-keystroke intervals than rare
# ones because the typing motor program is more practiced. Values in ms.
import random as _rng
# Bigram inter-keystroke intervals (ms) calibrated to Aalto 136M-keystroke
# study: mean IKI ~238ms, sigma ~111ms, floor ~60ms. Common bimanual bigrams
# get a 0.55-0.70 multiplier vs the mean (faster motor program); same-finger
# bigrams 1.3-1.5x slower. Target sustained WPM ~45 (range 25-90).
_BIGRAM_DELAY={"th":105,"he":110,"in":115,"er":115,"an":120,"re":120,"on":125,"at":125,"en":125,"nd":130,"ti":130,"es":130,"or":130,"te":135,"of":135,"ed":135,"is":135,"it":135,"al":135,"ar":140,"st":140,"to":140,"nt":140,"ng":140,"se":145,"ha":145,"as":145,"ou":150,"io":150,"le":150,"ve":155,"co":155,"me":155,"de":160,"hi":160,"ri":160,"ro":160,"ic":165,"ne":165,"ea":165,"ra":170,"ce":170,"li":150,"ch":175,"ll":160,"be":165,"ma":165,"si":170,"om":170,"ur":175,"ca":175,"el":175,"ta":170,"la":170,"ns":170}
# Common Linux desktop resolutions (StatCounter 2024-2025). 1920x1080
# dominates; weighted by repetition to sample the real distribution.
_VP_POOL=[(1920,1080),(1920,1080),(1920,1080),(1920,1080),(1366,768),(1366,768),(1536,864),(1440,900),(1280,720),(1600,900),(2560,1440)]
# Cached per-process so a single VM presents a stable identity across actions.
_VIEWPORT=None
# Real-Linux Firefox UA. Mozilla froze the UA architecture token years ago
# so even ARM64 t4g Firefox reports "Linux x86_64" by default. Firefox 140
# is the current ESR base (FF 128 ESR EOL'd 2025-09-16). FF doesn't emit
# Sec-CH-UA, so the UA<->ClientHints mismatch trap doesn't apply.
_UA_POOL=["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0","Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0","Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0","Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0"]
_UA=None
def _viewport():
 global _VIEWPORT
 if _VIEWPORT is None:_VIEWPORT=_rng.choice(_VP_POOL)
 return _VIEWPORT
def _user_agent():
 global _UA
 if _UA is None:_UA=_rng.choice(_UA_POOL)
 return _UA
def _human_move(x,y,steps=14):
 # Cubic Bezier curve from current pointer position to (x,y) with random
 # perpendicular control points. Matches the variable-speed / curved
 # trajectory real cursors trace; defeats naive "instant teleport" detectors.
 # ~10-15% probability of overshoot+correction (real-human pattern).
 import math
 env={**os.environ,"DISPLAY":DISPLAY}
 try:
  r=subprocess.run(["xdotool","getmouselocation","--shell"],capture_output=True,text=True,env=env,timeout=2)
  loc={k:int(v) for k,v in (l.split("=",1) for l in r.stdout.strip().split("\\n") if "=" in l and l.split("=",1)[0] in("X","Y"))}
  sx,sy=loc.get("X",x),loc.get("Y",y)
 except:sx,sy=x,y
 dx,dy=x-sx,y-sy
 d=math.hypot(dx,dy)
 if d<3:_xdo("mousemove",str(x),str(y));return
 # Perpendicular unit + jitter scaled to distance (Fitts-ish)
 ux,uy=-dy/d,dx/d
 j=min(d*0.15,35.0)
 cx1=sx+dx*0.30+ux*_rng.uniform(-j,j);cy1=sy+dy*0.30+uy*_rng.uniform(-j,j)
 cx2=sx+dx*0.70+ux*_rng.uniform(-j,j);cy2=sy+dy*0.70+uy*_rng.uniform(-j,j)
 overshoot=(_rng.random()<0.12 and d>80)
 ex=x+_rng.randint(6,18)*(1 if _rng.random()<0.5 else -1) if overshoot else x
 ey=y+_rng.randint(4,14)*(1 if _rng.random()<0.5 else -1) if overshoot else y
 for i in range(1,steps+1):
  t=i/steps;te=t*t*(3-2*t)  # smoothstep ease-in-out
  px=(1-te)**3*sx+3*(1-te)**2*te*cx1+3*(1-te)*te*te*cx2+te**3*ex
  py=(1-te)**3*sy+3*(1-te)**2*te*cy1+3*(1-te)*te*te*cy2+te**3*ey
  _xdo("mousemove",str(int(px)),str(int(py)))
  time.sleep(_rng.uniform(0.008,0.020))
 if overshoot:
  time.sleep(_rng.uniform(0.04,0.09))
  _xdo("mousemove",str(x),str(y))
def _human_type_delay(prev,ch):
 # Returns the time.sleep delay (seconds) AFTER pressing the current char.
 # Aalto 136M-keystroke distribution: mean IKI ~238ms, sigma ~111ms,
 # hard floor 60ms (faster = bot territory). Common bigrams are sampled
 # from the precomputed table; unknown ones sample from a normal-ish
 # range centered on the mean.
 bg=(prev+ch).lower() if prev else ""
 base=_BIGRAM_DELAY.get(bg,_rng.uniform(170,310))
 d=base*_rng.uniform(0.85,1.18)
 if ch.isupper() and prev and not prev.isupper():d+=_rng.uniform(60,130)
 if ch in".,!?;:":d+=_rng.uniform(90,220)
 if ch==" " and prev not in" \\t\\n":d+=_rng.uniform(20,70)
 # Hard floor: real human typists never go below ~60ms IKI sustained
 if d<60:d=60
 return d/1000.0
def _xclip_paste(text,env):
 # Set the X11 clipboard via xclip, then synthesize Ctrl+V. Returns the
 # selection name on success ("clipboard"), or None on failure so the
 # caller can fall back to direct xdotool type. Failure modes:
 #   * xclip not installed (FileNotFoundError)
 #   * xclip can't open DISPLAY (CalledProcessError)
 #   * keyboard synthesis fails (CalledProcessError)
 # Empty text is a no-op and returns "clipboard" so the caller treats
 # it as success (matches xdotool type "" behavior).
 if not text:return "clipboard"
 try:
  # Encode as bytes so xclip receives raw UTF-8 without locale-dependent
  # re-encoding. -selection clipboard is the modern Ctrl+V target;
  # -selection primary is the middle-click target (not used here).
  r=subprocess.run(["xclip","-selection","clipboard"],input=text.encode("utf-8"),env=env,timeout=5,capture_output=True)
  if r.returncode!=0:return None
  # Brief settle so the X server fully commits the clipboard selection
  # before the paste event reads it. 10 ms is enough on every X server
  # observed; without it, fast back-to-back paste calls race.
  time.sleep(0.01)
  # --clearmodifiers releases stuck Shift/Ctrl/etc. from prior actions
  # so Ctrl+V isn't shadowed by a held Alt or similar.
  r=subprocess.run(["xdotool","key","--clearmodifiers","ctrl+v"],env=env,timeout=5,capture_output=True)
  if r.returncode!=0:return None
  return "clipboard"
 except FileNotFoundError:
  # xclip not installed — caller falls back. We avoid logging here
  # because typing is in the request hot-path; the fallback is the
  # signal.
  return None
 except Exception:
  return None
def _shot():
 env={**os.environ,"DISPLAY":DISPLAY};img=None
 if _HAS_MSS:
  try:
   with mss.mss() as s:
    m=s.monitors[1];sh=s.grab(m);img=Image.frombytes("RGB",sh.size,sh.bgra,"raw","BGRX")
  except:img=None
 if img is None:
  try:
   f=tempfile.mktemp(suffix=".png");subprocess.run(["scrot",f],env=env,timeout=10,check=True)
   img=Image.open(f).copy();os.unlink(f)
  except:img=None
 if img is None:
  try:
   f=tempfile.mktemp(suffix=".png");subprocess.run(["import","-window","root",f],env=env,timeout=10,check=True)
   img=Image.open(f).copy();os.unlink(f)
  except:img=None
 if img is None:return None
 img.thumbnail((1280,720),Image.LANCZOS);buf=io.BytesIO()
 img.convert("RGB").save(buf,format="JPEG",quality=80)
 return "data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode()
def _get_browser():
 global _browser_instance
 if _browser_instance is not None:
  try:_=_browser_instance.title;return _browser_instance
  except:_browser_instance=None
 if not _HAS_SEL:raise RuntimeError("selenium unavailable")
 import shutil
 from urllib.parse import urlparse as _urlp
 # Match TZ + Accept-Language to (proxy) egress IP BEFORE spawning geckodriver
 # so Firefox inherits both via libc tzset and Firefox prefs respectively.
 loc=_apply_tz()
 vw,vh=_viewport()
 ua=_user_agent()
 opts=FFOptions()
 opts.add_argument(f"--width={vw}");opts.add_argument(f"--height={vh}")
 # ── Locale ────────────────────────────────────────────────────────────
 opts.set_preference("intl.accept_languages",loc["accept"])
 opts.set_preference("javascript.use_us_english_locale",False)
 # ── Stealth: webdriver tell ──────────────────────────────────────────
 # Hides navigator.webdriver. The classic check; still table-stakes.
 opts.set_preference("dom.webdriver.enabled",False)
 opts.set_preference("useAutomationExtension",False)
 # Marionette is needed by geckodriver, can't disable that pref or driver breaks.
 # ── Stealth: realistic UA (Linux x86_64 ~95% of Linux Firefox UAs) ───
 opts.set_preference("general.useragent.override",ua)
 # ── Stealth: WebRTC IP leak (don't disable WebRTC entirely — only ~2%
 # of users do that, which is itself a tell). Restrict ICE candidates
 # so STUN can't reveal the real public IP behind a proxy.
 opts.set_preference("media.peerconnection.ice.no_host",True)
 opts.set_preference("media.peerconnection.ice.default_address_only",True)
 opts.set_preference("media.peerconnection.ice.proxy_only_if_behind_proxy",True)
 # ── Stealth: telemetry / phone-home (rare on real users) ────────────
 opts.set_preference("toolkit.telemetry.enabled",False)
 opts.set_preference("toolkit.telemetry.unified",False)
 opts.set_preference("toolkit.telemetry.archive.enabled",False)
 opts.set_preference("datareporting.healthreport.uploadEnabled",False)
 opts.set_preference("datareporting.policy.dataSubmissionEnabled",False)
 opts.set_preference("app.shield.optoutstudies.enabled",False)
 opts.set_preference("app.normandy.enabled",False)
 opts.set_preference("browser.discovery.enabled",False)
 # ── Stealth: geo prompt (real users rarely allow it for a fresh tab) ─
 opts.set_preference("geo.enabled",False)
 # ── Stealth: dom.battery (deprecated but some sites still probe) ────
 opts.set_preference("dom.battery.enabled",False)
 # NB: privacy.resistFingerprinting is INTENTIONALLY left off.
 # It normalizes fingerprint, but creates its own RFP-cluster signature
 # AND forces tz=UTC, undoing our proxy-matched timezone.
 # ── Proxy via prefs (Firefox doesn't read HTTP_PROXY env on Linux) ──
 proxy_url=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
 if proxy_url:
  try:
   pu=_urlp(proxy_url)
   if pu.hostname and pu.port:
    opts.set_preference("network.proxy.type",1)
    opts.set_preference("network.proxy.http",pu.hostname)
    opts.set_preference("network.proxy.http_port",pu.port)
    opts.set_preference("network.proxy.ssl",pu.hostname)
    opts.set_preference("network.proxy.ssl_port",pu.port)
    opts.set_preference("network.proxy.share_proxy_settings",True)
    # SOCKS support if scheme indicates it (auto-falls-through harmlessly otherwise)
    if pu.scheme.startswith("socks"):
     opts.set_preference("network.proxy.socks",pu.hostname)
     opts.set_preference("network.proxy.socks_port",pu.port)
     opts.set_preference("network.proxy.socks_version",5 if "5" in pu.scheme else 4)
     # Critical: route DNS through the SOCKS proxy too (otherwise DNS leaks via EC2)
     opts.set_preference("network.proxy.socks_remote_dns",True)
    # Don't proxy localhost (agent talks to itself / Xvnc)
    opts.set_preference("network.proxy.no_proxies_on","localhost,127.0.0.1")
    print(f"[browser] proxy via {pu.hostname}:{pu.port} (auth: {'yes' if pu.username else 'no'})",flush=True)
  except Exception as e:print(f"[browser] proxy parse failed: {e}",flush=True)
 print(f"[browser] viewport={vw}x{vh} ua={ua[:60]}...",flush=True)
 gd=None
 for p in ["/usr/local/bin/geckodriver","/usr/bin/geckodriver"]:
  if os.path.exists(p):gd=p;break
 if not gd and shutil.which("geckodriver"):gd=shutil.which("geckodriver")
 if gd:
  svc=FFService(executable_path=gd)
  _browser_instance=webdriver.Firefox(service=svc,options=opts)
 else:_browser_instance=webdriver.Firefox(options=opts)
 _browser_instance.set_window_size(vw,vh)
 return _browser_instance
# ===== Smart navigation: API bypass for hostile-WAF sites + block detection =====
# Cloudflare's bot scoring weights datacenter ASN heavily; even with perfect
# browser stealth, EC2 IPs hit the gauntlet. For sites with a clean public
# API (Reddit, Hacker News, etc.) we route there instead of the browser.
def _is_blocked(html,status=200):
 # Detects common Cloudflare / DataDome / hostile-WAF block pages by markers.
 # status >= 400 + known interstitial strings = blocked.
 if status in(403,429,503):return True
 if not html:return False
 m=["Just a moment...","Attention Required! | Cloudflare","Access denied","cf-chl-","challenges.cloudflare","Please verify you are a human","Sorry, we just need to make sure","DDoS protection by"]
 return any(x in html for x in m)
def _reddit_fetch(url):
 # Translates www.reddit.com/<path> -> www.reddit.com/<path>.json (or
 # oauth.reddit.com if REDDIT_OAUTH_TOKEN set, granting 100 QPM vs 10 unauth).
 # Reddit's JSON API is on a different request path that bypasses CF Turnstile.
 # Returns (ok:bool, data:dict|list|None).
 try:
  pu=urllib.parse.urlparse(url)
  host=(pu.netloc or "").lower()
  if "reddit.com" not in host:return False,None
  path=pu.path or "/"
  if path.endswith("/"):path=path[:-1]
  if not path.endswith(".json"):path+=".json"
  json_url=f"https://www.reddit.com{path}"
  if pu.query:json_url+="?"+pu.query
  # Reddit asks for UA in form "platform:app-id:version (by /u/handle)"
  ua=os.environ.get("COASTY_REDDIT_UA","linux:ai.coasty.agent:1.0 (by /u/coasty-agent)")
  headers={"User-Agent":ua,"Accept":"application/json"}
  token=os.environ.get("REDDIT_OAUTH_TOKEN","").strip()
  if token:
   headers["Authorization"]="Bearer "+token
   json_url=json_url.replace("www.reddit.com","oauth.reddit.com")
  proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
  req=urllib.request.Request(json_url,headers=headers)
  op=urllib.request.build_opener(urllib.request.ProxyHandler({"https":proxy,"http":proxy})) if proxy else urllib.request.build_opener()
  resp=op.open(req,timeout=10)
  body=resp.read().decode("utf-8","replace")
  if resp.status>=400:return False,None
  return True,json.loads(body)
 except Exception as e:
  print(f"[reddit-api] fetch failed: {e}",flush=True);return False,None
def _reddit_render(data,url):
 # Render Reddit JSON listing or comment thread as readable HTML so the
 # agent's existing browser_get_dom flow extracts content unchanged.
 try:
  import html as _h
  esc=_h.escape
  parts=['<!doctype html><html><head><title>Reddit</title><meta charset="utf-8"></head><body>']
  parts.append(f'<h1>{esc(url)}</h1><p><em>(rendered from official Reddit API to bypass anti-bot)</em></p>')
  def render_post(d):
   title=esc(d.get("title","") or "")
   author=esc(d.get("author","") or "?")
   subr=esc(d.get("subreddit","") or "")
   score=d.get("score",0);ncm=d.get("num_comments",0)
   body=esc((d.get("selftext","") or d.get("body","") or "")[:3000])
   pl=esc(d.get("permalink","") or "")
   ext=esc(d.get("url_overridden_by_dest","") or "")
   t=f"<article><h2>{title or '(comment)'}</h2><p>r/{subr} · u/{author} · {score} pts · {ncm} comments</p><div>{body}</div>"
   if pl:t+=f'<p><a href="https://www.reddit.com{pl}">View thread</a></p>'
   if ext and ext!=pl:t+=f'<p>Link: <a href="{ext}">{ext}</a></p>'
   return t+"</article>"
  if isinstance(data,list):
   for item in data:
    if isinstance(item,dict) and "data" in item:
     for c in item.get("data",{}).get("children",[])[:40]:
      parts.append(render_post(c.get("data",{})))
  elif isinstance(data,dict) and "data" in data:
   for c in data.get("data",{}).get("children",[])[:60]:
    parts.append(render_post(c.get("data",{})))
  parts.append("</body></html>")
  return "".join(parts)
 except Exception as e:
  print(f"[reddit-api] render failed: {e}",flush=True);return None
def _navigate_smart(b,url):
 # Site-specific bypass router. Tries clean API path first; falls back to
 # raw browser navigation; surfaces blocked status so the orchestrator can
 # route to Electron / proxy / human.
 # Returns dict to merge into _bn/_bo response (no 'success' key — caller adds).
 if "reddit.com" in url and not url.startswith("data:"):
  ok,data=_reddit_fetch(url)
  if ok:
   html=_reddit_render(data,url)
   if html:
    b.get("data:text/html;charset=utf-8;base64,"+base64.b64encode(html.encode()).decode())
    print(f"[smart-nav] reddit-api OK for {url}",flush=True)
    return{"url":url,"title":b.title,"source":"reddit-api"}
  print(f"[smart-nav] reddit-api unavailable, falling back to browser for {url}",flush=True)
 b.get(url)
 try:
  body=b.execute_script("return document.documentElement.outerHTML")
  body=body[:8000] if body else ""
 except:body=""
 if _is_blocked(body):
  return{"url":b.current_url,"title":b.title,"blocked":True,"error":"blocked by anti-bot (likely datacenter IP); set HTTPS_PROXY for residential routing or hand off to Electron"}
 return{"url":b.current_url,"title":b.title}
class Agent:
 def __init__(self):self._t=time.time();self._n=0
 async def serve(self,ws):
  ok=not bool(VNC_PASSWORD)
  try:
   async for raw in ws:
    self._n+=1
    try:msg=json.loads(raw)
    except:continue
    t=msg.get("type")
    if t=="ping":
     await ws.send(json.dumps({"type":"pong","timestamp":time.time(),"uptime":time.time()-self._t,"messages_processed":self._n}));continue
    if t=="auth":
     pw=msg.get("password","")
     if not VNC_PASSWORD or pw==VNC_PASSWORD:
      ok=True;await ws.send(json.dumps({"type":"auth_success","data":{"message":"Authentication successful","sessionId":msg.get("sessionId",""),"userId":msg.get("userId",""),"persistent":True}}))
     else:await ws.send(json.dumps({"type":"error","data":{"error":"Invalid password","code":"AUTH_FAILED"}}))
     continue
    if not ok:await ws.send(json.dumps({"type":"error","data":{"error":"Not authenticated"}}));continue
    if t=="command":
     d=msg.get("data",{});cmd=d.get("command","");params=d.get("parameters",{})
     to=75.0 if cmd in{"browser_get_dom","browser_navigate","browser_open","ocr"} else 45.0
     try:
      res=await asyncio.wait_for(asyncio.get_event_loop().run_in_executor(None,self._run,cmd,params),timeout=to)
     except asyncio.TimeoutError:res={"success":False,"error":f"timeout: {cmd}"}
     except Exception as e:res={"success":False,"error":str(e)}
     await ws.send(json.dumps({"type":"result","data":res}))
  except websockets.exceptions.ConnectionClosed:pass
 def _run(self,command,p):
  fn={"screenshot":self._ss,"click":self._cl,"double_click":self._dc,"right_click":self._rc,
   "type":self._ty,"key_press":self._kp,"key_combo":self._kc,
   "execute_command":self._ex,"terminal_execute":self._ex,
   "terminal_connect":lambda _:{"success":True,"session_id":"default"},
   "terminal_read":lambda _:{"success":True,"output":""},
   "terminal_type":self._tt,
   "file_read":self._fr,"file_write":self._fw,"file_append":self._fa,
   "file_upload":self._fu,"file_download":self._fdn,"file_list_downloads":self._fld,
   "file_delete":self._fd,"file_exists":self._fe,"directory_list":self._dl,
   "ocr":self._ocr,
   "browser_open":self._bo,"browser_navigate":self._bn,"browser_click":self._bc,
   "browser_type":self._bt,"browser_execute":self._bx,"browser_get_dom":self._bd,
   "browser_state":self._bs,"browser_get_context":self._bd,
  }.get(command)
  if fn is None:return{"success":False,"error":f"Unknown: {command}"}
  return fn(p)
 def _ss(self,p):
  i=_shot()
  return{"success":True,"screenshot":i,"timestamp":time.time()} if i else{"success":False,"error":"screenshot failed"}
 def _cl(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0))
  b={"left":"1","middle":"2","right":"3"}.get(p.get("button","left"),"1")
  # Bezier curve mouse path (Fitts's-law-ish timing) before clicking, so
  # behavioral detectors don't see instant teleport-then-click.
  _human_move(x,y)
  time.sleep(_rng.uniform(0.04,0.10))  # settle pause before click
  _xdo("click",b)
  return{"success":True,"action":"click","x":x,"y":y}
 def _dc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0))
  _human_move(x,y);time.sleep(_rng.uniform(0.04,0.09))
  # Real human double-click inter-click gap ~80-180ms (well under OS
  # double-click threshold ~500ms but still visibly two events).
  _xdo("click","1");time.sleep(_rng.uniform(0.08,0.18));_xdo("click","1")
  return{"success":True}
 def _rc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0))
  _human_move(x,y);time.sleep(_rng.uniform(0.05,0.11))
  _xdo("click","3")
  return{"success":True}
 def _ty(self,p):
  # ── Typing modes (2026-05-11 perf rewrite) ──
  # The legacy default forked a new xdotool subprocess PER CHARACTER
  # (~30 ms fork × N) AND slept 238 ms Aalto IKI between every char,
  # producing ~3 s for 11 chars = ~3-4 WPM effective. Every additional
  # blocker below has been removed:
  #
  #   instant   — xdotool --delay 0, ONE subprocess. ~30-50 ms total
  #               regardless of length. Used by paste-style fills.
  #   fast      — DEFAULT. xdotool --delay 1-3 ms, ONE subprocess.
  #               Auto-promotes to clipboard for text >= 50 chars
  #               (massive speedup for URLs/paragraphs). For 100 chars
  #               via clipboard: ~50 ms. Via direct xdotool: ~150 ms.
  #               Falls back to plain xdotool if xclip is missing.
  #   clipboard — Explicit xclip + Ctrl+V. ~40 ms regardless of length.
  #               Best for long text but mutates clipboard and some
  #               apps (terminal, password fields) block Ctrl+V.
  #   human     — Legacy Aalto-calibrated per-char loop. Preserved for
  #               stealth-critical contexts.
  #
  # Back-compat: interval=0 / fast=true still map to instant mode so
  # existing callers see identical wire behaviour to before this fix.
  text=p.get("text","");env={**os.environ,"DISPLAY":DISPLAY}
  if not text:return{"success":True,"action":"type","chars":0}
  mode=(p.get("mode") or "").lower()
  if not mode:
   if p.get("interval")==0 or p.get("fast"):mode="instant"
   else:mode="fast"
  # Aliases: "paste" routes to clipboard.
  if mode=="paste":mode="clipboard"
  # ── instant ──
  if mode=="instant":
   to=max(15,int(2+len(text)/100))
   subprocess.run(["xdotool","type","--delay","0","--",text],env=env,timeout=to)
   return{"success":True,"action":"type","chars":len(text),"mode":mode}
  # ── clipboard (explicit) ──
  if mode=="clipboard":
   r=_xclip_paste(text,env)
   if r is not None:return{"success":True,"action":"type","chars":len(text),"mode":"clipboard","method":r}
   # xclip missing or failed → fall through to fast (don't silently no-op)
   mode="fast"
  # ── fast (default) — auto-promote to clipboard for long text ──
  if mode=="fast":
   if len(text)>=50:
    r=_xclip_paste(text,env)
    if r is not None:return{"success":True,"action":"type","chars":len(text),"mode":"clipboard","auto_promoted":True,"method":r}
    # xclip unavailable — fall through to direct xdotool
   # Direct xdotool path: --delay floor 1ms, ceiling 3ms. xdotool's
   # internal usleep is jittered per call so a sequence of types
   # doesn't produce a perfectly-flat IKI fingerprint, but stays
   # within the 80-300 WPM range that feels instant to a human user.
   d=_rng.randint(1,3)
   to=max(15,int(5+(len(text)*d*5)/1000))
   subprocess.run(["xdotool","type","--delay",str(d),"--",text],env=env,timeout=to)
   return{"success":True,"action":"type","chars":len(text),"mode":"fast","delay_ms":d}
  # ── human (legacy stealth path) — preserved verbatim for opt-in use ──
  prev=" "
  for ch in text:
   subprocess.run(["xdotool","type","--delay","0","--",ch],env=env,timeout=10)
   time.sleep(_human_type_delay(prev,ch))
   prev=ch
  return{"success":True,"action":"type","chars":len(text),"mode":"human"}
 def _kp(self,p):
  # Batch multiple keys into ONE xdotool invocation. xdotool key accepts
  # multiple key arguments and presses them sequentially in-process
  # (with its own --delay between them). The legacy per-key subprocess
  # loop paid ~30 ms fork × N keys; this version is 1 fork total.
  env={**os.environ,"DISPLAY":DISPLAY}
  keys=[k for k in (p.get("keys") or [p.get("key","")]) if k]
  if not keys:return{"success":True}
  to=max(10,len(keys)*2)
  subprocess.run(["xdotool","key","--clearmodifiers","--"]+keys,env=env,timeout=to)
  return{"success":True,"keys":len(keys)}
 def _kc(self,p):_xdo("key","+".join(p.get("keys",[])));return{"success":True}
 def _tt(self,p):
  env={**os.environ,"DISPLAY":DISPLAY};subprocess.run(["xdotool","type","--",p.get("text","")],env=env,timeout=10);return{"success":True}
 def _ex(self,p):
  cmd=p.get("command","");cwd=p.get("cwd","/home/ubuntu")
  use_sudo=p.get("sudo",False)
  env={**os.environ,"DISPLAY":DISPLAY,"HOME":"/home/ubuntu","PATH":"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"}
  if use_sudo and not cmd.strip().startswith("sudo"):cmd="sudo "+cmd
  try:
   r=subprocess.run(cmd,shell=True,capture_output=True,text=True,timeout=120,cwd=cwd,env=env)
   out=(r.stdout+r.stderr)[:5000]
   if len(r.stdout+r.stderr)>5000:out+="\\n...[truncated]"
   return{"success":True,"output":out,"exit_code":r.returncode}
  except subprocess.TimeoutExpired:return{"success":False,"error":"timed out"}
 def _fr(self,p):
  try:
   path=os.path.expanduser(p.get("path",""))
   with open(path,"r",errors="replace") as f:c=f.read()
   if len(c)>50000:c=c[:50000]+"\\n...[truncated]"
   return{"success":True,"content":c}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fw(self,p):
  try:
   path=os.path.expanduser(p.get("path",""));os.makedirs(os.path.dirname(path) or".",exist_ok=True)
   with open(path,"w") as f:f.write(p.get("content",""))
   return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fu(self,p):
  try:
   path=os.path.expanduser(p.get("filepath",p.get("path","")))
   if path.startswith("/home/desktop"):path="/home/ubuntu"+path[len("/home/desktop"):]
   if not os.path.isabs(path):path=os.path.join("/home/ubuntu/Desktop",path)
   os.makedirs(os.path.dirname(path) or".",exist_ok=True)
   enc=p.get("encoding","utf-8");content=p.get("content","")
   if enc=="base64":
    with open(path,"wb") as f:f.write(base64.b64decode(content))
   else:
    with open(path,"w") as f:f.write(content)
   sz=os.path.getsize(path)
   return{"success":True,"filepath":path,"size":sz,"message":f"Uploaded {sz} bytes"}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fdn(self,p):
  try:
   path=os.path.expanduser(p.get("filepath",""))
   if path.startswith("/home/desktop"):path="/home/ubuntu"+path[len("/home/desktop"):]
   if not os.path.isfile(path):return{"success":False,"error":f"Not found: {path}"}
   sz=os.path.getsize(path);name=os.path.basename(path);enc=p.get("encoding","auto")
   if enc=="auto":
    try:
     with open(path,"r") as f:content=f.read();enc="utf-8"
    except UnicodeDecodeError:
     with open(path,"rb") as f:content=base64.b64encode(f.read()).decode("ascii");enc="base64"
   elif enc=="base64":
    with open(path,"rb") as f:content=base64.b64encode(f.read()).decode("ascii")
   else:
    with open(path,"r",errors="replace") as f:content=f.read()
   return{"success":True,"filename":name,"filepath":path,"size":sz,"encoding":enc,"content":content}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fld(self,p):
  try:
   path=os.path.expanduser(p.get("dirpath",p.get("path","/home/ubuntu")))
   if path.startswith("/home/desktop"):path="/home/ubuntu"+path[len("/home/desktop"):]
   if not os.path.isdir(path):return{"success":False,"error":f"Not a directory: {path}"}
   files=[]
   for e in sorted(os.listdir(path)):
    full=os.path.join(path,e);is_dir=os.path.isdir(full)
    files.append({"filename":e,"path":full,"is_directory":is_dir,"size":0 if is_dir else os.path.getsize(full)})
   return{"success":True,"files":files,"count":len(files)}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fa(self,p):
  try:
   with open(os.path.expanduser(p.get("path","")),"a") as f:f.write(p.get("content",""))
   return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fd(self,p):
  try:os.remove(os.path.expanduser(p.get("path","")));return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fe(self,p):return{"success":True,"exists":os.path.exists(os.path.expanduser(p.get("path","")))}
 def _dl(self,p):
  try:
   path=os.path.expanduser(p.get("path","/home/ubuntu"));entries=[]
   for e in sorted(os.listdir(path)):
    full=os.path.join(path,e);entries.append({"name":e,"type":"directory" if os.path.isdir(full) else"file","size":os.path.getsize(full) if os.path.isfile(full) else 0})
   return{"success":True,"entries":entries}
  except Exception as e:return{"success":False,"error":str(e)}
 def _ocr(self,p):
  if not _HAS_OCR:return{"success":False,"error":"tesseract unavailable"}
  img_data=_shot()
  if not img_data:return{"success":False,"error":"screenshot failed"}
  b64=img_data.split(",",1)[1];img=Image.open(io.BytesIO(base64.b64decode(b64)))
  return{"success":True,"text":pytesseract.image_to_string(img),"screenshot":img_data}
 def _bo(self,p):
  try:
   b=_get_browser();u=p.get("url","about:blank")
   if u=="about:blank":return{"success":True}
   res=_navigate_smart(b,u);return{"success":not res.get("blocked",False),**res}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bn(self,p):
  try:
   b=_get_browser();res=_navigate_smart(b,p.get("url",""))
   return{"success":not res.get("blocked",False),**res}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bc(self,p):
  try:_get_browser().find_element(By.CSS_SELECTOR,p.get("selector","")).click();return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bt(self,p):
  try:
   el=_get_browser().find_element(By.CSS_SELECTOR,p.get("selector",""));el.clear();el.send_keys(p.get("text",""));return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bx(self,p):
  try:r=_get_browser().execute_script(p.get("script",""));return{"success":True,"result":str(r) if r is not None else None}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bd(self,p):
  try:
   b=_get_browser();dom=b.execute_script("return document.documentElement.outerHTML")
   if len(dom)>10000:dom=dom[:10000]+"...[truncated]"
   return{"success":True,"dom":dom,"url":b.current_url,"title":b.title}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bs(self,p):
  try:b=_get_browser();return{"success":True,"url":b.current_url,"title":b.title}
  except Exception as e:return{"success":False,"error":str(e)}
async def main():
 try:_apply_tz()
 except Exception as e:print(f"[locale] startup apply failed: {e}",flush=True)
 agent=Agent()
 print(f"AI Agent listening on {HOST}:{PORT}",flush=True)
 # ping_interval=20 / ping_timeout=10 — server-side keep-alive (2026-05-17 NAT fix).
 # The backend (vm_control.py) already pings every 20s on its side; adding the
 # server-side ping closes the asymmetry where a partition losing the
 # backend->VM direction first would keep the VM-side socket alive for the
 # full TCP keepalive window (~2h on Linux defaults). With both sides
 # pinging at 20s, AWS NAT GW's 350s idle timeout can never expire on
 # a healthy connection. Existing AMI'd instances do NOT pick this up
 # automatically — see operator runbook for rolling restart guidance.
 async with websockets.serve(agent.serve,HOST,PORT,max_size=100*1024*1024,ping_interval=20,ping_timeout=10,close_timeout=60,compression=None):
  await asyncio.Future()
if __name__=="__main__":asyncio.run(main())
`;
  }

  private generateDesktopUserData(vncPassword: string): string {
    // Minify Python (strip pure-comment lines + collapse blanks) before
    // gzip; cuts ~10-15% off the embedded agent payload after gzip.
    const agentPy = this.minifyPython(this.getAgentSource());

    // Gzip-compress the Python agent to fit within AWS UserData 16384-byte
    // RAW limit (after base64 decode at AWS).
    const agentGz = zlib.gzipSync(Buffer.from(agentPy), { level: 9 });
    const agentB64 = agentGz.toString("base64").match(/.{1,76}/g)?.join("\n") ?? "";

    const script = `#!/bin/bash
set -e
exec > /var/log/desktop-setup.log 2>&1

echo "DESKTOP_INIT_STATUS=installing" > /var/run/desktop-init-status
echo "Desktop setup started at $(date)"

# Update packages
apt-get update -y

# Install desktop + VNC + AI agent dependencies
DEBIAN_FRONTEND=noninteractive apt-get install -y \\
  xfce4 \\
  xfce4-terminal \\
  xfce4-goodies \\
  dbus-x11 \\
  x11-xserver-utils \\
  x11-utils \\
  tigervnc-standalone-server \\
  tigervnc-common \\
  python3-websockify \\
  python3-pip \\
  python3-dev \\
  git \\
  curl \\
  wget \\
  net-tools \\
  scrot \\
  xdotool \\
  xclip \\
  wmctrl \\
  tesseract-ocr \\
  tesseract-ocr-eng \\
  imagemagick \\
  xdg-utils \\
  fonts-liberation \\
  software-properties-common \\
  locales \\
  tzdata \\
  sudo

# Pre-generate locales the AI agent may switch into at runtime based on
# proxy egress IP geo. Without these, Firefox can't render its UI for the
# requested locale and falls back to en_US — that fallback is observable
# via document.fonts and Intl.Collator.compare and contradicts the spoofed
# Accept-Language header. Generating a small set covers the common markets
# without bloating the AMI.
locale-gen \\
  en_US.UTF-8 en_GB.UTF-8 en_CA.UTF-8 en_AU.UTF-8 \\
  de_DE.UTF-8 fr_FR.UTF-8 es_ES.UTF-8 es_MX.UTF-8 \\
  it_IT.UTF-8 nl_NL.UTF-8 pt_BR.UTF-8 pt_PT.UTF-8 \\
  ja_JP.UTF-8 ko_KR.UTF-8 zh_CN.UTF-8 zh_TW.UTF-8 \\
  ru_RU.UTF-8 tr_TR.UTF-8 ar_SA.UTF-8 he_IL.UTF-8 \\
  pl_PL.UTF-8 sv_SE.UTF-8

# Grant ubuntu user passwordless sudo (full admin access for AI agent)
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu-nopasswd
chmod 440 /etc/sudoers.d/ubuntu-nopasswd

# Install Firefox as native deb (not snap — snap breaks in VNC/cloud-init)
add-apt-repository -y ppa:mozillateam/ppa
cat > /etc/apt/preferences.d/mozilla-firefox << 'MOZPREF'
Package: *
Pin: release o=LP-PPA-mozillateam
Pin-Priority: 1001
MOZPREF
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y firefox

# Install geckodriver for Selenium
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  GD_ARCH="linux-aarch64"
else
  GD_ARCH="linux64"
fi
GD_VER=$(curl -sL https://api.github.com/repos/mozilla/geckodriver/releases/latest | python3 -c "import sys,json;print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || echo "v0.35.0")
curl -sL "https://github.com/mozilla/geckodriver/releases/download/\${GD_VER}/geckodriver-\${GD_VER}-\${GD_ARCH}.tar.gz" | tar xz -C /usr/local/bin
chmod +x /usr/local/bin/geckodriver

# Python AI agent dependencies
pip3 install --quiet \\
  websockets \\
  pyautogui \\
  Pillow \\
  mss \\
  requests \\
  python-xlib \\
  pytesseract \\
  selenium

# Remove screen lockers that get pulled in by xfce4-goodies
apt-get remove -y light-locker xfce4-screensaver xscreensaver 2>/dev/null || true

echo "Firefox + geckodriver installed"

# Set Firefox as default browser
update-alternatives --set x-www-browser /usr/bin/firefox 2>/dev/null || true
update-alternatives --set gnome-www-browser /usr/bin/firefox 2>/dev/null || true

echo "Browser setup completed"

# Clone noVNC
git clone --depth 1 https://github.com/novnc/noVNC.git /opt/novnc
git clone --depth 1 https://github.com/novnc/websockify.git /opt/novnc/utils/websockify
ln -sf /opt/novnc/vnc.html /opt/novnc/index.html

# Set up VNC for ubuntu user
USER_HOME=/home/ubuntu
mkdir -p $USER_HOME/.vnc
chown ubuntu:ubuntu $USER_HOME/.vnc

# Set VNC password
echo "${vncPassword}" | vncpasswd -f > $USER_HOME/.vnc/passwd
chmod 600 $USER_HOME/.vnc/passwd
chown ubuntu:ubuntu $USER_HOME/.vnc/passwd

# Create xstartup
cat > $USER_HOME/.vnc/xstartup << 'XSTARTUP_EOF'
#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/runtime-ubuntu
export XDG_CURRENT_DESKTOP=XFCE
export DESKTOP_SESSION=xfce
mkdir -p $XDG_RUNTIME_DIR
chmod 700 $XDG_RUNTIME_DIR

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
    if which dbus-launch >/dev/null 2>&1; then
        eval $(dbus-launch --sh-syntax)
        export DBUS_SESSION_BUS_ADDRESS
    fi
fi

[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources

xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true
xset s 0 0 2>/dev/null || true
xset -dpms 2>/dev/null || true

# Kill screen lockers
pkill -f light-locker 2>/dev/null || true
pkill -f xfce4-screensaver 2>/dev/null || true
pkill -f xscreensaver 2>/dev/null || true

# Disable XFCE screensaver and power manager idle via xfconf
xfconf-query -c xfce4-screensaver -p /saver/enabled -s false 2>/dev/null || true
xfconf-query -c xfce4-screensaver -p /lock/enabled -s false 2>/dev/null || true
xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -s false 2>/dev/null || true
xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/blank-on-ac -s 0 2>/dev/null || true
xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/inactivity-on-ac -s 0 2>/dev/null || true

exec /usr/bin/startxfce4 --disable-wm-check
XSTARTUP_EOF
chmod 755 $USER_HOME/.vnc/xstartup
chown -R ubuntu:ubuntu $USER_HOME/.vnc

# VNC startup wrapper (Xvnc + xstartup in foreground for systemd Type=simple)
cat > /usr/local/bin/start-vnc.sh << 'VNC_WRAPPER_EOF'
#!/bin/bash
# Clean up stale locks
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# Start Xvnc directly in the background
/usr/bin/Xvnc :1 \
  -geometry 1280x720 \
  -depth 24 \
  -SecurityTypes VncAuth \
  -PasswordFile /home/ubuntu/.vnc/passwd \
  -desktop "Ubuntu Desktop" \
  -alwaysshared &
XVNC_PID=$!

# Wait for display to be ready
sleep 2

# Launch xstartup (XFCE desktop)
export DISPLAY=:1
exec /home/ubuntu/.vnc/xstartup
VNC_WRAPPER_EOF
chmod 755 /usr/local/bin/start-vnc.sh

# Create systemd service for VNC
cat > /etc/systemd/system/vncserver@.service << 'SYSTEMD_VNC_EOF'
[Unit]
Description=TigerVNC Server for display %i
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu
Environment=HOME=/home/ubuntu
ExecStartPre=/bin/bash -c 'rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || :'
ExecStart=/usr/local/bin/start-vnc.sh
ExecStop=/bin/bash -c '/usr/bin/vncserver -kill %i 2>/dev/null; kill $(cat /tmp/.X1-lock 2>/dev/null) 2>/dev/null || true'
Restart=on-failure
RestartSec=5
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
SYSTEMD_VNC_EOF

# Create systemd service for noVNC
cat > /etc/systemd/system/novnc.service << 'SYSTEMD_NOVNC_EOF'
[Unit]
Description=noVNC WebSocket Proxy
After=vncserver@:1.service
Wants=vncserver@:1.service

[Service]
Type=simple
User=root
ExecStartPre=/bin/bash -c 'for i in $(seq 1 150); do ss -tln | grep -q :5901 && exit 0; sleep 0.2; done; exit 1'
ExecStart=/opt/novnc/utils/novnc_proxy --vnc localhost:5901 --listen 6080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD_NOVNC_EOF

# Enable and start services. noVNC's own ExecStartPre waits for port 5901,
# so we can fire both starts in parallel via --no-block — saves ~5s of
# sequential wait. systemd's After=/Wants= chain handles ordering.
systemctl daemon-reload
systemctl enable vncserver@:1.service novnc.service
systemctl start --no-block vncserver@:1.service novnc.service

# Comprehensive screen keep-alive script (prevents sleep/lock)
cat > /usr/local/bin/keep-screen-alive.sh << 'KEEPALIVE_EOF'
#!/bin/bash
export DISPLAY=:1

disable_dpms() {
    xset -dpms 2>/dev/null || true
    xset s off 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    xset s 0 0 2>/dev/null || true
}

disable_screensaver() {
    xfconf-query -c xfce4-screensaver -p /saver/enabled -s false 2>/dev/null || true
    xfconf-query -c xfce4-screensaver -p /saver/mode -s 0 2>/dev/null || true
    xfconf-query -c xfce4-screensaver -p /lock/enabled -s false 2>/dev/null || true
    pkill -f screensaver 2>/dev/null || true
    pkill -f xscreensaver 2>/dev/null || true
    pkill -f light-locker 2>/dev/null || true
}

disable_power_management() {
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -s false 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/blank-on-ac -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-on-ac-sleep -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-on-ac-off -s 0 2>/dev/null || true
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/inactivity-on-ac -s 0 2>/dev/null || true
}

simulate_activity() {
    if command -v xdotool >/dev/null 2>&1; then
        eval $(xdotool getmouselocation --shell 2>/dev/null || echo "X=100 Y=100")
        xdotool mousemove $((X+1)) $((Y+1)) 2>/dev/null || true
        sleep 0.1
        xdotool mousemove $X $Y 2>/dev/null || true
    fi
}

# Initial setup
disable_dpms
disable_screensaver
disable_power_management

COUNTER=0
while true; do
    disable_dpms
    xset s reset 2>/dev/null || true

    if [ $((COUNTER % 2)) -eq 0 ]; then
        simulate_activity
        disable_screensaver
    fi

    if [ $((COUNTER % 4)) -eq 0 ]; then
        xdotool key shift 2>/dev/null || true
        disable_power_management
    fi

    if [ $((COUNTER % 10)) -eq 0 ]; then
        if xset q 2>/dev/null | grep -q "DPMS is Enabled"; then
            disable_dpms
        fi
    fi

    COUNTER=$((COUNTER + 1))
    sleep 30
done
KEEPALIVE_EOF
chmod 755 /usr/local/bin/keep-screen-alive.sh

# Systemd service for keep-alive
cat > /etc/systemd/system/keep-screen-alive.service << 'KEEPALIVE_SVC_EOF'
[Unit]
Description=Screen Keep-Alive Service
After=vncserver@:1.service
Wants=vncserver@:1.service

[Service]
Type=simple
User=ubuntu
Environment=DISPLAY=:1
ExecStartPre=/bin/bash -c 'for i in $(seq 1 300); do xdpyinfo -display :1 >/dev/null 2>&1 && exit 0; sleep 0.2; done; exit 1'
ExecStart=/usr/local/bin/keep-screen-alive.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
KEEPALIVE_SVC_EOF

systemctl daemon-reload
systemctl enable keep-screen-alive.service
systemctl start keep-screen-alive.service

# Set up desktop shortcuts and browser defaults for ubuntu user
USER_DESKTOP=$USER_HOME/Desktop
mkdir -p $USER_DESKTOP
cat > $USER_DESKTOP/firefox.desktop << 'BROWSER_DESKTOP_EOF'
[Desktop Entry]
Version=1.0
Type=Application
Name=Firefox
Comment=Browse the Web
Exec=firefox %U
Icon=firefox
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
BROWSER_DESKTOP_EOF
chmod 755 $USER_DESKTOP/firefox.desktop
chown ubuntu:ubuntu $USER_DESKTOP/firefox.desktop

# Terminal shortcut
cat > $USER_DESKTOP/terminal.desktop << 'TERM_DESKTOP_EOF'
[Desktop Entry]
Version=1.0
Type=Application
Name=Terminal
Comment=Use the command line
Exec=xfce4-terminal
Icon=utilities-terminal
Terminal=false
Categories=System;TerminalEmulator;
TERM_DESKTOP_EOF
chmod 755 $USER_DESKTOP/terminal.desktop
chown ubuntu:ubuntu $USER_DESKTOP/terminal.desktop
chown -R ubuntu:ubuntu $USER_DESKTOP

# Set MIME defaults for ubuntu user
mkdir -p $USER_HOME/.local/share/applications
cat > $USER_HOME/.local/share/applications/mimeapps.list << 'MIME_EOF'
[Default Applications]
text/html=firefox.desktop
x-scheme-handler/http=firefox.desktop
x-scheme-handler/https=firefox.desktop
x-scheme-handler/about=firefox.desktop
x-scheme-handler/unknown=firefox.desktop
MIME_EOF
chown -R ubuntu:ubuntu $USER_HOME/.local

# Add useful aliases to ubuntu's bashrc
cat >> $USER_HOME/.bashrc << 'BASHRC_EOF'
alias browser='firefox'
export DISPLAY=:1
BASHRC_EOF
chown ubuntu:ubuntu $USER_HOME/.bashrc

# AI Agent Server
mkdir -p /opt/ai-agent && chown ubuntu:ubuntu /opt/ai-agent
printf 'VNC_PASSWORD=%s\\n' "${vncPassword}" > /opt/ai-agent/.env
chmod 600 /opt/ai-agent/.env && chown ubuntu:ubuntu /opt/ai-agent/.env

# Agent server (gzip+base64 to fit AWS UserData 25,600-byte limit)
base64 -d << 'AGENT_B64_EOF' | gunzip > /opt/ai-agent/server.py
${agentB64}
AGENT_B64_EOF
chown ubuntu:ubuntu /opt/ai-agent/server.py

# Create systemd service for AI agent with full environment.
# NOTE: NO After=/Wants=vncserver dependency. The agent starts as soon as
# multi-user.target is up so port 8080 is reachable for orchestrator probes
# in seconds (vs ~10s waiting for Xvnc). Browser commands lazily wait for
# X via xdpyinfo inside the Python agent (already imports try/except);
# terminal/file/screenshot ops work as soon as their underlying tool is
# usable.
#
# HARDENING (2026-05-11 audit follow-up): the 2026-05-10 13:02Z incident
# saw two EC2 hosts die in lockstep with Errno 111 on :8080 — host up,
# Python listener gone, never recovered. Root cause was almost certainly
# systemd's default StartLimitBurst=5/10s tripping after a short crash
# loop, leaving the unit in 'failed' state with no further restart.
# The mitigations below address each failure mode explicitly:
#   - StartLimitBurst=10 + StartLimitIntervalSec=60 lets us absorb 10
#     crashes per minute before refusing further restarts.
#   - Restart=always (not on-failure) catches clean exits too — a
#     deadlocked asyncio loop that eventually returns 0 is still bad.
#   - RuntimeMaxSec=14400 forces a preventive restart every 4 h to
#     bound slow leaks (Selenium / Chrome / mss can all leak FDs).
#   - MemoryMax=1G + MemoryHigh=768M doubles the prior 512M/384M caps;
#     t4g.small has 2 GB and the old caps put the agent on the edge of
#     OOM during burst workloads (Counter-Strike gameplay test agent).
#   - ExecStopPost kills orphan chromium/chromedriver/pyautogui procs
#     so a restart doesn't fight leftover Chrome profiles for the lock.
#   - LimitNOFILE=65536 prevents file-descriptor exhaustion under load.
#   - TasksMax=512 bounds child-process growth.
#   - OOMPolicy=restart keeps the existing behavior on kernel OOM.
# A separate tcp-listener-watchdog.service (defined below) provides
# defense-in-depth against the "process alive but listener gone" case
# that systemd alone can't detect.
cat > /etc/systemd/system/ai-agent.service << 'AGENT_SVC_EOF'
[Unit]
Description=LLMHub AI Agent WebSocket Server
After=network-online.target
Wants=network-online.target
# Be patient with restart bursts: default is 5 in 10s which is too
# strict for an agent under heavy load. Allow 10 in 60s before giving up.
StartLimitBurst=10
StartLimitIntervalSec=60

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
Environment=DISPLAY=:1
Environment=HOME=/home/ubuntu
Environment=AGENT_PORT=8080
Environment=AGENT_HOST=0.0.0.0
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
Environment=XDG_RUNTIME_DIR=/tmp/runtime-ubuntu
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/runtime-ubuntu/bus
# Python: line-buffered stdout/stderr + fault handler for crash tracebacks
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONFAULTHANDLER=1
EnvironmentFile=/opt/ai-agent/.env
ExecStartPre=/bin/bash -c 'mkdir -p /tmp/runtime-ubuntu && chmod 700 /tmp/runtime-ubuntu && chown ubuntu:ubuntu /tmp/runtime-ubuntu'
ExecStart=/usr/bin/python3 /opt/ai-agent/server.py
# Always restart, not just on-failure — a clean exit from a deadlocked
# event loop still leaves the agent dead and should trigger restart.
Restart=always
RestartSec=2
# Preventive periodic restart to bound slow leaks. 4 h is short enough
# that any leak gets bounded but long enough to not interrupt user
# work mid-session (typical CUA session is <30 min).
RuntimeMaxSec=14400
# Memory caps — doubled from the prior 512M/384M to give Python +
# Selenium + Chrome more headroom on bursty workloads. t4g.small has
# 2 GB total; 1 G for the agent + 1 G for OS/Chrome/Xvnc is safe.
MemoryMax=1G
MemoryHigh=768M
OOMPolicy=restart
# Resource limits to prevent FD / process exhaustion under load.
LimitNOFILE=65536
TasksMax=512
# Clean up orphan browser processes on stop so a restart doesn't fight
# leftover Chrome profiles for the user-data-dir lock. The agent itself
# spawns chromium via Selenium and Selenium doesn't always reap.
ExecStopPost=/bin/bash -c 'pkill -9 -f "chromium-browser" 2>/dev/null || true; pkill -9 -f "chromedriver" 2>/dev/null || true; pkill -9 -f "[c]hrome --type=" 2>/dev/null || true; rm -f /tmp/.X1-lock 2>/dev/null || true'

[Install]
WantedBy=multi-user.target
AGENT_SVC_EOF

# Swap space (2GB) - prevents OOM kills on t4g.small
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
sysctl -p /etc/sysctl.d/99-swap.conf

# Memory watchdog - kills excess browser processes before OOM and
# recovers ai-agent.service from systemd's 'failed' state (which is the
# terminal state after StartLimitBurst exhaustion — the exact failure
# mode the 2026-05-11 audit found on the lockstep-dead VMs).
cat > /usr/local/bin/memory-watchdog.sh << 'WATCHDOG_EOF'
#!/bin/bash
THRESHOLD_WARN=80
THRESHOLD_KILL=88
get_mem_pct() { free | awk '/^Mem:/ { printf "%.0f", ($3/$2)*100 }'; }
cleanup_browser_cache() {
    rm -rf /home/ubuntu/.cache/mozilla/firefox/*/cache2/* 2>/dev/null || true
    sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
}
kill_excess_browser_procs() {
    local pids=$(ps aux | grep -i "[I]solated Web" | sort -k6 -rn | tail -n +3 | awk '{print $2}')
    for pid in $pids; do kill -9 "$pid" 2>/dev/null && logger -t memory-watchdog "Killed excess browser process $pid"; done
    local zombies=$(ps aux | grep -i "[d]efunct" | awk '{print $2}')
    for pid in $zombies; do kill -9 "$pid" 2>/dev/null; done
}
recover_failed_agent() {
    # If ai-agent.service is in 'failed' state (typically after
    # StartLimitBurst exhaustion), reset-failed and start it back up.
    # This catches the 2026-05-10 13:02Z lockstep failure mode that
    # left both VMs with the unit permanently dead.
    local state=$(systemctl is-active ai-agent.service 2>/dev/null || true)
    local sub=$(systemctl is-failed ai-agent.service 2>/dev/null || true)
    if [ "$state" = "failed" ] || [ "$sub" = "failed" ]; then
        logger -t memory-watchdog "RECOVERY: ai-agent.service in failed state — reset-failed + start"
        systemctl reset-failed ai-agent.service 2>/dev/null || true
        systemctl start ai-agent.service 2>/dev/null || true
    fi
}
while true; do
    MEM_PCT=$(get_mem_pct)
    if [ "$MEM_PCT" -ge "$THRESHOLD_KILL" ]; then
        logger -t memory-watchdog "CRITICAL: Memory at \${MEM_PCT}% - killing excess browser procs"
        kill_excess_browser_procs; cleanup_browser_cache
    elif [ "$MEM_PCT" -ge "$THRESHOLD_WARN" ]; then
        logger -t memory-watchdog "WARNING: Memory at \${MEM_PCT}% - clearing caches"
        cleanup_browser_cache
    fi
    # Check every loop iteration (every 30s) whether the agent unit
    # has fallen into 'failed' state and resurrect it if so. Cheap.
    recover_failed_agent
    sleep 30
done
WATCHDOG_EOF
chmod 755 /usr/local/bin/memory-watchdog.sh

cat > /etc/systemd/system/memory-watchdog.service << 'WATCHDOG_SVC_EOF'
[Unit]
Description=Memory Watchdog Service
After=multi-user.target
[Service]
Type=simple
ExecStart=/usr/local/bin/memory-watchdog.sh
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
WATCHDOG_SVC_EOF

# TCP-listener watchdog — catches the exact failure mode the 2026-05-11
# audit found: host responding to ping, ai-agent.service shows "active",
# but the Python listener on :8080 is gone (Errno 111 TCP refused).
# systemd alone can't detect this — the process is alive, just not
# listening. We probe localhost:8080 every 15s; 3 consecutive failures
# trigger a clean restart of the agent. This is the load-bearing fix
# for the 491-event lockstep failure on 2026-05-10 13:02Z.
cat > /usr/local/bin/tcp-listener-watchdog.sh << 'TCPWD_EOF'
#!/bin/bash
# Watches ai-agent.service's TCP listener on $PORT. If the listener
# disappears for $FAILURE_THRESHOLD consecutive probes, restart the
# service. Resets the failed-state first so systemd's StartLimit doesn't
# block the restart.
set -u
PORT="\${AGENT_PORT:-8080}"
PROBE_INTERVAL=15        # seconds between probes
FAILURE_THRESHOLD=3      # consecutive failures before restart
CONNECT_TIMEOUT=3        # seconds for each probe
RESTART_COOLDOWN=60      # seconds between restart attempts
SERVICE="ai-agent.service"

probe_listener() {
    # /dev/tcp/host/port is bash built-in — no curl/nc dependency.
    # Timeout via the 'timeout' coreutil; bash builtin alone can hang
    # if the host is up but firewalled (rare but possible).
    timeout "\$CONNECT_TIMEOUT" bash -c "</dev/tcp/127.0.0.1/\$PORT" 2>/dev/null
}

restart_agent() {
    logger -t tcp-listener-watchdog "RESTART: listener gone on :\$PORT, restarting \$SERVICE"
    # Clear any failed-state backoff so the restart fires immediately
    # rather than being silently rejected by systemd's StartLimit.
    systemctl reset-failed "\$SERVICE" 2>/dev/null || true
    systemctl restart "\$SERVICE" 2>/dev/null || true
}

failures=0
last_restart=0

# Wait for the agent to come up initially before starting the watch
# loop — avoid restart-storm during boot when the agent is still
# starting up.
for i in 1 2 3 4 5 6 7 8 9 10; do
    if probe_listener; then
        logger -t tcp-listener-watchdog "initial probe OK on :\$PORT"
        break
    fi
    sleep 5
done

while true; do
    if probe_listener; then
        if [ "\$failures" -gt 0 ]; then
            logger -t tcp-listener-watchdog "listener recovered after \$failures failed probes"
        fi
        failures=0
    else
        failures=\$((failures + 1))
        logger -t tcp-listener-watchdog "probe failed on :\$PORT (failures=\$failures/\$FAILURE_THRESHOLD)"
        if [ "\$failures" -ge "\$FAILURE_THRESHOLD" ]; then
            now=\$(date +%s)
            since=\$((now - last_restart))
            if [ "\$since" -ge "\$RESTART_COOLDOWN" ]; then
                restart_agent
                last_restart=\$now
                failures=0
                # Give the restart time to take effect before probing again
                sleep 10
            else
                logger -t tcp-listener-watchdog "in cooldown (\${since}s since last restart < \${RESTART_COOLDOWN}s); skipping"
            fi
        fi
    fi
    sleep "\$PROBE_INTERVAL"
done
TCPWD_EOF
chmod 755 /usr/local/bin/tcp-listener-watchdog.sh

cat > /etc/systemd/system/tcp-listener-watchdog.service << 'TCPWD_SVC_EOF'
[Unit]
Description=AI Agent TCP listener watchdog (defense-in-depth for :8080)
# Start after the agent so the initial probe loop has a chance to
# succeed; if the agent unit is dead at boot the watchdog will detect
# and restart it just like at runtime.
After=ai-agent.service network-online.target
Wants=ai-agent.service network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/tcp-listener-watchdog.sh
Restart=always
RestartSec=10
# Keep the watchdog itself trim — it's just a probe loop.
MemoryMax=32M
TasksMax=8

[Install]
WantedBy=multi-user.target
TCPWD_SVC_EOF

systemctl daemon-reload
systemctl enable ai-agent.service memory-watchdog.service tcp-listener-watchdog.service
systemctl start ai-agent.service
systemctl start memory-watchdog.service
systemctl start tcp-listener-watchdog.service

echo "DESKTOP_INIT_STATUS=ready" > /var/run/desktop-init-status
echo "Desktop setup complete at $(date)"
`;

    // Strip comments + collapse blank lines (preserves heredoc bodies),
    // then gzip. AWS RunInstances enforces 16384 bytes RAW after base64
    // decode; cloud-init auto-detects gzip magic bytes for us on Linux.
    const minified = this.minifyBash(script);
    const scriptGz = zlib.gzipSync(Buffer.from(minified), { level: 9 });
    return scriptGz.toString("base64");
  }

  /**
   * Returns the Windows-compatible Python AI agent source code.
   * Uses pyautogui natively (no xdotool), PowerShell for terminal, Chrome for browser.
   * Same WebSocket protocol as the Linux agent.
   */
  private getWindowsAgentSource(): string {
    return `#!/usr/bin/env python3
import asyncio,base64,io,json,os,subprocess,tempfile,time,sys
import urllib.request
from typing import Any,Dict
try:
 import mss;_HAS_MSS=True
except:_HAS_MSS=False
try:
 import pyautogui;pyautogui.FAILSAFE=False;pyautogui.PAUSE=0.05;_HAS_PAG=True
except:_HAS_PAG=False
try:
 import pytesseract;_HAS_OCR=True
except:_HAS_OCR=False
try:
 from selenium import webdriver
 from selenium.webdriver.chrome.options import Options as ChromeOptions
 from selenium.webdriver.chrome.service import Service as ChromeService
 from selenium.webdriver.common.by import By
 _HAS_SEL=True
except:_HAS_SEL=False
from PIL import Image
import websockets
VNC_PASSWORD=os.environ.get("VNC_PASSWORD","")
PORT=int(os.environ.get("AGENT_PORT","8080"))
HOST=os.environ.get("AGENT_HOST","0.0.0.0")
HOME_DIR=os.path.expanduser("~")
DESKTOP_DIR=os.path.join(HOME_DIR,"Desktop")
_browser_instance=None
_COUNTRY_LANG={"US":"en-US","GB":"en-GB","CA":"en-CA","AU":"en-AU","NZ":"en-NZ","IE":"en-IE","ZA":"en-ZA","IN":"en-IN","DE":"de-DE","FR":"fr-FR","ES":"es-ES","IT":"it-IT","NL":"nl-NL","SE":"sv-SE","NO":"nb-NO","DK":"da-DK","FI":"fi-FI","PL":"pl-PL","PT":"pt-PT","BR":"pt-BR","MX":"es-MX","AR":"es-AR","JP":"ja-JP","KR":"ko-KR","CN":"zh-CN","TW":"zh-TW","HK":"zh-HK","SG":"en-SG","RU":"ru-RU","TR":"tr-TR","SA":"ar-SA","AE":"ar-AE","IL":"he-IL","ID":"id-ID","TH":"th-TH","VN":"vi-VN","PH":"en-PH","MY":"en-MY"}
_LOCALE=None
def _resolve_locale():
 # Returns {"tz":..., "lang":..., "accept":..., "country":...} matched to the egress IP.
 # Honors HTTPS_PROXY/https_proxy. Operator overrides: COASTY_TZ, COASTY_LANG.
 global _LOCALE
 if _LOCALE is not None:return _LOCALE
 tz=os.environ.get("COASTY_TZ","").strip()
 lang=os.environ.get("COASTY_LANG","").strip()
 country=""
 if not(tz and lang):
  try:
   proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
   req=urllib.request.Request("https://ipinfo.io/json",headers={"User-Agent":"coasty/1"})
   op=urllib.request.build_opener(urllib.request.ProxyHandler({"https":proxy,"http":proxy})) if proxy else urllib.request.build_opener()
   resp=op.open(req,timeout=4);d=json.loads(resp.read().decode())
   if not tz:tz=(d.get("timezone") or "").strip()
   country=(d.get("country") or "").strip().upper()
  except Exception as e:print(f"[locale] geo lookup failed: {e}",flush=True)
 if not lang:lang=_COUNTRY_LANG.get(country,"en-US")
 if not tz:tz="America/New_York"
 base=lang.split("-")[0]
 _LOCALE={"tz":tz,"lang":lang,"accept":lang+","+base+";q=0.9","country":country}
 print(f"[locale] tz={tz} lang={lang} country={country or '?'} accept={_LOCALE['accept']}",flush=True)
 return _LOCALE
def _apply_tz():
 # Sets TZ env var; on Windows Chrome reads timezone via Win32 GetTimeZoneInformation
 # (not TZ env), so this only matters for the Python process. The Chrome --lang flag
 # and intl.accept_languages pref below cover the browser-visible signals.
 loc=_resolve_locale();os.environ["TZ"]=loc["tz"]
 try:time.tzset()
 except:pass
 return loc
# ===== Behavioral mimicry & stealth (Windows / pyautogui) =====
import random as _rng
_BIGRAM_DELAY={"th":105,"he":110,"in":115,"er":115,"an":120,"re":120,"on":125,"at":125,"en":125,"nd":130,"ti":130,"es":130,"or":130,"te":135,"of":135,"ed":135,"is":135,"it":135,"al":135,"ar":140,"st":140,"to":140,"nt":140,"ng":140,"se":145,"ha":145,"as":145,"ou":150,"io":150,"le":150,"ve":155,"co":155,"me":155,"de":160,"hi":160,"ri":160,"ro":160,"ic":165,"ne":165,"ea":165,"ra":170,"ce":170,"li":150,"ch":175,"ll":160}
# Common Windows desktop resolutions (StatCounter 2024-2025)
_VP_POOL=[(1920,1080),(1920,1080),(1920,1080),(1920,1080),(1366,768),(1536,864),(1440,900),(2560,1440),(1600,900),(1280,720)]
_VIEWPORT=None
# Real Chrome on Windows UA distribution (Chrome 130+ stable channel as of late 2025)
_UA_POOL=["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"]
_UA=None
def _viewport():
 global _VIEWPORT
 if _VIEWPORT is None:_VIEWPORT=_rng.choice(_VP_POOL)
 return _VIEWPORT
def _user_agent():
 global _UA
 if _UA is None:_UA=_rng.choice(_UA_POOL)
 return _UA
def _human_move(x,y,steps=14):
 # pyautogui.moveTo with cubic Bezier path. pyautogui's tweens support
 # easing but don't include curve perpendicular jitter, so we manually
 # walk a Bezier with smoothstep ease-in-out + optional overshoot.
 if not _HAS_PAG:return
 import math
 try:sx,sy=pyautogui.position()
 except:sx,sy=x,y
 dx,dy=x-sx,y-sy;d=math.hypot(dx,dy)
 if d<3:
  try:pyautogui.moveTo(x,y,duration=0)
  except:pass
  return
 ux,uy=-dy/d,dx/d;j=min(d*0.15,35.0)
 cx1=sx+dx*0.30+ux*_rng.uniform(-j,j);cy1=sy+dy*0.30+uy*_rng.uniform(-j,j)
 cx2=sx+dx*0.70+ux*_rng.uniform(-j,j);cy2=sy+dy*0.70+uy*_rng.uniform(-j,j)
 overshoot=(_rng.random()<0.12 and d>80)
 ex=x+_rng.randint(6,18)*(1 if _rng.random()<0.5 else -1) if overshoot else x
 ey=y+_rng.randint(4,14)*(1 if _rng.random()<0.5 else -1) if overshoot else y
 for i in range(1,steps+1):
  t=i/steps;te=t*t*(3-2*t)
  px=(1-te)**3*sx+3*(1-te)**2*te*cx1+3*(1-te)*te*te*cx2+te**3*ex
  py=(1-te)**3*sy+3*(1-te)**2*te*cy1+3*(1-te)*te*te*cy2+te**3*ey
  try:pyautogui.moveTo(int(px),int(py),duration=0)
  except:pass
  time.sleep(_rng.uniform(0.008,0.020))
 if overshoot:
  time.sleep(_rng.uniform(0.04,0.09))
  try:pyautogui.moveTo(x,y,duration=0)
  except:pass
def _human_type_delay(prev,ch):
 # Aalto-calibrated bigram-aware inter-key delay. See Linux agent for refs.
 bg=(prev+ch).lower() if prev else ""
 base=_BIGRAM_DELAY.get(bg,_rng.uniform(170,310))
 d=base*_rng.uniform(0.85,1.18)
 if ch.isupper() and prev and not prev.isupper():d+=_rng.uniform(60,130)
 if ch in".,!?;:":d+=_rng.uniform(90,220)
 if ch==" " and prev not in" \\t\\n":d+=_rng.uniform(20,70)
 if d<60:d=60
 return d/1000.0
def _shot():
 img=None
 if _HAS_MSS:
  try:
   with mss.mss() as s:
    m=s.monitors[1];sh=s.grab(m);img=Image.frombytes("RGB",sh.size,sh.bgra,"raw","BGRX")
  except:img=None
 if img is None and _HAS_PAG:
  try:img=pyautogui.screenshot()
  except:img=None
 if img is None:return None
 img.thumbnail((1280,720),Image.LANCZOS);buf=io.BytesIO()
 img.convert("RGB").save(buf,format="JPEG",quality=80)
 return "data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode()
def _find_chrome():
 paths=[
  os.path.join(os.environ.get("PROGRAMFILES","C:\\\\Program Files"),"Google","Chrome","Application","chrome.exe"),
  os.path.join(os.environ.get("PROGRAMFILES(X86)","C:\\\\Program Files (x86)"),"Google","Chrome","Application","chrome.exe"),
  os.path.join(os.environ.get("LOCALAPPDATA",""),"Google","Chrome","Application","chrome.exe"),
  os.path.join(os.environ.get("PROGRAMFILES","C:\\\\Program Files (x86)"),"Microsoft","Edge","Application","msedge.exe"),
 ]
 for p in paths:
  if os.path.exists(p):return p
 return None
def _get_browser():
 global _browser_instance
 if _browser_instance is not None:
  try:_=_browser_instance.title;return _browser_instance
  except:_browser_instance=None
 if not _HAS_SEL:raise RuntimeError("selenium unavailable")
 import shutil
 from urllib.parse import urlparse as _urlp
 # Match browser-visible locale to (proxy) egress IP. On Windows, system tz
 # is set out-of-band; Chrome here just needs --lang + Accept-Language.
 loc=_apply_tz()
 vw,vh=_viewport()
 ua=_user_agent()
 opts=ChromeOptions()
 # ── Window size ──────────────────────────────────────────────────────
 opts.add_argument(f"--window-size={vw},{vh}")
 opts.add_argument("--no-sandbox")
 opts.add_argument("--disable-dev-shm-usage")
 opts.add_argument("--disable-gpu")
 # ── Locale ────────────────────────────────────────────────────────────
 opts.add_argument(f"--lang={loc['lang']}")
 # ── Stealth: kill the WebDriver / automation tells ───────────────────
 # The blink-features flag flips navigator.webdriver back to undefined,
 # kills the automation infobar, and removes cdc_ window properties
 # that anti-bot scripts grep for.
 opts.add_argument("--disable-blink-features=AutomationControlled")
 opts.add_experimental_option("excludeSwitches",["enable-automation"])
 opts.add_experimental_option("useAutomationExtension",False)
 # ── Stealth: realistic UA (Chrome on Windows, current stable channel) ─
 opts.add_argument(f"--user-agent={ua}")
 # ── Stealth: noise / tracking signals real users have off ────────────
 opts.add_argument("--disable-features=Translate,TranslateUI,IsolateOrigins,site-per-process,InterestCohort")
 opts.add_argument("--disable-default-apps")
 opts.add_argument("--disable-extensions-file-access-check")
 opts.add_argument("--disable-popup-blocking")
 opts.add_argument("--no-first-run")
 opts.add_argument("--no-default-browser-check")
 # ── Prefs: locale + disable phone-home ───────────────────────────────
 prefs={
  "intl.accept_languages":loc["accept"],
  "credentials_enable_service":False,
  "profile.password_manager_enabled":False,
  "profile.default_content_setting_values.geolocation":2,  # block geo prompt
  "profile.default_content_setting_values.notifications":2,
 }
 opts.add_experimental_option("prefs",prefs)
 # ── Proxy support (HTTPS_PROXY env -> --proxy-server) ────────────────
 proxy_url=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
 if proxy_url:
  try:
   pu=_urlp(proxy_url)
   if pu.hostname and pu.port:
    scheme=pu.scheme if pu.scheme.startswith("socks") else "http"
    opts.add_argument(f"--proxy-server={scheme}://{pu.hostname}:{pu.port}")
    opts.add_argument("--proxy-bypass-list=<-loopback>;localhost;127.0.0.1")
    print(f"[browser] proxy via {pu.hostname}:{pu.port}",flush=True)
  except Exception as e:print(f"[browser] proxy parse failed: {e}",flush=True)
 print(f"[browser] viewport={vw}x{vh} ua={ua[:60]}...",flush=True)
 chrome_path=_find_chrome()
 if chrome_path:opts.binary_location=chrome_path
 drv=None
 for p in ["C:\\\\coasty\\\\chromedriver.exe","C:\\\\tools\\\\chromedriver.exe"]:
  if os.path.exists(p):drv=p;break
 if not drv and shutil.which("chromedriver"):drv=shutil.which("chromedriver")
 if not drv and shutil.which("msedgedriver"):drv=shutil.which("msedgedriver")
 if drv:
  svc=ChromeService(executable_path=drv)
  _browser_instance=webdriver.Chrome(service=svc,options=opts)
 else:_browser_instance=webdriver.Chrome(options=opts)
 _browser_instance.set_window_size(vw,vh)
 # CDP-level shims to back up the --disable-blink-features flag (defense in
 # depth). Override navigator.webdriver to undefined and patch a few
 # well-known automation tells before any page script runs.
 try:
  _browser_instance.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{
   "source":"Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
            "window.chrome={runtime:{}};"
  })
 except Exception:pass
 return _browser_instance
# ===== Smart navigation: API bypass for hostile-WAF sites + block detection =====
import urllib.request as _urlreq, urllib.parse as _urlpars
def _is_blocked(html,status=200):
 if status in(403,429,503):return True
 if not html:return False
 m=["Just a moment...","Attention Required! | Cloudflare","Access denied","cf-chl-","challenges.cloudflare","Please verify you are a human","Sorry, we just need to make sure","DDoS protection by"]
 return any(x in html for x in m)
def _reddit_fetch(url):
 try:
  pu=_urlpars.urlparse(url)
  if "reddit.com" not in (pu.netloc or "").lower():return False,None
  path=pu.path or "/"
  if path.endswith("/"):path=path[:-1]
  if not path.endswith(".json"):path+=".json"
  json_url=f"https://www.reddit.com{path}"
  if pu.query:json_url+="?"+pu.query
  ua=os.environ.get("COASTY_REDDIT_UA","windows:ai.coasty.agent:1.0 (by /u/coasty-agent)")
  headers={"User-Agent":ua,"Accept":"application/json"}
  token=os.environ.get("REDDIT_OAUTH_TOKEN","").strip()
  if token:
   headers["Authorization"]="Bearer "+token
   json_url=json_url.replace("www.reddit.com","oauth.reddit.com")
  proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
  req=_urlreq.Request(json_url,headers=headers)
  op=_urlreq.build_opener(_urlreq.ProxyHandler({"https":proxy,"http":proxy})) if proxy else _urlreq.build_opener()
  resp=op.open(req,timeout=10)
  body=resp.read().decode("utf-8","replace")
  if resp.status>=400:return False,None
  return True,json.loads(body)
 except Exception as e:
  print(f"[reddit-api] fetch failed: {e}",flush=True);return False,None
def _reddit_render(data,url):
 try:
  import html as _h
  esc=_h.escape
  parts=['<!doctype html><html><head><title>Reddit</title><meta charset="utf-8"></head><body>']
  parts.append(f'<h1>{esc(url)}</h1><p><em>(rendered from official Reddit API to bypass anti-bot)</em></p>')
  def render_post(d):
   title=esc(d.get("title","") or "")
   author=esc(d.get("author","") or "?")
   subr=esc(d.get("subreddit","") or "")
   score=d.get("score",0);ncm=d.get("num_comments",0)
   body=esc((d.get("selftext","") or d.get("body","") or "")[:3000])
   pl=esc(d.get("permalink","") or "")
   ext=esc(d.get("url_overridden_by_dest","") or "")
   t=f"<article><h2>{title or '(comment)'}</h2><p>r/{subr} · u/{author} · {score} pts · {ncm} comments</p><div>{body}</div>"
   if pl:t+=f'<p><a href="https://www.reddit.com{pl}">View thread</a></p>'
   if ext and ext!=pl:t+=f'<p>Link: <a href="{ext}">{ext}</a></p>'
   return t+"</article>"
  if isinstance(data,list):
   for item in data:
    if isinstance(item,dict) and "data" in item:
     for c in item.get("data",{}).get("children",[])[:40]:
      parts.append(render_post(c.get("data",{})))
  elif isinstance(data,dict) and "data" in data:
   for c in data.get("data",{}).get("children",[])[:60]:
    parts.append(render_post(c.get("data",{})))
  parts.append("</body></html>")
  return "".join(parts)
 except Exception as e:
  print(f"[reddit-api] render failed: {e}",flush=True);return None
def _navigate_smart(b,url):
 if "reddit.com" in url and not url.startswith("data:"):
  ok,data=_reddit_fetch(url)
  if ok:
   html=_reddit_render(data,url)
   if html:
    b.get("data:text/html;charset=utf-8;base64,"+base64.b64encode(html.encode()).decode())
    print(f"[smart-nav] reddit-api OK for {url}",flush=True)
    return{"url":url,"title":b.title,"source":"reddit-api"}
  print(f"[smart-nav] reddit-api unavailable, falling back to browser for {url}",flush=True)
 b.get(url)
 try:
  body=b.execute_script("return document.documentElement.outerHTML")
  body=body[:8000] if body else ""
 except:body=""
 if _is_blocked(body):
  return{"url":b.current_url,"title":b.title,"blocked":True,"error":"blocked by anti-bot (likely datacenter IP); set HTTPS_PROXY for residential routing or hand off to Electron"}
 return{"url":b.current_url,"title":b.title}
class Agent:
 def __init__(self):self._t=time.time();self._n=0
 async def serve(self,ws):
  ok=not bool(VNC_PASSWORD)
  try:
   async for raw in ws:
    self._n+=1
    try:msg=json.loads(raw)
    except:continue
    t=msg.get("type")
    if t=="ping":
     await ws.send(json.dumps({"type":"pong","timestamp":time.time(),"uptime":time.time()-self._t,"messages_processed":self._n}));continue
    if t=="auth":
     pw=msg.get("password","")
     if not VNC_PASSWORD or pw==VNC_PASSWORD:
      ok=True;await ws.send(json.dumps({"type":"auth_success","data":{"message":"Authentication successful","sessionId":msg.get("sessionId",""),"userId":msg.get("userId",""),"persistent":True}}))
     else:await ws.send(json.dumps({"type":"error","data":{"error":"Invalid password","code":"AUTH_FAILED"}}))
     continue
    if not ok:await ws.send(json.dumps({"type":"error","data":{"error":"Not authenticated"}}));continue
    if t=="command":
     d=msg.get("data",{});cmd=d.get("command","");params=d.get("parameters",{})
     to=75.0 if cmd in{"browser_get_dom","browser_navigate","browser_open","ocr"} else 45.0
     try:
      res=await asyncio.wait_for(asyncio.get_event_loop().run_in_executor(None,self._run,cmd,params),timeout=to)
     except asyncio.TimeoutError:res={"success":False,"error":f"timeout: {cmd}"}
     except Exception as e:res={"success":False,"error":str(e)}
     await ws.send(json.dumps({"type":"result","data":res}))
  except websockets.exceptions.ConnectionClosed:pass
 def _run(self,command,p):
  fn={"screenshot":self._ss,"click":self._cl,"double_click":self._dc,"right_click":self._rc,
   "type":self._ty,"key_press":self._kp,"key_combo":self._kc,
   "execute_command":self._ex,"terminal_execute":self._ex,
   "terminal_connect":lambda _:{"success":True,"session_id":"default"},
   "terminal_read":lambda _:{"success":True,"output":""},
   "terminal_type":self._tt,
   "file_read":self._fr,"file_write":self._fw,"file_append":self._fa,
   "file_upload":self._fu,"file_download":self._fdn,"file_list_downloads":self._fld,
   "file_delete":self._fd,"file_exists":self._fe,"directory_list":self._dl,
   "ocr":self._ocr,"scroll":self._scr,"drag":self._drg,
   "browser_open":self._bo,"browser_navigate":self._bn,"browser_click":self._bc,
   "browser_type":self._bt,"browser_execute":self._bx,"browser_get_dom":self._bd,
   "browser_state":self._bs,"browser_get_context":self._bd,
  }.get(command)
  if fn is None:return{"success":False,"error":f"Unknown: {command}"}
  return fn(p)
 def _ss(self,p):
  i=_shot()
  return{"success":True,"screenshot":i,"timestamp":time.time()} if i else{"success":False,"error":"screenshot failed"}
 def _cl(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0));b=p.get("button","left");c=int(p.get("clicks",1))
  _human_move(x,y);time.sleep(_rng.uniform(0.04,0.10))
  pyautogui.click(x,y,clicks=c,button=b);return{"success":True,"action":"click","x":x,"y":y}
 def _dc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0))
  _human_move(x,y);time.sleep(_rng.uniform(0.04,0.09))
  pyautogui.click(x,y);time.sleep(_rng.uniform(0.08,0.18));pyautogui.click(x,y)
  return{"success":True}
 def _rc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0))
  _human_move(x,y);time.sleep(_rng.uniform(0.05,0.11))
  pyautogui.rightClick(x,y);return{"success":True}
 def _ty(self,p):
  # Mirror of the Linux agent's mode-dispatch _ty. Windows has no
  # subprocess fork cost (pyautogui calls Win32 SendInput directly), so
  # the speed-up over the legacy default isn't as dramatic — but it's
  # still material. Modes:
  #   instant   — pyautogui.write(text, interval=0). ~5 ms regardless.
  #   fast      — DEFAULT. interval jittered in 2-4 ms. ~95-200 WPM.
  #   human     — Legacy Aalto-calibrated per-char loop, preserved.
  # No clipboard mode here: pyautogui's hotkey/write path is already
  # fast enough that adding pywin32 clipboard APIs isn't worth the
  # dependency cost.
  text=p.get("text","")
  if not text:return{"success":True,"action":"type","chars":0}
  mode=(p.get("mode") or "").lower()
  if not mode:
   if p.get("interval")==0 or p.get("fast"):mode="instant"
   else:mode="fast"
  if mode=="instant":
   pyautogui.write(text,interval=0)
   return{"success":True,"action":"type","chars":len(text),"mode":mode}
  if mode=="fast":
   d=_rng.uniform(0.002,0.004)
   pyautogui.write(text,interval=d)
   return{"success":True,"action":"type","chars":len(text),"mode":mode,"delay_ms":int(d*1000)}
  # human (legacy stealth path) — preserved verbatim
  prev=" "
  for ch in text:
   try:pyautogui.write(ch,interval=0)
   except Exception:pass
   time.sleep(_human_type_delay(prev,ch));prev=ch
  return{"success":True,"action":"type","chars":len(text),"mode":"human"}
 def _kp(self,p):
  # pyautogui.press takes a list — single in-process call for multi-key
  # sequences. Already efficient (no fork), but the explicit list form
  # avoids the per-key dict lookup in pyautogui's KEYBOARD_KEYS map.
  keys=[k for k in (p.get("keys") or [p.get("key","")]) if k]
  if not keys:return{"success":True}
  pyautogui.press(keys)
  return{"success":True,"keys":len(keys)}
 def _kc(self,p):pyautogui.hotkey(*p.get("keys",[]));return{"success":True}
 def _scr(self,p):
  amt=int(p.get("amount",3));d=p.get("direction","down")
  if d in("down","right"):amt=-amt
  pyautogui.scroll(amt);return{"success":True}
 def _drg(self,p):
  sx,sy=int(p.get("start_x",0)),int(p.get("start_y",0))
  ex,ey=int(p.get("end_x",0)),int(p.get("end_y",0))
  pyautogui.moveTo(sx,sy);pyautogui.drag(ex-sx,ey-sy,duration=0.5);return{"success":True}
 def _tt(self,p):pyautogui.write(p.get("text",""));return{"success":True}
 def _ex(self,p):
  cmd=p.get("command","");cwd=p.get("cwd",HOME_DIR)
  use_sudo=p.get("sudo",False)
  try:
   r=subprocess.run(["powershell.exe","-Command",cmd],capture_output=True,text=True,timeout=120,cwd=cwd)
   out=(r.stdout+r.stderr)[:5000]
   if len(r.stdout+r.stderr)>5000:out+="\\n...[truncated]"
   return{"success":True,"output":out,"exit_code":r.returncode}
  except subprocess.TimeoutExpired:return{"success":False,"error":"timed out"}
 def _fr(self,p):
  try:
   path=os.path.expanduser(p.get("path",""))
   with open(path,"r",errors="replace") as f:c=f.read()
   if len(c)>50000:c=c[:50000]+"\\n...[truncated]"
   return{"success":True,"content":c}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fw(self,p):
  try:
   path=os.path.expanduser(p.get("path",""));os.makedirs(os.path.dirname(path) or".",exist_ok=True)
   with open(path,"w") as f:f.write(p.get("content",""))
   return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fu(self,p):
  try:
   path=os.path.expanduser(p.get("filepath",p.get("path","")))
   if not os.path.isabs(path):path=os.path.join(DESKTOP_DIR,path)
   os.makedirs(os.path.dirname(path) or".",exist_ok=True)
   enc=p.get("encoding","utf-8");content=p.get("content","")
   if enc=="base64":
    with open(path,"wb") as f:f.write(base64.b64decode(content))
   else:
    with open(path,"w") as f:f.write(content)
   sz=os.path.getsize(path)
   return{"success":True,"filepath":path,"size":sz,"message":f"Uploaded {sz} bytes"}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fdn(self,p):
  try:
   path=os.path.expanduser(p.get("filepath",""))
   if not os.path.isfile(path):return{"success":False,"error":f"Not found: {path}"}
   sz=os.path.getsize(path);name=os.path.basename(path);enc=p.get("encoding","auto")
   if enc=="auto":
    try:
     with open(path,"r") as f:content=f.read();enc="utf-8"
    except UnicodeDecodeError:
     with open(path,"rb") as f:content=base64.b64encode(f.read()).decode("ascii");enc="base64"
   elif enc=="base64":
    with open(path,"rb") as f:content=base64.b64encode(f.read()).decode("ascii")
   else:
    with open(path,"r",errors="replace") as f:content=f.read()
   return{"success":True,"filename":name,"filepath":path,"size":sz,"encoding":enc,"content":content}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fld(self,p):
  try:
   path=os.path.expanduser(p.get("dirpath",p.get("path",HOME_DIR)))
   # Cross-OS path remap: the web UI historically defaulted to
   # /home/desktop/<...> which the Linux Ubuntu agent maps to
   # /home/ubuntu/<...>.  Apply the same convention on Windows so
   # the FILES tab works on a fresh Windows VM without the user
   # having to re-navigate — map /home/desktop[...] to the user's
   # Desktop folder, and /home/ubuntu[...] to the Windows home.
   if path.startswith("/home/desktop"):
    rest=path[len("/home/desktop"):].lstrip("/")
    path=os.path.join(DESKTOP_DIR,rest) if rest else DESKTOP_DIR
   elif path.startswith("/home/ubuntu"):
    rest=path[len("/home/ubuntu"):].lstrip("/")
    path=os.path.join(HOME_DIR,rest) if rest else HOME_DIR
   if not os.path.isdir(path):return{"success":False,"error":f"Not a directory: {path}"}
   files=[]
   for e in sorted(os.listdir(path)):
    full=os.path.join(path,e);is_dir=os.path.isdir(full)
    files.append({"filename":e,"path":full,"is_directory":is_dir,"size":0 if is_dir else os.path.getsize(full)})
   return{"success":True,"files":files,"count":len(files)}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fa(self,p):
  try:
   with open(os.path.expanduser(p.get("path","")),"a") as f:f.write(p.get("content",""))
   return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fd(self,p):
  try:os.remove(os.path.expanduser(p.get("path","")));return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _fe(self,p):return{"success":True,"exists":os.path.exists(os.path.expanduser(p.get("path","")))}
 def _dl(self,p):
  try:
   path=os.path.expanduser(p.get("path",HOME_DIR));entries=[]
   for e in sorted(os.listdir(path)):
    full=os.path.join(path,e);entries.append({"name":e,"type":"directory" if os.path.isdir(full) else"file","size":os.path.getsize(full) if os.path.isfile(full) else 0})
   return{"success":True,"entries":entries}
  except Exception as e:return{"success":False,"error":str(e)}
 def _ocr(self,p):
  if not _HAS_OCR:return{"success":False,"error":"tesseract unavailable"}
  img_data=_shot()
  if not img_data:return{"success":False,"error":"screenshot failed"}
  b64=img_data.split(",",1)[1];img=Image.open(io.BytesIO(base64.b64decode(b64)))
  return{"success":True,"text":pytesseract.image_to_string(img),"screenshot":img_data}
 def _bo(self,p):
  try:
   b=_get_browser();u=p.get("url","about:blank")
   if u=="about:blank":return{"success":True}
   res=_navigate_smart(b,u);return{"success":not res.get("blocked",False),**res}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bn(self,p):
  try:
   b=_get_browser();res=_navigate_smart(b,p.get("url",""))
   return{"success":not res.get("blocked",False),**res}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bc(self,p):
  try:_get_browser().find_element(By.CSS_SELECTOR,p.get("selector","")).click();return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bt(self,p):
  try:
   el=_get_browser().find_element(By.CSS_SELECTOR,p.get("selector",""));el.clear();el.send_keys(p.get("text",""));return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bx(self,p):
  try:r=_get_browser().execute_script(p.get("script",""));return{"success":True,"result":str(r) if r is not None else None}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bd(self,p):
  try:
   b=_get_browser();dom=b.execute_script("return document.documentElement.outerHTML")
   if len(dom)>10000:dom=dom[:10000]+"...[truncated]"
   return{"success":True,"dom":dom,"url":b.current_url,"title":b.title}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bs(self,p):
  try:b=_get_browser();return{"success":True,"url":b.current_url,"title":b.title}
  except Exception as e:return{"success":False,"error":str(e)}
async def main():
 try:_apply_tz()
 except Exception as e:print(f"[locale] startup apply failed: {e}",flush=True)
 agent=Agent()
 print(f"AI Agent listening on {HOST}:{PORT}",flush=True)
 # ping_interval=20 / ping_timeout=10 — server-side keep-alive (Windows variant).
 # Mirrors the Linux agent fix in generateUserData. See the Linux agent's
 # main() for the full NAT-idle-timeout rationale. Existing Windows AMI
 # instances do NOT pick this up automatically — recycle them via the
 # operator runbook before this side becomes effective.
 async with websockets.serve(agent.serve,HOST,PORT,max_size=100*1024*1024,ping_interval=20,ping_timeout=10,close_timeout=60,compression=None):
  await asyncio.Future()
if __name__=="__main__":asyncio.run(main())
`;
  }

  /**
   * Full Windows Desktop UserData (PowerShell) for stock Windows Server 2022.
   * Since this script + agent exceeds the 16KB UserData limit, the full install
   * path is only for documentation. In practice, always use a golden AMI.
   * This method generates a slim bootstrap that downloads the agent from a
   * temporary local file written during golden AMI build.
   */
  private generateWindowsDesktopUserData(vncPassword: string): string {
    // For full install without golden AMI, we can't fit everything in 16KB.
    // Reuse the golden path — the golden AMI has all packages pre-installed.
    // If no golden AMI exists, this will still deploy the agent and start services,
    // assuming packages were installed manually or via the build script.
    return this.generateWindowsGoldenUserData(vncPassword);
  }

  /**
   * Slim Windows UserData for golden AMI (pre-baked) instances.
   * Only sets VNC password, deploys the gzipped agent, and restarts services.
   * Gzips the Python agent to stay well under the 16KB UserData limit.
   */
  private generateWindowsGoldenUserData(vncPassword: string): string {
    // Minify Python before gzip (cuts ~10-15% post-gzip size)
    const agentPy = this.minifyPython(this.getWindowsAgentSource());

    // Gzip + base64 to reduce size (same approach as Linux agent)
    const agentGz = zlib.gzipSync(Buffer.from(agentPy), { level: 9 });
    const agentB64 = agentGz.toString("base64");

    // ── WINDOWS USERDATA ARCHITECTURE ──
    //
    // Two problems to solve:
    // 1. Password with special chars ($%&!) breaks PowerShell interpolation
    //    → Solution: base64-encode the password, decode in PowerShell
    // 2. Session 0 isolation: Windows services (NSSM/SYSTEM) can't see desktop
    //    → Solution: Agent runs via Startup folder in interactive session
    //
    // Boot sequence:
    //   1st boot: UserData deploys agent, sets auto-logon, reboots
    //   2nd boot: Auto-logon creates desktop → Startup folder runs agent + noVNC
    //             TightVNC service mirrors desktop → noVNC proxies it → screenshots work
    //
    // No <persist> tag — UserData must NOT re-run on 2nd boot (it would run
    // as SYSTEM before the logon screen, preventing auto-logon).

    const pwB64 = Buffer.from(vncPassword).toString("base64");

    const script = `<powershell>
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path C:\\coasty\\agent | Out-Null

# ── Decode password from base64 (avoids PowerShell special char issues) ──
$pw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${pwB64}"))

# ── Disable password complexity policy ──
secedit /export /cfg C:\\coasty\\secpol.cfg 2>$null
(Get-Content C:\\coasty\\secpol.cfg) -replace 'PasswordComplexity = 1','PasswordComplexity = 0' -replace 'MinimumPasswordLength = \\d+','MinimumPasswordLength = 0' | Set-Content C:\\coasty\\secpol.cfg
secedit /configure /db C:\\windows\\security\\local.sdb /cfg C:\\coasty\\secpol.cfg /areas SECURITYPOLICY 2>$null

# ── Set Administrator password ──
net user Administrator $pw
if ($LASTEXITCODE -ne 0) { Write-Output "WARNING: net user failed with exit code $LASTEXITCODE" }

# ── Configure auto-logon ──
$winlogon = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
Set-ItemProperty -Path $winlogon -Name AutoAdminLogon -Value "1"
Set-ItemProperty -Path $winlogon -Name DefaultUserName -Value "Administrator"
Set-ItemProperty -Path $winlogon -Name DefaultPassword -Value $pw
Set-ItemProperty -Path $winlogon -Name ForceAutoLogon -Value "1"
reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v DisableCAD /t REG_DWORD /d 1 /f 2>$null
reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization" /v NoLockScreen /t REG_DWORD /d 1 /f 2>$null

# ── Prevent EC2Launch from regenerating password on future boots ──
$ec2lCfg = "C:\\ProgramData\\Amazon\\EC2Launch\\config\\agent-config.yml"
if (Test-Path $ec2lCfg) {
    (Get-Content $ec2lCfg -Raw) -replace 'setAdminAccount: true','setAdminAccount: false' | Set-Content $ec2lCfg
}

# ── Set TightVNC password (DES-encrypted in registry) ──
# VNC protocol truncates passwords to 8 chars. TightVNC stores them as
# DES-encrypted REG_BINARY using a well-known fixed key.
# Uses .NET System.Security.Cryptography.DES (works on all Windows versions).
Stop-Service tvnserver -Force -ErrorAction SilentlyContinue
Start-Sleep 1
$vncPw8 = $pw.Substring(0, [Math]::Min(8, $pw.Length))
$magicKey = [byte[]]@(0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0)
$toEncrypt = [byte[]]::new(8)
$null = [System.Text.Encoding]::ASCII.GetBytes($vncPw8, 0, $vncPw8.Length, $toEncrypt, 0)
$des = [System.Security.Cryptography.DES]::Create()
$des.Padding = [System.Security.Cryptography.PaddingMode]::None
$enc = $des.CreateEncryptor($magicKey, [byte[]]::new(8))
$encrypted = [byte[]]::new(8)
$null = $enc.TransformBlock($toEncrypt, 0, 8, $encrypted, 0)
$enc.Dispose(); $des.Dispose()
$vncRegPath = "HKLM:\\SOFTWARE\\TightVNC\\Server"
if (-not (Test-Path $vncRegPath)) { New-Item -Path $vncRegPath -Force | Out-Null }
Set-ItemProperty -Path $vncRegPath -Name "Password" -Value $encrypted -Type Binary
Set-ItemProperty -Path $vncRegPath -Name "PasswordViewOnly" -Value $encrypted -Type Binary
Set-ItemProperty -Path $vncRegPath -Name "UseVncAuthentication" -Value 1 -Type DWord
Set-ItemProperty -Path $vncRegPath -Name "RfbPort" -Value 5901 -Type DWord
Set-ItemProperty -Path $vncRegPath -Name "AcceptHttpConnections" -Value 0 -Type DWord
Start-Service tvnserver -ErrorAction SilentlyContinue

# ── Deploy agent: base64 decode -> gunzip -> server.py ──
$gz = [System.Convert]::FromBase64String("${agentB64}")
$ms = New-Object System.IO.MemoryStream(,$gz)
$ds = New-Object System.IO.Compression.GZipStream($ms,[System.IO.Compression.CompressionMode]::Decompress)
$sr = New-Object System.IO.StreamReader($ds)
$pyCode = $sr.ReadToEnd()
$sr.Close(); $ds.Close(); $ms.Close()
[System.IO.File]::WriteAllText("C:\\coasty\\agent\\server.py", $pyCode)

# ── Find Python path ──
$pythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonPath) { $pythonPath = "python" }

# ── Create startup .bat files ──
# Use double backslashes because this is inside a JS template literal
# where \\n would be interpreted as a newline.
# Agent .bat (with restart loop so it recovers from crashes)
@"
@echo off
set VNC_PASSWORD=$pw
set AGENT_PORT=8080
set AGENT_HOST=0.0.0.0
:loop
cd /d C:\\coasty\\agent
$pythonPath server.py
echo Agent exited, restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
"@ | Set-Content -Path "C:\\coasty\\start-agent.bat" -Encoding ASCII

# noVNC websockify .bat
@"
@echo off
:loop
cd /d C:\\coasty
$pythonPath -m websockify --web C:\\coasty\\novnc 6080 localhost:5901
echo noVNC exited, restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
"@ | Set-Content -Path "C:\\coasty\\start-novnc.bat" -Encoding ASCII

# ── Create resolution-setting script (runs in interactive session at logon) ──
@"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Display {
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string dmFormName;
        public short dmLogPixels, dmBitsPerPel;
        public int dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    public static void Set(int w, int h) {
        var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmFields = 0x80000 | 0x100000;
        ChangeDisplaySettings(ref dm, 0);
    }
}
'@
[Display]::Set(1280, 720)
"@ | Set-Content -Path "C:\\coasty\\set-resolution.ps1" -Encoding ASCII

# ── Place shortcuts in Administrator's Startup folder ──
# This is the ONLY reliable way to run processes in the interactive desktop
# session (Session 1). Windows services always run in Session 0.
$startupDir = "C:\\Users\\Administrator\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
New-Item -ItemType Directory -Force -Path $startupDir | Out-Null

# Resolution setter shortcut (runs first at logon to set 1280x720)
$ws = New-Object -ComObject WScript.Shell
$scRes = $ws.CreateShortcut("$startupDir\\0-CoastyResolution.lnk")
$scRes.TargetPath = "powershell.exe"
$scRes.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\coasty\\set-resolution.ps1"
$scRes.WindowStyle = 7
$scRes.Save()

# Agent shortcut (minimized window)
$sc = $ws.CreateShortcut("$startupDir\\CoastyAgent.lnk")
$sc.TargetPath = "C:\\coasty\\start-agent.bat"
$sc.WorkingDirectory = "C:\\coasty\\agent"
$sc.WindowStyle = 7
$sc.Save()

# noVNC shortcut (minimized window)
$sc2 = $ws.CreateShortcut("$startupDir\\CoastyNoVNC.lnk")
$sc2.TargetPath = "C:\\coasty\\start-novnc.bat"
$sc2.WorkingDirectory = "C:\\coasty"
$sc2.WindowStyle = 7
$sc2.Save()

# ── Remove NSSM services for agent/noVNC (they run in Session 0, useless) ──
nssm stop CoastyAgent 2>$null
nssm stop CoastyNoVNC 2>$null
nssm remove CoastyAgent confirm 2>$null
nssm remove CoastyNoVNC confirm 2>$null

# ── System settings ──
powercfg -change -monitor-timeout-ac 0
powercfg -change -standby-timeout-ac 0
powercfg -change -hibernate-timeout-ac 0
reg add "HKCU\\Control Panel\\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f 2>$null
reg add "HKLM\\SOFTWARE\\Microsoft\\ServerManager" /v DoNotOpenServerManagerAtLogon /t REG_DWORD /d 1 /f 2>$null

Set-Content -Path "C:\\coasty\\status.txt" -Value "ready"

# ── Reboot to activate auto-logon ──
# After reboot: Windows logon screen -> auto-logon -> desktop created ->
# Startup folder runs agent + noVNC in interactive session ->
# TightVNC mirrors desktop -> screenshots work
shutdown /r /t 10 /c "Coasty setup complete - activating desktop" /f
</powershell>`;

    // ── UserData size optimization ─────────────────────────────────────
    // AWS RunInstances enforces 16384 bytes RAW (after base64 decode).
    // Linux cloud-init auto-decompresses gzip; Windows EC2Launch does NOT,
    // so we (1) minify the PowerShell to strip comments + blank lines
    // (preserving here-string bodies verbatim), (2) gzip the inner script,
    // (3) wrap in a tiny self-decompressing bootstrap that gunzips + runs
    // it via a temp .ps1 file.
    const innerScript = this.minifyPowerShell(
      script
        .replace(/^\s*<powershell>\r?\n?/, "")
        .replace(/\r?\n?<\/powershell>\s*$/, "")
    );
    const innerGz = zlib.gzipSync(Buffer.from(innerScript), { level: 9 });
    const innerB64 = innerGz.toString("base64");

    const bootstrap = `<powershell>
$g=[Convert]::FromBase64String("${innerB64}")
$m=New-Object IO.MemoryStream(,$g)
$d=New-Object IO.Compression.GZipStream($m,[IO.Compression.CompressionMode]::Decompress)
$r=New-Object IO.StreamReader($d)
$s=$r.ReadToEnd()
$r.Close();$d.Close();$m.Close()
$f=Join-Path $env:TEMP "coasty-init.ps1"
[IO.File]::WriteAllText($f,$s)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f
</powershell>`;

    return Buffer.from(bootstrap).toString("base64");
  }

  /**
   * Slim UserData for golden AMI instances.
   * The golden AMI already has all packages, services, and config baked in.
   * This only injects the VNC password, deploys the Python agent, and starts services.
   */
  private generateGoldenAmiUserData(vncPassword: string): string {
    const agentPy = this.minifyPython(this.getAgentSource());

    const agentGz = zlib.gzipSync(Buffer.from(agentPy), { level: 9 });
    const agentB64 = agentGz.toString("base64").match(/.{1,76}/g)?.join("\n") ?? "";

    const script = `#!/bin/bash
set -e
exec > /var/log/desktop-setup.log 2>&1

echo "DESKTOP_INIT_STATUS=starting" > /var/run/desktop-init-status
echo "Golden AMI boot started at $(date)"

# Mask Ubuntu cruft that runs at boot but we never use on a headless
# automation VM. Each one shaves 0.5-3s off boot; combined ~5-10s.
# Use mask (not disable) — disable can be undone by package post-install
# scripts, mask wins via a /dev/null symlink. Idempotent. Effects apply
# on NEXT boot. Cheap insurance if the golden AMI bake missed any.
(
  systemctl mask --now \
    snapd.service snapd.socket snapd.seeded.service \
    unattended-upgrades.service \
    apport.service apport-autoreport.service \
    ModemManager.service \
    bluetooth.service \
    cups.service cups-browsed.service \
    accounts-daemon.service \
    motd-news.service motd-news.timer \
    fwupd.service fwupd-refresh.service \
    apt-daily.service apt-daily.timer apt-daily-upgrade.service apt-daily-upgrade.timer \
    ua-timer.service ua-timer.timer ua-reboot-cmds.service \
    2>/dev/null || true
) &

# Stop our services in parallel — they may be running from the prior boot
# (golden AMI auto-starts them) or from a snapshot restore. Background +
# wait so all five stop concurrently instead of serially. Saves ~2-3s.
systemctl stop ai-agent.service vncserver@:1.service novnc.service keep-screen-alive.service memory-watchdog.service tcp-listener-watchdog.service 2>/dev/null &
SVCS_STOP_PID=$!

# In parallel with the stops, do all per-instance file setup (none of
# these depend on services being down — only on filesystem access).
USER_HOME=/home/ubuntu
mkdir -p $USER_HOME/.vnc /opt/ai-agent
echo "${vncPassword}" | vncpasswd -f > $USER_HOME/.vnc/passwd
chmod 600 $USER_HOME/.vnc/passwd
chown ubuntu:ubuntu $USER_HOME/.vnc/passwd
printf 'VNC_PASSWORD=%s\\n' "${vncPassword}" > /opt/ai-agent/.env
chmod 600 /opt/ai-agent/.env && chown ubuntu:ubuntu /opt/ai-agent/.env
base64 -d << 'AGENT_B64_EOF' | gunzip > /opt/ai-agent/server.py
${agentB64}
AGENT_B64_EOF
chown ubuntu:ubuntu /opt/ai-agent/server.py

# Locale-gen runs FULLY in background — agent doesn't need locales at
# startup (it sets TZ/lang via env at runtime). If a locale is missing
# when the agent first switches into it, the user's first request takes
# ~5s longer. After that, cached forever. Massive boot-time win.
if command -v locale-gen >/dev/null 2>&1; then
  (
    needed="en_US.UTF-8 en_GB.UTF-8 en_CA.UTF-8 en_AU.UTF-8 de_DE.UTF-8 fr_FR.UTF-8 es_ES.UTF-8 es_MX.UTF-8 it_IT.UTF-8 nl_NL.UTF-8 pt_BR.UTF-8 pt_PT.UTF-8 ja_JP.UTF-8 ko_KR.UTF-8 zh_CN.UTF-8 zh_TW.UTF-8 ru_RU.UTF-8 tr_TR.UTF-8 ar_SA.UTF-8 he_IL.UTF-8 pl_PL.UTF-8 sv_SE.UTF-8"
    installed=$(locale -a 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed 's/utf8/UTF-8/g')
    missing=""
    for lc in $needed; do
      if ! echo "$installed" | grep -qiF "$lc"; then missing="$missing $lc"; fi
    done
    if [ -n "$missing" ]; then locale-gen $missing 2>/dev/null || true; fi
  ) &
fi

# Enable swap (cheap, no need to background)
swapon /swapfile 2>/dev/null || true
sysctl -p /etc/sysctl.d/99-swap.conf 2>/dev/null || true

# Wait for service stops to complete before restarting (avoid systemd
# "queued restart while still stopping" backoff).
wait $SVCS_STOP_PID 2>/dev/null || true

# Clear any failed-state backoff so restart fires immediately.
systemctl reset-failed vncserver@:1.service novnc.service keep-screen-alive.service ai-agent.service memory-watchdog.service tcp-listener-watchdog.service 2>/dev/null || true

# Skip daemon-reload + enable: golden AMI has both already done. If a
# future change adds a new .service file in slim UserData, add reload
# back (and update the regression test).
#
# --no-block: returns immediately, lets systemd's After=/Wants= chain
# handle ordering in parallel. vncserver starts first, novnc + agent +
# keep-alive wait for it via their own ExecStartPre xdpyinfo/port checks.
# Saves ~10s of sequential restart waits.
systemctl restart --no-block vncserver@:1.service novnc.service keep-screen-alive.service ai-agent.service memory-watchdog.service tcp-listener-watchdog.service

echo "DESKTOP_INIT_STATUS=ready" > /var/run/desktop-init-status
echo "Golden AMI boot complete at $(date)"
`;

    const minified = this.minifyBash(script);
    const scriptGz = zlib.gzipSync(Buffer.from(minified), { level: 9 });
    return scriptGz.toString("base64");
  }

  private async resolveUbuntuAmi(): Promise<string> {
    if (this.cachedAmiId) {
      return this.cachedAmiId;
    }

    const result = await this.client.send(
      new DescribeImagesCommand({
        Filters: [
          {
            Name: "name",
            Values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*"],
          },
          { Name: "state", Values: ["available"] },
          { Name: "architecture", Values: ["arm64"] },
        ],
        Owners: ["099720109477"], // Canonical's AWS account ID
      })
    );

    const images = result.Images || [];
    if (images.length === 0) {
      throw new Error(
        `No Ubuntu 22.04 ARM64 AMI found in region ${this.region}. Set AWS_EC2_AMI_ID manually.`
      );
    }

    // Sort by creation date descending, pick the latest
    images.sort((a, b) => {
      const dateA = a.CreationDate || "";
      const dateB = b.CreationDate || "";
      return dateB.localeCompare(dateA);
    });

    this.cachedAmiId = images[0].ImageId!;
    console.log(`Resolved Ubuntu 22.04 ARM64 AMI: ${this.cachedAmiId}`);
    return this.cachedAmiId;
  }

  private async resolveWindowsAmi(): Promise<string> {
    if (this.cachedWindowsAmiId) {
      return this.cachedWindowsAmiId;
    }

    const result = await this.client.send(
      new DescribeImagesCommand({
        Filters: [
          {
            Name: "name",
            Values: ["Windows_Server-2022-English-Full-Base-*"],
          },
          { Name: "state", Values: ["available"] },
          { Name: "architecture", Values: ["x86_64"] },
        ],
        Owners: ["amazon"],
      })
    );

    const images = result.Images || [];
    if (images.length === 0) {
      throw new Error(
        `No Windows Server 2022 x86_64 AMI found in region ${this.region}. Set AWS_EC2_WINDOWS_AMI_ID manually.`
      );
    }

    images.sort((a, b) => {
      const dateA = a.CreationDate || "";
      const dateB = b.CreationDate || "";
      return dateB.localeCompare(dateA);
    });

    this.cachedWindowsAmiId = images[0].ImageId!;
    console.log(`Resolved Windows Server 2022 x86_64 AMI: ${this.cachedWindowsAmiId}`);
    return this.cachedWindowsAmiId;
  }

  private mapInstanceState(instance: Instance): EC2InstanceStatus {
    const stateName = instance.State?.Name;
    const ipAddress = instance.PublicIpAddress;
    const publicDnsName = instance.PublicDnsName;

    let state: EC2InstanceStatus["state"];
    let message: string | undefined;

    switch (stateName) {
      case "pending":
        state = "creating";
        message = "Instance is starting up...";
        break;
      case "running":
        state = "running";
        message = "Instance is running";
        break;
      case "stopping":
        state = "stopped";
        message = "Instance is stopping...";
        break;
      case "stopped":
        state = "stopped";
        message = "Instance is stopped";
        break;
      case "shutting-down":
      case "terminated":
        state = "failed";
        message = "Instance has been terminated";
        break;
      default:
        state = "creating";
        message = `Instance state: ${stateName}`;
    }

    return { state, ipAddress, publicDnsName, message };
  }

  private isRetryableError(error: any): boolean {
    if (
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "ENETUNREACH"
    ) {
      return true;
    }

    if (error.$metadata?.httpStatusCode) {
      return [429, 502, 503, 504].includes(error.$metadata.httpStatusCode);
    }

    if (
      error.name === "RequestLimitExceeded" ||
      error.name === "Throttling" ||
      error.name === "InternalError"
    ) {
      return true;
    }

    return false;
  }

  estimateCost(instanceType: string, hours: number): number {
    // Prices per hour (us-east-1). Windows instances include license surcharge.
    const prices: Record<string, number> = {
      // Linux ARM64 (Graviton2)
      "t4g.nano": 0.0042,
      "t4g.micro": 0.0084,
      "t4g.small": 0.0168,
      "t4g.medium": 0.0336,
      // Windows x86_64 (includes Windows license)
      "t3.nano": 0.0052 + 0.012,   // base + Windows license
      "t3.micro": 0.0104 + 0.012,
      "t3.small": 0.0208 + 0.012,
      "t3.medium": 0.0416 + 0.012,
    };
    return parseFloat(((prices[instanceType] || 0.0042) * hours).toFixed(4));
  }
}

// Singleton instance
let awsService: AwsEc2Service | null = null;

export function getAwsEc2Service(): AwsEc2Service {
  if (!awsService) {
    awsService = new AwsEc2Service();
  }
  return awsService;
}
