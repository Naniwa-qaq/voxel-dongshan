$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$refRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$srcData = Get-Content -LiteralPath (Join-Path $refRoot 'sources.json') -Raw | ConvertFrom-Json
$imgData = Get-Content -LiteralPath (Join-Path $refRoot 'images.json') -Raw | ConvertFrom-Json
$expected = @{
  'luxiang-2026' = @('陆巷', '紫石街')
  'dongshan-2025' = @('东山', '花果山')
  'dongshan-2019' = @('东山镇', '启园')
  'huihetang' = @('惠和堂', '五进')
  'qiyuan' = @('启园', '席家花园')
  'museum-huihetang' = @('惠和堂', '平面图')
  'heritage-register' = @('东山民居', '轩辕宫')
  'dongshan-scenic' = @('东山景区', '花果名茶')
}
$pageChecks = @()
foreach ($s in $srcData.sources) {
  $f = Join-Path $refRoot $s.raw_html
  $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
  $txt = [System.IO.File]::ReadAllText($f)
  $tokens = @($expected[$s.id] | ForEach-Object { [PSCustomObject]@{ token = $_; present = $txt.Contains($_) } })
  $pageChecks += [PSCustomObject]@{
    id = $s.id; file = $s.raw_html; bytes = (Get-Item -LiteralPath $f).Length
    sha256_match = ($h -eq $s.sha256); expected_content = $tokens
    expected_content_present = (@($tokens | Where-Object { -not $_.present }).Count -eq 0)
    original_fetched_at_utc = $s.fetched_at_utc; source_page_date = $s.date
    source_page_date_literal_in_html = if ($s.date) { $txt.Contains($s.date) } else { $null }
  }
}
$imageChecks = @()
foreach ($i in $imgData.images) {
  $f = Join-Path $refRoot $i.file
  $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
  $b = $null; $target = $null; $g = $null
  try {
    $b = [System.Drawing.Bitmap]::new($f)
    $target = [System.Drawing.Bitmap]::new($b.Width, $b.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($target)
    $g.DrawImageUnscaled($b, 0, 0)
    $corner = $target.GetPixel($target.Width - 1, $target.Height - 1).ToArgb()
    $imageChecks += [PSCustomObject]@{
      id = $i.id; file = $i.file; bytes = (Get-Item -LiteralPath $f).Length
      sha256_match = ($h -eq $i.sha256); decoded = $true; decoder = 'System.Drawing/GDI+ DrawImageUnscaled full raster decode'
      width = $b.Width; height = $b.Height; dimensions_match = ($b.Width -eq $i.width -and $b.Height -eq $i.height)
      source_id = $i.source_id; source_page = $i.source_page; image_url = $i.image_url
      page_publication_date = $i.page_publication_date; image_publication_date = $i.image_publication_date
      original_fetched_at_utc = $i.fetched_at_utc
      has_attribution_and_rights = [bool]($i.publisher -and $i.image_author -and $i.license_status)
    }
  } catch {
    $imageChecks += [PSCustomObject]@{id = $i.id; file = $i.file; decoded = $false; error = $_.Exception.Message; sha256_match = ($h -eq $i.sha256)}
  } finally {
    if ($g) { $g.Dispose() }; if ($target) { $target.Dispose() }; if ($b) { $b.Dispose() }
  }
}
$gallery = [System.IO.File]::ReadAllText((Join-Path $refRoot 'index.html'))
$localImageLinks = @([regex]::Matches($gallery, '<img\b[^>]*src="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
$galleryChecks = @($localImageLinks | ForEach-Object { [PSCustomObject]@{src = $_; local_only = (-not ($_ -match '^(https?:|data:)')); exists = (Test-Path -LiteralPath (Join-Path $refRoot $_) -PathType Leaf)} })
$badPages = @($pageChecks | Where-Object { -not $_.sha256_match -or -not $_.expected_content_present })
$badImages = @($imageChecks | Where-Object { -not $_.decoded -or -not $_.sha256_match -or -not $_.dimensions_match -or -not $_.has_attribution_and_rights })
$badLinks = @($galleryChecks | Where-Object { -not $_.local_only -or -not $_.exists })
$report = [PSCustomObject]@{
  schema_version = 1; audited_at_utc = [DateTime]::UtcNow.ToString('o')
  audited_at_local = ([TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd HH:mm:ss') + ' +08:00')
  original_collection_date_local = '2026-10-16'; audit_date_local = '2026-10-19'
  downloaded_again = $false; network_requests_this_audit = 0
  pages_verified = $pageChecks.Count; original_html_files = $pageChecks.Count
  images_verified = $imageChecks.Count; decoded_images = @($imageChecks | Where-Object decoded).Count
  gallery_local_image_links = $galleryChecks.Count
  passed = ($badPages.Count -eq 0 -and $badImages.Count -eq 0 -and $badLinks.Count -eq 0 -and $galleryChecks.Count -eq $imageChecks.Count)
  visual_review_note = '原采集时18图已逐张view_image目视检查；本次重新校验SHA一致，并用GDI+完整解码。惠和堂俯瞰、平面及穿堂可读，但无测绘尺度或坐标。'
  pages = $pageChecks; images = $imageChecks; gallery = $galleryChecks
  rights = '未确认开放许可，仅内部研究参考；不默认允许公开贴图或再分发'
}
[System.IO.File]::WriteAllText((Join-Path $refRoot 'qa-audit.json'), ($report | ConvertTo-Json -Depth 12), [System.Text.UTF8Encoding]::new($false))
$report | Select-Object audited_at_local,pages_verified,images_verified,decoded_images,gallery_local_image_links,passed | ConvertTo-Json
