# UI smoke test for the DreamCanvas app via Windows UI Automation (no mouse/keyboard input).
# Usage: .\ui-smoke.ps1 -Navigate "Wallpaper Gallery" [-Select "Aurora Sky"] [-Invoke "Randomize"]
param(
    [string]$Navigate,
    [string]$Select,
    [string]$Invoke,
    [int]$WaitSeconds = 3
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$TreeScope = [System.Windows.Automation.TreeScope]

$proc = Get-Process DreamCanvas -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "DreamCanvas app is not running"; exit 1 }
$window = $A::FromHandle($proc.MainWindowHandle)

function Find-ByName([string]$name) {
    # Exact name first, then a prefix match (cards are named "<Name>, <Category>").
    $cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name)
    $el = $window.FindFirst($TreeScope::Descendants, $cond)
    if (-not $el) {
        $el = $window.FindAll($TreeScope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
            Where-Object { $_.Current.Name -like "$name*" } | Select-Object -First 1
    }
    if (-not $el) { throw "UI element '$name' not found" }
    return $el
}

function Activate($start) {
    # Text inside a list item or button isn't actionable itself; walk up to the control that is.
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($el = $start; $el -ne $null; $el = $walker.GetParent($el)) {
        $pattern = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); return "selected" }
        if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); return "invoked" }
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); return "toggled" }
    }
    throw "Element '$($start.Current.Name)' has no actionable ancestor"
}

foreach ($step in @(@('navigate', $Navigate), @('select', $Select), @('invoke', $Invoke))) {
    if (-not $step[1]) { continue }
    $el = Find-ByName $step[1]
    $how = Activate $el
    Write-Host "$($step[0]): '$($step[1])' $how"
    Start-Sleep -Seconds $WaitSeconds
}
