import {
  Bot,
  Clock3,
  Folder,
  MessageSquarePlus,
  Search,
  Settings,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { NavLink } from "react-router-dom";

const primaryItems = [
  { label: "新对话", icon: MessageSquarePlus, to: "/workspaces/default" },
  { label: "搜索", icon: Search, to: "/workspaces/default?panel=search" },
  { label: "插件", icon: Workflow, to: "/workspaces/default?panel=plugins" },
  { label: "自动化", icon: Clock3, to: "/workspaces/default?panel=automation" },
];

const projectItems = [
  { title: "Nova Desk", subtitle: "新对话", time: "1 小时" },
  {
    title: "helixdr-manage-web",
    subtitle: "这个文件是用的 approval...",
    time: "2 天",
  },
  { title: "react-micro", subtitle: "整理应用接入方案", time: "6 天" },
];

const chatItems = [
  { title: "使用 Figma 插件继续优化界面", time: "2 小时" },
  { title: "我想要修改 template-skill", time: "1 天" },
  { title: "这个 skill 我该如何使用", time: "2 天" },
  { title: "将 Hermes Agent 接入 Nova Desk", time: "2 天" },
];

export const Sidebar = () => {
  return (
    <aside className="flex min-h-screen flex-col border-r border-border bg-[#f0f1f3] text-[#2f343d]">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <img
          src="/brand/icon.png"
          alt="Nova Desk"
          className="h-10 w-10 rounded-xl object-cover"
          draggable={false}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Nova Desk</div>
          <div className="truncate text-xs text-[#737985]">Hermes Agent</div>
        </div>
      </div>

      <nav className="space-y-1 px-2">
        {primaryItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.label}
              to={item.to}
              className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-[#3f4650] transition hover:bg-white/70"
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-3">
        <SectionTitle title="项目" />
        <div className="space-y-1">
          {projectItems.map((item) => (
            <ConversationItem key={item.title} icon={Folder} {...item} />
          ))}
        </div>

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
          {chatItems.map((item) => (
            <ConversationItem
              key={item.title}
              icon={Bot}
              title={item.title}
              time={item.time}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#dfe3e8] px-4 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/70"
        >
          <Settings size={15} />
          设置
        </button>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1.5 text-xs shadow-sm hover:text-primary"
        >
          升级
        </button>
      </div>
    </aside>
  );
};

const SectionTitle = ({ title }: { title: string }) => (
  <div className="mb-2 px-1 text-xs font-medium text-[#8a9099]">{title}</div>
);

const ConversationItem = ({
  icon: Icon,
  title,
  subtitle,
  time,
}: {
  icon: typeof Folder;
  title: string;
  subtitle?: string;
  time: string;
}) => (
  <button
    type="button"
    className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-white/70"
  >
    <Icon className="text-[#727984]" size={15} />
    <span className="min-w-0">
      <span className="block truncate text-[#363b44]">{title}</span>
      {subtitle ? (
        <span className="block truncate text-xs text-[#7e8490]">
          {subtitle}
        </span>
      ) : null}
    </span>
    <span className="text-xs text-[#8b919b]">{time}</span>
  </button>
);
