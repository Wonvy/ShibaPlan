param(
    [string]$Uid = '',
    [string]$Name = '',
    [int]$TimeoutSeconds = 10
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Uid)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SHIBA_PARAM_UID)) {
        $Uid = $env:SHIBA_PARAM_UID
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:SHIBA_PARAM_VMID)) {
        $Uid = $env:SHIBA_PARAM_VMID
    }
}

if ([string]::IsNullOrWhiteSpace($Name) -and -not [string]::IsNullOrWhiteSpace($env:SHIBA_PARAM_NAME)) {
    $Name = $env:SHIBA_PARAM_NAME
}

$displayName = if ([string]::IsNullOrWhiteSpace($Name)) { 'B站粉丝' } else { $Name.Trim() }

$resolvedUid = ''
if (-not [string]::IsNullOrWhiteSpace($Uid)) {
    $m = [regex]::Match($Uid.Trim(), '(?:space\.bilibili\.com/|^\s*)(\d+)')
    if ($m.Success) {
        $resolvedUid = $m.Groups[1].Value
    }
}

if ([string]::IsNullOrWhiteSpace($resolvedUid)) {
    $warnPayload = @{
        schema = 'shibaplan-info/v1'
        status = 'warn'
        view   = 'metrics'
        items  = @(
            @{
                label   = $displayName
                value   = '未配置 UID'
                trend   = '请设置参数 uid'
                tone    = 'warn'
                tooltip = @{
                    title = '配置说明'
                    items = @(
                        @{ label = '参数名'; value = 'uid' }
                        @{ label = '示例值'; value = '你的 B 站数字 UID 或主页链接' }
                        @{ label = '可选参数'; value = 'name（自定义卡片指标名称）' }
                    )
                }
            }
        )
    }
    $warnPayload | ConvertTo-Json -Depth 6 -Compress | Write-Output
    exit 0
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
}
catch {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$apiUrl = "https://api.bilibili.com/x/relation/stat?vmid=$resolvedUid"
$spaceUrl = "https://space.bilibili.com/$resolvedUid"

try {
    $headers = @{
        'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        'Referer'    = $spaceUrl
    }
    $resp = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec $TimeoutSeconds -Method Get
    if ($null -eq $resp -or $resp.code -ne 0 -or $null -eq $resp.data) {
        $apiMsg = if ($null -ne $resp -and $resp.message) { "$($resp.code): $($resp.message)" } else { '接口返回格式异常' }
        throw [System.InvalidOperationException]::new("B站接口异常 ($apiMsg)")
    }

    $follower = [int64]$resp.data.follower
    $following = [int64]$resp.data.following
}
catch {
    $errMsg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
    $errPayload = @{
        schema = 'shibaplan-info/v1'
        status = 'error'
        badge  = '获取失败'
        view   = 'metrics'
        items  = @(
            @{
                label   = $displayName
                value   = '获取失败'
                tone    = 'error'
                tooltip = @{
                    title = 'B站粉丝获取失败'
                    items = @(
                        @{ label = 'UID'; value = $resolvedUid }
                        @{ label = '错误'; value = $errMsg }
                    )
                }
            }
        )
    }
    $errPayload | ConvertTo-Json -Depth 6 -Compress | Write-Output
    exit 0
}

$baseDir = if (-not [string]::IsNullOrWhiteSpace($env:SHIBA_DATA_DIR)) {
    $env:SHIBA_DATA_DIR.Trim()
}
else {
    Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ShibaPlan'
}

$historyDir = Join-Path $baseDir 'metrics-history'
$historyFile = Join-Path $historyDir "bilibili-$resolvedUid.json"

$historyList = New-Object System.Collections.Generic.List[object]
if (Test-Path -LiteralPath $historyFile) {
    try {
        $rawHist = Get-Content -LiteralPath $historyFile -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($rawHist)) {
            $parsedHist = $rawHist | ConvertFrom-Json
            if ($null -ne $parsedHist) {
                foreach ($entry in @($parsedHist)) {
                    if ($null -ne $entry -and $null -ne $entry.follower) {
                        $historyList.Add([PSCustomObject]@{
                            ts        = [string]$entry.ts
                            date      = [string]$entry.date
                            follower  = [int64]$entry.follower
                            following = if ($null -ne $entry.following) { [int64]$entry.following } else { 0 }
                        })
                    }
                }
            }
        }
    }
    catch {
        # Ignore corrupted history file and rebuild cleanly
    }
}

$now = Get-Date
$nowStr = $now.ToString('yyyy-MM-dd HH:mm:ss')
$today = $now.ToString('yyyy-MM-dd')

