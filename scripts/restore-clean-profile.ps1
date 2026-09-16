#!/usr/bin/env pwsh
#requires -Version 5.1
<#
把 DSH 的 web profile 恢复成纯净状态(不含 Dizzy-DSH 合集,也不含任何第三方实验包)。

⚠️ 本文件必须带 UTF-8 BOM 保存:Windows PowerShell 5.1 按 BOM 识别编码,
无 BOM 时中文按 ANSI 解读会直接解析失败。

背景:合集走 profile 的 file: 依赖 + bundle 层。装完起不来时,故障面在这三处:
  1. ~/.dsh/profiles/web/package.json 的 dependencies 与 dsh.profile.bundles
  2. ~/.dsh/profiles/web/cordis.patch.yml(profile patch 层)
  3. ~/.dsh/profiles/web/node_modules/(已安装副本)
所以「恢复纯净」= 把这三处清掉。**凭证、设置、会话日志都不动**。

三级递进,默认只做到第 1 级:
  第 1 级(默认) 只做减法:把合集从 profile 移除,保留同一 profile 与全部数据。
  第 2 级 -RebuildProfile 当前 profile 的配置与 node_modules 已损坏时,用官方
                 模板重建一个同名 profile(先整目录备份),数据目录原样保留。
  第 3 级 -RescueProfile 另起一个纯净救援 profile(不碰原 profile),用来先确认
                 「DSH 本身没问题」,再决定怎么修原 profile。

用法:
  powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1
  powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1 -RebuildProfile
  powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1 -RescueProfile
  powershell -ExecutionPolicy Bypass -File scripts\restore-clean-profile.ps1 -Profile web -Collection dizzy-dsh
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Collection = 'dizzy-dsh',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$RebuildProfile,
  [switch]$RescueProfile
)

$ErrorActionPreference = 'Stop'

# `dsh` 自己按 DSH_HOME 环境变量定位 profile,所以必须把本脚本的 -DshHome
# 同步进环境变量,否则脚本算的是一处、dsh 动的是另一处(踩过)。
$env:DSH_HOME = $DshHome

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }

Write-Step "DSH_HOME: $DshHome"
if (-not (Test-Path -LiteralPath $DshHome)) { throw "找不到 DSH_HOME:$DshHome" }

$profilesDir = Join-Path $DshHome 'profiles'
$profileDir = Join-Path $profilesDir $Profile
$packageJson = Join-Path $profileDir 'package.json'
$profilePatch = Join-Path $profileDir 'cordis.patch.yml'

# ── 第 3 级:另起救援 profile ─────────────────────────────────────────────────
if ($RescueProfile) {
  Write-Step "第 3 级:创建纯净救援 profile 'rescue'(不碰 '$Profile')"
  Write-Note '从官方 web 模板生成 —— 它没有 dependencies、bundles 只有 base + web-app。'
  & dsh --profile rescue --from-default-profile web --dump-config | Out-Null
  Write-Note "救援 profile 已生成:$profilesDir\rescue"
  Write-Note "用它启动(换端口避免和坏 profile 抢 3080):dsh --profile rescue --port 3081"
  Write-Note '能起来 = DSH 内核没问题,故障面在下面两处之一:原 profile 配置 / 已装的插件副本。'
  return
}

