Add-Type -AssemblyName System.Windows.Forms
$dataObject = [System.Windows.Forms.Clipboard]::GetDataObject()
$formats = $dataObject.GetFormats()

Write-Host "Available formats in Clipboard:"
foreach ($f in $formats) {
    Write-Host " - $f"
}

# 检查是否有 Text 格式
if ($dataObject.GetDataPresent([System.Windows.Forms.DataFormats]::Text)) {
    $text = $dataObject.GetData([System.Windows.Forms.DataFormats]::Text)
    Write-Host "Text Data: '$text'"
} else {
    Write-Host "No Text format present."
}

# 检查是否有 FileDropList 格式
if ($dataObject.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
    $files = $dataObject.GetData([System.Windows.Forms.DataFormats]::FileDrop)
    Write-Host "File Drop Data: $files"
} else {
    Write-Host "No FileDrop format present."
}

# 检查是否有 Bitmap 格式
if ($dataObject.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {
    Write-Host "Bitmap/Image format is PRESENT."
} else {
    Write-Host "No Bitmap/Image format present."
}