$hasPrev = $historyList.Count -gt 0
$prevDelta = [int64]0
$todayDelta = [int64]0
$hasTodayBaseline = $false

if ($hasPrev) {
    $lastEntry = $historyList[$historyList.Count - 1]
    $prevDelta = $follower - [int64]$lastEntry.follower

    $baselineEntry = $null
    for ($i = $historyList.Count - 1; $i -ge 0; $i--) {
        if ($historyList[$i].date -lt $today) {
            $baselineEntry = $historyList[$i]
            break
        }
    }
    if ($null -eq $baselineEntry) {
        for ($i = 0; $i -lt $historyList.Count; $i++) {
            if ($historyList[$i].date -eq $today) {
                $baselineEntry = $historyList[$i]
                break
            }
        }
    }
    if ($null -ne $baselineEntry) {
        $hasTodayBaseline = $true
        $todayDelta = $follower - [int64]$baselineEntry.follower
    }
}

$newEntry = [PSCustomObject]@{
    ts        = $nowStr
    date      = $today
    follower  = $follower
    following = $following
}

$shouldReplaceLast = $false
if ($historyList.Count -gt 0) {
    $last = $historyList[$historyList.Count - 1]
    if ($last.date -eq $today) {
        try {
            $lastDt = [DateTime]::ParseExact($last.ts, 'yyyy-MM-dd HH:mm:ss', $null)
            if (($now - $lastDt).TotalSeconds -lt 60) {
                $shouldReplaceLast = $true
            }
        }
        catch {}
    }
}

if ($shouldReplaceLast) {
    $historyList[$historyList.Count - 1] = $newEntry
}
else {
    $historyList.Add($newEntry)
}

while ($historyList.Count -gt 60) {
    $historyList.RemoveAt(0)
}

try {
    if (-not (Test-Path -LiteralPath $historyDir)) {
        New-Item -ItemType Directory -Path $historyDir -Force | Out-Null
    }
    $histJson = ConvertTo-Json -InputObject @($historyList.ToArray()) -Depth 4 -Compress
    [System.IO.File]::WriteAllText($historyFile, $histJson, [System.Text.UTF8Encoding]::new($false))
}
catch {
    # Non-fatal if history cannot be written
}

$sparkline = @()
if ($historyList.Count -ge 2) {
    $startIdx = [Math]::Max(0, $historyList.Count - 12)
    for ($i = $startIdx; $i -lt $historyList.Count; $i++) {
        $sparkline += [int64]$historyList[$i].follower
    }
}

function Format-SignedDelta([int64]$delta) {
    if ($delta -gt 0) { return "+$($delta.ToString('N0'))" }
    if ($delta -lt 0) { return "$($delta.ToString('N0'))" }
    return '0'
}

if (-not $hasPrev -or -not $hasTodayBaseline) {
    $todayTrendText = '首次记录'
    $todayTooltipText = '首次记录'
    $prevTooltipText = '首次记录'
}
else {
    if ($todayDelta -gt 0) {
        $todayTrendText = "+$($todayDelta.ToString('N0')) 今日"
    }
    elseif ($todayDelta -lt 0) {
        $todayTrendText = "$($todayDelta.ToString('N0')) 今日"
    }
    else {
        $todayTrendText = '今日持平'
    }
    $todayTooltipText = Format-SignedDelta $todayDelta
    $prevTooltipText = Format-SignedDelta $prevDelta
}

$itemTone = if ($hasTodayBaseline -and $todayDelta -lt 0) { 'warn' } else { 'ok' }

$metricItem = @{
    label   = $displayName
    value   = $follower.ToString('N0')
    trend   = $todayTrendText
    tone    = $itemTone
    tooltip = @{
        title = "$displayName (UID: $resolvedUid)"
        items = @(
            @{ label = '当前粉丝'; value = $follower.ToString('N0') }
            @{ label = '关注数'; value = $following.ToString('N0') }
            @{ label = '今日变化'; value = $todayTooltipText }
            @{ label = '较上次'; value = $prevTooltipText }
            @{ label = '主页'; value = $spaceUrl }
            @{ label = '更新时间'; value = $nowStr }
        )
    }
}

if ($sparkline.Count -ge 2) {
    $metricItem.sparkline = @($sparkline)
}

$payload = @{
    schema = 'shibaplan-info/v1'
    status = $itemTone
    view   = 'metrics'
    items  = @($metricItem)
}

$payload | ConvertTo-Json -Depth 6 -Compress | Write-Output
exit 0
