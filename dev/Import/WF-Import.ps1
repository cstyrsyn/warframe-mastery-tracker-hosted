# WF-Import.ps1 — Warframe Mastery Tracker  XLSX → import.json
# Requires Microsoft Excel to be installed.
#
# Usage (defaults to xlsx in same folder, writes import.json beside it):
#   .\WF-Import.ps1
#   .\WF-Import.ps1 -XlsxPath ".\My Checklist.xlsx" -OutputPath ".\my-import.json"

param(
    [string]$XlsxPath   = (Join-Path $PSScriptRoot 'Copy of Warframe Mastery Checklist Update 42.xlsx'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'import.json')
)

$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────────────────

function Test-Truthy($val) {
    if ($null -eq $val)                                  { return $false }
    if ($val -is [bool])                                 { return $val }
    if ($val -is [double] -or $val -is [int])            { return $val -ne 0 }
    $s = [string]$val
    return $s -eq 'TRUE' -or $s -eq 'true' -or $s -eq '1' -or $s -eq 'Yes'
}

# Read a worksheet range and return a 1-indexed [row,col] 2-D array.
# Normalises the edge-cases Excel COM produces for single-row or single-cell ranges.
function Get-Range2D($ws, $addr) {
    $raw = $ws.Range($addr).Value2
    if ($null -eq $raw) { return $null }
    if ($raw -is [System.Object[,]]) { return $raw }
    # Single row — COM returns a 1-D array; wrap into 2-D array with lower bounds [1,1]
    if ($raw -is [System.Array]) {
        $len = $raw.Length
        $arr = [System.Array]::CreateInstance([object], @(1, $len), @(1, 1))
        for ($i = 1; $i -le $len; $i++) { $arr.SetValue($raw[$i - 1], 1, $i) }
        return $arr
    }
    # Scalar (single cell) — wrap in a [1,1] 2-D array
    $arr = [System.Array]::CreateInstance([object], @(1, 1), @(1, 1))
    $arr.SetValue($raw, 1, 1)
    return $arr
}

# Read a standard section from $addr.
# Row 1 of the range is the header and is skipped.
# Stops at the first blank in col 1 (name col) or at the end of the range.
# Assumes col layout: 1=name, 2=acquired, 3=mastered.
function Read-Std($ws, $addr) {
    $d = Get-Range2D $ws $addr
    if ($null -eq $d) { return @() }
    $rows = $d.GetUpperBound(0)
    $out  = [System.Collections.Generic.List[object]]::new()
    for ($r = 2; $r -le $rows; $r++) {
        $name = [string]($d.GetValue($r, 1))
        if ([string]::IsNullOrWhiteSpace($name)) { break }
        $acq = $d.GetValue($r, 2)
        $mas = $d.GetValue($r, 3)
        $out.Add([pscustomobject]@{ Name = $name.Trim(); Acquired = $acq; Mastered = $mas })
    }
    return $out.ToArray()
}

# Read a dual-row section (maxRank 40).
# Each weapon occupies 2 rows: the name row then a level-40 row.
# $hasHeader = $false when data starts at row 1 of the range (no header to skip).
# Assumes col layout: 1=name, 2=acquired, 3=mastered.
function Read-Dual($ws, $addr, [bool]$hasHeader = $true) {
    $d = Get-Range2D $ws $addr
    if ($null -eq $d) { return @() }
    $rows  = $d.GetUpperBound(0)
    $r     = if ($hasHeader) { 2 } else { 1 }
    $out   = [System.Collections.Generic.List[object]]::new()
    while ($r -le $rows) {
        $name = [string]($d.GetValue($r, 1))
        if ([string]::IsNullOrWhiteSpace($name)) { break }
        $acq = $d.GetValue($r, 2)
        $m30 = $d.GetValue($r, 3)
        $m40 = if ($r + 1 -le $rows) { $d.GetValue($r + 1, 3) } else { $false }
        $out.Add([pscustomobject]@{
            Name       = $name.Trim()
            Acquired   = $acq
            Mastered30 = $m30
            Mastered40 = $m40
        })
        $r += 2
    }
    return $out.ToArray()
}

