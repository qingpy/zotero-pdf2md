# Builds build\zotero-pdf2md.xpi (requires Node.js — PowerShell's
# Compress-Archive produces zips Zotero rejects as corrupt)
$ErrorActionPreference = "Stop"
node (Join-Path $PSScriptRoot "build-xpi.mjs") `
    (Join-Path $PSScriptRoot "addon") `
    (Join-Path $PSScriptRoot "build\zotero-pdf2md.xpi")
if ($LASTEXITCODE -ne 0) { throw "Packing failed" }
