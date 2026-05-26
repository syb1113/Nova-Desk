import { Bot, ChevronLeft, Info, Plus } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  getConfiguredModelOptions,
  getProviderMeta,
  modelProviders,
  type ModelProviderConfig,
  type ModelProviderId,
} from "../config/modelProviders";
import { useWorkspaceStore } from "../state/workspaceStore";

const settingNav = [
  { id: "models", label: "模型设置", icon: Bot },
  { id: "about", label: "关于", icon: Info },
] as const;

type SettingTab = (typeof settingNav)[number]["id"];

const withActiveModelInList = (
  config: ModelProviderConfig,
): ModelProviderConfig => {
  const activeModel = config.activeModel.trim();
  const availableModels = uniqueModels([
    ...(config.availableModels ?? []),
    ...config.models,
    activeModel,
  ]);

  if (!activeModel || config.models.includes(activeModel)) {
    return {
      ...config,
      activeModel,
      availableModels,
    };
  }

  return {
    ...config,
    activeModel,
    availableModels,
    models: [...config.models, activeModel],
  };
};

const uniqueModels = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

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
  const [isProviderFormOpen, setIsProviderFormOpen] = useState(false);
  const [isModelManagerOpen, setIsModelManagerOpen] = useState(false);

  const selectedMeta = getProviderMeta(selectedProvider);
  const selectedConfig = drafts[selectedProvider];
  const configuredProviders = useMemo(
    () => modelProviders.filter((provider) => drafts[provider.id].enabled),
    [drafts],
  );
  const providerOptions = useMemo(
    () =>
      modelProviders.map((provider) => ({
        label: provider.name,
        value: provider.id,
      })),
    [],
  );
  const selectedProviderModelOptions = useMemo(
    () =>
      uniqueModels([
        ...selectedMeta.models,
        ...(selectedConfig.availableModels ?? []),
        ...selectedConfig.models,
        selectedConfig.activeModel,
      ]).map((model) => ({
        label: model,
        value: model,
      })),
    [
      selectedConfig.activeModel,
      selectedConfig.availableModels,
      selectedConfig.models,
      selectedMeta.models,
    ],
  );
  const canSaveProvider =
    selectedConfig.baseUrl.trim().length > 0 &&
    selectedConfig.apiKey.trim().length > 0 &&
    selectedConfig.activeModel.trim().length > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab("models");
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
    const normalizedDrafts = Object.fromEntries(
      modelProviders.map((provider) => [
        provider.id,
        withActiveModelInList(drafts[provider.id]),
      ]),
    ) as Record<ModelProviderId, ModelProviderConfig>;

    for (const provider of modelProviders) {
      updateModelConfig(provider.id, {
        ...normalizedDrafts[provider.id],
        protocol:
          provider.id === "mimo"
            ? "openai"
            : normalizedDrafts[provider.id].protocol,
      });
    }

    const configuredOptions = getConfiguredModelOptions(normalizedDrafts);
    const selectedModel = normalizedDrafts[selectedProvider].activeModel;
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

  const openAddProvider = () => {
    const nextProvider =
      modelProviders.find((provider) => !drafts[provider.id].enabled)?.id ??
      modelProviders[0].id;

    setSelectedProvider(nextProvider);
    setIsProviderFormOpen(true);
  };

  const openEditProvider = (provider: ModelProviderId) => {
    setSelectedProvider(provider);
    setIsProviderFormOpen(true);
  };

  const openModelManager = (provider: ModelProviderId) => {
    setDrafts((current) => ({
      ...current,
      [provider]: withActiveModelInList(current[provider]),
    }));
    setSelectedProvider(provider);
    setIsModelManagerOpen(true);
  };

  const closeProviderForm = () => {
    setIsProviderFormOpen(false);
  };

  const closeModelManager = () => {
    setIsModelManagerOpen(false);
  };

  const handleSaveProvider = () => {
    if (!canSaveProvider) {
      return;
    }

    const activeModel = (
      selectedConfig.activeModel || selectedMeta.defaultModel
    ).trim();

    updateDraft({
      ...withActiveModelInList({
        ...selectedConfig,
        enabled: true,
        baseUrl: selectedConfig.baseUrl || selectedMeta.defaultBaseUrl,
        activeModel,
        availableModels: uniqueModels([
          ...(selectedConfig.availableModels ?? []),
          ...selectedMeta.models,
          activeModel,
        ]),
        models: selectedConfig.enabled ? selectedConfig.models : [activeModel],
      }),
    });
    closeProviderForm();
  };

  const handleVisibleModelsChange = (models: string[]) => {
    const activeModel = selectedConfig.activeModel.trim();
    updateDraft({
      availableModels: uniqueModels([
        ...(selectedConfig.availableModels ?? []),
        ...selectedMeta.models,
        ...models,
        activeModel,
      ]),
      models: uniqueModels(activeModel ? [...models, activeModel] : models),
    });
  };

  const handleDeleteProvider = (provider: ModelProviderId) => {
    setDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        enabled: false,
      },
    }));

    if (selectedProvider === provider) {
      const nextProvider = modelProviders.find(
        (item) => item.id !== provider && drafts[item.id].enabled,
      );
      setSelectedProvider(nextProvider?.id ?? provider);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-background text-text"
      onWheel={(event) => event.stopPropagation()}
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-background px-2 py-4">
        <button
          type="button"
          className="mb-4 flex h-9 items-center gap-2 rounded-lg px-3 text-left text-sm text-textMuted hover:bg-surface hover:text-text"
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
                className={`flex h-8 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${
                  active
                    ? "bg-surfaceHover text-text"
                    : "text-textMuted hover:bg-surface"
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
                <h1 className="text-3xl font-semibold tracking-normal text-text">
                  模型供应商
                </h1>
                <p className="mt-7 text-sm text-textMuted">
                  管理自定义模型供应商，配置后可在聊天时选择使用。
                </p>
              </div>
              <Space>
                <Button onClick={() => setDrafts(modelConfigs)}>刷新</Button>
                <Button
                  type="primary"
                  icon={<Plus size={14} />}
                  onClick={openAddProvider}
                >
                  添加模型
                </Button>
              </Space>
            </div>

            <div className="space-y-5">
              {configuredProviders.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {configuredProviders.map((provider) => {
                    const config = drafts[provider.id];
                    const visibleModels = config.models.slice(0, 5);
                    const hiddenModelCount = Math.max(
                      config.models.length - visibleModels.length,
                      0,
                    );

                    return (
                      <Card
                        key={provider.id}
                        className="min-h-[292px]"
                        styles={{
                          body: {
                            minHeight: 292,
                            display: "flex",
                            flexDirection: "column",
                          },
                        }}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-col text-left"
                          onClick={() => setSelectedProvider(provider.id)}
                        >
                          <div className="mb-5 flex items-start justify-between gap-4">
                            <h2 className="min-w-0 truncate text-base font-semibold text-text">
                              {provider.name}
                            </h2>
                            <Space size={8} className="shrink-0">
                              {activeProvider === provider.id ? (
                                <Tag className="m-0 !border-primary/20 !bg-primary/10 !text-primary">
                                  当前默认
                                </Tag>
                              ) : null}
                              <Tag className="m-0 !border-accent/20 !bg-accent/10 !text-accent">
                                自定义
                              </Tag>
                            </Space>
                          </div>

                          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-y-3 text-sm">
                            <span className="text-textMuted">Provider</span>
                            <span className="truncate text-right font-mono text-xs text-textSecondary">
                              {provider.id}
                            </span>
                            <span className="text-textMuted">Base URL</span>
                            <span className="truncate text-right font-mono text-xs text-textSecondary">
                              {config.baseUrl || provider.defaultBaseUrl}
                            </span>
                            <span className="text-textMuted">模型列表</span>
                            <span className="text-right text-xs text-textMuted">
                              {visibleModels.length}/{config.models.length}{" "}
                              个模型
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {visibleModels.map((model) => (
                              <Tag
                                key={model}
                                className={`rounded-lg px-2 py-1 font-mono text-xs ${
                                  config.activeModel === model
                                    ? "!bg-primary/10 !text-primary"
                                    : "!bg-surface !text-textMuted"
                                }`}
                              >
                                {model}
                              </Tag>
                            ))}
                            {hiddenModelCount > 0 ? (
                              <Tag className="rounded-lg !bg-surface px-2 py-1 text-xs !text-textMuted">
                                +{hiddenModelCount}
                              </Tag>
                            ) : null}
                          </div>
                        </button>

                        <div className="mt-6 flex items-center gap-5 border-t border-border pt-3 text-xs">
                          <Button
                            type="link"
                            className="h-auto p-0 text-textSecondary"
                            onClick={() => openEditProvider(provider.id)}
                          >
                            编辑配置
                          </Button>
                          <Button
                            type="link"
                            className="h-auto p-0 text-textSecondary"
                            onClick={() => openModelManager(provider.id)}
                          >
                            管理可见模型
                          </Button>
                          <Popconfirm
                            title="删除模型供应商"
                            description="删除后会从已配置列表移除，可重新添加。"
                            okText="删除"
                            cancelText="取消"
                            onConfirm={() => handleDeleteProvider(provider.id)}
                          >
                            <Button
                              type="link"
                              danger
                              className="ml-auto h-auto p-0"
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <Empty
                    description="暂无已配置模型供应商"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button
                      type="primary"
                      icon={<Plus size={14} />}
                      onClick={openAddProvider}
                    >
                      添加模型
                    </Button>
                  </Empty>
                </Card>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleSave}>
                保存
              </Button>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-[720px]">
            <h1 className="text-3xl font-semibold tracking-normal text-text">
              关于 Nova Desk
            </h1>
            <div className="mt-7 rounded-xl border border-border bg-card p-6 text-sm leading-7 text-textSecondary">
              <p>
                Nova Desk
                是本地桌面工作台，用于在当前工作区内组织会话、模型供应商和 Agent
                能力。
              </p>
              <p className="mt-4 text-textMuted">当前版本：0.1.0</p>
            </div>
          </section>
        )}
      </main>

      <Modal
        title={selectedConfig.enabled ? "编辑模型供应商" : "添加模型"}
        open={isProviderFormOpen}
        onCancel={closeProviderForm}
        onOk={handleSaveProvider}
        okButtonProps={{ disabled: !canSaveProvider }}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <Form layout="vertical" className="pt-3">
          <Form.Item label="模型供应商" required>
            <Select
              value={selectedProvider}
              options={providerOptions}
              onChange={(value: ModelProviderId) => setSelectedProvider(value)}
            />
          </Form.Item>

          <Form.Item label="Base URL" required>
            <Input
              value={selectedConfig.baseUrl}
              placeholder={selectedMeta.defaultBaseUrl}
              onChange={(event) => updateDraft({ baseUrl: event.target.value })}
            />
          </Form.Item>

          <Form.Item label="API Key" required>
            <Input.Password
              value={selectedConfig.apiKey}
              placeholder="输入 API Key"
              onChange={(event) => updateDraft({ apiKey: event.target.value })}
            />
          </Form.Item>

          <Form.Item label="默认模型" required>
            <Select
              mode="tags"
              value={
                selectedConfig.activeModel ? [selectedConfig.activeModel] : []
              }
              options={selectedProviderModelOptions}
              placeholder={selectedMeta.defaultModel}
              onChange={(models: string[]) =>
                updateDraft({ activeModel: models.at(-1)?.trim() ?? "" })
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="管理可见模型"
        open={isModelManagerOpen}
        onCancel={closeModelManager}
        onOk={closeModelManager}
        okText="完成"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <div className="pt-2">
          <div className="mb-3 text-sm text-textMuted">
            选择后，这些模型会出现在聊天输入框的模型下拉列表中。
          </div>
          <Checkbox.Group
            className="grid w-full grid-cols-1 gap-2"
            value={selectedConfig.models}
            options={selectedProviderModelOptions.map((option) => ({
              ...option,
              disabled: option.value === selectedConfig.activeModel,
            }))}
            onChange={(models) => handleVisibleModelsChange(models.map(String))}
          />
        </div>
      </Modal>
    </div>
  );
};