# Read multiple sections that share a column block, separated by blank rows.
# Each section's first non-blank row is its header and is skipped.
# Returns an array of arrays, each containing [Name, Acquired, Mastered] objects.
function Read-Sections($ws, $addr) {
    $d = Get-Range2D $ws $addr
    if ($null -eq $d) { return @(, @()) }
    $rows      = $d.GetUpperBound(0)
    $sections  = [System.Collections.Generic.List[object]]::new()
    $current   = $null
    $inSection = $false
    for ($r = 1; $r -le $rows; $r++) {
        $name = [string]($d.GetValue($r, 1))
        if ([string]::IsNullOrWhiteSpace($name)) {
            if ($null -ne $current -and $current.Count -gt 0) {
                $sections.Add($current.ToArray()); $current = $null
            }
            $inSection = $false
        } else {
            if (-not $inSection) { $inSection = $true; continue }  # skip section header row
            if ($null -eq $current) { $current = [System.Collections.Generic.List[object]]::new() }
            $acq = $d.GetValue($r, 2)
            $mas = $d.GetValue($r, 3)
            $current.Add([pscustomobject]@{ Name = $name.Trim(); Acquired = $acq; Mastered = $mas })
        }
    }
    if ($null -ne $current -and $current.Count -gt 0) { $sections.Add($current.ToArray()) }
    return , $sections.ToArray()
}

# ── Progress builders ─────────────────────────────────────────────────────────

function Add-Std($progress, $pfx, $items, $maxRank = 30) {
    if ($null -eq $items) { return }
    foreach ($i in $items) {
        $n = $i.Name
        if (Test-Truthy $i.Mastered) {
            $progress["$pfx$n"] = $maxRank; $progress["aq:$pfx$n"] = $true
        } elseif (Test-Truthy $i.Acquired) {
            $progress["aq:$pfx$n"] = $true
        }
    }
}

function Add-Dual($progress, $pfx, $items) {
    if ($null -eq $items) { return }
    foreach ($i in $items) {
        $n    = $i.Name
        $rank = if (Test-Truthy $i.Mastered40) { 40 } elseif (Test-Truthy $i.Mastered30) { 30 } else { 0 }
        if ($rank -gt 0) {
            $progress["$pfx$n"] = $rank; $progress["aq:$pfx$n"] = $true
        } elseif (Test-Truthy $i.Acquired) {
            $progress["aq:$pfx$n"] = $true
        }
    }
}

function Add-Intrinsics($progress, $ws, $addr) {
    $d = Get-Range2D $ws $addr
    if ($null -eq $d) { return }
    $rows = $d.GetUpperBound(0)
    for ($r = 2; $r -le $rows; $r++) {
        $name = [string]($d.GetValue($r, 1))
        if ([string]::IsNullOrWhiteSpace($name)) { break }
        $lvl = $d.GetValue($r, 2)
        if ($null -ne $lvl) {
            $lvlInt = [int][double]$lvl
            if ($lvlInt -gt 0) { $progress["in:$($name.Trim())"] = $lvlInt }
        }
    }
}

# ── Open workbook ─────────────────────────────────────────────────────────────

$xlsxFull = (Resolve-Path $XlsxPath).Path
Write-Host "Opening $xlsxFull ..."

$xl = New-Object -ComObject Excel.Application
$xl.Visible       = $false
$xl.DisplayAlerts = $false

