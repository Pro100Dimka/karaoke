import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const programFiles = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const vswhere = path.join(programFiles, "Microsoft Visual Studio/Installer/vswhere.exe");
  if (!existsSync(vswhere))
    throw new Error(
      "Keyboard lighting is a required build component. Install Visual Studio 2022 " +
        "Build Tools with 'Desktop development with C++' and CMake."
    );
  let vs;
  try {
    vs = execFileSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath"
      ],
      { encoding: "utf8", windowsHide: true }
    ).trim();
  } catch (error) {
    throw new Error(
      "Could not locate Visual Studio C++ Build Tools required for keyboard lighting.",
      { cause: error }
    );
  }
  const vcvars = path.join(vs, "VC/Auxiliary/Build/vcvars64.bat");
  const cmake = path.join(vs, "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe");
  if (!vs || !existsSync(cmake))
    throw new Error("Windows lighting build requires Visual Studio C++ Build Tools and CMake");
  const source = path.join(root, "front/electron/rgb/native");
  const build = path.join(root, "generated/build/lighting");
  const ctest = path.join(path.dirname(cmake), "ctest.exe");
  const command = `call "${vcvars}" >nul && "${cmake}" -S "${source}" -B "${build}" -G Ninja -DCMAKE_BUILD_TYPE=Release && "${cmake}" --build "${build}" && "${ctest}" --test-dir "${build}" --output-on-failure`;
  execSync(command, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    shell: process.env.ComSpec || "cmd.exe"
  });
}
