import { Activity, CalendarDays } from "lucide-react";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import type { MessageAttachment } from "../api/hermes";
import {
  type TokenUsageRecord,
  useTokenUsageStore,
} from "../state/tokenUsageStore";
import { useWorkspaceStore } from "../state/workspaceStore";

type RangeKey = "today" | "7d" | "30d" | "90d" | "year";

type Bucket = {
  key: string;
  label: string;
  start: number;
  end: number;
};

type Series = {
  id: string;
  label: string;
  color: string;
  values: number[];
};

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "90d", label: "90 天" },
  { key: "year", label: "今年" },
];

const SERIES_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#4f46e5",
  "#be123c",
];

const DAY_MS = 24 * 60 * 60 * 1000;

type TooltipPoint = {
  axisValueLabel?: string;
  name?: string;
  marker?: string;
  seriesName?: string;
  value?: number | string | null;
  color?: string;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
};

const buildBuckets = (range: RangeKey, now = new Date()): Bucket[] => {
  if (range === "today") {
    const start = startOfDay(now);
    return Array.from({ length: now.getHours() + 1 }, (_, hour) => ({
      key: `${hour}`,
      label: `${hour}:00`,
      start: start + hour * 60 * 60 * 1000,
      end: start + (hour + 1) * 60 * 60 * 1000,
    }));
  }

  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const todayStart = startOfDay(now);
    return Array.from({ length: days }, (_, index) => {
      const start = todayStart - (days - 1 - index) * DAY_MS;
      const date = new Date(start);
      return {
        key: `${start}`,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        start,
        end: start + DAY_MS,
      };
    });
  }

  if (range === "90d") {
    const todayStart = startOfDay(now);
    return Array.from({ length: 13 }, (_, index) => {
      const start = todayStart - (12 - index) * 7 * DAY_MS;
      const end = index === 12 ? todayStart + DAY_MS : start + 7 * DAY_MS;
      const date = new Date(start);
      return {
        key: `${start}`,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        start,
        end,
      };
    });
  }

  const year = now.getFullYear();
  return Array.from({ length: now.getMonth() + 1 }, (_, month) => {
    const start = new Date(year, month, 1).getTime();
    const end = new Date(year, month + 1, 1).getTime();
    return {
      key: `${start}`,
      label: `${month + 1}月`,
      start,
      end,
    };
  });
};

const modelKey = (record: TokenUsageRecord) =>
  `${record.provider}:${record.model}`;

const modelLabel = (key: string) => key.split(":").slice(1).join(":") || key;

const estimateTextTokens = (value: string) => {
  const cjkMatches = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
  const cjkCount = cjkMatches?.length ?? 0;
  const nonCjkText = value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "");
  return Math.max(0, cjkCount + Math.ceil(nonCjkText.length / 4));
};

const estimateAttachmentTokens = (attachment: MessageAttachment) => {
  if (attachment.textContent) return estimateTextTokens(attachment.textContent);
  if (attachment.type === "image") return 85;
  return estimateTextTokens(`${attachment.name} ${attachment.mimeType}`);
};

const aggregateSeries = (records: TokenUsageRecord[], buckets: Bucket[]) => {
  const visible = records.filter((record) => {
    const first = buckets[0];
    const last = buckets[buckets.length - 1];
    return (
      first &&
      last &&
      record.timestamp >= first.start &&
      record.timestamp < last.end
    );
  });

  const models = Array.from(new Set(visible.map(modelKey))).sort();
  const modelSeries = models.map((model, index) => ({
    id: model,
    label: modelLabel(model),
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    values: buckets.map((bucket) =>
      visible
        .filter(
          (record) =>
            modelKey(record) === model &&
            record.timestamp >= bucket.start &&
            record.timestamp < bucket.end,
        )
        .reduce((sum, record) => sum + record.totalTokens, 0),
    ),
  }));

  const totalSeries: Series = {
    id: "total",
    label: "总量",
    color: "#111827",
    values: buckets.map((bucket) =>
      visible
        .filter(
          (record) =>
            record.timestamp >= bucket.start && record.timestamp < bucket.end,
        )
        .reduce((sum, record) => sum + record.totalTokens, 0),
    ),
  };

  return {
    visible,
    series:
      modelSeries.length > 1 ? [totalSeries, ...modelSeries] : modelSeries,
  };
};