try {
    $wb       = $xl.Workbooks.Open($xlsxFull)
    $progress = [ordered]@{}

    # ── Main + Info: Star Chart ───────────────────────────────────────────────
    Write-Host 'Processing Main + Info...'
    $main = $wb.Sheets['Main + Info']

    # Planets B16:E36 — col1=name, col2=missions(skip), col3=regular, col4=steelpath
    $d = Get-Range2D $main 'B16:E36'
    for ($r = 2; $r -le $d.GetUpperBound(0); $r++) {
        $name = [string]($d.GetValue($r, 1)); if ([string]::IsNullOrWhiteSpace($name)) { break }
        $name = $name.Trim()
        if (Test-Truthy ($d.GetValue($r, 3))) { $progress["pl:$name"]  = $true }
        if (Test-Truthy ($d.GetValue($r, 4))) { $progress["sp:$name"]  = $true }
    }

    # Junctions G16:I29 — col1=name, col2=regular, col3=steelpath
    $d = Get-Range2D $main 'G16:I29'
    for ($r = 2; $r -le $d.GetUpperBound(0); $r++) {
        $name = [string]($d.GetValue($r, 1)); if ([string]::IsNullOrWhiteSpace($name)) { break }
        $name = $name.Trim()
        if (Test-Truthy ($d.GetValue($r, 2))) { $progress["jn:$name"]  = $true }
        if (Test-Truthy ($d.GetValue($r, 3))) { $progress["spj:$name"] = $true }
    }

    # Overrides G32:J33 — data row is row 2; col2=regular value, col4=sp value
    $d = Get-Range2D $main 'G32:J33'
    foreach ($pair in @(@(2, 'sc-ovr:regular'), @(4, 'sc-ovr:sp'))) {
        $col = $pair[0]; $key = $pair[1]
        $val = $d.GetValue(2, $col)
        if ($null -ne $val -and "$val" -ne '') {
            $n = [double]$val; if (-not [double]::IsNaN($n)) { $progress[$key] = [int]$n }
        }
    }

    # ── Warframe ──────────────────────────────────────────────────────────────
    Write-Host 'Processing Warframes...'
    $wf = $wb.Sheets['Warframe']

    # Base frames — single section in B column
    $secs = Read-Sections $wf 'B2:F200'
    if ($secs.Count -ge 1) { Add-Std $progress 'w:' $secs[0] }

    # Prime + Umbra — two sections in H column separated by a blank row
    $secs = Read-Sections $wf 'H2:K200'
    if ($secs.Count -ge 1) { Add-Std $progress 'w:' $secs[0] }
    if ($secs.Count -ge 2) { Add-Std $progress 'w:' $secs[1] }

    # ── Primary ───────────────────────────────────────────────────────────────
    Write-Host 'Processing Primary...'
    $pw = $wb.Sheets['Primary']

    Add-Std  $progress 'p1:' (Read-Std  $pw 'B2:E200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'G2:J200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'G25:J200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'G37:J200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'G55:J200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'G61:J200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'L2:O200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'L15:O200')
    Add-Std  $progress 'p1:' (Read-Std  $pw 'L50:O200')
    Add-Dual $progress 'p1:' (Read-Dual $pw 'G64:J200')
    Add-Dual $progress 'p1:' (Read-Dual $pw 'L56:O200')
    Add-Dual $progress 'p1:' (Read-Dual $pw 'L82:O200')

    # ── Secondary ─────────────────────────────────────────────────────────────
    Write-Host 'Processing Secondary...'
    $sw = $wb.Sheets['Secondary']

    Add-Std  $progress 'p2:' (Read-Std  $sw 'B2:E200')
    Add-Std  $progress 'p2:' (Read-Std  $sw 'G2:J200')
    Add-Std  $progress 'p2:' (Read-Std  $sw 'G29:J200')
    Add-Std  $progress 'p2:' (Read-Std  $sw 'L2:O200')
    Add-Std  $progress 'p2:' (Read-Std  $sw 'L33:O200')
    Add-Std  $progress 'p2:' (Read-Std  $sw 'L37:O200')
    Add-Dual $progress 'p2:' (Read-Dual $sw 'G43:J200')
    Add-Dual $progress 'p2:' (Read-Dual $sw 'L45:O200')
    Add-Dual $progress 'p2:' (Read-Dual $sw 'L58:O200')

    # ── Melee ─────────────────────────────────────────────────────────────────
    Write-Host 'Processing Melee...'
    $mw = $wb.Sheets['Melee']

    Add-Std  $progress 'p3:' (Read-Std  $mw 'B2:E200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'B25:E200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'B42:E200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'B55:E200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G2:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G12:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G19:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G30:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G42:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G50:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G56:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G62:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'G65:J200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'L2:O200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'L22:O200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'L36:O200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'L47:O200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'L59:O200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'Q2:T200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'Q10:T200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'Q24:T200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'Q28:T200')
    Add-Std  $progress 'p3:' (Read-Std  $mw 'Q33:T200')
    Add-Dual $progress 'p3:' (Read-Dual $mw 'L63:O200')
    Add-Dual $progress 'p3:' (Read-Dual $mw 'Q74:T200')
    Add-Dual $progress 'p3:' (Read-Dual $mw 'Q80:T200')

    # ── Companion ─────────────────────────────────────────────────────────────
    Write-Host 'Processing Companions...'
    $cp = $wb.Sheets['Companion']

    # Companions
    Add-Std $progress 'c:'  (Read-Std $cp 'B2:E13')
    Add-Std $progress 'c:'  (Read-Std $cp 'B35:E41')
    Add-Std $progress 'c:'  (Read-Std $cp 'G2:J8')
    Add-Std $progress 'c:'  (Read-Std $cp 'G10:J15')
    Add-Std $progress 'c:'  (Read-Std $cp 'G17:J21')
    Add-Std $progress 'c:'  (Read-Std $cp 'G22:J26')
    Add-Std $progress 'c:'  (Read-Std $cp 'G28:J31')
    Add-Std $progress 'c:'  (Read-Std $cp 'G33:J36')
    # Companion weapons
    Add-Std $progress 'cw:' (Read-Std $cp 'B15:E33')
    Add-Std $progress 'cw:' (Read-Std $cp 'B43:E49')

    # ── Vehicle ───────────────────────────────────────────────────────────────
    Write-Host 'Processing Vehicles...'
    $veh = $wb.Sheets['Vehicle']

    # Standard vehicles
    Add-Std  $progress 'v:' (Read-Std  $veh 'B2:E6')
    Add-Std  $progress 'v:' (Read-Std  $veh 'B45:E50')
    Add-Dual $progress 'v:' (Read-Dual $veh 'B52:E200')

    # Prime section B8:E11 — B9:B10 are arch weapons, B11 is an archwing (vehicle)
    # Direct cell access avoids ambiguity in this mixed section
    foreach ($rowNum in 9, 10) {
        $name = [string]($veh.Cells.Item($rowNum, 2).Value2)
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $name = $name.Trim()
            $acq  = $veh.Cells.Item($rowNum, 3).Value2
            $mas  = $veh.Cells.Item($rowNum, 4).Value2
            if (Test-Truthy $mas)         { $progress["aw:$name"] = 30; $progress["aq:aw:$name"] = $true }
            elseif (Test-Truthy $acq)     { $progress["aq:aw:$name"] = $true }
        }
    }
    $name = [string]($veh.Cells.Item(11, 2).Value2)  # B11 = prime archwing
    if (-not [string]::IsNullOrWhiteSpace($name)) {
        $name = $name.Trim()
        $acq  = $veh.Cells.Item(11, 3).Value2
        $mas  = $veh.Cells.Item(11, 4).Value2
        if (Test-Truthy $mas)         { $progress["v:$name"] = 30; $progress["aq:v:$name"] = $true }
        elseif (Test-Truthy $acq)     { $progress["aq:v:$name"] = $true }
    }

    # Arch-Guns: standard B13:E29, then Kuva dual B30:E33 (no header row)
    Add-Std  $progress 'aw:' (Read-Std  $veh 'B13:E29')
    Add-Dual $progress 'aw:' (Read-Dual $veh 'B30:E33' $false)
    Add-Std  $progress 'aw:' (Read-Std  $veh 'B35:E200')

    # Plexus G22 — no acquired col, use mastered as proxy; single row so use direct cell access
    $name = [string]($veh.Cells.Item(22, 7).Value2)   # G22
    $mas  = $veh.Cells.Item(22, 8).Value2              # H22
    if (-not [string]::IsNullOrWhiteSpace($name)) {
        $name = $name.Trim()
        if (Test-Truthy $mas) { $progress["v:$name"] = 30; $progress["aq:v:$name"] = $true }
    }

    # Railjack intrinsics G24:J29 — col1=name, col2=level
    Add-Intrinsics $progress $veh 'G24:J29'

    # ── AmpDrifter ────────────────────────────────────────────────────────────
    Write-Host 'Processing AmpDrifter...'
    $amp = $wb.Sheets['AmpDrifter']

    Add-Std        $progress 'am:' (Read-Std $amp 'B2:E200')
    Add-Intrinsics $progress $amp 'H9:I13'   # Drifter intrinsics; same in: prefix as Railjack

    # ── Write JSON ────────────────────────────────────────────────────────────
    $json = $progress | ConvertTo-Json -Compress -Depth 3
    [System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.Encoding]::UTF8)
    Write-Host "Wrote $OutputPath - $($progress.Count) entries."

} finally {
    if ($null -ne $wb) { $wb.Close($false) }
    $xl.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
