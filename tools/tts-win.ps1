param(
  [string]$Lines = "tools\voice-lines.json",
  [string]$OutDir = "assets\voice",
  [string]$Only = "",
  [string]$VoiceMatch = "Kangkang",
  [double]$SpeakingRate = 0.92,
  [string]$Pitch = "-6%"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, $type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
  Where-Object { $_.Id -like "*$VoiceMatch*" } | Select-Object -First 1
if (-not $voice) {
  Write-Output "VOICE NOT FOUND: $VoiceMatch"
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
    ForEach-Object { Write-Output ("  " + $_.Id + " | " + $_.DisplayName) }
  exit 1
}
$synth.Voice = $voice
Write-Output ("voice: " + $voice.DisplayName + " / " + $voice.Language)

try { $synth.Options.SpeakingRate = [double]$SpeakingRate } catch { }
try {
  $pct = [double]($Pitch.TrimEnd('%'))
  $synth.Options.Pitch = [double](1.0 + $pct / 100.0)
} catch { }

$data = Get-Content $Lines -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

foreach ($prop in $data.PSObject.Properties) {
  $id = $prop.Name
  if ($Only -and $id -ne $Only) { continue }

  $text = [string]$prop.Value.text
  try {
    $stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
    Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] ([int]$stream.Size)
    $reader.ReadBytes($bytes)

    $file = Join-Path $OutDir ($id + ".wav")
    [System.IO.File]::WriteAllBytes($file, $bytes)
    Write-Output ("$id OK " + $bytes.Length + " [" + $stream.ContentType + "]")
  }
  catch {
    $e = $_.Exception
    while ($e) { Write-Output ("  > " + $e.GetType().Name + ": " + $e.Message); $e = $e.InnerException }
    Write-Output "$id FAIL"
  }
}
