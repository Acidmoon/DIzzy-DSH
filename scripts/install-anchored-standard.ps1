#requires -Version 5.1
<#
安装 Anchored Standard 预设(两阶段工具目录引导,来自 third-party 快照)。

agent preset 不走 dsh plugin add 机制,安装 = 把快照的 preset/ 目录复制到
用户预设根 ~/.dsh/.agent-presets/anchored-standard。

幂等行为:
  - 目标已存在且必备文件齐全 → 跳过;
  - 目标存在但缺文件 → 只补缺失文件;
  - -Force → 全部覆盖为快照版。

用法:  powershell -ExecutionPolicy Bypass -File scripts\install-anchored-standard.ps1 [-Force]
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$PresetRoot = (Join-Path $env:USERPROFILE '.dsh\.agent-presets')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$snapshot = Join-Path $repoRoot 'third-party\dsh-anchored-standard\preset'
$id = 'anchored-standard'
$target = Join-Path $PresetRoot $id

if (-not (Test-Path -LiteralPath (Join-Path $snapshot 'agent.cordis.yml'))) {
  throw "快照不完整:找不到 $snapshot\agent.cordis.yml"
}

$files = @(
  'agent.cordis.yml',
  'preset.yml',
  'tool-bootstrap.mjs',
  'custom-bash.mjs',
  'compaction-epoch.mjs',
  'dev-tool-search.mjs',
  'instruction-hint.mjs',
  'skill-search.mjs'
)
$existing = @()
if (Test-Path -LiteralPath $target) {
  $existing = $files | Where-Object { Test-Path -LiteralPath (Join-Path $target $_) }
}

if (-not $Force -and $existing.Count -eq $files.Count) {
  Write-Host "已安装且文件齐全,跳过:$target(用 -Force 覆盖为快照版)"
  exit 0
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -LiteralPath $snapshot | Copy-Item -Destination $target -Recurse -Force
$missing = $files | Where-Object { -not (Test-Path -LiteralPath (Join-Path $target $_)) }
if ($missing.Count -gt 0) {
  throw "安装后校验失败,缺失:$($missing -join ', ')"
}

$action = if ($existing.Count -eq 0) {
  '已安装'
} elseif ($Force) {
  '已覆盖为快照版'
} else {
  "已补全缺失文件($($files.Count - $existing.Count) 个)"
}
Write-Host "$action → $target"
Write-Host '重启 dsh web 后,新会话预设下拉选择「Anchored Standard (experimental)」。'
Write-Host '快照另含 zero-anchored-standard/ 与 whoami-standard/,需单独复制到 ~/.dsh/.agent-presets/ 才会出现。'
