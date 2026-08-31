import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const programFiles = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const vswhere = path.join(programFiles, "Microsoft Visual Studio/Installer/vswhere.exe");
  const vs = execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8", windowsHide: true }).trim();
  const vcvars = path.join(vs, "VC/Auxiliary/Build/vcvars64.bat");
  const cmake = path.join(vs, "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe");
  if (!vs || !existsSync(cmake)) throw new Error("Windows lighting build requires Visual Studio C++ Build Tools and CMake");
  const source = path.join(root, "front/electron/rgb/native");
  const build = path.join(root, "generated/build/lighting");
  const command = `call "${vcvars}" >nul && "${cmake}" -S "${source}" -B "${build}" -G Ninja -DCMAKE_BUILD_TYPE=Release && "${cmake}" --build "${build}"`;
  execSync(command, { cwd: root, stdio: "inherit", windowsHide: true, shell: process.env.ComSpec || "cmd.exe" });
}
