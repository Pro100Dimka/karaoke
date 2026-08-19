
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _text(relative: str) -> str: return (ROOT / relative).read_text(encoding='utf-8-sig')


def test_start_dev_has_prepare_only_mode_for_build_bootstrap(): script = _text("start-dev.bat"); assert ('if /i "%~1"=="--prepare-only" set "PREPARE_ONLY=1"' in script) and ('Development dependencies are ready' in script)


def test_build_installer_bootstraps_gitignored_downloads_first(): script = _text("build-installer.bat"); assert ('set "KARAOKE_PREPARE_DIRECTML=1"' in script) and ('call "%~dp0start-dev.bat" --prepare-only' in script) and (script.index('--prepare-only') < script.index('build-installer.ps1'))


def test_ai_install_restores_msst_engine_before_fast_path(): script = _text("scripts/install-ai-models.bat"); assert ('set "MSST_SETUP=%ROOT%\\scripts\\install-msst-engine.bat"' in script) and ('call "%MSST_SETUP%" "%ROOT%" || goto :fail' in script) and (script.index('call "%MSST_SETUP%"') < script.index('rem FAST PATH'))


def test_msst_installer_has_git_and_zip_recovery_and_verification():
    script = _text("scripts/install-msst-engine.bat"); assert ('ZFTurbo/Music-Source-Separation-Training.git' in script) and ('Music-Source-Separation-Training/archive/refs/heads/main.zip' in script)
    for required in (
        "inference.py",
        "utils\\model_utils.py",
        "models\\bs_roformer\\mel_band_roformer.py",
        "config_vocals_mel_band_roformer_kj.yaml",
    ):
        assert required in script


def test_directml_optional_assets_are_recoverable_automatically(): script = _text("scripts/install-ai-models.bat"); assert ('set "DML_SETUP=%ROOT%\\scripts\\prepare-fcpe-directml-pilot.bat"' in script) and (':optional_accelerators' in script) and ('call "%DML_SETUP%"' in script); cached = script.index("AI Core is ready. [cached]"); assert script.rfind("call :optional_accelerators", 0, cached) != -1


def test_scene_video_is_optional_for_git_clean_build(): package = json.loads(_text("front/package.json")); extras = package["build"]["extraResources"]; assert all(item.get("from") != "../downloads/media/videoplayback.webm" for item in extras); builder = _text("scripts/build-installer.ps1"); assert ('Optional karaoke scene video is absent; building without it.' in builder) and ('Optional karaoke scene video copied into application resources.' in builder)


def test_ai_cached_quick_check_does_not_require_private_nagisa_modules_directly(): script = _text("scripts/install-ai-models.bat"); quick_line = next(line for line in script.splitlines() if "mods=('qwen_asr','nagisa'" in line); assert ("'prepro'" not in quick_line) and ("'nagisa_utils'" not in quick_line) and ('Qwen/Nagisa runtime' in script) and ('from qwen_asr import Qwen3ASRModel,Qwen3ForcedAligner;import nagisa' in script)


def test_backend_packaging_bundles_nagisa_native_modules_and_smokes_qwen(): builder = _text("scripts/build-installer.ps1"); assert ('foreach ($moduleName in @("prepro", "nagisa_utils"))' in builder) and ('from importlib.metadata import files' in builder) and ("files('nagisa')" in builder) and ('$args += @("--add-binary", "$($nagisaNative[$moduleName]);.")' in builder) and ('Required Nagisa native module' not in builder); smoke = _text("scripts/smoke-packaged-backend.ps1"); assert 'ArgumentList "--verify-qwen-runtime"' in smoke; runner = _text("backend/run.py"); assert ('nagisa.tagging("テスト")' in runner) and ('importlib.import_module("prepro")' not in runner)
