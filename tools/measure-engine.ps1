# Measures CPU (% of one core) and private memory of the engine plus its WebView2
# child processes over a sampling window. Usage: .\measure-engine.ps1 [-Seconds 10]
param([int]$Seconds = 10)

function Get-EngineProcesses {
    $engine = Get-Process DreamCanvas.Engine -ErrorAction SilentlyContinue
    if (-not $engine) { return @() }
    $ids = @($engine.Id)
    # WebView2 processes are descendants of the engine.
    $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
    $added = $true
    while ($added) {
        $added = $false
        foreach ($p in $all) {
            if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added = $true }
        }
    }
    return $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}

$before = Get-EngineProcesses
if (-not $before) { Write-Error "DreamCanvas.Engine is not running"; exit 1 }
function Get-CpuMs($procs) { ($procs | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum }
$cpu0 = Get-CpuMs $before
Start-Sleep -Seconds $Seconds
$after = Get-EngineProcesses
$cpu1 = Get-CpuMs $after
$mem = ($after | Measure-Object -Property PrivateMemorySize64 -Sum).Sum / 1MB
$cores = [Environment]::ProcessorCount
$pctCore = ($cpu1 - $cpu0) / ($Seconds * 1000) * 100
"processes={0} cpu={1:F1}% of one core ({2:F1}% of total, {3} logical cores) private memory={4:F0} MB" -f $after.Count, $pctCore, ($pctCore / $cores), $cores, $mem
