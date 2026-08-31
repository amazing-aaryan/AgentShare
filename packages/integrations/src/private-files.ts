import { execFile } from "node:child_process";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

export async function ensurePrivateDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await securePrivatePath(root, true);
}

/** Exact owner ACL, including removal of foreign explicit grants. Never use on broad parent directories. */
export async function securePrivatePath(
  path: string,
  directory = false,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    (directory ? !metadata.isDirectory() : !metadata.isFile())
  ) {
    throw new Error(
      "Private AgentShare storage must be a regular file/directory, not a symlink",
    );
  }
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const encoded = Buffer.from(path, "utf8").toString("base64");
  const script =
    `$ErrorActionPreference='Stop'; $target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
    `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ` +
    `$acl=New-Object Security.AccessControl.${directory ? "DirectorySecurity" : "FileSecurity"}; ` +
    `$acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); ` +
    `$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','${directory ? "ContainerInherit,ObjectInherit" : "None"}','None','Allow'); ` +
    `$acl.AddAccessRule($rule); [IO.${directory ? "Directory" : "File"}]::SetAccessControl($target,$acl);`;
  try {
    await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
  } catch {
    throw new Error(
      "Cannot enforce owner-only Windows permissions for AgentShare storage",
    );
  }
}
