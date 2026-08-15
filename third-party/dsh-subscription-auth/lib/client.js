/**
 * dsh-subscription-auth browser half: a "订阅服务" page in the settings center
 * that lists subscription-backed model providers (ChatGPT Plus/Pro OAuth) with
 * login/logout buttons. The page talks to the plugin's host half through the
 * package-private JSON routes /subscription-auth/providers,
 * /subscription-auth/auth/login and /subscription-auth/auth/logout.
 * @module dsh-subscription-auth/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-subscription-auth',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    const PROVIDERS_PATH = '/subscription-auth/providers';
    const LOGIN_PATH = '/subscription-auth/auth/login';
    const LOGOUT_PATH = '/subscription-auth/auth/logout';
    const POLL_INTERVAL_MS = 2000;
    const POLL_MAX_TRIES = 300; // 10 分钟

    const cardStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '16px',
      marginBottom: '12px',
      background: 'var(--dsw-alias-bg-surface, rgba(127,127,127,.06))',
      border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.25))',
      borderRadius: '12px',
      maxWidth: '560px',
    };
    const titleRowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap', // 标题行过窄时允许换行，按钮不会被挤出卡片
    };
    const titleStyle = {
      margin: 0,
      fontSize: '15px',
      lineHeight: '22px',
      fontWeight: '600',
      color: 'var(--dsw-alias-label-primary, inherit)',
      minWidth: 0,
    };
    const descStyle = {
      margin: 0,
      fontSize: '13px',
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,.9))',
    };
    const metaStyle = {
      margin: 0,
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };
    const badgeStyle = (status) => ({
      flexShrink: 0,
      padding: '2px 10px',
      borderRadius: '999px',
      fontSize: '12px',
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      color: status === 'logged-in'
        ? 'var(--dsw-alias-state-success-primary, #2e9e5b)'
        : status === 'pending'
          ? 'var(--dsw-alias-interactive-accent, #4f6ef2)'
          : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
      background: status === 'logged-in'
        ? 'rgba(46,158,91,.12)'
        : status === 'pending'
          ? 'rgba(79,110,242,.12)'
          : 'rgba(127,127,127,.12)',
    });
    const buttonStyle = {
      cursor: 'pointer',
      height: '30px',
      padding: '0 14px',
      border: 'none',
      borderRadius: '8px',
      fontFamily: 'inherit',
      fontSize: '13px',
      fontWeight: '500',
      whiteSpace: 'nowrap',
    };
    const primaryButton = {
      ...buttonStyle,
      color: 'var(--dsw-alias-label-on-accent, #fff)',
      background: 'var(--dsw-alias-interactive-accent, #4f6ef2)',
    };
    const dangerButton = {
      ...buttonStyle,
      color: 'var(--dsw-alias-state-error-primary, #d64545)',
      background: 'rgba(214,69,69,.1)',
      border: '1px solid rgba(214,69,69,.35)',
    };
    const disabledButton = {
      ...buttonStyle,
      cursor: 'default',
      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
      background: 'rgba(127,127,127,.12)',
    };
    const feedbackStyle = {
      margin: '0 0 8px',
      color: 'var(--dsw-alias-state-error-primary, #d64545)',
      fontSize: '12px',
      lineHeight: '18px',
    };
    const hintStyle = {
      margin: '0 0 16px',
      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
      fontSize: '12px',
      lineHeight: '18px',
      maxWidth: '560px',
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function statusText(provider) {
      // 徽标只放简短状态；账号/有效期在卡片的 meta 行展示。
      if (provider.status === 'logged-in') return '已登录';
      if (provider.status === 'pending') return '登录中…';
      return '未登录';
    }

    function metaText(provider) {
      if (provider.status !== 'logged-in') return null;
      const parts = [];
      if (provider.account) {
        const account = String(provider.account);
        // uuid 太长，截断显示
        parts.push(account.length > 20 ? account.slice(0, 8) + '…' : account);
      }
      if (provider.expiresAt) {
        parts.push('有效期至 ' + new Date(provider.expiresAt).toLocaleString());
      }
      return parts.join(' · ');
    }

    /**
     * 可用模型折叠列表：默认收起，点击标题展开/收起。
     */
    function ModelList({ models }) {
      const [open, setOpen] = React.useState(false);
      if (!Array.isArray(models) || models.length === 0) return null;
      return React.createElement('div', { style: { marginTop: '2px' } },
        React.createElement('button', {
          type: 'button',
          style: {
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: '0',
            fontFamily: 'inherit',
            fontSize: '12px',
            lineHeight: '20px',
            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          },
          onClick: () => setOpen(!open),
        },
          React.createElement('span', {
            style: {
              display: 'inline-block',
              fontSize: '10px',
              transition: 'transform .15s ease',
              transform: open ? 'rotate(90deg)' : 'none',
            },
          }, '▶'),
          `可用模型（${models.length}）`,
        ),
        open && React.createElement('ul', {
          style: {
            margin: '8px 0 0',
            padding: '0 0 0 4px',
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          },
        }, models.map((modelId) => React.createElement('li', {
          key: modelId,
          style: {
            fontSize: '12px',
            lineHeight: '18px',
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
            color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,.9))',
          },
        }, modelId))),
      );
    }

    function SubscriptionSection() {
      const [phase, setPhase] = React.useState('loading'); // loading | ready | error
      const [providers, setProviders] = React.useState([]);
      const [busyId, setBusyId] = React.useState(null); // 正在操作的 provider id
      // 进行中的授权会话，按 provider id 隔离：{ [id]: { url, userCode } }
      const [authPending, setAuthPending] = React.useState({});
      const [error, setError] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const res = await fetch(PROVIDERS_PATH);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          setProviders(Array.isArray(data.providers) ? data.providers : []);
          setPhase('ready');
          setError(null);
        } catch (e) {
          setPhase('error');
          setError('读取提供商列表失败：' + (e && e.message ? e.message : String(e)));
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const login = async (provider) => {
        setBusyId(provider.id);
        setError(null);
        try {
          const res = await fetch(LOGIN_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: provider.id }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (data.status === 'logged-in') {
            await load();
            return;
          }
          // 授权 URL：Host 已在默认浏览器打开；页面同时给出可点击链接，
          // 覆盖"默认浏览器没起来 / 远程场景"的情况。设备流（Grok/Kimi）还要展示授权码。
          setAuthPending((prev) => ({ ...prev, [provider.id]: { url: data.url || null, userCode: data.userCode || null } }));
          // 轮询直到授权完成或超时
          for (let i = 0; i < POLL_MAX_TRIES; i += 1) {
            await sleep(POLL_INTERVAL_MS);
            const statusRes = await fetch(PROVIDERS_PATH);
            if (!statusRes.ok) continue;
            const statusData = await statusRes.json();
            const updated = (statusData.providers || []).find((p) => p.id === provider.id);
            if (updated && updated.status !== 'pending') {
              await load();
              setAuthPending((prev) => { const next = { ...prev }; delete next[provider.id]; return next; });
              return;
            }
          }
          await load();
          setAuthPending((prev) => { const next = { ...prev }; delete next[provider.id]; return next; });
        } catch (e) {
          setError('登录失败：' + (e && e.message ? e.message : String(e)));
          setBusyId(null);
        }
      };

      const logout = async (provider) => {
        setBusyId(provider.id);
        setError(null);
        try {
          const res = await fetch(LOGOUT_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: provider.id }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          await load();
        } catch (e) {
          setError('注销失败：' + (e && e.message ? e.message : String(e)));
        } finally {
          setBusyId(null);
        }
      };

      if (phase === 'loading') {
        return React.createElement('p', { style: hintStyle }, '加载中…');
      }
      if (phase === 'error') {
        return React.createElement('p', { style: feedbackStyle }, error);
      }

      return React.createElement('div', null,
        React.createElement('p', { style: hintStyle },
          '用订阅会员额度访问模型，无需 API key。ChatGPT / Claude 通过浏览器 OAuth 登录，' +
          'Grok / Kimi 通过设备码授权（打开链接后输入代码）。令牌由 dsh 的凭据服务保管并在到期前自动续期。'),
        error !== null && React.createElement('p', { style: feedbackStyle }, error),
        providers.map((provider) => {
          const busy = busyId === provider.id;
          const loggedIn = provider.status === 'logged-in';
          const pending = authPending[provider.id];
          return React.createElement('div', { key: provider.id, style: cardStyle },
            React.createElement('div', { style: titleRowStyle },
              React.createElement('h3', { style: titleStyle }, provider.name),
              // 右上：状态徽标 + 已登录时的注销按钮
              React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
              },
                React.createElement('span', { style: badgeStyle(provider.status) }, statusText(provider)),
                loggedIn && React.createElement('button', {
                  style: busy ? disabledButton : dangerButton,
                  disabled: busy,
                  onClick: () => logout(provider),
                }, busy ? '处理中…' : '注销'),
              ),
            ),
            React.createElement('p', { style: descStyle }, provider.description),
            metaText(provider) !== null &&
              React.createElement('p', { style: metaStyle, title: metaText(provider) }, metaText(provider)),
            React.createElement(ModelList, { models: provider.models }),
            // 未登录时底部放登录按钮（已登录的注销按钮在右上角）
            !loggedIn &&
              React.createElement('div', null,
                React.createElement('button', {
                  style: busy ? disabledButton : primaryButton,
                  disabled: busy,
                  onClick: () => login(provider),
                }, busy ? '处理中…' : '登录'),
              ),
            pending &&
              React.createElement('div', null,
                React.createElement('p', { style: hintStyle },
                  pending.userCode
                    ? '请在浏览器打开下面的链接，并输入设备授权码：'
                    : '如果浏览器没有自动打开授权页，请点击：'),
                pending.url &&
                  React.createElement('button', {
                    type: 'button',
                    style: primaryButton,
                    onClick: () => { try { window.open(pending.url, '_blank', 'noopener,noreferrer'); } catch (e) { /* 弹窗被拦截时依赖下方 URL 文本 */ } },
                  }, '打开授权页'),
                pending.url &&
                  React.createElement('p', {
                    style: {
                      ...hintStyle,
                      margin: '6px 0 0',
                      wordBreak: 'break-all',
                      userSelect: 'text',
                      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                    },
                  }, pending.url),
                pending.userCode &&
                  React.createElement('p', {
                    style: {
                      ...hintStyle,
                      margin: '8px 0 0',
                      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                      fontSize: '16px',
                      fontWeight: '600',
                      color: 'var(--dsw-alias-label-primary, inherit)',
                    },
                  }, '授权码：' + pending.userCode),
              ),
          );
        }),
        providers.length === 0 &&
          React.createElement('p', { style: hintStyle }, '暂无可用订阅提供商。'),
      );
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'subscription-auth',
        order: 40,
        label: () => '订阅服务',
      }, SubscriptionSection));
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
