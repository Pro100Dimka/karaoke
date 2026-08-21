param(
    [Parameter(Mandatory = $true)]
    [string]$Engine
)

$modelUtils = Join-Path $Engine "utils\model_utils.py"
if (-not (Test-Path -LiteralPath $modelUtils -PathType Leaf)) {
    throw "MSST model_utils.py is missing: $modelUtils"
}

$utf8 = [Text.UTF8Encoding]::new($false)
$content = [IO.File]::ReadAllText($modelUtils, $utf8).Replace("`r`n", "`n")
$original = $content
$oldStep = "step = chunk_size // num_overlap"
$newStep = "step = max(1, int(chunk_size / float(num_overlap)))"
$oldWindow = @'
                    if mode == "generic":
                        window = windowing_array.clone() # using clone() fixes the clicks at chunk edges when using batch_size=1
                        if i - step == 0:  # First audio chunk, no fadein
                            window[:fade_size] = 1
                        elif i >= mix.shape[1]:  # Last audio chunk, no fadeout
                            window[-fade_size:] = 1

                    for j, (start, seg_len) in enumerate(batch_locations):
                        if mode == "generic":
'@
$newWindow = @'
                    for j, (start, seg_len) in enumerate(batch_locations):
                        if mode == "generic":
                            window = windowing_array.clone()
                            if start == 0:
                                window[:min(fade_size, seg_len)] = 1
                            if start + seg_len >= mix.shape[1]:
                                window[max(0, seg_len - fade_size):seg_len] = 1
'@

if ($content.Contains($oldStep)) {
    $content = $content.Replace($oldStep, $newStep)
}
if (([regex]::Matches($content, [regex]::Escape($newStep))).Count -ne 2) {
    throw "Unsupported MSST overlap implementation; expected exactly two step calculations"
}

if ($content.Contains($oldWindow)) {
    $content = $content.Replace($oldWindow, $newWindow)
}
if (-not $content.Contains("window[max(0, seg_len - fade_size):seg_len] = 1")) {
    throw "Unsupported MSST window implementation; boundary patch was not applied"
}

if ($content -ne $original) {
    [IO.File]::WriteAllText($modelUtils, $content, $utf8)
}
