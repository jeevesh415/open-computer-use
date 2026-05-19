import fs from "fs";
import zlib from "zlib";

const src = fs.readFileSync("lib/aws/ec2-service.ts", "utf-8");

function extract(method) {
  const re = new RegExp(`${method}\\(\\): string \\{\\s*return \`([\\s\\S]*?)\`;\\s*\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`could not extract ${method}`);
  // Resolve TS string-literal escapes that the agent template uses
  return m[1]
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\t/g, "\t")
    .replace(/\\\\\\$/g, "$")
    .replace(/\\\\\\\\/g, "\\")
    .replace(/\\\\`/g, "`")
    .replace(/\\n/g, "\n")
    .replace(/\\\$/g, "$");
}

for (const m of ["getAgentSource", "getWindowsAgentSource"]) {
  const body = extract(m);
  const gz = zlib.gzipSync(Buffer.from(body), { level: 9 });
  const b64 = gz.toString("base64");
  console.log(
    `${m.padEnd(24)} raw=${body.length}B gz=${gz.length}B base64=${b64.length}B (limit ~25600B for UserData)`
  );
}
