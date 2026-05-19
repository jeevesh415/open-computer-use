// Measures the actual final UserData size for both Linux + Windows paths.
// AWS RunInstances rejects UserData > 25600 bytes (base64-encoded).
import fs from "fs";
import zlib from "zlib";

const src = fs.readFileSync("lib/aws/ec2-service.ts", "utf-8");

function extract(method) {
  const re = new RegExp(`${method}\\(\\): string \\{\\s*return \`([\\s\\S]*?)\`;\\s*\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`could not extract ${method}`);
  return m[1]
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\\\$/g, "$")
    .replace(/\\\\\\\\/g, "\\")
    .replace(/\\\\`/g, "`")
    .replace(/\\n/g, "\n")
    .replace(/\\\$/g, "$");
}

// Mirror of the production minifiers in lib/aws/ec2-service.ts
function minifyPython(s) {
  const lines = s.split("\n");
  const out = [];
  let lastBlank = false;
  for (const line of lines) {
    if (line.startsWith("#!")) {
      out.push(line);
      lastBlank = false;
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    const blank = line.trim() === "";
    if (blank && lastBlank) continue;
    lastBlank = blank;
    out.push(line);
  }
  return out.join("\n");
}
function minifyBash(s) {
  const lines = s.split("\n");
  const out = [];
  let inHeredoc = null;
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
    if (/^\s*#/.test(line)) continue;
    const blank = line.trim() === "";
    if (blank && lastBlank) continue;
    lastBlank = blank;
    out.push(line);
  }
  return out.join("\n");
}
function minifyPowerShell(s) {
  const lines = s.split("\n");
  const out = [];
  let inHere = null;
  let lastBlank = false;
  for (const line of lines) {
    if (inHere !== null) {
      out.push(line);
      if (line === inHere + "@") inHere = null;
      continue;
    }
    const opensDouble = line.includes('@"') && !/@"[\s\S]*"@/.test(line);
    const opensSingle = line.includes("@'") && !/@'[\s\S]*'@/.test(line);
    if (opensDouble) {
      out.push(line);
      inHere = '"';
      continue;
    }
    if (opensSingle) {
      out.push(line);
      inHere = "'";
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    const blank = line.trim() === "";
    if (blank && lastBlank) continue;
    lastBlank = blank;
    out.push(line);
  }
  return out.join("\n");
}

// Linux UserData: full script (with embedded gzipped+base64 agent inline) is gzipped
function linuxUserData() {
  const agent = minifyPython(extract("getAgentSource"));
  const agentGz = zlib.gzipSync(Buffer.from(agent), { level: 9 });
  const agentB64 = agentGz.toString("base64").match(/.{1,76}/g).join("\n");
  // Approx the wrapper — full script is large; we just care about the
  // gzipped+b64 OUTPUT size, which is what AWS sees. Pull from the actual
  // generator instead: rebuild a representative script.
  const wrapper = src.match(
    /generateDesktopUserData\(vncPassword: string\): string \{[\s\S]*?const script = `([\s\S]*?)`;[\s\S]*?const minified = this\.minifyBash/
  );
  if (!wrapper) return null;
  let script = wrapper[1].replace(/\$\{vncPassword\}/g, "TESTPW").replace(/\$\{agentB64\}/g, agentB64);
  script = script
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\\\$/g, "$")
    .replace(/\\\\\\\\/g, "\\")
    .replace(/\\\\`/g, "`")
    .replace(/\\n/g, "\n")
    .replace(/\\\$/g, "$");
  const minified = minifyBash(script);
  const scriptGz = zlib.gzipSync(Buffer.from(minified), { level: 9 });
  const final = scriptGz.toString("base64");
  return {
    rawScript: script.length,
    minifiedRaw: minified.length,
    gzipped: scriptGz.length,
    base64: final.length,
  };
}

// Windows UserData: PowerShell wrapper (with embedded gzipped+base64 agent
// inline) is now wrapped in a self-decompressing bootstrap, so the inner
// script is gzipped a second time before final base64.
function windowsUserData() {
  const agent = minifyPython(extract("getWindowsAgentSource"));
  const agentGz = zlib.gzipSync(Buffer.from(agent), { level: 9 });
  const agentB64 = agentGz.toString("base64");

  const wrapper = src.match(
    /generateWindowsGoldenUserData\(vncPassword: string\): string \{[\s\S]*?const script = `([\s\S]*?)`;[\s\S]*?const innerScript = this\.minifyPowerShell/
  );
  if (!wrapper) return null;
  let script = wrapper[1]
    .replace(/\$\{pwB64\}/g, "VEVTVFBX")
    .replace(/\$\{agentB64\}/g, agentB64);
  script = script
    .replace(/\\\\\\\\/g, "\\\\")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\\$/g, "$")
    .replace(/\\\\`/g, "`");
  // Mirror production: strip <powershell> tags, MINIFY, gzip, base64,
  // wrap in self-decompressing bootstrap, base64 the bootstrap.
  const stripped = script
    .replace(/^\s*<powershell>\r?\n?/, "")
    .replace(/\r?\n?<\/powershell>\s*$/, "");
  const inner = minifyPowerShell(stripped);
  const innerGz = zlib.gzipSync(Buffer.from(inner), { level: 9 });
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
  const final = Buffer.from(bootstrap).toString("base64");
  return {
    rawScript: script.length,
    innerGzipped: innerGz.length,
    bootstrapRaw: bootstrap.length,
    base64: final.length,
  };
}

// AWS docs: "User data is limited to 16 KB, in raw form, before it is
// base64-encoded." That's 16384 bytes RAW. AWS receives our base64,
// decodes it, and checks the RAW size. The size that matters is what
// AWS sees AFTER decoding our base64 string — for Linux that's the
// gzipped size; for Windows the bootstrap PowerShell text size.
const HARD_RAW_LIMIT = 16384;
const lin = linuxUserData();
const win = windowsUserData();
const linRaw = lin.gzipped; // what AWS sees after base64 decode
const winRaw = win.bootstrapRaw;
console.log(`AWS RunInstances limit: ${HARD_RAW_LIMIT} bytes RAW (after base64 decode)`);
console.log("Linux full UserData (gzipped, then base64):");
console.log(
  `  scriptRaw=${lin.rawScript}B  AWS-sees=${linRaw}B  base64chars=${lin.base64}  ${linRaw > HARD_RAW_LIMIT ? "✗ OVER " + HARD_RAW_LIMIT + "B RAW LIMIT" : "✓ within " + HARD_RAW_LIMIT + "B raw limit"}`
);
console.log("Windows full UserData (gzipped inner + bootstrap, then base64):");
console.log(
  `  scriptRaw=${win.rawScript}B  innerGz=${win.innerGzipped}B  AWS-sees=${winRaw}B  base64chars=${win.base64}  ${winRaw > HARD_RAW_LIMIT ? "✗ OVER " + HARD_RAW_LIMIT + "B RAW LIMIT" : "✓ within " + HARD_RAW_LIMIT + "B raw limit"}`
);
