import json

import pytest

from tests._shared import assert_contains, assert_excludes, project_text


@pytest.mark.parametrize(
    ("script", "required"),
    [
        (
            "start-dev.bat",
            (
                'if /i "%~1"=="--prepare-only" set "PREPARE_ONLY=1"',
                "Development dependencies are ready",
            ),
        ),
        (
            "scripts/install-ai-models.bat",
            (
                'set "DML_SETUP=%ROOT%\\scripts\\prepare-fcpe-directml-pilot.bat"',
                ":optional_accelerators",
                'call "%DML_SETUP%"',
            ),
        ),
    ],
)
def test_recovery_script_contracts(script, required):
    assert_contains(project_text(script, encoding="utf-8-sig"), *required)


def test_development_launch_uses_browser_compatible_isolated_ports():
    script = project_text("start-dev.bat", encoding="utf-8-sig")
    assert_contains(
        script,
        'set "KARAOKE_BACKEND_URL=http://127.0.0.1:18000"',
        'set "VITE_API_BASE_URL=http://127.0.0.1:18000"',
        'set "SONGAPP_API_TOKEN=advoice-local-development"',
        'set "VITE_API_TOKEN=advoice-local-development"',
        '"$p=18000,5173;',
        "Get-CimInstance Win32_Process",
        "'node.exe','electron.exe','python.exe','pythonw.exe'",
        "Start-Process -FilePath taskkill.exe",
        "-ArgumentList '/PID',([string]$target),'/T','/F'",
    )
    assert script.index("call :stop_dev_processes") < script.index("call :start_job front")


def test_prepare_only_does_not_stop_running_development_instance():
    script = project_text("start-dev.bat", encoding="utf-8-sig")
    cleanup_guard = script.index('if "%PREPARE_ONLY%"=="0" (')
    cleanup_call = script.index("call :stop_dev_processes")
    assert cleanup_guard < cleanup_call
    assert "*> $null" not in script
    assert "\\.vscode\\extensions\\" in script


def test_build_installer_prepares_gitignored_downloads_before_build():
    script = project_text("build-installer.bat", encoding="utf-8-sig")
    assert_contains(script, 'set "KARAOKE_PREPARE_DIRECTML=1"', 'call "%~dp0start-dev.bat" --prepare-only')
    assert script.index("--prepare-only") < script.index("build-installer.ps1")


def test_ai_install_restores_msst_before_fast_path():
    script = project_text("scripts/install-ai-models.bat", encoding="utf-8-sig")
    assert_contains(
        script,
        'set "MSST_SETUP=%ROOT%\\scripts\\install-msst-engine.bat"',
        'call "%MSST_SETUP%" "%ROOT%" || goto :fail',
    )
    assert script.index('call "%MSST_SETUP%"') < script.index("rem FAST PATH")


def test_msst_installer_recovery_contract():
    script = project_text("scripts/install-msst-engine.bat", encoding="utf-8-sig")
    # The engine clone is pinned to an exact commit (not refs/heads/main) so a
    # fresh bootstrap can't silently fetch code patch-msst-engine.ps1 wasn't
    # verified against -- both the git fetch and the ZIP fallback must target
    # that same pinned COMMIT variable, not a moving branch.
    assert_contains(
        script,
        "ZFTurbo/Music-Source-Separation-Training.git",
        'set "COMMIT=',
        "Music-Source-Separation-Training/archive/%COMMIT%.zip",
        "fetch --quiet --depth 1 origin \"%COMMIT%\"",
        "inference.py",
        "utils\\model_utils.py",
        "models\\bs_roformer\\mel_band_roformer.py",
        "config_vocals_mel_band_roformer_kj.yaml",
    )


def test_directml_optional_assets_run_before_cached_fast_path():
    script = project_text("scripts/install-ai-models.bat", encoding="utf-8-sig")
    cached = script.index("AI Core is ready. [cached]")
    assert script.rfind("call :optional_accelerators", 0, cached) != -1


def test_scene_video_remains_optional_for_git_clean_build():
    package = json.loads(project_text("front/package.json", encoding="utf-8-sig"))
    assert all(
        item.get("from") != "../downloads/media/videoplayback.webm"
        for item in package["build"]["extraResources"]
    )
    assert_contains(
        project_text("scripts/build-installer.ps1", encoding="utf-8-sig"),
        "Optional karaoke scene video is absent; building without it.",
        "Optional karaoke scene video copied into application resources.",
    )


def test_ai_cached_quick_check_uses_public_nagisa_runtime():
    script = project_text("scripts/install-ai-models.bat", encoding="utf-8-sig")
    quick_line = next(line for line in script.splitlines() if "mods=('qwen_asr','nagisa'" in line)
    assert_excludes(quick_line, "'prepro'", "'nagisa_utils'")
    assert_contains(
        script,
        "Qwen/Nagisa runtime",
        "from qwen_asr import Qwen3ASRModel,Qwen3ForcedAligner;import nagisa",
    )


def test_backend_packaging_bundles_nagisa_native_modules_and_smokes_qwen():
    builder = project_text("scripts/build-installer.ps1", encoding="utf-8-sig")
    assert_contains(
        builder,
        'foreach ($moduleName in @("prepro", "nagisa_utils"))',
        "from importlib.metadata import files",
        "files('nagisa')",
        '$args += @("--add-binary", "$($nagisaNative[$moduleName]);.")',
    )
    assert_excludes(builder, "Required Nagisa native module")
    assert_contains(
        project_text("scripts/smoke-packaged-backend.ps1", encoding="utf-8-sig"),
        'ArgumentList "--verify-qwen-runtime"',
    )
    runner = project_text("backend/run.py", encoding="utf-8-sig")
    assert_contains(runner, 'nagisa.tagging("テスト")')
    assert_excludes(runner, 'importlib.import_module("prepro")')


def test_audio_monitor_packaging_excludes_unused_ai_frameworks():
    builder = project_text("scripts/build-installer.ps1", encoding="utf-8-sig")
    assert '"--contents-directory","audio-monitor-runtime"' in builder
    assert '"--onefile"' not in builder
    assert "audio-monitor-runtime\\base_library.zip" in builder
    monitor = builder.split('$monitorArgs += @(', 1)[1].split('"app\\services\\monitor_worker.py"', 1)[0]
    assert_contains(
        monitor,
        '"--exclude-module","tensorflow"',
        '"--exclude-module","torch"',
        '"--exclude-module","jax"',
    )


def test_backend_packaging_bundles_and_smokes_parselmouth():
    build = project_text("scripts/build-installer.ps1", encoding="utf-8-sig")
    runner = project_text("backend/run.py", encoding="utf-8-sig")

    assert_contains(build, '"--collect-all","parselmouth"', "backend-v5-parselmouth-psola")
    assert_contains(runner, "import parselmouth", "parselmouth.PRAAT_VERSION")
