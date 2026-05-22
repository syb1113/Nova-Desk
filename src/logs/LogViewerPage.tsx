import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronUp,
  Info,
  Search,
  Trash2,
  ScrollText,
} from "lucide-react";
import { Input, Modal, Select, Tag, message } from "antd";
import { useMemo, useState } from "react";
import { useLogStore, type LogEntry, type LogLevel } from "../state/logStore";

const levelConfig: Record<
  LogLevel,
  { label: string; color: string; bg: string; icon: typeof Info }
> = {
  debug: {
    label: "DEBUG",
    color: "text-[#8a919d]",
    bg: "bg-[#f4f6f8]",
    icon: Bug,
  },
  info: {
    label: "INFO",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    icon: Info,
  },
  warn: {
    label: "WARN",
    color: "text-amber-600",
    bg: "bg-amber-50",
    icon: AlertTriangle,
  },
  error: {
    label: "ERROR",
    color: "text-red-600",
    bg: "bg-red-50",
    icon: AlertTriangle,
  },
};

const levelOptions: { label: string; value: LogLevel | "all" }[] = [
  { label: "全部级别", value: "all" },
  { label: "ERROR", value: "error" },
  { label: "WARN", value: "warn" },
  { label: "INFO", value: "info" },
  { label: "DEBUG", value: "debug" },
];

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const LogRow = ({ entry }: { entry: LogEntry }) => {
  const [expanded, setExpanded] = useState(false);
  const cfg = levelConfig[entry.level];
  const Icon = cfg.icon;
  const hasData = entry.data !== undefined;

  return (
    <div className="border-b border-[#f0f2f5] last:border-0">
      <div className="flex items-start gap-2 px-4 py-2">
        <span className="mt-0.5 shrink-0 text-[10px] font-mono text-[#b0b7c3] w-20">
          {formatTime(entry.timestamp)}
        </span>
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}
        >
          <Icon size={10} />
          {cfg.label}
        </span>
        <Tag className="m-0 shrink-0 rounded bg-[#f4f6f8] border-0 px-1.5 py-0 text-[10px] text-[#6b7280]">
          {entry.category}
        </Tag>
        <span className="min-w-0 flex-1 text-xs text-[#374151] break-all">
          {entry.message}
        </span>
        {hasData ? (
          <button
            type="button"
            className="shrink-0 text-[#9ca3af] hover:text-primary transition"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        ) : null}
      </div>
      {expanded && hasData ? (
        <div className="px-4 pb-2 pl-[76px]">
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#1e1e2e] p-3 font-mono text-[11px] leading-5 text-[#cdd6f4]">
            {typeof entry.data === "string"
              ? entry.data
              : JSON.stringify(entry.data, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

export const LogViewerPage = () => {
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const clearOlderThan = useLogStore((s) => s.clearOlderThan);

  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const categories = useMemo(() => {
    const set = new Set(logs.map((l) => l.category));
    return Array.from(set).sort();
  }, [logs]);

  const categoryOptions = useMemo(
    () => [
      { label: "全部分类", value: "all" },
      ...categories.map((c) => ({ label: c, value: c })),
    ],
    [categories],
  );

  const filtered = useMemo(() => {
    let result = logs;
    if (levelFilter !== "all") {
      result = result.filter((l) => l.level === levelFilter);
    }
    if (categoryFilter !== "all") {
      result = result.filter((l) => l.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [logs, levelFilter, categoryFilter, search]);

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  const handleClear = () => {
    Modal.confirm({
      centered: true,
      title: "清空日志",
      content: "确认清空所有日志记录？此操作无法撤销。",
      okText: "清空",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        clearLogs();
        message.success("日志已清空");
      },
    });
  };

  const handleClearOld = () => {
    clearOlderThan(24 * 60 * 60 * 1000);
    message.success("已清理 24 小时前的日志");
  };

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-1 pb-8 pt-8">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-[#111827]">运行日志</h1>
              <p className="mt-0.5 text-xs text-[#6b7280]">
                {logs.length} 条日志
                {errorCount > 0 ? (
                  <span className="ml-2 text-red-500">{errorCount} 个错误</span>
                ) : null}
                {warnCount > 0 ? (
                  <span className="ml-2 text-amber-500">{warnCount} 个警告</span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-[#e5e9f0] bg-white px-3 py-1.5 text-xs text-[#6b7280] transition hover:border-primary hover:text-primary"
                onClick={handleClearOld}
              >
                清理旧日志
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100"
                onClick={handleClear}
              >
                <Trash2 size={12} />
                清空
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4 flex items-center gap-2">
            <Select
              className="w-32"
              size="small"
              value={levelFilter}
              options={levelOptions}
              onChange={setLevelFilter}
            />
            <Select
              className="w-36"
              size="small"
              value={categoryFilter}
              options={categoryOptions}
              onChange={setCategoryFilter}
              showSearch
            />
            <Input
              size="small"
              className="flex-1"
              prefix={<Search size={12} className="text-[#9ca3af]" />}
              placeholder="搜索日志内容…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
            />
          </div>

          {/* Log list */}
          <div className="rounded-xl border border-[#e5e9f0] bg-white">
            {filtered.length > 0 ? (
              filtered.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-14">
                <ScrollText size={28} className="mb-2 text-[#c4c9d4]" />
                <p className="text-sm text-[#9ca3af]">
                  {logs.length === 0 ? "暂无日志" : "没有匹配的日志"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
