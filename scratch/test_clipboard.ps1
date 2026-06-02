Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$filePath = "d:\testCode\screenshotStorage\assets\tray.png"
if (Test-Path $filePath) {
    Write-Host "File exists: $filePath"
} else {
    Write-Host "File NOT exists: $filePath"
    exit 1
}

$dataObject = New-Object System.Windows.Forms.DataObject
$fileList = New-Object System.Collections.Specialized.StringCollection
$fileList.Add($filePath) > $null

$dataObject.SetFileDropList($fileList)

$img = [System.Drawing.Image]::FromFile($filePath)
$dataObject.SetImage($img)

[System.Windows.Forms.Clipboard]::SetDataObject($dataObject, $true)
Write-Host "Successfully wrote file and image to clipboard (no Text format)."
