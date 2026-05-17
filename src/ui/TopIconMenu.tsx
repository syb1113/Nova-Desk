import { addCollection, Icon } from "@iconify/react";
import { icons as iconParkOutline } from "@iconify-json/icon-park-outline";
import { Button, Input, Modal, Popover, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore, type ChatSession } from "../state/workspaceStore";

addCollection(iconParkOutline);

type MenuItem = {
  label: string;
  icon: string;
  to?: string;
};

const leftMenuItems: MenuItem[] = [
  {
    label: "技能管理",
    icon: "icon-park-outline:toolkit",
    to: "/workspaces/default?panel=skills",
  },
  {
    label: "MCP管理",
    icon: "icon-park-outline:connection-box",
    to: "/workspaces/default?panel=mcp",
  },
  {
    label: "自动化",
    icon: "icon-park-outline:time",
    to: "/workspaces/default?panel=automation",
  },
];

const formatTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
  }

  if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  }

  return `${Math.floor(diff / day)}天前`;
};

const sortChats = (a: ChatSession, b: ChatSession) => {
  if (a.pinnedAt && b.pinnedAt) {
    return b.pinnedAt - a.pinnedAt;
  }

  if (a.pinnedAt) {
    return -1;
  }

  if (b.pinnedAt) {
    return 1;
  }

  return b.updatedAt - a.updatedAt;
};