# ── 第 2 级:重建当前 profile ─────────────────────────────────────────────────
if ($RebuildProfile) {
  if (-not (Test-Path -LiteralPath $profileDir)) { throw "找不到 profile 目录:$profileDir" }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $DshHome ".backup-restore-$stamp"
  Write-Step "第 2 级:重建 profile '$Profile'(先整目录备份到 $backup)"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  Copy-Item -LiteralPath $profileDir -Destination (Join-Path $backup $Profile) -Recurse -Force
  Write-Note "已备份:$backup\$Profile"
  Remove-Item -LiteralPath $profileDir -Recurse -Force

  # ⚠️ 内置 profile 名(web)不能作为 --from-default-profile 的目标 —— dsh 会报
  #    "profile \"web\" is shipped and cannot be a custom profile target"。
  #    正确姿势是分两步:先把 web 模板"复制"成一个临时自定义 profile(这步只为
  #    确认模板可用),再让内置名自己按模板落盘(不带 --from-default-profile)。
  if ($Profile -in @('web', 'tui', 'headless')) {
    Write-Note "内置 profile 名:$Profile —— 直接按内置模板重新落盘(不带 --from-default-profile)。"
    & dsh --profile $Profile --dump-config | Out-Null
  } else {
    Write-Note "自定义 profile 名:$Profile —— 从 web 模板新建。"
    & dsh --profile $Profile --from-default-profile web --dump-config | Out-Null
  }
  if (-not (Test-Path -LiteralPath (Join-Path $profileDir 'package.json'))) {
    throw "重建失败:$profileDir\package.json 没有生成。回滚:Copy-Item '$backup\$Profile' '$profileDir' -Recurse"
  }
  Write-Note "已按内置 web 模板重建:$profileDir(dependencies 为空、bundles 只有 base + web-app)"
  Write-Note '数据没动:sessions / credentials / settings / skills / storage 都在 $DSH_HOME 顶层,与 profile 目录无关。'
  Write-Note "想回滚:把 $backup\$Profile 复制回 $profileDir。"
  return
}

# ── 第 1 级(默认):只做减法 ──────────────────────────────────────────────────
Write-Step "第 1 级:把 '$Collection' 从 profile '$Profile' 移除"

if (-not (Test-Path -LiteralPath $packageJson)) {
  Write-Note "没有 $packageJson —— profile 可能根本不存在,试试 -RescueProfile 或 -RebuildProfile。"
  return
}

$before = Get-Content -Raw -LiteralPath $packageJson
Write-Note "移除前 dependencies: $(($before | ConvertFrom-Json).dependencies.PSObject.Properties.Name -join ', ')"

# dsh plugin remove 会同时清 dependencies 与 dsh.profile.bundles(已实测)。
& dsh plugin --profile $Profile remove $Collection
Write-Note "已执行 dsh plugin --profile $Profile remove $Collection"

$after = Get-Content -Raw -LiteralPath $packageJson
$afterObj = $after | ConvertFrom-Json
Write-Note "移除后 dependencies: $(($afterObj.dependencies.PSObject.Properties.Name -join ', '))"
Write-Note "移除后 bundles    : $($afterObj.dsh.profile.bundles -join ' | ')"

# profile patch 层:合集的 bundle patch 已随 bundle 一起消失,但用户层里可能还留着
# 针对合集 entry 的 patch 行(disable / config 覆盖)。这些行指向不存在的 entry,
# 只会打 "patch: entry ... not found" 警告 —— 想彻底干净就清空成 []。
if (Test-Path -LiteralPath $profilePatch) {
  $patchText = Get-Content -Raw -LiteralPath $profilePatch
  $meaningful = ($patchText -split "`n" | Where-Object { $_ -match '^\s*-\s' }).Count
  if ($meaningful -gt 0) {
    Write-Note "注意:$profilePatch 里还有 $meaningful 条顶层 patch 行。"
    Write-Note '    它们若指向已移除的 entry,启动时只会打 "not found" 警告,不影响启动。'
    Write-Note '    要彻底干净:把该文件内容替换成一行 []'
  }
}

Write-Step '验证'
& dsh --profile $Profile --dump-config 2>&1 | Select-String -Pattern 'not found|error|invalid' | ForEach-Object { Write-Note "  警告:$($_.Line)" }
$dump = & dsh --profile $Profile --dump-config 2>&1 | Out-String
if ($dump -match [regex]::Escape($Collection)) {
  Write-Note "组合里仍出现 '$Collection' —— 检查 cordis.patch.yml 里的 insert 行。"
} else {
  Write-Note "组合里已无 '$Collection'。"
}
Write-Note '收工:重启 dsh web 即可。'
