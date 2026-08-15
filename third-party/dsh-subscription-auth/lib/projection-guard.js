const USAGE_KEYS = new Set(["tokenUsage", "contextPressure"]);
const COUNT_FIELDS = [
  "uncachedInputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "pressureTokens",
  "projectedTokens"
];
function clampCount(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n))
    return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(n)));
}
function clampView(value) {
  if (value === null || typeof value !== "object")
    return value;
  const input = value;
  const output = { ...input };
  for (const field of COUNT_FIELDS) {
    if (field in output && output[field] !== undefined) {
      output[field] = clampCount(output[field]);
    }
  }
  return output;
}
function wrapUsageView(def, log) {
  if (!USAGE_KEYS.has(def.key) || def.__subscriptionUsageClamped)
    return;
  const original = def.view.bind(def);
  def.view = (state) => {
    try {
      return clampView(original(state));
    } catch (error) {
      log(`session projection ${def.key} view failed: ${String(error)}`);
      throw error;
    }
  };
  def.__subscriptionUsageClamped = true;
}
export function installProjectionGuard(ctx, log) {
  ctx.inject(["sessionProjections"], (projCtx) => {
    const registry = projCtx.sessionProjections;
    if (registry === undefined || typeof registry.register !== "function")
      return;
    for (const registration of registry.registrations.values()) {
      wrapUsageView(registration.def, log);
    }
    const originalRegister = registry.register.bind(registry);
    registry.register = (definition) => {
      wrapUsageView(definition, log);
      return originalRegister(definition);
    };
    const injected = projCtx;
    injected.effect?.(() => () => {
      registry.register = originalRegister;
    }, "subscription-auth.projection-guard");
  });
}
