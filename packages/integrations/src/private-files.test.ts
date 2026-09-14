import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { ensurePrivateDirectory, securePrivatePath } from "./private-files.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("enforces exact private permissions, removing explicit foreign Windows grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentshare-private-acl-test-"));
  roots.push(root);
  const file = join(root, "fixture.txt");
  await writeFile(file, "synthetic public fixture");
  if (process.platform === "win32") {
    await promisify(execFile)(
      "icacls.exe",
      [root, "/grant", "*S-1-1-0:(OI)(CI)R"],
      { windowsHide: true },
    );
    await promisify(execFile)("icacls.exe", [file, "/grant", "*S-1-1-0:R"], {
      windowsHide: true,
    });
  }
  await ensurePrivateDirectory(root);
  await securePrivatePath(file);
  if (process.platform === "win32") {
    const encoded = Buffer.from(JSON.stringify([root, file])).toString(
      "base64",
    );
    const script =
      `$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); ` +
      `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($p in $paths) { ` +
      `$acl=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; ` +
      `$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); ` +
      `if(!$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid){throw 'Foreign ACL survived'} }; 'owner-only'`;
    const checked = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
    expect(checked.stdout.trim()).toBe("owner-only");
  } else {
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});
