"""One Nova turn over NDJSON; stdout is reserved for protocol events."""
import json
import os
from pathlib import Path
import queue
import sys
import threading
import uuid

wire = sys.stdout
sys.stdout = sys.stderr
sys.path.insert(0, sys.argv[1])
write_lock = threading.Lock()
pending = {}
pending_lock = threading.Lock()
cancelled = threading.Event()
agent = None


def emit(kind, **data):
    with write_lock:
        wire.write(json.dumps({"type": kind, **data}, ensure_ascii=False, default=str) + "\n")
        wire.flush()


def ask(kind, **data):
    interaction_id = str(uuid.uuid4())
    answer = queue.Queue(maxsize=1)
    with pending_lock:
        pending[interaction_id] = answer
    emit(kind, id=interaction_id, **data)
    try:
        while not cancelled.is_set():
            try:
                return answer.get(timeout=0.1)
            except queue.Empty:
                pass
        return "deny" if kind == "approval" else "用户已停止任务。"
    finally:
        with pending_lock:
            pending.pop(interaction_id, None)


def read_controls():
    for line in sys.stdin:
        try:
            control = json.loads(line)
            if control.get("type") == "cancel":
                cancelled.set()
                if agent is not None:
                    agent.interrupt()
            elif control.get("type") == "reply":
                with pending_lock:
                    answer = pending.get(control.get("id"))
                    if answer is not None and answer.empty():
                        answer.put_nowait(str(control.get("value", "")))
        except (ValueError, queue.Full):
            continue
    cancelled.set()
    if agent is not None:
        agent.interrupt()


def run(request):
    global agent
    config = request["modelConfig"]
    # Auxiliary tasks must see the same endpoint/model as the foreground turn.
    os.environ["OPENAI_API_KEY"] = config["apiKey"]
    os.environ["OPENAI_BASE_URL"] = config["baseUrl"]
    os.environ["HERMES_INFERENCE_PROVIDER"] = config["provider"]
    os.environ["HERMES_INFERENCE_MODEL"] = config["activeModel"]
    provider_env = {
        "deepseek": ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"),
        "moonshot": ("MOONSHOT_API_KEY", "MOONSHOT_BASE_URL"),
        "zai": ("ZAI_API_KEY", "ZAI_BASE_URL"),
        "xiaomi": ("MIMO_API_KEY", "MIMO_BASE_URL"),
    }.get(config["provider"])
    if provider_env:
        os.environ[provider_env[0]] = config["apiKey"]
        os.environ[provider_env[1]] = config["baseUrl"]
    # Never inherit oneshot's automatic approval switches.
    os.environ.pop("HERMES_YOLO_MODE", None)
    os.environ.pop("HERMES_ACCEPT_HOOKS", None)
    os.environ["HERMES_INTERACTIVE"] = "1"
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools
    from tools.terminal_tool import set_approval_callback, register_task_env_overrides
    from run_agent import AIAgent
    from agent.auxiliary_client import set_runtime_main
    set_runtime_main(config["provider"], config["activeModel"])

    session_id = request.get("sessionId") or str(uuid.uuid4())
    # IDs are opaque UUIDs, never filesystem paths from a renderer.
    uuid.UUID(session_id)
    session_dir = Path(request["sessionDir"])
    session_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = session_dir / (session_id + ".json")
    history = request.get("history") or []
    hermes_id = session_id
    if request.get("sessionId"):
        if not snapshot_path.exists():
            raise ValueError("会话续接记录不存在，请新建对话。")
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        history = snapshot["messages"]
        hermes_id = snapshot["hermesId"]

    def approval(command, description, **_kwargs):
        answer = ask("approval", command=command, description=description)
        return "once" if answer == "once" else "deny"

    def tool_start(call_id, name, args):
        emit("tool_start", id=call_id, name=name, args=args)

    def tool_complete(call_id, name, args, result):
        emit("tool_complete", id=call_id, name=name, args=args, result=str(result)[:24000])

    set_approval_callback(approval)
    cfg = load_config()
    agent = AIAgent(
        model=config["activeModel"], provider=config["provider"],
        api_key=config["apiKey"], base_url=config["baseUrl"],
        api_mode=config["apiMode"], quiet_mode=True, platform="cli",
        session_id=hermes_id,
        enabled_toolsets=[] if request.get("testMode") else sorted(_get_platform_tools(cfg, "cli")),
        skip_context_files=bool(request.get("testMode")),
        skip_memory=bool(request.get("testMode")),
        stream_delta_callback=lambda text: emit("delta", text=text) if text else None,
        tool_start_callback=tool_start, tool_complete_callback=tool_complete,
        clarify_callback=lambda question, choices=None: ask("clarify", question=question, choices=choices or []),
        status_callback=lambda kind, message: emit("status", text=str(message)),
    )
    agent.suppress_status_output = True
    if cancelled.is_set():
        emit("cancelled")
        return
    register_task_env_overrides(session_id, {"cwd": request["workspace"]})
    result = agent.run_conversation(
        user_message=request["prompt"], conversation_history=history, task_id=session_id,
    )
    if cancelled.is_set() or result.get("interrupted"):
        emit("cancelled")
        return
    if result.get("error") or not result.get("completed", True) or result.get("partial"):
        raise RuntimeError(result.get("error") or "本轮执行未完成，请重试。")
    if not request.get("testMode"):
        # Atomic commit: a failed/cancelled turn never replaces the last good history.
        temp = snapshot_path.with_suffix(".tmp")
        temp.write_text(json.dumps({"hermesId": agent.session_id, "messages": result["messages"]},
                                   ensure_ascii=False), encoding="utf-8")
        temp.replace(snapshot_path)
    emit("done", text=result.get("final_response") or "", sessionId=None if request.get("testMode") else session_id)


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.readline())
        threading.Thread(target=read_controls, daemon=True).start()
        run(request)
    except Exception as error:
        emit("error", message=str(error))