export const TopIconMenu = () => {
  const navigate = useNavigate();
  const activeChatId = useWorkspaceStore((state) => state.activeChatId);
  const chatSessions = useWorkspaceStore((state) => state.chatSessions);
  const createChat = useWorkspaceStore((state) => state.createChat);
  const deleteChat = useWorkspaceStore((state) => state.deleteChat);
  const renameChat = useWorkspaceStore((state) => state.renameChat);
  const setActiveChat = useWorkspaceStore((state) => state.setActiveChat);
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen);
  const toggleChatPinned = useWorkspaceStore((state) => state.toggleChatPinned);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const chats = chatSessions
      .filter((chat) => chat.messages.length > 0)
      .sort(sortChats);

    if (!normalizedQuery) {
      return chats;
    }

    return chats.filter((chat) =>
      chat.title.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [chatSessions, query]);

  const handleNewChat = () => {
    createChat();
    navigate("/workspaces/default");
    setHistoryOpen(false);
  };

  const handleSelectChat = (chatId: string) => {
    setActiveChat(chatId);
    navigate("/workspaces/default");
    setHistoryOpen(false);
  };

  const startRename = (chat: ChatSession) => {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  };

  const commitRename = () => {
    if (!editingId || !draftTitle.trim()) {
      return;
    }

    renameChat(editingId, draftTitle);
    setEditingId(null);
    setDraftTitle("");
  };

  const handleDelete = (chat: ChatSession) => {
    setDeleteConfirmOpen(true);
    Modal.confirm({
      centered: true,
      icon: (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-500">
          <Icon icon="icon-park-outline:caution" width={22} height={22} />
        </span>
      ),
      title: (
        <span className="text-[17px] font-semibold text-[#171b24]">
          确认删除会话
        </span>
      ),
      content: (
        <div className="mt-2 text-sm leading-6 text-[#6b7280]">
          此操作无法撤销，当前会话的所有消息记录将被永久删除。
        </div>
      ),
      okText: "删除会话",
      cancelText: "取消",
      okButtonProps: {
        danger: true,
        type: "primary",
      },
      cancelButtonProps: {
        type: "text",
      },
      className: "delete-chat-confirm",
      width: 480,
      afterClose: () => setDeleteConfirmOpen(false),
      onOk: () => {
        deleteChat(chat.id);

        if (chat.id === activeChatId) {
          navigate("/workspaces/default");
        }
      },
      onCancel: () => setDeleteConfirmOpen(false),
    });
  };

  const expandableMenuClass =
    "group flex h-11 w-auto max-w-11 items-center overflow-hidden rounded-full border border-white/70 bg-white/90 pr-3.5 text-[#273142] shadow-[0_10px_30px_rgb(15_23_42_/_0.10)] backdrop-blur transition-[max-width,background-color,border-color,box-shadow] duration-300 ease-out hover:max-w-32 hover:border-primary/30 hover:bg-white hover:text-primary hover:shadow-[0_14px_34px_rgb(79_110_247_/_0.18)]";

  const renderExpandableLabel = (icon: string, label: string) => (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center">
        <Icon className="block" icon={icon} width={20} height={20} />
      </span>
      <span className="ml-0.5 whitespace-nowrap pr-4 text-sm font-medium opacity-0 transition-opacity delay-75 duration-200 group-hover:opacity-100">
        {label}
      </span>
    </>
  );

  const historyPanel = (
    <div className="w-[360px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#171b24]">历史对话</div>
          <div className="text-xs text-[#8a919d]">
            {filteredChats.length} 个本地会话
          </div>
        </div>
      </div>

      <Input
        allowClear
        size="middle"
        placeholder="搜索会话名称"
        prefix={<Icon icon="icon-park-outline:search" width={16} height={16} />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {filteredChats.length > 0 ? (
          filteredChats.map((chat) => (
            <div
              key={chat.id}
              className={`group rounded-lg border px-2 py-2 transition ${
                chat.id === activeChatId
                  ? "border-primary/30 bg-primary/10"
                  : "border-transparent hover:bg-[#f4f6fa]"
              }`}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    if (editingId !== chat.id) {
                      handleSelectChat(chat.id);
                    }
                  }}
                >
                  {editingId === chat.id ? (
                    <Input
                      autoFocus
                      size="small"
                      value={draftTitle}
                      onBlur={commitRename}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEditingId(null);
                          setDraftTitle("");
                        }
                      }}
                      onPressEnter={commitRename}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        {chat.pinnedAt ? (
                          <Icon
                            className="text-primary"
                            icon="icon-park-outline:pushpin"
                            width={14}
                            height={14}
                          />
                        ) : null}
                        <span className="block truncate text-sm font-medium text-[#252b36]">
                          {chat.title}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-[#8a919d]">
                        {formatTime(chat.updatedAt)}
                      </div>
                    </>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <Tooltip title={chat.pinnedAt ? "取消置顶" : "置顶"}>
                    <button
                      type="button"
                      className="history-row-action"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleChatPinned(chat.id);
                      }}
                    >
                      <Icon
                        icon="icon-park-outline:pushpin"
                        width={15}
                        height={15}
                      />
                    </button>
                  </Tooltip>
                  <Tooltip title="重命名">
                    <button
                      type="button"
                      className="history-row-action"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        startRename(chat);
                      }}
                    >
                      <Icon
                        icon="icon-park-outline:edit"
                        width={15}
                        height={15}
                      />
                    </button>
                  </Tooltip>
                  <Tooltip title="删除">
                    <button
                      type="button"
                      className="history-row-action history-row-action-danger"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(chat);
                      }}
                    >
                      <Icon
                        icon="icon-park-outline:delete"
                        width={15}
                        height={15}
                      />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[#d7dde8] py-8 text-center text-sm text-[#8a919d]">
            没有找到会话
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex items-start justify-between px-5">
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 shadow-[0_10px_30px_rgb(15_23_42_/_0.10)] backdrop-blur">
          <img
            src="/brand/icon.png"
            alt="Nova Desk"
            className="h-8 w-8 rounded-full object-cover"
            draggable={false}
          />
        </div>

        <Tooltip title="新对话" placement="bottom">
          <button
            type="button"
            aria-label="新对话"
            className="top-icon-action"
            onClick={handleNewChat}
          >
            <Icon icon="icon-park-outline:add-one" width={21} height={21} />
          </button>
        </Tooltip>

        <Popover
          arrow={false}
          content={historyPanel}
          open={historyOpen}
          placement="bottomLeft"
          trigger="click"
          onOpenChange={(open) => {
            if (!open && (editingId || deleteConfirmOpen)) {
              return;
            }

            setHistoryOpen(open);
          }}
        >
          <button
            type="button"
            aria-label="历史对话"
            className={expandableMenuClass}
          >
            {renderExpandableLabel("icon-park-outline:history", "历史对话")}
          </button>
        </Popover>

        {leftMenuItems.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            className={expandableMenuClass}
            onClick={() => {
              if (item.to) {
                navigate(item.to);
              }
            }}
          >
            {renderExpandableLabel(item.icon, item.label)}
          </button>
        ))}
      </div>

      <Tooltip title="设置" placement="bottomRight">
        <button
          type="button"
          aria-label="设置"
          className="pointer-events-auto top-icon-action"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon icon="icon-park-outline:setting-two" width={21} height={21} />
        </button>
      </Tooltip>
    </div>
  );
};
