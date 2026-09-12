import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cancelOwner,
  controlTurn,
  runHermes,
  type ChatRequest,
} from "./hermes-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devServerUrl = process.env.NOVA_DEV_SERVER_URL || "http://127.0.0.1:5173";
const hermesExecutableName =
  process.platform === "win32" ? "hermes.exe" : "hermes";
const hermesBinDir = process.platform === "win32" ? "Scripts" : "bin";

const getBundledHermesCommand = () => {
  if (process.env.HERMES_CLI_PATH) {
    return process.env.HERMES_CLI_PATH;
  }

  const vendorRoot = isDev
    ? path.join(process.cwd(), "vendor")
    : path.join(process.resourcesPath, "vendor");

  return path.join(
    vendorRoot,
    "hermes-agent",
    ".venv",
    hermesBinDir,
    hermesExecutableName,
  );
};

const getBundledHermesHome = () => {
  if (process.env.HERMES_HOME) {
    return process.env.HERMES_HOME;
  }

  const vendorRoot = isDev
    ? path.join(process.cwd(), "vendor")
    : path.join(process.resourcesPath, "vendor");

  return path.join(vendorRoot, "hermes-home");
};

type HermesChatRequest = {
  requestId?: string;
  prompt: string;
  sessionId?: string | null;
  attachments?: {
    id: string;
    name: string;
    type: "image" | "file";
    mimeType: string;
    dataUrl?: string;
    textContent?: string;
    filePath?: string;
    size: number;
  }[];
  modelConfig?: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    protocol?: string;
    activeModel?: string;
  };
};

type HermesChatResponse = {
  text: string;
  sessionId: string | null;
};

const hasImageAttachments = (attachments?: HermesChatRequest["attachments"]) =>
  Boolean(attachments?.some((attachment) => attachment.type === "image" && attachment.dataUrl));

const hasAnyImageAttachments = (attachments?: HermesChatRequest["attachments"]) =>
  Boolean(attachments?.some((attachment) => attachment.type === "image"));

const normalizeOpenAiBaseUrl = (baseUrl: string) => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
};

