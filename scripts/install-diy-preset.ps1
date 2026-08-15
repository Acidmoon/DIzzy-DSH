#requires -Version 5.1
<#
安装 DIY 模式预设(Dizzy-DSH 自有)。

⚠️ 本文件必须带 UTF-8 BOM 保存:Windows PowerShell 5.1 按 BOM 识别编码,
无 BOM 时中文按 ANSI 解读会直接解析失败(编辑器存盘注意保留 BOM)。

agent preset 不走 dsh plugin add 机制,安装 = 把仓库 presets/diy/ 复制到
用户预设根 ~/.dsh/.agent-presets/diy,并从本机 DSH 安装目录同步两份官方
创作技能快照(cordis-plugin-development / editing-cordis-compositions)
到预设的 skills/ 下 —— 快照随部署版本走,不随仓库分发。

幂等行为:
  - 目标已存在且文件齐全 → 跳过仓库文件(官方技能快照仍会刷新);
  - 目标存在但缺文件 → 只补缺失文件;
  - -Force → 全部覆盖为仓库快照版。

用法:  powershell -ExecutionPolicy Bypass -File scripts\install-diy-preset.ps1 [-Force]
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$PresetRoot = (Join-Path $env:USERPROFILE '.dsh\.agent-presets')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$snapshot = Join-Path $repoRoot 'presets\diy'
$id = 'diy'
$target = Join-Path $PresetRoot $id

# 仓库侧必须齐全的文件;官方技能快照不在其列(来自本机部署,见下)
$files = @('agent.cordis.yml', 'preset.yml', 'README.md', 'skills\dizzy-diy\SKILL.md')

if (-not (Test-Path -LiteralPath (Join-Path $snapshot 'agent.cordis.yml'))) {
  throw "仓库快照不完整:找不到 $snapshot\agent.cordis.yml"
}

$existing = @()
if (Test-Path -LiteralPath $target) {
  $existing = $files | Where-Object { Test-Path -LiteralPath (Join-Path $target $_) }
}

if (-not $Force -and $existing.Count -eq $files.Count) {
  Write-Host "已安装且文件齐全,跳过仓库文件:$target(用 -Force 覆盖为快照版)"
} else {
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
}

# ── 同步官方创作技能快照(始终刷新,跟随本机部署版本)─────────────────────

function Find-DshInstall {
  $candidates = @()
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) {
    # dsh 启动器 shim 位于 npm 全局 bin,其同级 node_modules\@deepseek-ai\dsh 即安装根
    $candidates += Join-Path (Split-Path -Parent $cmd.Source) 'node_modules\@deepseek-ai\dsh'
  }
  try {
    $npmRoot = (npm root -g 2>$null)
    if ($LASTEXITCODE -eq 0 -and $npmRoot) {
      $candidates += Join-Path $npmRoot.Trim() '@deepseek-ai\dsh'
    }
  } catch {
    # npm 不在 PATH 时无候选可追加;仅靠 dsh shim 探测
  }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c 'config\agent-presets\cordis\skills\cordis-plugin-development\SKILL.md')) {
      return $c
    }
  }
  return $null
}

$officialSkills = @('cordis-plugin-development', 'editing-cordis-compositions')
$dshInstall = Find-DshInstall
if ($dshInstall) {
  foreach ($s in $officialSkills) {
    $src = Join-Path $dshInstall "config\agent-presets\cordis\skills\$s"
    if (Test-Path -LiteralPath $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $target 'skills') -Recurse -Force
    }
  }
  Write-Host "已同步官方技能快照($($officialSkills -join ' / '))← $dshInstall"
} else {
  Write-Warning '未找到本机 DSH 安装目录,跳过官方技能快照同步(dizzy-diy 主技能不受影响)。'
}

Write-Host '重启 dsh web 后,新会话预设下拉选择「DIY 模式」。'
