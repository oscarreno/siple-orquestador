$ErrorActionPreference = 'Stop'
$orquestadorRuta = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fuenteRuta = Join-Path $orquestadorRuta 'docs\contratos\grupos-v1'
$manifiesto = Get-Content -LiteralPath (Join-Path $fuenteRuta 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$rutasRelativas = @($manifiesto.archivos | ForEach-Object { $_.ruta }) + @('manifest.json')
$destinos = @('C:\SIPLE\siple-backTS\docs\contratos\grupos-v1', 'C:\SIPLE\siple-front\docs\contratos\grupos-v1')
# Preflight completo: solo archivos del manifiesto, sin sobreescribir divergencias.
foreach ($destinoRuta in $destinos) {
    foreach ($relativa in $rutasRelativas) {
        $archivoDestino = [IO.Path]::GetFullPath((Join-Path $destinoRuta $relativa))
        if (-not $archivoDestino.StartsWith($destinoRuta + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta fuera del destino' }
        $archivoFuente = Join-Path $fuenteRuta $relativa
        if (Test-Path -LiteralPath $archivoDestino) {
            if ((Get-FileHash -LiteralPath $archivoDestino).Hash -ne (Get-FileHash -LiteralPath $archivoFuente).Hash) {
                throw "Archivo existente diferente; no se sobrescribe: $archivoDestino"
            }
        }
    }
}
foreach ($destinoRuta in $destinos) {
    foreach ($relativa in $rutasRelativas) {
        $archivoDestino = Join-Path $destinoRuta $relativa
        if (-not (Test-Path -LiteralPath $archivoDestino)) {
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($archivoDestino)) | Out-Null
            Copy-Item -LiteralPath (Join-Path $fuenteRuta $relativa) -Destination $archivoDestino
        }
    }
    Write-Output "Espejo publicado: $destinoRuta"
}
