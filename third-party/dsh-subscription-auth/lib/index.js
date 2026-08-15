import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { chatgptChannel } from "./channels/chatgpt.js";
import { claudeChannel } from "./channels/claude.js";
import { grokChannel } from "./channels/grok.js";
import { kimiChannel } from "./channels/kimi.js";
import { installProjectionGuard } from "./projection-guard.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
async function installProxyAgent() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!proxy)
    return;
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent);
  } catch {}
}
installProxyAgent();
export const name = "dsh-subscription-auth";
export const inject = ["llm"];
const channelNamespace = (id) => settingsNamespace(`subscription-auth-${id}`);
export const CHANNELS = [
  chatgptChannel,
  claudeChannel,
  grokChannel,
  kimiChannel
];
function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    console.log(line);
    const dir = join(os.homedir(), ".dsh", "tmp");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "subscription-auth.log"), line + `
`);
  } catch {}
}
const catalogModel = z.object({
  id: z.string().required(),
  name: z.string().required(),
  contextWindow: z.number()
});
function makeConfigSchema(def) {
  return z.object({
    apiBaseURL: z.string().default(def.defaultApiBaseURL),
    redirectPort: z.number().default(def.defaultRedirectPort),
    models: z.array(catalogModel),
    defaultContextWindow: z.number().default(def.defaultContextWindow),
    maxTokens: z.number().default(def.defaultMaxTokens),
    discoveredModels: z.array(catalogModel)
  });
}
function resolveOptions(raw, discovered, def) {
  const source = raw.models !== undefined && raw.models.length > 0 ? raw.models : raw.discoveredModels !== undefined && raw.discoveredModels.length > 0 ? raw.discoveredModels : discovered !== undefined && discovered.length > 0 ? discovered : def.defaultModels;
  const models = source.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    ...m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}
  }));
  return {
    apiBaseURL: raw.apiBaseURL ?? def.defaultApiBaseURL,
    redirectPort: raw.redirectPort ?? def.defaultRedirectPort,
    models,
    defaultContextWindow: raw.defaultContextWindow ?? def.defaultContextWindow,
    maxTokens: raw.maxTokens ?? def.defaultMaxTokens
  };
}
export function apply(ctx, config = {}) {
  installProjectionGuard(ctx, logLine);
  const states = new Map;
  const credentials = () => ctx.get("credentials");
  const gateStopped = new Map;
  for (const def of CHANNELS) {
    const st = {
      def,
      runtime: undefined,
      channelCtx: undefined
    };
    states.set(def.id, st);
    const ref = credentialRef(def.tokenRefName);
    const readToken = async () => {
      const c = credentials();
      if (!c)
        return;
      const hit = await c.resolve(ref);
      if (!hit)
        return;
      try {
        const t = JSON.parse(hit.value);
        if (t && typeof t.refresh === "string" && typeof t.access === "string")
          return t;
      } catch {}
      return;
    };
    const writeToken = async (token) => {
      const c = credentials();
      if (c)
        await c.set(ref, JSON.stringify(token));
    };
    const clearToken = async () => {
      const c = credentials();
      if (c)
        await c.unset(ref);
    };
    const getRaw = () => {
      const s = st.settingsScope;
      return s !== undefined ? s.get() : {};
    };
    const channelCtx = {
      id: def.id,
      tokenRefName: def.tokenRefName,
      options: () => resolveOptions(getRaw(), st.discovered?.models, def),
      getConfig: getRaw,
      updateConfig: async (patch) => {
        const s = st.settingsScope;
        if (s !== undefined)
          await s.update(patch);
      },
      credentials,
      log: logLine,
      notifyModelsChanged: () => {
        try {
          st.replaceRegistration?.();
        } catch (error) {
          logLine(`模型列表刷新通知失败: ${error?.message ?? error}`);
        }
      },
      readToken,
      writeToken,
      clearToken,
      afterLogin: () => {
        discoverAndStore(st);
      }
    };
    st.channelCtx = channelCtx;
    st.runtime = def.create(channelCtx);
  }
  async function discoverAndStore(st) {
    const token = await st.channelCtx.readToken();
    if (!token || token.expires - Date.now() < 60000)
      return;
    const found = await st.runtime.discoverModels();
    if (found.length > 0) {
      st.discovered = { models: found, at: Date.now() };
      if (st.settingsScope !== undefined) {
        try {
          await st.settingsScope.update({ discoveredModels: found });
        } catch (error) {
          logLine(`模型列表持久化失败: ${error?.message ?? error}`);
        }
      }
      st.channelCtx.notifyModelsChanged();
      logLine(`[${st.def.id}] 已发现 ${found.length} 个订阅模型：${found.map((m) => m.id).join(", ")}`);
    }
  }
  async function logoutChannel(st) {
    await st.runtime.logout();
    st.discovered = undefined;
    st.syncRegistration?.(false);
    if (st.settingsScope !== undefined) {
      try {
        await st.settingsScope.update({ discoveredModels: [] });
      } catch (error) {
        logLine(`清除模型列表失败: ${error?.message ?? error}`);
      }
    }
    logLine(`[${st.def.id}] 已注销，清除令牌与模型列表`);
  }
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.effect(() => {
      const created = [];
      for (const def of CHANNELS) {
        const base = config[def.id];
        const scope = settingsCtx.settings.register(channelNamespace(def.id), makeConfigSchema(def), { base: base !== undefined && typeof base === "object" ? base : {} });
        created.push({ id: def.id, scope });
      }
      for (const { id, scope } of created) {
        const st = states.get(id);
        if (st !== undefined)
          st.settingsScope = scope;
      }
      for (const { id } of created) {
        const st = states.get(id);
        if (st === undefined)
          continue;
        (async () => {
          if (gateStopped.get(id) === true)
            return;
          const token = await st.channelCtx.readToken();
          if (gateStopped.get(id) === true || token === undefined)
            return;
          st.syncRegistration?.(true);
          if (st.discovered === undefined)
            discoverAndStore(st);
        })();
      }
      return () => {
        for (const { id } of created) {
          const st = states.get(id);
          if (st !== undefined)
            st.settingsScope = undefined;
        }
      };
    }, "subscription-auth.settings");
  });
  for (const def of CHANNELS) {
    const st = states.get(def.id);
    const entry = {
      provider: def.id,
      displayName: def.displayName,
      settingsNs: channelNamespace(def.id),
      settingsPath: []
    };
    const providersHandle = ctx.llm.registerConfigurableProviders([entry]);
    const adapterHandle = ctx.llm.registerAdapter([def.id], st.runtime.adapter);
    let registered = true;
    const sync = (next, announce) => {
      if (next === registered && !announce)
        return;
      providersHandle.replace(next ? [entry] : []);
      adapterHandle.replace(next ? [def.id] : []);
      registered = next;
    };
    st.syncRegistration = (next) => sync(next, false);
    st.replaceRegistration = () => sync(true, true);
    let attempts = 0;
    const gate = async () => {
      if (gateStopped.get(def.id) === true || attempts >= 200)
        return;
      attempts += 1;
      if (credentials() === undefined) {
        setTimeout(() => {
          gate();
        }, 300);
        return;
      }
      const token = await st.channelCtx.readToken();
      if (gateStopped.get(def.id) === true)
        return;
      const loggedIn = token !== undefined;
      sync(loggedIn, false);
      logLine(`[${def.id}] 登录状态: ${loggedIn ? "已登录，注册 provider" : "未登录，不注册 provider"}`);
      if (loggedIn)
        discoverAndStore(st);
    };
    gate();
  }
  ctx.effect(() => () => {
    for (const def of CHANNELS)
      gateStopped.set(def.id, true);
    for (const st of states.values())
      st.runtime.cancelLogin();
  }, "subscription-auth.auth-cleanup");
  ctx.inject(["webServer"], (webCtx) => {
    const webServer = webCtx.webServer;
    const collectBody = async (req) => {
      const chunks = [];
      for await (const chunk of req)
        chunks.push(chunk);
      return Buffer.concat(chunks).toString("utf8");
    };
    const send = (res, code, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(body);
    };
    const channelCard = async (st) => {
      const state = await st.runtime.authStatus();
      if (state.status === "logged-in" && st.discovered === undefined) {
        discoverAndStore(st);
      }
      const models = resolveOptions(st.channelCtx.getConfig(), st.discovered?.models, st.def).models.map((m) => m.id);
      return {
        id: st.def.id,
        name: st.def.name,
        description: st.def.description,
        models,
        ...st.discovered !== undefined ? { discoveredAt: st.discovered.at } : {},
        ...state
      };
    };
    webCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/subscription-auth/providers",
      handler: async (req, res) => {
        try {
          if (req.method !== "GET") {
            send(res, 405, { error: "method not allowed" });
            return;
          }
          const providers = [];
          for (const def of CHANNELS) {
            providers.push(await channelCard(states.get(def.id)));
          }
          send(res, 200, { providers });
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }), "subscription-auth.providers-route");
    webCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/subscription-auth/auth/login",
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") {
            send(res, 405, { error: "method not allowed" });
            return;
          }
          let body = {};
          try {
            body = JSON.parse(await collectBody(req) || "{}");
          } catch {}
          const id = typeof body.provider === "string" ? body.provider : "";
          const st = states.get(id);
          if (st === undefined) {
            send(res, 404, { error: `unknown provider: ${id}` });
            return;
          }
          const result = await st.runtime.login();
          send(res, 200, result);
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }), "subscription-auth.login-route");
    webCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/subscription-auth/auth/logout",
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") {
            send(res, 405, { error: "method not allowed" });
            return;
          }
          let body = {};
          try {
            body = JSON.parse(await collectBody(req) || "{}");
          } catch {}
          const id = typeof body.provider === "string" ? body.provider : "";
          const st = states.get(id);
          if (st === undefined) {
            send(res, 404, { error: `unknown provider: ${id}` });
            return;
          }
          await logoutChannel(st);
          send(res, 200, { ok: true });
        } catch (error) {
          send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }), "subscription-auth.logout-route");
  });
}
