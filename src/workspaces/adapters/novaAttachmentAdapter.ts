import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import { extractDocxText, extractXlsxText } from "../../utils/fileExtractors";
import { logger } from "../../state/logStore";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".tsv", ".yaml", ".yml",
  ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".go", ".rs", ".sh", ".sql", ".toml",
  ".ini", ".env", ".log",
]);

const ACCEPTED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS,
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar", ".7z",
]);

const MAX_TEXT_LENGTH = 20_000;

const getExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

const isImageFile = (file: File) =>
  file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(getExtension(file.name));

const isDocxFile = (file: File) => getExtension(file.name) === ".docx";
const isXlsxFile = (file: File) => {
  const ext = getExtension(file.name);
  return ext === ".xlsx" || ext === ".xls";
};
const isTextFile = (file: File) =>
  file.type.startsWith("text/") || TEXT_EXTENSIONS.has(getExtension(file.name));

const truncateText = (text: string) =>
  text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH)}\n\n[文件内容已截断]`
    : text;

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export class NovaAttachmentAdapter implements AttachmentAdapter {
  readonly accept = Array.from(ACCEPTED_EXTENSIONS).map((e) => e).join(",");

  private attachments = new Map<string, { dataUrl?: string; textContent?: string }>();

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const type = isImageFile(file) ? "image" : "file";
    const id = crypto.randomUUID();

    const extra: { dataUrl?: string; textContent?: string } = {};

    if (isImageFile(file)) {
      extra.dataUrl = await fileToDataUrl(file);
    } else if (isDocxFile(file)) {
      try {
        extra.textContent = truncateText(await extractDocxText(file));
      } catch {
        extra.textContent = "[DOCX 解析失败，请确认文件格式正确]";
      }
    } else if (isXlsxFile(file)) {
      try {
        extra.textContent = truncateText(await extractXlsxText(file));
      } catch {
        extra.textContent = "[XLSX 解析失败，请确认文件格式正确]";
      }
    } else if (isTextFile(file)) {
      extra.textContent = truncateText(await file.text());
    }

    this.attachments.set(id, extra);

    const content = this.buildContentParts(file, extra);

    return {
      id,
      type,
      name: file.name,
      contentType: file.type || (type === "image" ? "image/png" : "application/octet-stream"),
      file,
      status: { type: "requires-action", reason: "composer-send" },
      content,
    };
  }

  async remove(attachment: Attachment): Promise<void> {
    this.attachments.delete(attachment.id);
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const extra = this.attachments.get(attachment.id);
    const content = this.buildContentParts(attachment.file!, extra);

    logger.info("attachment-adapter", "send 调用", {
      id: attachment.id,
      fileName: attachment.file?.name,
      hasExtra: Boolean(extra),
      hasDataUrl: Boolean(extra?.dataUrl),
      hasTextContent: Boolean(extra?.textContent),
      contentParts: content.map((p) => ({
        type: p.type,
        hasImage: "image" in p ? Boolean(p.image) : undefined,
        hasData: "data" in p ? Boolean(p.data) : undefined,
      })),
    });

    this.attachments.delete(attachment.id);

    return {
      ...attachment,
      status: { type: "complete" },
      content,
    };
  }

  private buildContentParts(
    file: File,
    extra?: { dataUrl?: string; textContent?: string },
  ) {
    if (isImageFile(file) && extra?.dataUrl) {
      return [{ type: "image" as const, image: extra.dataUrl, filename: file.name }];
    }

    return [
      {
        type: "file" as const,
        filename: file.name,
        data: extra?.textContent ?? "",
        mimeType: file.type || "application/octet-stream",
      },
    ];
  }
}