export const TokenUsagePage = () => {
  const records = useTokenUsageStore((state) => state.records);
  const addRecords = useTokenUsageStore((state) => state.addRecords);
  const chatSessions = useWorkspaceStore((state) => state.chatSessions);
  const activeProvider = useWorkspaceStore((state) => state.activeProvider);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const [range, setRange] = useState<RangeKey>("7d");

  useEffect(() => {
    const backfillRecords = chatSessions
      .filter((chat) => chat.messages.length > 0)
      .map((chat) => {
        const inputTokens = chat.messages
          .filter(
            (message) => message.role === "user" || message.role === "system",
          )
          .reduce(
            (sum, message) =>
              sum +
              estimateTextTokens(message.content) +
              (message.attachments ?? []).reduce(
                (attachmentSum, attachment) =>
                  attachmentSum + estimateAttachmentTokens(attachment),
                0,
              ),
            0,
          );
        const outputTokens = chat.messages
          .filter((message) => message.role === "assistant")
          .reduce(
            (sum, message) => sum + estimateTextTokens(message.content),
            0,
          );

        return {
          id: `history:${chat.id}`,
          timestamp: chat.updatedAt || chat.createdAt || Date.now(),
          provider: activeProvider,
          model: activeModel,
          inputTokens,
          outputTokens,
        };
      })
      .filter((record) => record.inputTokens + record.outputTokens > 0);

    addRecords(backfillRecords);
  }, [activeModel, activeProvider, addRecords, chatSessions]);

  const buckets = useMemo(() => buildBuckets(range), [range]);
  const { visible, series } = useMemo(
    () => aggregateSeries(records, buckets),
    [records, buckets],
  );
  const totalTokens = visible.reduce(
    (sum, record) => sum + record.totalTokens,
    0,
  );
  const modelCount = new Set(visible.map(modelKey)).size;

  return (
    <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-8 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[#7b8494]">
              <Activity size={14} />
              Token Usage
            </div>
            <h1 className="text-2xl font-semibold text-[#14171f]">
              Token 用量
            </h1>
          </div>
          <div className="inline-flex rounded-lg bg-[#eef1f5] p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`h-8 rounded-md px-3 text-sm transition ${
                  range === option.key
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#667085] hover:text-[#111827]"
                }`}
                onClick={() => setRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="当前区间总量" value={formatTokenCount(totalTokens)} />
          <Metric label="模型数量" value={`${modelCount}`} />
          <Metric label="请求次数" value={`${visible.length}`} />
        </div>

        <div className="min-h-0 flex-1 rounded-2xl border border-[#dfe4ec] bg-white p-5 shadow-[0_10px_28px_rgb(17_24_39_/_0.05)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1f2430]">
              <CalendarDays size={16} className="text-[#667085]" />
              {RANGE_OPTIONS.find((item) => item.key === range)?.label}
            </div>
            <div className="flex flex-wrap justify-end gap-3 text-xs text-[#667085]">
              {series.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <TokenLineChart buckets={buckets} series={series} />
        </div>
      </div>
    </section>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-[#dfe4ec] bg-white px-4 py-3">
    <div className="text-xs text-[#7b8494]">{label}</div>
    <div className="mt-1 text-xl font-semibold text-[#111827]">{value}</div>
  </div>
);

const TokenLineChart = ({
  buckets,
  series,
}: {
  buckets: Bucket[];
  series: Series[];
}) => {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const yMax = Math.ceil(maxValue * 1.12);

  const option = useMemo<EChartsOption>(
    () => ({
      animation: true,
      animationDuration: 420,
      animationDurationUpdate: 320,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicInOut",
      stateAnimation: {
        duration: 160,
        easing: "cubicOut",
      },
      color: series.map((item) => item.color),
      grid: {
        top: 10,
        right: 12,
        bottom: 32,
        left: 48,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        transitionDuration: 0.16,
        backgroundColor: "rgba(255,255,255,0.94)",
        borderColor: "#dfe4ec",
        borderWidth: 1,
        padding: [10, 12],
        extraCssText:
          "border-radius:10px;box-shadow:0 14px 34px rgba(15,23,42,.14);backdrop-filter:blur(12px);",
        textStyle: {
          color: "#374151",
          fontSize: 12,
        },
        axisPointer: {
          type: "line",
          snap: true,
          lineStyle: {
            color: "#c8d0dc",
            width: 1,
            type: "dashed",
          },
        },
        formatter: (params: unknown) => {
          const payload = (
            Array.isArray(params) ? params : [params]
          ) as TooltipPoint[];
          const label =
            payload[0]?.axisValueLabel ?? payload[0]?.name ?? "";
          const rows = payload
            .filter((item) => Number(item.value ?? 0) > 0)
            .map((item) => {
              const value = Number(item.value ?? 0);
              return `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:160px;margin-top:6px">
                <span style="display:flex;align-items:center;gap:6px;color:${item.color ?? "#667085"}">
                  ${item.marker ?? ""}
                  <span style="color:#374151">${item.seriesName ?? ""}</span>
                </span>
                <span style="font-weight:600;color:#111827">${formatTokenCount(value)}</span>
              </div>`;
            });

          return [
            `<div style="margin-bottom:2px;color:#7b8494;font-weight:500">${label}</div>`,
            rows.length > 0
              ? rows.join("")
              : `<div style="margin-top:6px;color:#7b8494">0 tokens</div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: buckets.map((bucket) => bucket.label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: "#7b8494",
          fontSize: 11,
          interval:
            buckets.length > 16 ? Math.ceil(buckets.length / 8) - 1 : 0,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        splitNumber: 4,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: "#7b8494",
          fontSize: 11,
          formatter: (value: number) => formatTokenCount(value),
        },
        splitLine: {
          lineStyle: {
            color: "#dfe4ec",
            opacity: 0.55,
            type: "dashed",
          },
        },
      },
      series: series.map((item, index) => {
        const isTotal = item.id === "total";
        return {
          name: item.label,
          type: "line",
          data: item.values,
          smooth: true,
          showSymbol: false,
          symbol: "circle",
          symbolSize: isTotal ? 8 : 7,
          animationDelay: index * 45,
          animationDelayUpdate: index * 20,
          lineStyle: {
            width: isTotal ? 2.5 : 2,
            opacity: isTotal ? 0.92 : 0.86,
            cap: "round",
            join: "round",
          },
          areaStyle: isTotal
            ? undefined
            : {
                opacity: 1,
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0.05, color: `${item.color}33` },
                  { offset: 0.95, color: `${item.color}00` },
                ]),
              },
          itemStyle: {
            borderWidth: 1.5,
            borderColor: "#ffffff",
          },
          emphasis: {
            focus: "series",
            scale: true,
            itemStyle: {
              borderWidth: 2.5,
              borderColor: "#ffffff",
              shadowBlur: 8,
              shadowColor: `${item.color}66`,
            },
            lineStyle: {
              width: isTotal ? 3 : 2.5,
              opacity: 1,
            },
          },
        };
      }),
    }),
    [buckets, series, yMax],
  );

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    chartInstanceRef.current = chart;

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartInstanceRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={chartRef}
      className="h-full min-h-[420px] w-full"
      role="img"
      aria-label="Token 用量折线图"
    />
  );
};
