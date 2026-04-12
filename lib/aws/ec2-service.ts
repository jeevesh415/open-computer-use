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
   */
  async createMachineImage(
    instanceId: string,
    userId: string,
    machineName?: string
  ): Promise<{ amiId: string; name: string }> {
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    const name = `coasty-snapshot-${userId.substring(0, 8)}-${ts}`;

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
   * Returns the Python AI agent source code, shared by both full and golden AMI UserData.
   */
  private getAgentSource(): string {
    return `#!/usr/bin/env python3
import asyncio,base64,io,json,os,subprocess,tempfile,time
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
def _xdo(*a):
 env={**os.environ,"DISPLAY":DISPLAY}
 r=subprocess.run(["xdotool"]+list(a),capture_output=True,text=True,env=env,timeout=10)
 return r.stdout.strip()
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
 opts=FFOptions()
 opts.add_argument("--width=1280");opts.add_argument("--height=720")
 gd=None
 for p in ["/usr/local/bin/geckodriver","/usr/bin/geckodriver"]:
  if os.path.exists(p):gd=p;break
 if not gd and shutil.which("geckodriver"):gd=shutil.which("geckodriver")
 if gd:
  svc=FFService(executable_path=gd)
  _browser_instance=webdriver.Firefox(service=svc,options=opts)
 else:_browser_instance=webdriver.Firefox(options=opts)
 _browser_instance.set_window_size(1280,720)
 return _browser_instance
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
  x,y=int(p.get("x",0)),int(p.get("y",0));b={"left":"1","middle":"2","right":"3"}.get(p.get("button","left"),"1")
  _xdo("mousemove",str(x),str(y),"click",b);return{"success":True,"action":"click","x":x,"y":y}
 def _dc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0));_xdo("mousemove",str(x),str(y),"click","--repeat","2","1");return{"success":True}
 def _rc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0));_xdo("mousemove",str(x),str(y),"click","3");return{"success":True}
 def _ty(self,p):
  env={**os.environ,"DISPLAY":DISPLAY};subprocess.run(["xdotool","type","--delay",str(p.get("interval",50)),"--",p.get("text","")],env=env,timeout=30)
  return{"success":True,"action":"type"}
 def _kp(self,p):
  env={**os.environ,"DISPLAY":DISPLAY}
  for k in(p.get("keys") or[p.get("key","")]):subprocess.run(["xdotool","key","--",k],env=env,timeout=10)
  return{"success":True}
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
  try:b=_get_browser();u=p.get("url","about:blank");b.get(u) if u!="about:blank" else None;return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bn(self,p):
  try:b=_get_browser();b.get(p.get("url",""));return{"success":True,"url":b.current_url,"title":b.title}
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
 agent=Agent()
 print(f"AI Agent listening on {HOST}:{PORT}",flush=True)
 async with websockets.serve(agent.serve,HOST,PORT,max_size=100*1024*1024,ping_interval=None,ping_timeout=None,close_timeout=60,compression=None):
  await asyncio.Future()
if __name__=="__main__":asyncio.run(main())
`;
  }

  private generateDesktopUserData(vncPassword: string): string {
    const agentPy = this.getAgentSource();

    // Gzip-compress the Python agent to fit within AWS UserData 25,600 byte base64 limit
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
  wmctrl \\
  tesseract-ocr \\
  tesseract-ocr-eng \\
  imagemagick \\
  xdg-utils \\
  fonts-liberation \\
  software-properties-common \\
  sudo

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
ExecStartPre=/bin/bash -c 'for i in $(seq 1 30); do ss -tln | grep -q :5901 && exit 0; sleep 1; done; exit 1'
ExecStart=/opt/novnc/utils/novnc_proxy --vnc localhost:5901 --listen 6080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD_NOVNC_EOF

# Enable and start services
systemctl daemon-reload
systemctl enable vncserver@:1.service
systemctl enable novnc.service
systemctl start vncserver@:1.service
sleep 5
systemctl start novnc.service

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
ExecStartPre=/bin/bash -c 'for i in $(seq 1 60); do xdpyinfo -display :1 >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
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

# Create systemd service for AI agent with full environment
cat > /etc/systemd/system/ai-agent.service << 'AGENT_SVC_EOF'
[Unit]
Description=LLMHub AI Agent WebSocket Server
After=vncserver@:1.service
Wants=vncserver@:1.service

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
EnvironmentFile=/opt/ai-agent/.env
ExecStartPre=/bin/bash -c 'mkdir -p /tmp/runtime-ubuntu && chmod 700 /tmp/runtime-ubuntu && chown ubuntu:ubuntu /tmp/runtime-ubuntu'
ExecStartPre=/bin/bash -c 'for i in $(seq 1 60); do xdpyinfo -display :1 >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
ExecStart=/usr/bin/python3 /opt/ai-agent/server.py
Restart=on-failure
RestartSec=5
MemoryMax=512M
MemoryHigh=384M
OOMPolicy=restart

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

# Memory watchdog - kills excess browser processes before OOM
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
while true; do
    MEM_PCT=$(get_mem_pct)
    if [ "$MEM_PCT" -ge "$THRESHOLD_KILL" ]; then
        logger -t memory-watchdog "CRITICAL: Memory at \${MEM_PCT}% - killing excess browser procs"
        kill_excess_browser_procs; cleanup_browser_cache
    elif [ "$MEM_PCT" -ge "$THRESHOLD_WARN" ]; then
        logger -t memory-watchdog "WARNING: Memory at \${MEM_PCT}% - clearing caches"
        cleanup_browser_cache
    fi
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

systemctl daemon-reload
systemctl enable ai-agent.service memory-watchdog.service
systemctl start ai-agent.service
systemctl start memory-watchdog.service

echo "DESKTOP_INIT_STATUS=ready" > /var/run/desktop-init-status
echo "Desktop setup complete at $(date)"
`;

    // Gzip the entire script — cloud-init auto-detects gzip magic bytes
    const scriptGz = zlib.gzipSync(Buffer.from(script), { level: 9 });
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
 opts=ChromeOptions()
 opts.add_argument("--window-size=1280,720")
 opts.add_argument("--no-sandbox")
 opts.add_argument("--disable-dev-shm-usage")
 opts.add_argument("--disable-gpu")
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
 _browser_instance.set_window_size(1280,720)
 return _browser_instance
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
  pyautogui.click(x,y,clicks=c,button=b);return{"success":True,"action":"click","x":x,"y":y}
 def _dc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0));pyautogui.doubleClick(x,y);return{"success":True}
 def _rc(self,p):
  x,y=int(p.get("x",0)),int(p.get("y",0));pyautogui.rightClick(x,y);return{"success":True}
 def _ty(self,p):
  text=p.get("text","");interval=float(p.get("interval",50))/1000.0
  pyautogui.write(text,interval=interval);return{"success":True,"action":"type"}
 def _kp(self,p):
  for k in(p.get("keys") or[p.get("key","")]):pyautogui.press(k)
  return{"success":True}
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
  try:b=_get_browser();u=p.get("url","about:blank");b.get(u) if u!="about:blank" else None;return{"success":True}
  except Exception as e:return{"success":False,"error":str(e)}
 def _bn(self,p):
  try:b=_get_browser();b.get(p.get("url",""));return{"success":True,"url":b.current_url,"title":b.title}
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
 agent=Agent()
 print(f"AI Agent listening on {HOST}:{PORT}",flush=True)
 async with websockets.serve(agent.serve,HOST,PORT,max_size=100*1024*1024,ping_interval=None,ping_timeout=None,close_timeout=60,compression=None):
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
    const agentPy = this.getWindowsAgentSource();

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

    return Buffer.from(script).toString("base64");
  }

  /**
   * Slim UserData for golden AMI instances.
   * The golden AMI already has all packages, services, and config baked in.
   * This only injects the VNC password, deploys the Python agent, and starts services.
   */
  private generateGoldenAmiUserData(vncPassword: string): string {
    const agentPy = this.getAgentSource();

    const agentGz = zlib.gzipSync(Buffer.from(agentPy), { level: 9 });
    const agentB64 = agentGz.toString("base64").match(/.{1,76}/g)?.join("\n") ?? "";

    const script = `#!/bin/bash
set -e
exec > /var/log/desktop-setup.log 2>&1

echo "DESKTOP_INIT_STATUS=starting" > /var/run/desktop-init-status
echo "Golden AMI boot started at $(date)"

# 1. Stop any services that may already be running (snapshot restore case)
systemctl stop ai-agent.service vncserver@:1.service novnc.service keep-screen-alive.service memory-watchdog.service 2>/dev/null || true

# 2. Set VNC password
USER_HOME=/home/ubuntu
mkdir -p $USER_HOME/.vnc
echo "${vncPassword}" | vncpasswd -f > $USER_HOME/.vnc/passwd
chmod 600 $USER_HOME/.vnc/passwd
chown ubuntu:ubuntu $USER_HOME/.vnc/passwd

# 3. Deploy AI agent
mkdir -p /opt/ai-agent
printf 'VNC_PASSWORD=%s\\n' "${vncPassword}" > /opt/ai-agent/.env
chmod 600 /opt/ai-agent/.env && chown ubuntu:ubuntu /opt/ai-agent/.env

base64 -d << 'AGENT_B64_EOF' | gunzip > /opt/ai-agent/server.py
${agentB64}
AGENT_B64_EOF
chown ubuntu:ubuntu /opt/ai-agent/server.py

# 4. Enable swap (pre-created in golden AMI)
swapon /swapfile 2>/dev/null || true
sysctl -p /etc/sysctl.d/99-swap.conf 2>/dev/null || true

# 5. Start all services (restart to pick up new password)
systemctl daemon-reload
systemctl enable vncserver@:1.service novnc.service keep-screen-alive.service ai-agent.service memory-watchdog.service
systemctl restart vncserver@:1.service
sleep 3
systemctl restart novnc.service
systemctl restart keep-screen-alive.service
systemctl restart ai-agent.service
systemctl restart memory-watchdog.service

echo "DESKTOP_INIT_STATUS=ready" > /var/run/desktop-init-status
echo "Golden AMI boot complete at $(date)"
`;

    const scriptGz = zlib.gzipSync(Buffer.from(script), { level: 9 });
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
