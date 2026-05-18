import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  Info,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { streamHermesMessage } from "../api/hermes";
import {
  getConfiguredModelOptions,
  getProviderMeta,
  modelProviders,
  type ApiProtocol,
  type ModelProviderConfig,
  type ModelProviderId,
} from "../config/modelProviders";
import { useWorkspaceStore } from "../state/workspaceStore";

const settingNav = [
  { id: "models", label: "模型设置", icon: Bot },
  { id: "about", label: "关于", icon: Info },
] as const;

type SettingTab = (typeof settingNav)[number]["id"];

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
  const [activeTab, setActiveTab] = useState<SettingTab>("models");
  const [selectedProvider, setSelectedProvider] =
    useState<ModelProviderId>(activeProvider);
  const [drafts, setDrafts] = useState(modelConfigs);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [newModelName, setNewModelName] = useState("");
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

    setActiveTab("models");
    setSelectedProvider(activeProvider);
    setDrafts(modelConfigs);
    setTestStatus("idle");
    setTestMessage("");
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
    setTestStatus("idle");
    setTestMessage("");
  };

  const handleSave = () => {
    for (const provider of modelProviders) {
      updateModelConfig(provider.id, {
        ...drafts[provider.id],
        protocol:
          provider.id === "mimo" ? "openai" : drafts[provider.id].protocol,
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
    setIsAddModelOpen(true);
  };

  const openEditModel = (model: string) => {
    setEditingModelId(model);
    setNewModelName(model);
    setIsAddModelOpen(true);
  };

  const closeAddModel = () => {
    setIsAddModelOpen(false);
    setEditingModelId(null);
    setNewModelName("");
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

    if (isTesting) {
      return;
    }

    setIsTesting(true);
    setTestStatus("idle");
    setTestMessage("");

    try {
      await streamHermesMessage("你好", null, () => undefined, runtimeConfig);
      setTestStatus("success");
      setTestMessage("连接成功");
    } catch (error) {
      setTestStatus("error");
      setTestMessage(error instanceof Error ? error.message : "连接失败");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-[#f8f9fb] text-[#151922]"
      onWheel={(event) => event.stopPropagation()}
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#dfe3ea] bg-[#f8f9fb] px-2 py-4">
        <button
          type="button"
          className="mb-4 flex h-9 items-center gap-2 rounded-md px-3 text-left text-sm text-[#4b5563] hover:bg-[#eef1f5] hover:text-[#151922]"
          onClick={() => setOpen(false)}
        >
          <ChevronLeft size={16} />
          返回工作区
        </button>

        <nav className="space-y-1">
          {settingNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`flex h-8 w-full items-center gap-3 rounded-md px-3 text-sm transition ${
                  active
                    ? "bg-[#e8ecf4] text-[#151922]"
                    : "text-[#4b5563] hover:bg-[#eef1f5]"
                }`}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-12 py-12">
        {activeTab === "models" ? (
          <section className="mx-auto max-w-[1080px]">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-normal text-[#151922]">
                  模型供应商
                </h1>
                <p className="mt-7 text-sm text-[#6b7280]">
                  管理自定义模型供应商，配置后可在聊天时选择使用。
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-primary hover:text-primary/80"
                onClick={() => setDrafts(modelConfigs)}
              >
                刷新
              </button>
            </div>

            <div className="grid min-h-[520px] grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#dfe3ea] bg-white">
              <div className="border-r border-[#e5e7eb] p-3">
                <div className="mb-2 px-2 text-xs text-[#8a919d]">供应商</div>
                <div className="space-y-1">
                  {modelProviders.map((provider) => {
                    const Icon = provider.icon;
                    const selected = selectedProvider === provider.id;
                    const config = drafts[provider.id];

                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className={`flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition ${
                          selected
                            ? "bg-primary/10 text-[#151922]"
                            : "text-[#374151] hover:bg-[#f4f6fa]"
                        }`}
                        onClick={() => setSelectedProvider(provider.id)}
                      >
                        <Icon size={16} className="text-primary" />
                        <span className="min-w-0 flex-1 truncate">
                          {provider.name}
                        </span>
                        <span
                          className={`h-2 w-2 rounded-full ${config.enabled ? "bg-emerald-500" : "bg-[#c3cad5]"}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0 p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-[#151922]">
                        {selectedMeta.name} - API Key
                      </h2>
                      {selectedConfig.enabled ? (
                        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
                          已启用
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-[#6b7280]">
                      当前聊天使用：{activeProvider}/{activeModel}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="h-7 rounded-md border border-[#d8dde6] bg-white px-3 text-xs text-[#374151] hover:bg-[#f4f6fa]"
                    onClick={() =>
                      updateDraft({ enabled: !selectedConfig.enabled })
                    }
                  >
                    {selectedConfig.enabled ? "禁用" : "启用"}
                  </button>
                </div>

                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-[#374151]">
                      接口地址
                    </span>
                    <input
                      className="h-9 w-full rounded-md border border-[#dfe3ea] bg-[#f8fafc] px-3 text-sm text-[#111827] outline-none focus:border-primary"
                      value={selectedConfig.baseUrl}
                      onChange={(event) =>
                        updateDraft({ baseUrl: event.target.value })
                      }
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-sm text-[#374151]">
                      API Key
                    </span>
                    <span className="flex h-9 items-center rounded-md border border-[#dfe3ea] bg-[#f8fafc] px-3 focus-within:border-primary">
                      <input
                        type={showApiKey ? "text" : "password"}
                        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#9aa2af]"
                        placeholder="输入 API Key"
                        value={selectedConfig.apiKey}
                        onChange={(event) =>
                          updateDraft({ apiKey: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        aria-label={
                          showApiKey ? "隐藏 API Key" : "显示 API Key"
                        }
                        className="ml-2 text-[#6b7280] hover:text-primary"
                        onClick={() => setShowApiKey((visible) => !visible)}
                      >
                        {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </label>

                  <div>
                    <div className="mb-2 text-sm text-[#374151]">API 格式</div>
                    <div className="flex gap-4 text-sm text-[#374151]">
                      {(["anthropic", "openai"] as ApiProtocol[]).map(
                        (protocol) => (
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
                        ),
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm text-[#374151]">模型列表</span>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-[#eef1f5] px-2 text-xs text-[#273142] hover:bg-[#e3e8f0]"
                        onClick={openAddModel}
                      >
                        <Plus size={13} />
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
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="ml-2 rounded-md bg-[#eef1f5] px-2 py-1 text-xs text-[#737b88]">
                            {model}
                          </span>
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 ml-2 text-left"
                            onClick={() => updateDraft({ activeModel: model })}
                          >
                            <span className="truncate">{model}</span>
                          </button>
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
                      ))}
                    </div>
                  </div>

                  <form
                    className="rounded-md border border-[#dfe3ea] bg-[#f8fafc] p-3"
                    onSubmit={handleTest}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        <div className="text-[#273142]">测试连接</div>
                      </div>
                      <button
                        type="submit"
                        className="h-8 rounded-md bg-[#5f6df6] px-4 text-sm text-white disabled:bg-[#555b91]"
                        disabled={isTesting}
                      >
                        {isTesting ? "测试中" : "测试"}
                      </button>
                    </div>
                    {testStatus !== "idle" ? (
                      <div
                        className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                          testStatus === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {testStatus === "success" ? (
                          <CheckCircle2 size={16} />
                        ) : (
                          <XCircle size={16} />
                        )}
                        <span className="min-w-0 break-words">
                          {testMessage}
                        </span>
                      </div>
                    ) : null}
                  </form>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="h-9 rounded-md border border-[#d8dde6] bg-white px-5 text-sm text-[#374151] hover:bg-[#f4f6fa]"
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-[#5f6df6] px-5 text-sm text-white"
                onClick={handleSave}
              >
                保存
              </button>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-[720px]">
            <h1 className="text-3xl font-semibold tracking-normal text-[#151922]">
              关于 Nova Desk
            </h1>
            <div className="mt-7 rounded-lg border border-[#dfe3ea] bg-white p-6 text-sm leading-7 text-[#374151]">
              <p>
                Nova Desk
                是本地桌面工作台，用于在当前工作区内组织会话、模型供应商和 Agent
                能力。
              </p>
              <p className="mt-4 text-[#6b7280]">当前版本：0.1.0</p>
            </div>
          </section>
        )}
      </main>

      {isAddModelOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25">
          <div className="w-[520px] rounded-lg border border-[#dfe3ea] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-4">
              <h3 className="text-lg font-semibold text-[#151922]">
                {editingModelId ? "修改模型" : "添加模型"}
              </h3>
              <button
                type="button"
                className="text-[#6b7280] hover:text-[#151922]"
                onClick={closeAddModel}
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-1.5 block text-sm text-[#374151]">
                  模型名称
                </span>
                <input
                  autoFocus
                  className="h-10 w-full rounded-md border border-[#dfe3ea] bg-[#f8fafc] px-3 text-sm text-[#111827] outline-none focus:border-primary"
                  placeholder="gpt-4.1"
                  value={newModelName}
                  onChange={(event) => setNewModelName(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm text-[#374151]">
                  模型 ID
                </span>
                <input
                  className="h-10 w-full rounded-md border border-[#dfe3ea] bg-[#eef1f5] px-3 text-sm text-[#6b7280] outline-none"
                  value={newModelId}
                  disabled
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-[#e5e7eb] px-5 py-4">
              <button
                type="button"
                className="h-9 rounded-md border border-[#d8dde6] bg-white px-5 text-sm text-[#374151] hover:bg-[#f4f6fa]"
                onClick={closeAddModel}
              >
                取消
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-[#5f6df6] px-5 text-sm text-white disabled:bg-[#555b91]"
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
