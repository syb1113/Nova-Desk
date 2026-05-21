import {
  Archive,
  Bot,
  Briefcase,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Input, Modal, Popover } from "antd";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceStore, type ChatSession } from "../state/workspaceStore";

type MenuItem = {
  label: string;
  icon: typeof Sparkles;
  shortcut?: string;
  to?: string;
  panel?: string;
  onClick?: () => void;
};

const workspacePath = "/workspaces/default";

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

export const LeftIconMenu = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeChatId = useWorkspaceStore((state) => state.activeChatId);
  const chatSessions = useWorkspaceStore((state) => state.chatSessions);
  const createChat = useWorkspaceStore((state) => state.createChat);
  const deleteChat = useWorkspaceStore((state) => state.deleteChat);
  const renameChat = useWorkspaceStore((state) => state.renameChat);
  const setActiveChat = useWorkspaceStore((state) => state.setActiveChat);
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen);
  const toggleChatPinned = useWorkspaceStore((state) => state.toggleChatPinned);
  const streamingChatIds = useWorkspaceStore((state) => state.streamingChatIds);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const activePanel = new URLSearchParams(location.search).get("panel");
  const visibleChats = useMemo(
    () =>
      chatSessions.filter((chat) => chat.messages.length > 0).sort(sortChats),
    [chatSessions],
  );

  const menuItems: MenuItem[] = [
    {
      label: "新建任务",
      icon: MessageSquarePlus,
      shortcut: "Ctrl+N",
      onClick: () => {
        createChat();
        navigate(workspacePath);
      },
    },
    {
      label: "打开工作区",
      icon: Briefcase,
      shortcut: "Ctrl+O",
      onClick: () => navigate(workspacePath),
    },
    {
      label: "技能",
      icon: Sparkles,
      to: `${workspacePath}?panel=skills`,
      panel: "skills",
    },
    {
      label: "机器人",
      icon: Bot,
      to: `${workspacePath}?panel=automation`,
      panel: "automation",
    },
  ];

  const handleSelectChat = (chatId: string) => {
    setActiveChat(chatId);
    navigate(workspacePath);
  };

  const startRename = (chat: ChatSession) => {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  };

  const commitRename = () => {
    if (!editingId) {
      return;
    }

    const nextTitle = draftTitle.trim();
    if (nextTitle) {
      renameChat(editingId, nextTitle);
    }

    setEditingId(null);
    setDraftTitle("");
  };

  const handleDelete = (chat: ChatSession) => {
    Modal.confirm({
      centered: true,
      title: "确认删除会话",
      content: "此操作无法撤销，当前会话的所有消息记录将被永久删除。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: {
        danger: true,
      },
      onOk: () => {
        deleteChat(chat.id);

        if (chat.id === activeChatId) {
          navigate(workspacePath);
        }
      },
    });
  };

  return (
    <aside className="relative z-40 flex h-screen w-[254px] shrink-0 flex-col rounded-r-2xl border-r border-[#dfe4ec] bg-[#f8f9fb] px-3 py-4 text-[#273142]">
      {/* <div className="mb-4 flex h-9 items-center px-2">
        <img
          src="/brand/icon.png"
          alt="Nova Desk"
          className="h-7 w-7 rounded-md object-cover"
          draggable={false}
        />
      </div> */}

      <nav className="space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = item.panel ? activePanel === item.panel : false;

          return (
            <button
              key={item.label}
              type="button"
              className={`flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm transition ${
                active
                  ? "bg-[#e8ecf4] text-[#151922]"
                  : "text-[#273142] hover:bg-[#eef1f5]"
              }`}
              onClick={() => {
                if (item.to) {
                  navigate(item.to);
                  return;
                }

                item.onClick?.();
              }}
            >
              <Icon size={16} className="shrink-0 text-[#5d6675]" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut ? (
                <span className="text-xs text-[#9aa2af]">{item.shortcut}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex h-7 items-center justify-between px-2 text-xs text-[#8a919d]">
          <span>历史对话</span>
          <Archive size={14} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {visibleChats.length > 0 ? (
            <div className="space-y-1">
              {visibleChats.map((chat) => (
                <HistoryRow
                  key={chat.id}
                  active={chat.id === activeChatId}
                  chat={chat}
                  draftTitle={draftTitle}
                  editing={editingId === chat.id}
                  isStreaming={streamingChatIds.has(chat.id)}
                  onDelete={handleDelete}
                  onDraftTitleChange={setDraftTitle}
                  onRename={startRename}
                  onRenameCancel={() => {
                    setEditingId(null);
                    setDraftTitle("");
                  }}
                  onRenameCommit={commitRename}
                  onSelect={handleSelectChat}
                  onTogglePinned={toggleChatPinned}
                />
              ))}
            </div>
          ) : (
            <div className="px-7 py-2 text-sm text-[#9aa2af]">暂无任务</div>
          )}
        </div>
      </div>

      <div className="mt-3 flex justify-start border-t border-[#e5e9f0] pt-2">
        <button
          type="button"
          aria-label="设置"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#6f7785] hover:bg-[#eef1f5] hover:text-primary"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
};

const HistoryRow = ({
  active,
  chat,
  draftTitle,
  editing,
  isStreaming,
  onDelete,
  onDraftTitleChange,
  onRename,
  onRenameCancel,
  onRenameCommit,
  onSelect,
  onTogglePinned,
}: {
  active: boolean;
  chat: ChatSession;
  draftTitle: string;
  editing: boolean;
  isStreaming: boolean;
  onDelete: (chat: ChatSession) => void;
  onDraftTitleChange: (value: string) => void;
  onRename: (chat: ChatSession) => void;
  onRenameCancel: () => void;
  onRenameCommit: () => void;
  onSelect: (chatId: string) => void;
  onTogglePinned: (chatId: string) => void;
}) => {
  const actionPanel = (
    <div className="w-32 py-1">
      <BubbleAction
        icon={chat.pinnedAt ? PinOff : Pin}
        label={chat.pinnedAt ? "取消置顶" : "置顶"}
        onClick={() => onTogglePinned(chat.id)}
      />
      <BubbleAction
        icon={Pencil}
        label="重命名"
        onClick={() => onRename(chat)}
      />
      <BubbleAction
        danger
        icon={Trash2}
        label="删除"
        onClick={() => onDelete(chat)}
      />
    </div>
  );

  return (
    <div
      className={`group flex h-8 items-center gap-1 rounded-lg px-2 transition ${
        active
          ? "bg-[#e8ecf4] text-[#151922]"
          : "text-[#667085] hover:bg-[#eef1f5] hover:text-[#273142]"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          if (!editing) {
            onSelect(chat.id);
          }
        }}
      >
        {isStreaming ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
        ) : chat.pinnedAt ? (
          <Pin size={12} className="shrink-0 text-[#9aa7ff]" />
        ) : null}
        {editing ? (
          <Input
            autoFocus
            size="small"
            value={draftTitle}
            onBlur={onRenameCommit}
            onChange={(event) => onDraftTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onRenameCancel();
              }
            }}
            onPressEnter={onRenameCommit}
          />
        ) : (
          <span className="truncate text-sm">{chat.title}</span>
        )}
      </button>

      {!editing ? (
        <Popover
          arrow={false}
          content={actionPanel}
          placement="rightTop"
          trigger="click"
          classNames={{ root: "history-action-popover" }}
        >
          <button
            type="button"
            aria-label="会话操作"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#e1e6ef] text-[#6f7785] opacity-0 transition hover:bg-[#d8dee9] hover:text-[#273142] group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal size={15} />
          </button>
        </Popover>
      ) : null}
    </div>
  );
};

const BubbleAction = ({
  danger,
  icon: Icon,
  label,
  onClick,
}: {
  danger?: boolean;
  icon: typeof Pin;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition ${
      danger
        ? "text-red-500 hover:bg-red-50"
        : "text-[#273142] hover:bg-[#f4f6fa]"
    }`}
    onClick={onClick}
  >
    <Icon size={14} />
    <span>{label}</span>
  </button>
);