const directOpenAiCompatibleChat = async (
  { prompt, modelConfig, attachments }: HermesChatRequest,
  emitChunk?: (chunk: string) => void,
): Promise<HermesChatResponse> => {
  if (!modelConfig?.apiKey || !modelConfig.baseUrl || !modelConfig.activeModel) {
    throw new Error("Image messages require API Key, Base URL, and model configuration.");
  }

  const content = [
    {
      type: "text",
      text: [
        "The user attached one or more images in this same message as image_url content.",
        "Analyze the attached image pixels directly. Do not try to read a local filename or claim the image is inaccessible via the filesystem.",
        prompt,
      ].join("\n\n"),
    },
    ...(attachments ?? [])
      .filter((attachment) => attachment.type === "image" && attachment.dataUrl)
      .map((attachment) => ({
        type: "image_url",
        image_url: {
          url: attachment.dataUrl,
        },
      })),
  ];

  const response = await fetch(normalizeOpenAiBaseUrl(modelConfig.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: modelConfig.activeModel,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      stream: Boolean(emitChunk),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Image request failed with HTTP ${response.status}`);
  }

  if (!emitChunk) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      sessionId: null,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Image request returned no response body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[];
          };
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
          if (delta) {
            text += delta;
            emitChunk(delta);
          }
        } catch {
          // Ignore malformed non-JSON SSE keepalive lines.
        }
      }
    }
  }

  return { text, sessionId: null };
};

const dataUrlToBuffer = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) {
    throw new Error("Invalid attachment data URL.");
  }

  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  return Buffer.from(isBase64 ? payload : decodeURIComponent(payload), isBase64 ? "base64" : "utf8");
};

const extensionFromMime = (mimeType: string) => {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
  };

  return map[mimeType.toLowerCase()] ?? ".png";
};

const materializeImageAttachments = (attachments?: HermesChatRequest["attachments"]) => {
  const imagePaths: string[] = [];
  const cleanupPaths: string[] = [];

  for (const attachment of attachments ?? []) {
    if (attachment.type !== "image" || !attachment.dataUrl) {
      continue;
    }

    const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "nova-attachment-"));
    const imagePath = path.join(dir, `${attachment.id}${extensionFromMime(attachment.mimeType)}`);
    fs.writeFileSync(imagePath, dataUrlToBuffer(attachment.dataUrl));
    imagePaths.push(imagePath);
    cleanupPaths.push(dir);
  }

  return { imagePaths, cleanupPaths };
};

const preparePromptForCli = (prompt: string) => {
  if (prompt.length <= 20_000) {
    return { prompt, cleanupPath: null as string | null };
  }

  const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "nova-prompt-"));
  const promptPath = path.join(dir, "prompt.md");
  fs.writeFileSync(promptPath, prompt, "utf8");

  return {
    prompt: `${promptPath} 请读取这个提示文件，并根据里面的完整用户请求回答。`,
    cleanupPath: dir,
  };
};

type SkillFsFile = {
  path: string;
  content: string;
};

type SkillPackagePayload = {
  packageId: string;
  files: SkillFsFile[];
};

const textSkillFileExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
]);
const maxSkillFileBytes = 1024 * 1024;
const maxSkillPackageBytes = 8 * 1024 * 1024;

const getSkillsRoot = () => path.join(app.getPath("userData"), "skills");

const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
};

const assertSafePackageId = (packageId: string) => {
  if (!/^[a-zA-Z0-9._-]+$/.test(packageId)) {
    throw new Error("Invalid skill package id.");
  }
};

const resolveSkillPackageDir = (packageId: string) => {
  assertSafePackageId(packageId);
  const root = path.resolve(getSkillsRoot());
  const packageDir = path.resolve(root, packageId);

  if (!isPathInside(root, packageDir)) {
    throw new Error("Skill package path escapes the skills root.");
  }

  return packageDir;
};

const resolveSkillFilePath = (packageDir: string, relativePath: string) => {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("Invalid skill file path.");
  }

  const normalized = path.normalize(relativePath.replace(/\\/g, "/"));
  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Skill file path escapes the package directory.");
  }

  const filePath = path.resolve(packageDir, normalized);
  if (!isPathInside(packageDir, filePath)) {
    throw new Error("Skill file path escapes the package directory.");
  }

  return filePath;
};

const shouldReadSkillTextFile = (filePath: string) =>
  textSkillFileExtensions.has(path.extname(filePath).toLowerCase());

const readSkillFilesRecursive = async (
  rootDir: string,
  currentDir = rootDir,
  byteBudget = { used: 0 },
): Promise<SkillFsFile[]> => {
  const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
  const files: SkillFsFile[] = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await readSkillFilesRecursive(rootDir, absolutePath, byteBudget)),
      );
      continue;
    }

    if (!entry.isFile() || !shouldReadSkillTextFile(absolutePath)) {
      continue;
    }

    const stat = await fsPromises.stat(absolutePath);
    if (
      stat.size > maxSkillFileBytes ||
      byteBudget.used + stat.size > maxSkillPackageBytes
    ) {
      continue;
    }

    byteBudget.used += stat.size;
    files.push({
      path: path.relative(rootDir, absolutePath).replace(/\\/g, "/"),
      content: await fsPromises.readFile(absolutePath, "utf8"),
    });
  }

  return files;
};

const writeSkillPackage = async ({ packageId, files }: SkillPackagePayload) => {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Skill package has no files to write.");
  }

  const packageDir = resolveSkillPackageDir(packageId);
  await fsPromises.rm(packageDir, { recursive: true, force: true });
  await fsPromises.mkdir(packageDir, { recursive: true });

  for (const file of files) {
    const targetPath = resolveSkillFilePath(packageDir, file.path);
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
    await fsPromises.writeFile(targetPath, file.content, "utf8");
  }

  return {
    id: packageId,
    rootPath: packageDir,
  };
};

const getApiMode = (provider?: string, protocol?: string) => {
  if (getHermesProviderName(provider) === "xiaomi") {
    return "chat_completions";
  }

  if (protocol === "anthropic") {
    return "anthropic_messages";
  }

  return "chat_completions";
};

const parseSessionId = (stderr: string) => {
  const match = stderr.match(/session_id:\s*([^\s]+)/i);
  return match?.[1] ?? null;
};

const getHermesProviderName = (provider?: string) => {
  const providerMap: Record<string, string> = {
    deepseek: "deepseek",
    kimi: "moonshot",
    glm: "zai",
    minimax: "minimax",
    mimo: "xiaomi",
  };

  return provider ? (providerMap[provider] ?? provider) : undefined;
};

const getProviderEnv = (config: HermesChatRequest["modelConfig"]) => {
  if (!config?.apiKey) {
    return {};
  }

  const envByProvider: Record<string, Record<string, string>> = {
    deepseek: { DEEPSEEK_API_KEY: config.apiKey },
    kimi: { MOONSHOT_API_KEY: config.apiKey, KIMI_API_KEY: config.apiKey },
    glm: { ZAI_API_KEY: config.apiKey, ZHIPUAI_API_KEY: config.apiKey },
    minimax: { MINIMAX_API_KEY: config.apiKey },
    mimo: { MIMO_API_KEY: config.apiKey, XIAOMI_API_KEY: config.apiKey },
  };

  const env = envByProvider[config.provider ?? ""] ?? {};

  if (!config.baseUrl) {
    return env;
  }

  const baseUrlEnvByProvider: Record<string, Record<string, string>> = {
    deepseek: { DEEPSEEK_BASE_URL: config.baseUrl },
    kimi: { MOONSHOT_BASE_URL: config.baseUrl, KIMI_BASE_URL: config.baseUrl },
    glm: { GLM_BASE_URL: config.baseUrl, ZAI_BASE_URL: config.baseUrl },
    minimax: { MINIMAX_BASE_URL: config.baseUrl },
    mimo: { MIMO_BASE_URL: config.baseUrl, XIAOMI_BASE_URL: config.baseUrl },
  };

  return {
    ...env,
    ...(baseUrlEnvByProvider[config.provider ?? ""] ?? {}),
  };
};

const writeRequestHermesHome = (
  baseHermesHome: string,
  config: HermesChatRequest["modelConfig"],
) => {
  if (
    !config?.provider ||
    !config.apiKey?.trim() ||
    !config.activeModel?.trim()
  ) {
    return baseHermesHome;
  }

  const hermesProvider =
    getHermesProviderName(config.provider) ?? config.provider;
  const requestHome = fs.mkdtempSync(
    path.join(app.getPath("temp"), "nova-hermes-"),
  );
  const providerEnv = getProviderEnv(config);
  const envLines = Object.entries(providerEnv)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`);

  fs.writeFileSync(
    path.join(requestHome, ".env"),
    `${envLines.join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(requestHome, "config.yaml"),
    [
      "model:",
      `  provider: ${hermesProvider}`,
      `  default: ${config.activeModel.trim()}`,
      `  base_url: ${config.baseUrl?.trim() || ""}`,
      `  api_mode: ${getApiMode(config.provider, config.protocol)}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return requestHome;
};

const chatWithHermes = (
  { prompt, requestId, modelConfig, attachments }: HermesChatRequest,
  emitChunk?: (chunk: string) => void,
) =>
  new Promise<HermesChatResponse>((resolve, reject) => {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      reject(new Error("Prompt is empty."));
      return;
    }

    if (hasImageAttachments(attachments)) {
      directOpenAiCompatibleChat(
        { prompt: trimmedPrompt, requestId, modelConfig, attachments },
        emitChunk,
      )
        .then(resolve)
        .catch(reject);
      return;
    }

    if (hasAnyImageAttachments(attachments)) {
      reject(
        new Error(
          "Image attachment data is missing. Please remove the image and upload it again.",
        ),
      );
      return;
    }

    const promptForCli = preparePromptForCli(trimmedPrompt);
    const args = ["chat", "--quiet", "--query", promptForCli.prompt];
    const hermesProvider = getHermesProviderName(modelConfig?.provider);

    if (hermesProvider) {
      args.push("--provider", hermesProvider);
    }

    if (modelConfig?.activeModel) {
      args.push("--model", modelConfig.activeModel);
    }

    const hermesCommand = getBundledHermesCommand();
    const bundledHermesHome = getBundledHermesHome();
    const hermesHome = writeRequestHermesHome(bundledHermesHome, modelConfig);
    const cleanupTempInputs = () => {
      for (const cleanupPath of [promptForCli.cleanupPath].filter(
        Boolean,
      ) as string[]) {
        try {
          fs.rmSync(cleanupPath, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup for temporary prompt and attachment files.
        }
      }
    };
    const cleanupHermesHome = () => {
      if (hermesHome === bundledHermesHome) {
        return;
      }

      try {
        fs.rmSync(hermesHome, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup for per-request Hermes config.
      }
    };

    if (!fs.existsSync(hermesCommand)) {
      reject(
        new Error(
          `Bundled Hermes Agent runtime is missing at ${hermesCommand}. Restart with "pnpm start" so Nova Desk can prepare the embedded runtime automatically.`,
        ),
      );
      return;
    }

    const child = spawn(hermesCommand, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...getProviderEnv(modelConfig),
        HERMES_HOME: hermesHome,
        HERMES_INFERENCE_PROVIDER:
          hermesProvider ?? process.env.HERMES_INFERENCE_PROVIDER,
        HERMES_INFERENCE_MODEL:
          modelConfig?.activeModel ?? process.env.HERMES_INFERENCE_MODEL,
        OPENAI_API_KEY: modelConfig?.apiKey || process.env.OPENAI_API_KEY,
        OPENAI_BASE_URL: modelConfig?.baseUrl || process.env.OPENAI_BASE_URL,
        NO_COLOR: "1",
        TERM: "dumb",
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        PYTHONUTF8: "1",
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      cleanupHermesHome();
      cleanupTempInputs();
      reject(new Error("Hermes Agent request timed out."));
    }, 300_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      emitChunk?.(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      cleanupHermesHome();
      cleanupTempInputs();
      reject(
        new Error(
          `Failed to start bundled Hermes Agent at ${hermesCommand}. Restart with "pnpm start" so Nova Desk can prepare the embedded runtime automatically. ${error.message}`,
        ),
      );
    });

    child.once("exit", (code) => {
      clearTimeout(timeout);
      cleanupHermesHome();
      cleanupTempInputs();

      const text = stdout.trim();
      if (code === 0) {
        if (!text) {
          reject(
            new Error(
              (
                stderr ||
                "Hermes Agent exited successfully but returned an empty response."
              ).trim(),
            ),
          );
          return;
        }

        resolve({ text, sessionId: null });
        return;
      }

      reject(
        new Error(
          (stderr || stdout || `Hermes Agent exited with code ${code}`).trim(),
        ),
      );
    });
  });

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#F5F7FB",
    title: "Nova Desk",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const owner = window.webContents.id;
  window.on("closed", () => void cancelOwner(owner));
  window.webContents.on("render-process-gone", () => void cancelOwner(owner));

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    try {
      await window.loadURL(devServerUrl);
    } catch (error) {
      console.error(
        `Failed to load Vite dev server at ${devServerUrl}. Run pnpm start to launch both Vite and Electron.`,
        error,
      );
      throw error;
    }
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(path.join(__dirname, "../dist/index.html"));
};

app.whenReady().then(async () => {
  ipcMain.handle("nova:runtime-info", () => ({
    appName: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle("nova:open-path", async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== "string") {
      return "Invalid file path.";
    }

    return shell.openPath(filePath);
  });

  const runChat = (event: Electron.IpcMainInvokeEvent, request: ChatRequest) => {
    const requestId = request.requestId || randomUUID();
    if (hasAnyImageAttachments(request.attachments as HermesChatRequest["attachments"])) {
      return chatWithHermes({ ...request, requestId } as HermesChatRequest, (chunk) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`hermes:event:${requestId}`, { type: "delta", text: chunk });
        }
      });
    }
    return runHermes(
      { ...request, requestId },
      event.sender.id,
      (data) => {
        if (!event.sender.isDestroyed()) event.sender.send(`hermes:event:${requestId}`, data);
      },
      {
        vendor: path.join(isDev ? process.cwd() : process.resourcesPath, "vendor"),
        bridge: path.join(isDev ? process.cwd() : process.resourcesPath, "scripts", "hermes-bridge.py"),
        data: app.getPath("userData"),
      },
    );
  };

  ipcMain.handle("hermes:chat", (event, request: ChatRequest) =>
    runChat(event, { ...request, testMode: true }),
  );
  ipcMain.handle("hermes:chat-stream", runChat);
  ipcMain.handle("hermes:cancel", (event, requestId: string) =>
    controlTurn(event.sender.id, requestId),
  );
  ipcMain.handle("hermes:reply", (event, requestId: string, id: string, value: string) =>
    controlTurn(event.sender.id, requestId, id, value),
  );

  ipcMain.handle("skills:get-root", async () => {
    const root = getSkillsRoot();
    await fsPromises.mkdir(root, { recursive: true });
    return root;
  });

  ipcMain.handle("skills:list-packages", async () => {
    const root = getSkillsRoot();
    await fsPromises.mkdir(root, { recursive: true });
    const entries = await fsPromises.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  });

  ipcMain.handle("skills:read-package", async (_event, packageId: string) => {
    const packageDir = resolveSkillPackageDir(packageId);
    const files = await readSkillFilesRecursive(packageDir);
    return {
      id: packageId,
      rootPath: packageDir,
      files,
    };
  });

  ipcMain.handle(
    "skills:write-package",
    async (_event, payload: SkillPackagePayload) => writeSkillPackage(payload),
  );

  ipcMain.handle("skills:delete-package", async (_event, packageId: string) => {
    const packageDir = resolveSkillPackageDir(packageId);
    await fsPromises.rm(packageDir, { recursive: true, force: true });
  });

  ipcMain.handle("skills:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择技能文件夹",
      properties: ["openDirectory"],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const rootPath = result.filePaths[0];
    return {
      rootPath,
      name: path.basename(rootPath),
      files: await readSkillFilesRecursive(rootPath),
    };
  });

  ipcMain.handle("skills:reveal-root", async () => {
    const root = getSkillsRoot();
    await fsPromises.mkdir(root, { recursive: true });
    await shell.openPath(root);
    return root;
  });

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let quittingAfterCleanup = false;
app.on("before-quit", (event) => {
  if (quittingAfterCleanup) return;
  event.preventDefault();
  void cancelOwner().finally(() => {
    quittingAfterCleanup = true;
    app.quit();
  });
});
