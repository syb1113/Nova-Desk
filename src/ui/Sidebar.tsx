import { Bot, Clock3, MessageSquarePlus, Search, Settings, SlidersHorizontal, Workflow } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useWorkspaceStore } from '../state/workspaceStore'

const primaryItems = [
  { label: '新对话', icon: MessageSquarePlus, to: '/workspaces/default' },
  { label: '搜索', icon: Search, to: '/workspaces/default?panel=search' },
  { label: '插件', icon: Workflow, to: '/workspaces/default?panel=plugins' },
  { label: '自动化', icon: Clock3, to: '/workspaces/default?panel=automation' },
]

const formatTime = (timestamp: number) => {
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))} 分钟`
  }

  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时`
  }

  return `${Math.floor(diff / day)} 天`
}

export const Sidebar = () => {
  const activeChatId = useWorkspaceStore((state) => state.activeChatId)
  const chatSessions = useWorkspaceStore((state) => state.chatSessions)
  const createChat = useWorkspaceStore((state) => state.createChat)
  const setActiveChat = useWorkspaceStore((state) => state.setActiveChat)
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen)

  return (
    <aside className="flex min-h-screen flex-col border-r border-border bg-[#f0f1f3] text-[#2f343d]">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <img src="/brand/icon.png" alt="Nova Desk" className="h-10 w-10 rounded-xl object-cover" draggable={false} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Nova Desk</div>
          <div className="truncate text-xs text-[#737985]">Hermes Agent</div>
        </div>
      </div>

      <nav className="space-y-1 px-2">
        {primaryItems.map((item) => {
          const Icon = item.icon
          const isNewChat = item.label === '新对话'

          return (
            <NavLink
              key={item.label}
              to={item.to}
              className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-[#3f4650] transition hover:bg-white/70"
              onClick={() => {
                if (isNewChat) {
                  createChat()
                }
              }}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <div className="mt-6 flex items-center justify-between">
          <SectionTitle title="对话" />
          <button
            type="button"
            aria-label="Conversation filters"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#7a808a] hover:bg-white/70"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
        <div className="space-y-1">
          {chatSessions.map((chat) => (
            <ConversationItem
              key={chat.id}
              active={chat.id === activeChatId}
              title={chat.title}
              time={formatTime(chat.updatedAt)}
              onClick={() => setActiveChat(chat.id)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-[#dfe3e8] px-4 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/70"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} />
          设置
        </button>
      </div>
    </aside>
  )
}

const SectionTitle = ({ title }: { title: string }) => (
  <div className="mb-2 px-1 text-xs font-medium text-[#8a9099]">{title}</div>
)

const ConversationItem = ({
  active,
  title,
  time,
  onClick,
}: {
  active: boolean
  title: string
  time: string
  onClick: () => void
}) => (
  <button
    type="button"
    className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
      active ? 'bg-white text-primary shadow-sm' : 'hover:bg-white/70'
    }`}
    onClick={onClick}
  >
    <Bot className="text-[#727984]" size={15} />
    <span className="min-w-0">
      <span className="block truncate text-[#363b44]">{title}</span>
    </span>
    <span className="text-xs text-[#8b919b]">{time}</span>
  </button>
)
