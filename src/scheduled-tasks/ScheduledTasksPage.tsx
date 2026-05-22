import {
  Clock,
  Play,
  Plus,
  Pencil,
  Trash2,
  Timer,
  Calendar,
} from "lucide-react";
import { DatePicker, Form, Input, Modal, Select, Switch, TimePicker, message } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import {
  CRON_PRESETS,
  INTERVAL_PRESETS,
  describeSchedule,
  useScheduledTaskStore,
  type ScheduleType,
  type ScheduledTask,
} from "../state/scheduledTaskStore";

import { executeTask } from "../utils/taskExecutor";

const { TextArea } = Input;

const scheduleTypeOptions: { label: string; value: ScheduleType }[] = [
  { label: "定时", value: "cron" },
  { label: "固定周期", value: "interval" },
  { label: "一次性", value: "once" },
];

const TaskCard = ({
  task,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: {
  task: ScheduledTask;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onToggle: (id: string) => void;
  onRun: (task: ScheduledTask) => void;
}) => {
  const scheduleLabel = describeSchedule(task);
  const TypeIcon =
    task.scheduleType === "cron"
      ? Calendar
      : task.scheduleType === "interval"
        ? Timer
        : Clock;

  return (
    <div
      className={`group flex flex-col rounded-2xl border bg-white p-4 transition-shadow hover:shadow-[0_6px_24px_rgb(15_23_42_/_0.07)] ${
        task.enabled ? "border-primary/20" : "border-[#e5e9f0]"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              task.enabled
                ? "bg-primary/10 text-primary"
                : "bg-[#f0f2f5] text-[#8a919d]"
            }`}
          >
            <TypeIcon size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[#111827]">
              {task.name}
            </h3>
            <span
              className={`text-[11px] ${task.enabled ? "text-emerald-600" : "text-[#9ca3af]"}`}
            >
              {scheduleLabel}
            </span>
          </div>
        </div>
        <Switch
          size="small"
          checked={task.enabled}
          onChange={() => onToggle(task.id)}
        />
      </div>

      {task.description ? (
        <p className="mb-2 line-clamp-2 text-xs leading-5 text-[#6b7280]">
          {task.description}
        </p>
      ) : null}

      <p className="mb-3 line-clamp-2 flex-1 rounded-lg bg-[#f8f9fb] px-3 py-2 font-mono text-[11px] leading-5 text-[#374151]">
        {task.prompt}
      </p>

      {task.lastRunAt ? (
        <p className="mb-2 text-[10px] text-[#9ca3af]">
          上次运行：{new Date(task.lastRunAt).toLocaleString()}
        </p>
      ) : null}

      <div className="flex items-center gap-1 border-t border-[#f0f2f5] pt-2.5">
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#8a919d] transition hover:bg-emerald-50 hover:text-emerald-600"
          onClick={() => onRun(task)}
        >
          <Play size={12} />
          <span>运行</span>
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#8a919d] transition hover:bg-[#f4f6f8] hover:text-primary"
          onClick={() => onEdit(task)}
        >
          <Pencil size={12} />
          <span>编辑</span>
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#8a919d] transition hover:bg-red-50 hover:text-red-500"
          onClick={() => onDelete(task)}
        >
          <Trash2 size={12} />
          <span>删除</span>
        </button>
      </div>
    </div>
  );
};

const TaskFormModal = ({
  open,
  task,
  onClose,
  onSave,
}: {
  open: boolean;
  task?: ScheduledTask | null;
  onClose: () => void;
  onSave: (values: any) => void;
}) => {
  const [form] = Form.useForm();
  const scheduleType =
    Form.useWatch("scheduleType", form) ?? task?.scheduleType ?? "cron";

  const initialDate = useMemo(
    () => (task?.fireAt ? dayjs(task.fireAt) : dayjs().add(1, "hour").startOf("hour")),
    [task],
  );
  const [fireDate, setFireDate] = useState(initialDate);
  const [fireTime, setFireTime] = useState(initialDate);

  const fireAtIso = useMemo(() => {
    const merged = fireDate
      .hour(fireTime.hour())
      .minute(fireTime.minute())
      .second(0);
    return merged.format("YYYY-MM-DDTHH:mm:ss");
  }, [fireDate, fireTime]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const dt = task?.fireAt ? dayjs(task.fireAt) : dayjs().add(1, "hour").startOf("hour");
      setFireDate(dt);
      setFireTime(dt);
    }
  };

  return (
    <Modal
      title={task ? "编辑定时任务" : "新建定时任务"}
      open={open}
      onCancel={onClose}
      afterOpenChange={handleOpenChange}
      onOk={() => {
        form.validateFields().then((values) => {
          onSave({
            ...values,
            fireAt: values.scheduleType === "once" ? fireAtIso : undefined,
          });
        });
      }}
      okText="保存"
      cancelText="取消"
      width={560}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        className="pt-2"
        initialValues={
          task
            ? {
                name: task.name,
                description: task.description,
                scheduleType: task.scheduleType,
                cronExpression: task.cronExpression ?? CRON_PRESETS[1].value,
                intervalMs: task.intervalMs ?? INTERVAL_PRESETS[3].value,
                prompt: task.prompt,
                enabled: task.enabled,
              }
            : {
                scheduleType: "cron",
                cronExpression: CRON_PRESETS[1].value,
                intervalMs: INTERVAL_PRESETS[3].value,
                enabled: true,
              }
        }
      >
        <Form.Item
          label="任务名称"
          name="name"
          rules={[{ required: true, message: "请输入名称" }]}
        >
          <Input placeholder="例如：每日代码审查" />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input placeholder="简要描述任务用途（可选）" />
        </Form.Item>

        <Form.Item
          label="运行周期"
          name="scheduleType"
          rules={[{ required: true }]}
        >
          <Select options={scheduleTypeOptions} />
        </Form.Item>

        {scheduleType === "cron" && (
          <Form.Item
            label="计划"
            name="cronExpression"
            rules={[{ required: true, message: "请选择或输入计划" }]}
          >
            <Select
              showSearch
              options={CRON_PRESETS.map((p) => ({
                label: p.label,
                value: p.value,
              }))}
              placeholder="选择预设或输入自定义表达式"
            />
          </Form.Item>
        )}

        {scheduleType === "interval" && (
          <Form.Item
            label="计划"
            name="intervalMs"
            rules={[{ required: true }]}
          >
            <Select
              options={INTERVAL_PRESETS.map((p) => ({
                label: p.label,
                value: p.value,
              }))}
            />
          </Form.Item>
        )}

        {scheduleType === "once" && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#374151]">
              运行时间
            </label>
            <div className="flex gap-3">
              <DatePicker
                className="flex-1"
                value={fireDate}
                onChange={(d) => d && setFireDate(d)}
                placeholder="选择日期"
                format="YYYY 年 MM 月 DD 日"
              />
              <TimePicker
                className="flex-1"
                value={fireTime}
                onChange={(t) => t && setFireTime(t)}
                placeholder="选择时间"
                format="HH:mm"
                minuteStep={5}
                showNow={false}
              />
            </div>
            <p className="mt-2 text-xs text-[#9ca3af]">
              {fireAtIso.replace("T", " ")}
            </p>
          </div>
        )}

        <Form.Item
          label="执行指令"
          name="prompt"
          rules={[{ required: true, message: "请输入要执行的指令" }]}
        >
          <TextArea
            rows={4}
            placeholder="输入要定时执行的指令…"
            className="font-mono text-sm"
          />
        </Form.Item>

        <Form.Item label="立即启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export const ScheduledTasksPage = () => {
  const tasks = useScheduledTaskStore((s) => s.tasks);
  const addTask = useScheduledTaskStore((s) => s.addTask);
  const updateTask = useScheduledTaskStore((s) => s.updateTask);
  const deleteTask = useScheduledTaskStore((s) => s.deleteTask);
  const toggleTask = useScheduledTaskStore((s) => s.toggleTask);

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);

  const enabledCount = useMemo(
    () => tasks.filter((t) => t.enabled).length,
    [tasks],
  );

  const handleSave = (values: any) => {
    const draft = {
      name: values.name,
      description: values.description ?? "",
      scheduleType: values.scheduleType as ScheduleType,
      cronExpression:
        values.scheduleType === "cron" ? values.cronExpression : undefined,
      intervalMs:
        values.scheduleType === "interval" ? values.intervalMs : undefined,
      fireAt: values.scheduleType === "once" ? values.fireAt : undefined,
      prompt: values.prompt,
      enabled: values.enabled ?? true,
    };

    if (editingTask) {
      updateTask(editingTask.id, draft);
      message.success("任务已更新");
    } else {
      addTask(draft);
      message.success("任务已创建");
    }

    setFormOpen(false);
    setEditingTask(null);
  };

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setFormOpen(true);
  };

  const handleDelete = (task: ScheduledTask) => {
    Modal.confirm({
      centered: true,
      title: "确认删除",
      content: `删除「${task.name}」后无法撤销。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        deleteTask(task.id);
        message.success("已删除");
      },
    });
  };

  const handleRun = async (task: ScheduledTask) => {
    message.loading({ content: `正在执行「${task.name}」…`, key: task.id });
    const ok = await executeTask(task);
    if (ok) {
      message.success({ content: `任务「${task.name}」执行完成`, key: task.id });
    } else {
      message.error({ content: `任务「${task.name}」执行失败`, key: task.id });
    }
  };

  return (
    <section className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[#f8f9fb]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-1 pb-8 pt-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-[#111827]">定时任务</h1>
              <p className="mt-0.5 text-xs text-[#6b7280]">
                {enabledCount} 个任务已启用 · 创建自动执行的定时指令
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/90"
              onClick={() => {
                setEditingTask(null);
                setFormOpen(true);
              }}
            >
              <Plus size={13} />
              新建任务
            </button>
          </div>

          {tasks.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggle={toggleTask}
                  onRun={handleRun}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8e0f0] bg-white py-14">
              <Clock size={28} className="mb-2 text-[#c4c9d4]" />
              <p className="text-sm text-[#9ca3af]">暂无定时任务</p>
              <p className="mt-1 text-xs text-[#c4c9d4]">
                点击「新建任务」开始
              </p>
            </div>
          )}
        </div>
      </div>

      <TaskFormModal
        open={formOpen}
        task={editingTask}
        onClose={() => {
          setFormOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSave}
      />
    </section>
  );
};
