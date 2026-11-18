param(
    [Parameter(Mandatory=$true)][string]$Path,
    [string]$ExportPdfPath = ""
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Path).Path
if ($ExportPdfPath -ne "" -and $ExportPdfPath.ToUpper().StartsWith("C:")) {
    throw "Storage guardrail violation: refusing to write PDF onto C: drive ($ExportPdfPath)."
}

$excel = $null
$wb = $null
$shouldQuit = $false
$errorsFound = [Collections.Generic.List[object]]::new()
$sheetSummaries = [Collections.Generic.List[object]]::new()

try {
    $excel = New-Object -ComObject Excel.Application
    $existingCount = $excel.Workbooks.Count
    $wasVisible = $excel.Visible
    $shouldQuit = ($existingCount -eq 0) -and (-not $wasVisible)
    if (-not $wasVisible) { $excel.Visible = $false }
    $excel.DisplayAlerts = $false

    foreach ($openWb in $excel.Workbooks) {
        if ($openWb.FullName -eq $sourcePath) {
            throw "Workbook is currently open in Excel. Audit a saved copy to avoid disturbing active work."
        }
    }

    # Open(Filename, UpdateLinks=0, ReadOnly=$true)
    $wb = $excel.Workbooks.Open($sourcePath, 0, $true)
    $excel.CalculateFullRebuild()

    foreach ($ws in $wb.Worksheets) {
        $used = $ws.UsedRange
        $rows = $used.Rows.Count
        $cols = $used.Columns.Count
        $formulaCount = 0
        $sheetErrCount = 0

        for ($r = 1; $r -le $rows; $r++) {
            for ($c = 1; $c -le $cols; $c++) {
                $cell = $used.Item($r, $c)
                $f = [string]$cell.Formula
                if ($f.StartsWith("=")) { $formulaCount++ }
                $txt = [string]$cell.Text
                if ($txt -match '^#(REF!|DIV/0!|VALUE!|NAME\?|NUM!|NULL!|N/A|SPILL!|CALC!)') {
                    $sheetErrCount++
                    $errorsFound.Add([pscustomobject]@{
                        sheet   = $ws.Name
                        address = $cell.Address($false, $false)
                        error   = $txt
                        formula = $f
                    })
                }
            }
        }
        $sheetSummaries.Add([pscustomobject]@{
            sheet         = $ws.Name
            used_rows     = $rows
            used_cols     = $cols
            formula_cells = $formulaCount
            error_cells   = $sheetErrCount
        })
    }

    if ($ExportPdfPath -ne "") {
        $pdfFull = [IO.Path]::GetFullPath($ExportPdfPath)
        $pdfDir = [IO.Path]::GetDirectoryName($pdfFull)
        if (-not (Test-Path -LiteralPath $pdfDir)) { New-Item -ItemType Directory -Force -Path $pdfDir | Out-Null }
        # 0 = xlTypePDF
        $wb.ExportAsFixedFormat(0, $pdfFull)
    }

    [pscustomobject]@{
        workbook          = $sourcePath
        sheet_count       = $wb.Worksheets.Count
        total_error_cells = $errorsFound.Count
        sheets            = @($sheetSummaries.ToArray())
        errors            = @($errorsFound.ToArray())
        exported_pdf      = $ExportPdfPath
    } | ConvertTo-Json -Depth 6
} finally {
    if ($null -ne $wb) {
        $wb.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($wb)
    }
    if ($null -ne $excel) {
        if ($shouldQuit) { $excel.Quit() }
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if ($errorsFound.Count -gt 0) { exit 1 }
