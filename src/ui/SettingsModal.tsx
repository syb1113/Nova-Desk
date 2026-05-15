import {
  Bot,
  Info,
  KeyRound,
  Mail,
  MessageSquare,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  getProviderMeta,
  modelProviders,
  type ApiProtocol,
  type ModelProviderConfig,
  type ModelProviderId,
} from "../config/modelProviders";
import { streamHermesMessage } from "../api/hermes";
import { useWorkspaceStore } from "../state/workspaceStore";

const settingNav = [
  // { label: '通用', icon: Zap },
  { label: "模型", icon: Bot },
  // { label: 'IM 机器人', icon: MessageSquare },
  // { label: '邮箱', icon: Mail },
  // { label: '记忆', icon: KeyRound },
  // { label: '沙箱', icon: Shield },
  { label: "关于", icon: Info },
];

export const SettingsModal = () => {
  const isOpen = useWorkspaceStore((state) => state.isSettingsOpen);
  const setOpen = useWorkspaceStore((state) => state.setSettingsOpen);
  const activeProvider = useWorkspaceStore((state) => state.activeProvider);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const modelConfigs = useWorkspaceStore((state) => state.modelConfigs);
  const setActiveProvider = useWorkspaceStore(
    (state) => state.setActiveProvider,
  );
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const updateModelConfig = useWorkspaceStore(
    (state) => state.updateModelConfig,
  );
  const [selectedProvider, setSelectedProvider] =
    useState<ModelProviderId>(activeProvider);
  const [drafts, setDrafts] = useState(modelConfigs);
  const [testPrompt, setTestPrompt] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const selectedMeta = getProviderMeta(selectedProvider);
  const selectedConfig = drafts[selectedProvider];
  const runtimeConfig = useMemo(
    () => ({
      ...selectedConfig,
      provider: selectedProvider,
    }),
    [selectedConfig, selectedProvider],
  );

  if (!isOpen) {
    return null;
  }

  const updateDraft = (config: Partial<ModelProviderConfig>) => {
    setDrafts((current) => ({
      ...current,
      [selectedProvider]: {
        ...current[selectedProvider],
        ...config,
      },
    }));
  };

  const handleSave = () => {
    for (const provider of modelProviders) {
      updateModelConfig(provider.id, drafts[provider.id]);
    }

    setActiveProvider(selectedProvider);
    setActiveModel(drafts[selectedProvider].activeModel);
    setOpen(false);
  };

  const handleTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const prompt = testPrompt.trim();

    if (!prompt || isTesting) {
      return;
    }

    setIsTesting(true);
    setTestOutput("");

    try {
      await streamHermesMessage(
        prompt,
        null,
        (chunk) => setTestOutput((current) => `${current}${chunk}`),
        runtimeConfig,
      );
    } catch (error) {
      setTestOutput(error instanceof Error ? error.message : "测试连接失败");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm">
      <div className="grid h-[720px] w-[1080px] grid-cols-[240px_330px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/70 bg-[#f8f9fb] shadow-2xl">
        <aside className="border-r border-[#dfe3ea] px-5 py-6">
          <h2 className="mb-5 text-xl font-semibold text-[#151922]">设置</h2>
          <nav className="space-y-1">
            {settingNav.map((item) => {
              const Icon = item.icon;
              const active = item.label === "模型";

              return (
                <button
                  key={item.label}
                  type="button"
                  className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-[#606773] hover:bg-white"
                  }`}
                >
                  <Icon size={17} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="border-r border-[#dfe3ea] px-6 py-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-[#151922]">模型</h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[#d8dde6] bg-white px-3 py-1.5 text-xs hover:border-primary"
              >
                导入
              </button>
              <button
                type="button"
                className="rounded-md border border-[#d8dde6] bg-white px-3 py-1.5 text-xs hover:border-primary"
              >
                导出
              </button>
            </div>
          </div>

          <div className="mb-3 text-sm text-[#444b56]">模型提供商</div>
          <div className="space-y-2">
            {modelProviders.map((provider) => {
              const Icon = provider.icon;
              const config = drafts[provider.id];
              const selected = selectedProvider === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`flex h-14 w-full items-center justify-between rounded-xl border px-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent bg-white hover:border-[#dfe3ea]"
                  }`}
                  onClick={() => setSelectedProvider(provider.id)}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="text-primary" size={22} />
                    <span className="text-sm font-medium text-[#202631]">
                      {provider.name}
                    </span>
                  </span>
                  <span
                    className={`h-5 w-9 rounded-full p-0.5 ${config.enabled ? "bg-primary" : "bg-[#e7ebf0]"}`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition ${config.enabled ? "translate-x-4" : ""}`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex min-w-0 flex-col px-6 py-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#151922]">
                {selectedMeta.name} 提供商设置
              </h3>
              <p className="text-xs text-[#707784]">
                当前聊天使用：{activeProvider}/{activeModel}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              className="rounded-md p-2 text-[#737b88] hover:bg-[#eef1f5]"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm text-[#2f3540]">
                API Key
              </span>
              <input
                type="password"
                className="h-10 w-full rounded-xl border border-[#dfe3ea] bg-[#eef1f5] px-3 text-sm outline-none focus:border-primary"
                placeholder="输入你的 API Key"
                value={selectedConfig.apiKey}
                onChange={(event) =>
                  updateDraft({ apiKey: event.target.value })
                }
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm text-[#2f3540]">
                API Base URL
              </span>
              <input
                className="h-10 w-full rounded-xl border border-[#dfe3ea] bg-[#eef1f5] px-3 text-sm outline-none focus:border-primary"
                value={selectedConfig.baseUrl}
                onChange={(event) =>
                  updateDraft({ baseUrl: event.target.value })
                }
              />
            </label>

            <div>
              <div className="mb-2 text-sm text-[#2f3540]">API 格式</div>
              <div className="flex gap-5 text-sm">
                {(["anthropic", "openai"] as ApiProtocol[]).map((protocol) => (
                  <label
                    key={protocol}
                    className="inline-flex items-center gap-2"
                  >
                    <input
                      type="radio"
                      checked={selectedConfig.protocol === protocol}
                      onChange={() => updateDraft({ protocol })}
                    />
                    {protocol === "anthropic"
                      ? "Anthropic 兼容"
                      : "OpenAI 兼容"}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#2f3540]">可用模型列表</span>
                <button
                  type="button"
                  className="text-xs text-primary"
                  onClick={() =>
                    updateDraft({
                      models: [...selectedConfig.models, "new-model"],
                      activeModel: "new-model",
                    })
                  }
                >
                  添加模型
                </button>
              </div>
              <div className="space-y-2">
                {selectedConfig.models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm ${
                      selectedConfig.activeModel === model
                        ? "border-primary bg-primary/10"
                        : "border-[#dfe3ea] bg-white"
                    }`}
                    onClick={() => updateDraft({ activeModel: model })}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      {model}
                    </span>
                    <span className="rounded-md bg-[#eef1f5] px-2 py-1 text-xs text-[#737b88]">
                      {model}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form
            className="mt-5 min-h-0 flex-1 rounded-xl border border-[#dfe3ea] bg-white p-3"
            onSubmit={handleTest}
          >
            <div className="mb-2 text-sm font-medium text-[#2f3540]">
              测试聊天
            </div>
            <div className="mb-2 h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f5f7fa] p-3 text-xs text-[#4c5563]">
              {testOutput || "保存前也可以在这里用当前配置测试模型响应。"}
            </div>
            <div className="flex gap-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#dfe3ea] px-3 text-sm outline-none focus:border-primary"
                placeholder="输入一句话测试..."
                value={testPrompt}
                onChange={(event) => setTestPrompt(event.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 text-sm text-white disabled:bg-primary/40"
                disabled={isTesting}
              >
                {isTesting ? "测试中" : "发送"}
              </button>
            </div>
          </form>

          <div className="flex justify-end gap-3 border-t border-[#dfe3ea] pt-4">
            <button
              type="button"
              className="rounded-xl border border-[#dfe3ea] bg-white px-5 py-2 text-sm"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary px-5 py-2 text-sm text-white"
              onClick={handleSave}
            >
              保存
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
