param([switch]$SkipInfrastructure)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimePath = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
if (-not $SkipInfrastructure) {
    $linuxProject = (wsl --exec wslpath -a $projectRoot.Replace('\','/')).Trim()
    wsl --exec bash "$linuxProject/scripts/start-local-infra.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Local WSL services are unavailable; follow README or use Docker Compose.' }
}
$nodePath = (Get-Command node).Source
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$records = @{}
$statePath = Join-Path $runtimePath 'processes.json'
if (Test-Path -LiteralPath $statePath) {
    $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $records[$property.Name] = $property.Value }
}
function Start-Component($name, $program, $arguments) {
    if ($records.ContainsKey($name)) {
        $prior = $records[$name]
        $process = Get-Process -Id $prior.pid -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $prior.startedAt) { return }
    }
    $process = Start-Process -FilePath $program -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath "$name.log") -RedirectStandardError (Join-Path $runtimePath "$name.error.log")
    $records[$name] = @{ pid=$process.Id; startedAt=$process.StartTime.ToUniversalTime().ToString('o') }
}
$nextPath = Join-Path $projectRoot 'node_modules\next\dist\bin\next'
$envPath = Join-Path $projectRoot '.env'
$workerPath = Join-Path $projectRoot 'src\worker\index.ts'
Start-Component 'web' $nodePath "`"$nextPath`" start --hostname 127.0.0.1"
Start-Component 'worker' $nodePath "--env-file=`"$envPath`" --import tsx `"$workerPath`""
Start-Component 'agent' $pythonPath '-m agent.run'
$records | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Output 'Local services started. Open http://127.0.0.1:3000. Credentials: .runtime/access.txt'
