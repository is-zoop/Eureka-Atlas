param(
    [string]$MakeNsis = '',
    [string]$Node = (Get-Command node -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$atlasRoot = Split-Path $PSScriptRoot -Parent
$atlasBuild = Join-Path $atlasRoot '.installer-build'
$atlasPayload = Join-Path $atlasBuild 'payload'
if (!$MakeNsis) {
    $atlasArchive = Join-Path $atlasRoot '.build-tools/nsis-3.13-verified.zip'
    if (!(Test-Path -LiteralPath $atlasArchive)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $atlasArchive -Parent) | Out-Null
        & curl.exe -L --fail --proto '=https' --proto-redir '=https' --max-time 60 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip?download=1' -o $atlasArchive
        if ($LASTEXITCODE -ne 0) { throw 'NSIS download failed' }
    }
    if ((Get-FileHash -LiteralPath $atlasArchive).Hash -ne 'BA63DFFC4410EE89193E1CB5A41989991BD77C61068DA17E3156D136B7B0B3D8') { throw 'NSIS archive hash mismatch' }
    Expand-Archive -LiteralPath $atlasArchive -DestinationPath (Join-Path $atlasRoot '.build-tools') -Force
    $MakeNsis = Join-Path $atlasRoot '.build-tools/nsis-3.13/Bin/makensis.exe'
}
if (!(Test-Path -LiteralPath $MakeNsis)) { throw 'NSIS compiler missing. Specify it with -MakeNsis.' }
$atlasSignature = Get-AuthenticodeSignature -LiteralPath $Node
if ($atlasSignature.Status -ne 'Valid' -or $atlasSignature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw 'Only signed official Node.js binaries may be bundled.' }
if ((& $Node --version) -ne 'v24.12.0') { throw 'This installer requires Node.js v24.12.0. Specify it with -Node.' }
Push-Location $atlasRoot
try {
    & pnpm build:desktop
    if ($LASTEXITCODE -ne 0) { throw 'WPS UI build failed' }
    # Only clean this generated payload, never the source or repository root.
    $atlasResolved = [IO.Path]::GetFullPath($atlasPayload)
    if ($atlasResolved -ne [IO.Path]::GetFullPath((Join-Path $atlasRoot '.installer-build/payload'))) { throw 'Unsafe build directory' }
    if (Test-Path -LiteralPath $atlasResolved) { Remove-Item -LiteralPath $atlasResolved -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $atlasPayload, (Join-Path $atlasPayload 'web'), (Join-Path $atlasPayload 'runtime'), (Join-Path $atlasPayload 'licenses') | Out-Null
    Copy-Item -LiteralPath $Node -Destination (Join-Path $atlasPayload 'node.exe')
    Copy-Item -Path (Join-Path $atlasRoot 'dist-desktop/*') -Destination (Join-Path $atlasPayload 'web') -Recurse
    Copy-Item -LiteralPath (Join-Path $atlasRoot 'runtime/server.mjs') -Destination (Join-Path $atlasPayload 'runtime/server.mjs')
    Copy-Item -LiteralPath (Join-Path $atlasRoot 'runtime/session-store.mjs') -Destination (Join-Path $atlasPayload 'runtime/session-store.mjs')
    Copy-Item -LiteralPath (Join-Path $atlasRoot 'public/images/atlas.ico') -Destination (Join-Path $atlasPayload 'atlas-badge.ico')
    Copy-Item -LiteralPath (Join-Path $atlasRoot 'README.md') -Destination (Join-Path $atlasPayload 'README.md')
    $atlasLicense = Join-Path $atlasRoot '.build-tools/NODE-LICENSE.txt'
    if (!(Test-Path -LiteralPath $atlasLicense)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $atlasLicense -Parent) | Out-Null
        Invoke-WebRequest 'https://raw.githubusercontent.com/nodejs/node/v24.12.0/LICENSE' -OutFile $atlasLicense
    }
    Copy-Item -LiteralPath $atlasLicense -Destination (Join-Path $atlasPayload 'licenses/NODE-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $atlasRoot 'installer/THIRD-PARTY-NOTICES.txt') -Destination (Join-Path $atlasPayload 'licenses/THIRD-PARTY-NOTICES.txt')
    Copy-Item -LiteralPath (Join-Path (Split-Path (Split-Path $MakeNsis -Parent) -Parent) 'COPYING') -Destination (Join-Path $atlasPayload 'licenses/NSIS-LICENSE.txt')
    & $Node (Join-Path $PSScriptRoot 'licenses.mjs') (Join-Path $atlasPayload 'licenses/WEB-LICENSES.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency license collection failed' }
    & "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ "/win32icon:$atlasPayload/atlas-badge.ico" "/out:$atlasPayload/AtlasWps.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Xml.Linq.dll (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'Registration.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
    & "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /codepage:65001 /target:exe /platform:x64 /optimize+ "/out:$atlasPayload/SessionVault.exe" /reference:System.Security.dll (Join-Path $PSScriptRoot 'SessionVault.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Session vault compilation failed' }
    & $Node (Join-Path $PSScriptRoot 'manifest.mjs') $atlasPayload (Join-Path $atlasBuild 'uninstall-files.nsh')
    if ($LASTEXITCODE -ne 0) { throw 'Uninstall manifest failed' }
    New-Item -ItemType Directory -Force -Path (Join-Path $atlasRoot 'release') | Out-Null
    & $MakeNsis /WX /INPUTCHARSET UTF8 "/DPAYLOAD=$atlasPayload" (Join-Path $PSScriptRoot 'atlas.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
    Get-Item (Join-Path $atlasRoot 'release/AtlasWpsSetup-0.4.1-x64.exe') | Select-Object FullName,Length
    Get-FileHash (Join-Path $atlasRoot 'release/AtlasWpsSetup-0.4.1-x64.exe') -Algorithm SHA256
} finally { Pop-Location }
