import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const usageKey = "NSAppleEventsUsageDescription";
const usageDescription = "Memmy adds a task to Reminders only after you confirm the suggestion.";
const scriptPath = fileURLToPath(import.meta.url);

function isInside(directory, candidate) {
  const path = relative(directory, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function plistCommand(plistPath, command) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plistPath], { encoding: "utf8", timeout: 10_000, stdio: "pipe" }).trim();
}

/** Only prepares the Electron dependency used by npm run dev, never installed apps or TCC. */
export function prepareDevRuntime() {
  if (process.platform !== "darwin") return { status: "skipped" };
  const desktopDirectory = dirname(dirname(scriptPath));
  const repositoryDirectory = realpathSync(resolve(desktopDirectory, "../../.."));
  const electronPackageDirectory = realpathSync(dirname(require.resolve("electron/package.json")));
  const dependencyRoots = [join(repositoryDirectory, "node_modules"), join(desktopDirectory, "node_modules")];
  if (!dependencyRoots.some((root) => isInside(root, electronPackageDirectory))
    || JSON.parse(readFileSync(join(electronPackageDirectory, "package.json"), "utf8")).name !== "electron") {
    throw new Error("Refusing to modify Electron outside this repository's installed dependencies.");
  }

  const bundleDirectory = join(electronPackageDirectory, "dist", "Electron.app");
  const expectedExecutable = join(bundleDirectory, "Contents", "MacOS", "Electron");
  const executable = realpathSync(require("electron"));
  const plistPath = realpathSync(join(bundleDirectory, "Contents", "Info.plist"));
  // Reject external symlink targets and ELECTRON_OVERRIDE_DIST_PATH overrides.
  if (executable !== expectedExecutable || plistPath !== join(bundleDirectory, "Contents", "Info.plist")) {
    throw new Error("Refusing to modify an overridden or externally linked Electron app. Use this repository's Electron dependency for development.");
  }
  if (plistCommand(plistPath, "Print :CFBundleIdentifier") !== "com.github.Electron") {
    throw new Error("Refusing to modify a bundle that is not the Electron development runtime.");
  }

  try {
    plistCommand(plistPath, `Print :${usageKey}`);
    return { status: "ready", plistPath };
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (error.status !== 1 || !output.includes("Does Not Exist")) throw error;
  }
  plistCommand(plistPath, `Add :${usageKey} string ${usageDescription}`);
  if (plistCommand(plistPath, `Print :${usageKey}`) !== usageDescription) {
    throw new Error("Could not verify Electron's Reminders automation usage description.");
  }
  return { status: "updated", plistPath };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = prepareDevRuntime();
    if (result.status === "updated") console.log("[dev-runtime] Prepared Electron's Reminders automation description.");
  } catch (error) {
    console.error(`[dev-runtime] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
