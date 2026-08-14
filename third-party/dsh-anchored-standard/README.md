# dsh-anchored-standard

[中文说明](./README.zh-CN.md)

An experimental DeepSeek Harness agent preset that bootstraps the first model
request with a Minimal-aligned prompt and two tools, then exposes the complete
Standard tool catalog after the first durable tool call.

This is a community project. It is not an official DeepSeek preset and is not
affiliated with or endorsed by DeepSeek.

## Why

DeepSeek V4 Pro conditions strongly on the API-visible tool catalog. In the
Project2 evaluation, Standard and PTC produced scores of 91 and 92, while the
official Minimal preset produced 99 and 96. Permanently staying on Minimal,
however, gives up the Standard preset's broader tool set.

Anchored Standard separates initial trajectory selection from later tool use:

1. Keep the Minimal complete system prompt.
2. Expose only the platform shell plus `read` on the first model request.
3. After the session records its first `tool/call`, expose all Standard tools.
4. Derive the phase from durable session events so resume and reload preserve it.

On Windows the bootstrap catalog is `pwsh/read`; on Linux it is `bash/read`.

## Results

Project2 V4.1b, DeepSeek V4 Pro, `reasoningEffort=max`, Windows native:

| Run | Ability | Reasoning blocks | `we` | `let's` | `let me` | Visible replies |
|---|---:|---:|---:|---:|---:|---:|
| r1 | 98 | 193 | 179 | 88 | 1 | 1 |
| r2 | 99 | 162 | 165 | 98 | 0 | 1 |

Both runs emitted exactly two tool-catalog snapshots: two bootstrap tools,
followed by the 25-tool Standard catalog. The result is reproducible evidence
for this task, not a claim of universal improvement across models or workloads.

Full methodology and aggregate evidence are in
[`xiaobright/modeltest`](https://github.com/xiaobright/modeltest).

## Compatibility

Developed and tested against:

- DeepSeek Harness `0.1.0-rc.5`
- repository commit [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- Node.js 24 on Windows

DeepSeek Harness is currently a developer preview and explicitly permits
breaking changes. This preset is a full snapshot of the Standard composition,
so review upstream changes before using it with a newer release.

## Install

Clone this repository, then copy the entire `preset` directory into the user
preset root under the id `anchored-standard`.

PowerShell:

```powershell
$target = Join-Path $env:USERPROFILE '.dsh\.agent-presets\anchored-standard'
if (Test-Path -LiteralPath $target) { throw "Preset already exists: $target" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -Recurse -LiteralPath '.\preset' -Destination $target
```

Linux/macOS:

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$dsh_home/.agent-presets/anchored-standard"
cp -R preset "$dsh_home/.agent-presets/anchored-standard"
```

Fully restart DeepSeek Harness, create a blank session, and select
**Anchored Standard (experimental)**. Do not switch an active session from a
different preset.

## Verify

Export the session JSONL and inspect `request/header` events:

- the first header should contain only `pwsh/read` or `bash/read`;
- after the first tool call, the next changed header should contain the full
  Standard catalog;
- subsequent requests should keep that full catalog.

Run the local zero-dependency tests with:

```sh
npm test
```

## Important behavior

- If the first model response makes no tool call, promotion does not occur.
- A failed tool execution still promotes the session because the durable
  `tool/call` already exists.
- The tool catalog changes once, so request-prefix cache continuity also changes
  once between the first and second model requests.
- The preset has the same trust level as shell access. Review its files before
  installation.
- The plugin performs no network requests and adds no telemetry.

## Official ecosystem guidance

DeepSeek currently asks community plugin authors to publish plugins in their own
GitHub projects and add the [`dsh-plugin`](https://github.com/topics/dsh-plugin)
repository topic for discovery. The official repository does not currently
accept external pull requests and does not mandate a community repository
template. See the official
[`CONTRIBUTING.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.md).

## License

MIT. `preset/agent.cordis.yml` is derived from the DeepSeek Harness Standard
preset; the original DeepSeek copyright and MIT notice are retained in
[`NOTICE`](./NOTICE).
