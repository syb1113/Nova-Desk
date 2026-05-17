import {
  Bot,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Info,
  KeyRound,
  Mail,
  MessageSquare,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  getConfiguredModelOptions,
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
  const setActiveModelSelection = useWorkspaceStore(
    (state) => state.setActiveModelSelection,
  );
  const updateModelConfig = useWorkspaceStore(
    (state) => state.updateModelConfig,
  );
  const [selectedProvider, setSelectedProvider] =
    useState<ModelProviderId>(activeProvider);
  const [drafts, setDrafts] = useState(modelConfigs);
  const [testPrompt, setTestPrompt] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [newModelSupportsVision, setNewModelSupportsVision] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const selectedMeta = getProviderMeta(selectedProvider);
  const selectedConfig = drafts[selectedProvider];
  const selectedProtocol =
    selectedProvider === "mimo" ? "openai" : selectedConfig.protocol;
  const runtimeConfig = useMemo(
    () => ({
      ...selectedConfig,
      provider: selectedProvider,
    }),
    [selectedConfig, selectedProvider],
  );
  const newModelId = useMemo(
    () =>
      newModelName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9._:-]/g, ""),
    [newModelName],
  );
  const canSaveNewModel =
    newModelId.length > 0 &&
    (editingModelId === newModelId ||
      !selectedConfig.models.includes(newModelId));

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedProvider(activeProvider);
    setDrafts(modelConfigs);
  }, [activeProvider, isOpen, modelConfigs]);

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
      updateModelConfig(provider.id, {
        ...drafts[provider.id],
        protocol: provider.id === "mimo" ? "openai" : drafts[provider.id].protocol,
      });
    }

    const configuredOptions = getConfiguredModelOptions(drafts);
    const selectedModel = drafts[selectedProvider].activeModel;
    const selectedOption = configuredOptions.find(
      (option) =>
        option.provider === selectedProvider && option.model === selectedModel,
    );
    const currentOption = configuredOptions.find(
      (option) =>
        option.provider === activeProvider && option.model === activeModel,
    );
    const nextOption = selectedOption ?? currentOption ?? configuredOptions[0];

    if (nextOption) {
      setActiveModelSelection(nextOption.provider, nextOption.model);
    } else {
      setActiveProvider(selectedProvider);
      setActiveModel(selectedModel);
    }

    setOpen(false);
  };

  const openAddModel = () => {
    setEditingModelId(null);
    setNewModelName("");
    setNewModelSupportsVision(false);
    setIsAddModelOpen(true);
  };

  const openEditModel = (model: string) => {
    setEditingModelId(model);
    setNewModelName(model);
    setNewModelSupportsVision(false);
    setIsAddModelOpen(true);
  };

  const closeAddModel = () => {
    setIsAddModelOpen(false);
    setEditingModelId(null);
    setNewModelName("");
    setNewModelSupportsVision(false);
  };

  const handleSaveModel = () => {
    if (!canSaveNewModel) {
      return;
    }

    if (editingModelId) {
      const nextModels = selectedConfig.models.map((model) =>
        model === editingModelId ? newModelId : model,
      );

      updateDraft({
        models: nextModels,
        activeModel:
          selectedConfig.activeModel === editingModelId
            ? newModelId
            : selectedConfig.activeModel,
      });
      closeAddModel();
      return;
    }

    updateDraft({
      models: [...selectedConfig.models, newModelId],
      activeModel: newModelId,
    });
    closeAddModel();
  };

  const handleDeleteModel = (model: string) => {
    const nextModels = selectedConfig.models.filter((item) => item !== model);

    if (nextModels.length === 0) {
      return;
    }

    updateDraft({
      models: nextModels,
      activeModel:
        selectedConfig.activeModel === model
          ? nextModels[0]
          : selectedConfig.activeModel,
    });
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="grid h-[min(720px,calc(100vh-24px))] w-[min(1080px,calc(100vw-24px))] grid-cols-[240px_330px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/70 bg-[#f8f9fb] shadow-2xl">
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
                    role="switch"
                    aria-checked={config.enabled}
                    tabIndex={0}
                    className={`h-5 w-9 rounded-full p-0.5 transition ${config.enabled ? "bg-primary" : "bg-[#e7ebf0]"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDrafts((current) => ({
                        ...current,
                        [provider.id]: {
                          ...current[provider.id],
                          enabled: !current[provider.id].enabled,
                        },
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        setDrafts((current) => ({
                          ...current,
                          [provider.id]: {
                            ...current[provider.id],
                            enabled: !current[provider.id].enabled,
                          },
                        }));
                      }
                    }}
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

        <section className="flex min-h-0 min-w-0 flex-col px-6 py-6">
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

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm text-[#2f3540]">
                API Key
              </span>
              <span className="flex h-10 w-full items-center rounded-xl border border-[#dfe3ea] bg-[#eef1f5] px-3 focus-within:border-primary">
                <input
                  type={showApiKey ? "text" : "password"}
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
                  placeholder="输入你的 API Key"
                  value={selectedConfig.apiKey}
                  onChange={(event) =>
                    updateDraft({ apiKey: event.target.value })
                  }
                />
                <button
                  type="button"
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-[#737b88] hover:bg-white hover:text-primary"
                  onClick={() => setShowApiKey((visible) => !visible)}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
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
                      checked={selectedProtocol === protocol}
                      disabled={selectedProvider === "mimo"}
                      onChange={() => updateDraft({ protocol })}
                    />
                    {protocol === "anthropic"
                      ? "Anthropic 兼容"
                      : "OpenAI 兼容"}
                  </label>
                ))}
              </div>
              {selectedProvider === "mimo" ? (
                <div className="mt-1 text-xs text-[#707784]">
                  Mimo 固定使用 OpenAI 兼容格式。
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#2f3540]">可用模型列表</span>
                <button
                  type="button"
                  className="text-xs text-primary"
                  onClick={openAddModel}
                >
                  添加模型
                </button>
              </div>
              <div className="max-h-40 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {selectedConfig.models.map((model) => (
                  <div
                    key={model}
                    className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm ${
                      selectedConfig.activeModel === model
                        ? "border-primary bg-primary/10"
                        : "border-[#dfe3ea] bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => updateDraft({ activeModel: model })}
                    >
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="truncate">{model}</span>
                    </button>
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <span className="rounded-md bg-[#eef1f5] px-2 py-1 text-xs text-[#737b88]">
                        {model}
                      </span>
                      <button
                        type="button"
                        aria-label={`修改模型 ${model}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                        onClick={() => openEditModel(model)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除模型 ${model}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300 disabled:hover:bg-transparent"
                        disabled={selectedConfig.models.length <= 1}
                        onClick={() => handleDeleteModel(model)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>

          <form
            className="mt-5 rounded-xl border border-[#dfe3ea] bg-white p-3"
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
          </div>

          <div className="shrink-0 flex justify-end gap-3 border-t border-[#dfe3ea] pt-4">
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
      {isAddModelOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25">
          <div className="w-[560px] rounded-2xl border border-[#e5e7eb] bg-[#f8f9fb] shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h3 className="text-lg font-semibold text-[#171b24]">
                {editingModelId ? "修改模型" : "添加新模型"}
              </h3>
              <button
                type="button"
                aria-label="Close add model"
                className="rounded-md p-1.5 text-[#6f7785] hover:bg-[#eef1f5]"
                onClick={closeAddModel}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 pb-4">
              <label className="block">
                <span className="mb-1.5 block text-sm text-[#687182]">模型名称</span>
                <input
                  autoFocus
                  className="h-11 w-full rounded-2xl border border-[#f59e0b] bg-[#f1f3f6] px-4 text-sm text-[#1f2430] outline-none"
                  placeholder="GPT-4"
                  value={newModelName}
                  onChange={(event) => setNewModelName(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm text-[#687182]">模型ID</span>
                <input
                  className="h-11 w-full rounded-2xl border border-[#dde2ea] bg-[#eceff3] px-4 text-sm text-[#8a94a3] outline-none"
                  placeholder="gpt-4"
                  value={newModelId}
                  disabled
                />
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-[#687182]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[#9ca3af]"
                  checked={newModelSupportsVision}
                  onChange={(event) => setNewModelSupportsVision(event.target.checked)}
                />
                支持图像输入
              </label>
            </div>

            <div className="flex justify-end gap-3 px-5 pb-5 pt-2">
              <button
                type="button"
                className="h-10 rounded-xl border border-[#dfe3ea] bg-white px-5 text-sm text-[#2f3540] hover:bg-[#f3f5f8]"
                onClick={closeAddModel}
              >
                取消
              </button>
              <button
                type="button"
                className="h-10 rounded-xl bg-primary px-5 text-sm text-white disabled:bg-primary/35"
                disabled={!canSaveNewModel}
                onClick={handleSaveModel}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
