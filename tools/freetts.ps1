param(
  [string]$Lines = "tools\voice-lines.json",
  [string]$OutDir = "assets\voice",
  [string]$Voice = "zh-CN-YunjianNeural",
  [string]$Rate = "-20%",
  [string]$Pitch = "-20Hz",
  [string]$Only = "",
  [int]$MaxTries = 14
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

$data = Get-Content $Lines -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

foreach ($prop in $data.PSObject.Properties) {
  $id = $prop.Name
  if ($Only -and $id -notmatch $Only) { continue }
  $text = [string]$prop.Value.text
  $reqFile = Join-Path $env:TEMP ("ft_" + $id + ".json")
  $tmpMp3 = Join-Path $env:TEMP ("ft_" + $id + ".mp3")

  $payload = [ordered]@{ text = $text; voice = $Voice; rate = $Rate; pitch = $Pitch }
  [System.IO.File]::WriteAllText($reqFile, ($payload | ConvertTo-Json -Compress), $utf8)

  $done = $false
  for ($i = 0; $i -lt $MaxTries; $i++) {
    try {
      $raw = curl.exe -s --tlsv1.2 --max-time 60 -X POST -H "Content-Type: application/json" -A "Mozilla/5.0" --data-binary "@$reqFile" "https://freetts.org/api/tts"
      $res = $raw | ConvertFrom-Json
      if (-not $res.file_id) {
        Start-Sleep -Seconds 4
        continue
      }
      curl.exe -sL --tlsv1.2 --max-time 60 -A "Mozilla/5.0" -o $tmpMp3 "https://freetts.org/api/audio/$($res.file_id)"
      if (-not (Test-Path $tmpMp3)) { Start-Sleep -Seconds 2; continue }

      $first = (Get-Content $tmpMp3 -Encoding Byte -TotalCount 1)[0]
      $size = (Get-Item $tmpMp3).Length
      # 0xFF = 直接是 mp3 帧（干净版）；0x49 = 'ID3'（带 3 秒空白/水印的版本）
      if ($first -eq 255 -and $size -gt 4000) {
        Copy-Item -Force $tmpMp3 (Join-Path $OutDir ($id + ".mp3"))
        Write-Output ("$id OK " + $size + " try=" + ($i + 1))
        $done = $true
        break
      }
    }
    catch { }
    Start-Sleep -Seconds 2
  }

  if (-not $done) { Write-Output "$id FAIL" }
  Remove-Item $reqFile, $tmpMp3 -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}
