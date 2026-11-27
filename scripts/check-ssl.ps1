param(
    [string[]]$Targets = @('wonvy.cn', 'https://license.wonvy.cn/'),
    [int]$WarningDays = 7,
    [int]$TimeoutSeconds = 10
)

if (-not [string]::IsNullOrWhiteSpace($env:SHIBA_PARAM_TARGETS)) {
    $parsedTargets = @(
        $env:SHIBA_PARAM_TARGETS -split '[,;\r\n]+' |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($parsedTargets.Count -gt 0) {
        $Targets = $parsedTargets
    }
}

$parsedWarning = 0
if (-not [string]::IsNullOrWhiteSpace($env:SHIBA_PARAM_WARNING_DAYS) -and
    [int]::TryParse($env:SHIBA_PARAM_WARNING_DAYS.Trim(), [ref]$parsedWarning)) {
    $WarningDays = $parsedWarning
}

function Resolve-TargetEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Target
    )

    $trimmed = $Target.Trim()
    $normalized = if ($trimmed -match '^https?://') {
        $trimmed
    }
    else {
        "https://$trimmed"
    }

    $uri = [System.Uri]::new($normalized)
    $resolvedHost = if ([string]::IsNullOrWhiteSpace($uri.IdnHost)) { $uri.Host } else { $uri.IdnHost }

    return @{
        Raw  = $Target
        Host = $resolvedHost
        Port = $uri.Port
    }
}

function Get-SslCertificateStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Target,
        [int]$TimeoutSeconds = 10
    )

    $endpoint = $null
    $tcpClient = $null
    $sslStream = $null
    $cert = $null

    try {
        $endpoint = Resolve-TargetEndpoint -Target $Target
        $timeoutMs = $TimeoutSeconds * 1000

        $tcpClient = [System.Net.Sockets.TcpClient]::new()
        $connectTask = $tcpClient.ConnectAsync($endpoint.Host, $endpoint.Port)
        if (-not $connectTask.Wait($timeoutMs)) {
            throw [System.TimeoutException]::new("连接 $($endpoint.Host):$($endpoint.Port) 超时（>${TimeoutSeconds}s）")
        }

        $stream = $tcpClient.GetStream()
        $stream.ReadTimeout = $timeoutMs
        $stream.WriteTimeout = $timeoutMs

        $cbState = @{ Errors = [System.Net.Security.SslPolicyErrors]::None }
        $validationCallback = {
            param($sender, $certificate, $chain, $sslPolicyErrors)
            $cbState.Errors = $sslPolicyErrors
            return $true
        }.GetNewClosure()

        $sslStream = [System.Net.Security.SslStream]::new($stream, $false, $validationCallback)
        $sslStream.AuthenticateAsClient($endpoint.Host)

        if ($null -eq $sslStream.RemoteCertificate) {
            throw [System.InvalidOperationException]::new("未获取到远端 SSL 证书")
        }

        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($sslStream.RemoteCertificate)
        $remainingDays = ($cert.NotAfter.ToUniversalTime() - [DateTime]::UtcNow).TotalDays

        return [PSCustomObject]@{
            Target        = $endpoint.Raw
            Host          = $endpoint.Host
            Port          = $endpoint.Port
            Success       = $true
            Error         = $null
            Subject       = $cert.Subject
            Issuer        = $cert.Issuer
            NotBefore     = $cert.NotBefore
            NotAfter      = $cert.NotAfter
            RemainingDays = $remainingDays
            PolicyErrors  = $cbState.Errors
        }
    }
    catch {
        $hostName = if ($null -ne $endpoint) { $endpoint.Host } else { $Target }
        $portNum = if ($null -ne $endpoint) { $endpoint.Port } else { 443 }
        $errMsg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }

        return [PSCustomObject]@{
            Target        = $Target
            Host          = $hostName
            Port          = $portNum
            Success       = $false
            Error         = $errMsg
            Subject       = $null
            Issuer        = $null
            NotBefore     = $null
            NotAfter      = $null
            RemainingDays = $null
            PolicyErrors  = $null
        }
    }
    finally {
        if ($null -ne $cert) { $cert.Dispose() }
        if ($null -ne $sslStream) { $sslStream.Dispose() }
        if ($null -ne $tcpClient) { $tcpClient.Dispose() }
    }
}

$hasAlert = $false
$hasExpiring = $false
$items = @()

foreach ($target in $Targets) {
    $result = Get-SslCertificateStatus -Target $target -TimeoutSeconds $TimeoutSeconds

    if (-not $result.Success) {
        $hasAlert = $true
        $items += @{
            key     = $result.Host
            value   = "获取失败"
            tone    = "error"
            tooltip = @{
                title = "$($result.Host) 检查失败"
                items = @(
                    @{ label = "目标"; value = $result.Target }
                    @{ label = "错误"; value = $result.Error }
                )
            }
        }
        continue
    }

    $daysFloor = [int][math]::Floor($result.RemainingDays)
    $remainPrecise = "$($result.RemainingDays.ToString('F1')) 天"
    $policyText = if ($result.PolicyErrors -eq [System.Net.Security.SslPolicyErrors]::None) {
        "通过"
    }
    else {
        "$($result.PolicyErrors)"
    }

    if ($result.RemainingDays -le 0) {
        $hasAlert = $true
        $hasExpiring = $true
        $valueText = "已过期"
        $tone = "error"
        $detailStatus = "已过期"
    }
    elseif ($result.RemainingDays -le $WarningDays) {
        $hasAlert = $true
        $hasExpiring = $true
        $valueText = if ($daysFloor -lt 1) { "不足 1 天" } else { "仅剩 $daysFloor 天" }
        $tone = "error"
        $detailStatus = "即将到期（<= $WarningDays 天）"
    }
    elseif ($result.PolicyErrors -ne [System.Net.Security.SslPolicyErrors]::None) {
        $hasAlert = $true
        $valueText = "校验异常"
        $tone = "error"
        $detailStatus = "证书校验异常"
    }
    else {
        $valueText = "剩余 $daysFloor 天"
        $tone = "ok"
        $detailStatus = "正常"
    }

    $items += @{
        key     = $result.Host
        value   = $valueText
        tone    = $tone
        tooltip = @{
            title = "$($result.Host) SSL 证书详情"
            items = @(
                @{ label = "状态"; value = $detailStatus }
                @{ label = "主机"; value = "$($result.Host):$($result.Port)" }
                @{ label = "颁发对象"; value = $result.Subject }
                @{ label = "颁发机构"; value = $result.Issuer }
                @{ label = "生效时间"; value = $result.NotBefore.ToString('yyyy-MM-dd HH:mm:ss') }
                @{ label = "过期时间"; value = $result.NotAfter.ToString('yyyy-MM-dd HH:mm:ss') }
                @{ label = "剩余时间"; value = $remainPrecise }
                @{ label = "证书校验"; value = $policyText }
            )
        }
    }
}

$payload = @{
    schema = "shibaplan-info/v1"
    status = if ($hasAlert) { "error" } else { "ok" }
    view   = "kv"
    items  = @($items)
}

if ($hasAlert) {
    $payload.badge = if ($hasExpiring) { "即将到期" } else { "异常" }
}

$payload | ConvertTo-Json -Depth 6 -Compress | Write-Output
exit 0
