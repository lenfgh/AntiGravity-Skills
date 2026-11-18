param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [int]$Width = 1280,
    [int]$Height = 720,
    [double]$TolerancePoints = 2
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Path).Path
if ([IO.Path]::GetExtension($sourcePath) -ne '.pptx') { throw 'Expected a saved .pptx file.' }
if ($Width -lt 1 -or $Height -lt 1) { throw 'Preview dimensions must be positive.' }
$previewPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $previewPath) {
    if (@(Get-ChildItem -LiteralPath $previewPath -Force).Count -gt 0) {
        throw 'Use a new or empty preview directory so existing files are not overwritten.'
    }
} else { New-Item -ItemType Directory -Path $previewPath | Out-Null }

$script:textIssues = [Collections.Generic.List[object]]::new()
function Check-TextShape($shape, [int]$slideNumber) {
    if ($shape.Type -eq 6) {
        for ($i=1; $i -le $shape.GroupItems.Count; $i++) { Check-TextShape $shape.GroupItems.Item($i) $slideNumber }
        return
    }
    if ($shape.HasTable -ne 0) {
        for ($row=1; $row -le $shape.Table.Rows.Count; $row++) {
            for ($col=1; $col -le $shape.Table.Columns.Count; $col++) {
                Check-TextShape $shape.Table.Cell($row,$col).Shape $slideNumber
            }
        }
        return
    }
    if ($shape.HasTextFrame -eq 0 -or $shape.TextFrame.HasText -eq 0) { return }
    $range = $shape.TextFrame2.TextRange
    $availableWidth = $shape.Width - $shape.TextFrame2.MarginLeft - $shape.TextFrame2.MarginRight
    $availableHeight = $shape.Height - $shape.TextFrame2.MarginTop - $shape.TextFrame2.MarginBottom
    if ($range.BoundWidth -gt $availableWidth + $TolerancePoints -or $range.BoundHeight -gt $availableHeight + $TolerancePoints) {
        $snippet = $shape.TextFrame.TextRange.Text
        if ($snippet.Length -gt 80) { $snippet = $snippet.Substring(0,80) }
        $script:textIssues.Add([pscustomobject]@{slide=$slideNumber;text=$snippet;width=$availableWidth;text_width=$range.BoundWidth;height=$availableHeight;text_height=$range.BoundHeight})
    }
}
$app = $null
$presentation = $null
$shouldQuit = $false
try {
    $app = New-Object -ComObject PowerPoint.Application
    $existingCount = $app.Presentations.Count
    $wasVisible = $app.Visible -ne 0
    $shouldQuit = $existingCount -eq 0 -and -not $wasVisible
    foreach ($existing in $app.Presentations) {
        if ($existing.FullName -eq $sourcePath) {
            throw 'This presentation is already open. Render a separate saved copy to preserve the active document.'
        }
    }
    $presentation = $app.Presentations.Open($sourcePath,$true,$false,$false)
    foreach ($slide in $presentation.Slides) {
        foreach ($shape in $slide.Shapes) { Check-TextShape $shape $slide.SlideIndex }
    }
    $presentation.Export($previewPath,'PNG',$Width,$Height)
    [pscustomobject]@{slides=$presentation.Slides.Count;text_overflow_count=$script:textIssues.Count;issues=@($script:textIssues.ToArray());preview_directory=$previewPath} | ConvertTo-Json -Depth 5
}
finally {
    if ($null -ne $presentation) {
        $presentation.Close()
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
    }
    if ($null -ne $app) {
        if ($shouldQuit) { $app.Quit() }
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
if ($script:textIssues.Count -gt 0) { exit 1 }
