import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import { message } from "antd";
import { logger } from "../../state/logStore";
import { extractDocxText, extractXlsxText } from "../../utils/fileExtractors";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ini",
  ".env",
  ".log",
]);

const ACCEPTED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
  ".rar",
  ".7z",
]);

const MAX_TEXT_LENGTH = 20_000;

const getExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

const isImageFile = (file: File) =>
  file.type.startsWith("image/") ||
  IMAGE_EXTENSIONS.has(getExtension(file.name));

const isDocxFile = (file: File) => getExtension(file.name) === ".docx";

const isXlsxFile = (file: File) => {
  const ext = getExtension(file.name);
  return ext === ".xlsx" || ext === ".xls";
};

const isTextFile = (file: File) =>
  file.type.startsWith("text/") || TEXT_EXTENSIONS.has(getExtension(file.name));

const truncateText = (text: string) =>
  text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH)}\n\n[File content truncated]`
    : text;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

type StoredAttachmentContent = {
  name: string;
  size: number;
  dataUrl?: string;
  textContent?: string;
  filePath?: string;
};

const attachmentFilePaths = new Map<string, string>();

const filePathKey = (name: string, size?: number) =>
  `${name}\u0000${size ?? 0}`;

export const rememberNovaAttachmentFilePath = ({
  id,
  name,
  size,
  filePath,
}: {
  id?: string;
  name: string;
  size?: number;
  filePath?: string;
}) => {
  if (!filePath) return;
  if (id) attachmentFilePaths.set(id, filePath);
  attachmentFilePaths.set(filePathKey(name, size), filePath);
};

export const getNovaAttachmentFilePath = ({
  id,
  name,
  size,
}: {
  id?: string;
  name: string;
  size?: number;
}) =>
  attachmentFilePaths.get(id ?? "") ??
  attachmentFilePaths.get(filePathKey(name, size));

const duplicateAttachmentKeys = new Set<string>();

const duplicateKeyForFile = (file: File, filePath?: string) =>
  filePath || filePathKey(file.name, file.size);

const duplicateKeyForStoredAttachment = (attachment: StoredAttachmentContent) =>
  attachment.filePath || filePathKey(attachment.name, attachment.size);

export class NovaAttachmentAdapter implements AttachmentAdapter {
  readonly accept = Array.from(ACCEPTED_EXTENSIONS).join(",");

  private attachments = new Map<string, StoredAttachmentContent>();

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const type = isImageFile(file) ? "image" : "document";
    const id = crypto.randomUUID();
    const extra = await this.readAttachmentContent(file);
    const duplicateKey = duplicateKeyForFile(file, extra.filePath);

    if (duplicateAttachmentKeys.has(duplicateKey)) {
      message.warning(`该文件已上传`);
      throw new Error(`Duplicate attachment: ${file.name}`);
    }

    this.attachments.set(id, extra);
    duplicateAttachmentKeys.add(duplicateKey);
    rememberNovaAttachmentFilePath({
      id,
      name: file.name,
      size: file.size,
      filePath: extra.filePath,
    });

    return {
      id,
      type,
      name: file.name,
      contentType:
        file.type ||
        (type === "image" ? "image/png" : "application/octet-stream"),
      file,
      status: { type: "requires-action", reason: "composer-send" },
      content: this.buildContentParts(file, extra),
      filePath: extra.filePath,
    } as PendingAttachment & { filePath?: string };
  }

  async remove(attachment: Attachment): Promise<void> {
    const extra = this.attachments.get(attachment.id);
    if (extra) {
      duplicateAttachmentKeys.delete(duplicateKeyForStoredAttachment(extra));
    }
    this.attachments.delete(attachment.id);
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const extra: StoredAttachmentContent =
      this.attachments.get(attachment.id) ??
      (attachment.file
        ? await this.readAttachmentContent(attachment.file)
        : {
            name: attachment.name,
            size: 0,
            filePath: (attachment as PendingAttachment & { filePath?: string })
              .filePath,
          });
    const content = attachment.file
      ? this.buildContentParts(attachment.file, extra)
      : (attachment.content ?? []);
    rememberNovaAttachmentFilePath({
      id: attachment.id,
      name: attachment.name,
      size: attachment.file?.size,
      filePath: extra.filePath,
    });

    logger.info("attachment-adapter", "send called", {
      id: attachment.id,
      fileName: attachment.file?.name,
      type: attachment.type,
      filePath: extra.filePath,
      hasDataUrl: Boolean(extra.dataUrl),
      hasTextContent: Boolean(extra.textContent),
      contentParts: content.map((part) => ({
        type: part.type,
        hasImage: part.type === "image" ? Boolean(part.image) : undefined,
        hasData: part.type === "file" ? Boolean(part.data) : undefined,
        filename:
          part.type === "image" || part.type === "file"
            ? part.filename
            : undefined,
      })),
    });

    duplicateAttachmentKeys.delete(duplicateKeyForStoredAttachment(extra));
    this.attachments.delete(attachment.id);

    return {
      ...attachment,
      status: { type: "complete" },
      content,
      filePath: extra.filePath,
    } as CompleteAttachment & { filePath?: string };
  }

  private async readAttachmentContent(
    file: File,
  ): Promise<StoredAttachmentContent> {
    const filePath = window.novaDesk?.getFilePath?.(file) || undefined;

    if (isImageFile(file)) {
      return {
        name: file.name,
        size: file.size,
        dataUrl: await fileToDataUrl(file),
        filePath,
      };
    }

    if (isDocxFile(file)) {
      try {
        return {
          textContent: truncateText(await extractDocxText(file)),
          name: file.name,
          size: file.size,
          filePath,
        };
      } catch {
        return {
          textContent: "[DOCX parse failed. Check the file format.]",
          name: file.name,
          size: file.size,
          filePath,
        };
      }
    }

    if (isXlsxFile(file)) {
      try {
        return {
          textContent: truncateText(await extractXlsxText(file)),
          name: file.name,
          size: file.size,
          filePath,
        };
      } catch {
        return {
          textContent: "[XLSX parse failed. Check the file format.]",
          name: file.name,
          size: file.size,
          filePath,
        };
      }
    }

    if (isTextFile(file)) {
      return {
        name: file.name,
        size: file.size,
        textContent: truncateText(await file.text()),
        filePath,
      };
    }

    return { name: file.name, size: file.size, filePath };
  }

  private buildContentParts(file: File, extra: StoredAttachmentContent) {
    if (isImageFile(file) && extra.dataUrl) {
      return [
        { type: "image" as const, image: extra.dataUrl, filename: file.name },
      ];
    }

    return [
      {
        type: "file" as const,
        filename: file.name,
        data:
          extra.textContent ??
          `[File: ${file.name} (${file.type || "unknown"}, ${formatBytes(file.size)}) - content could not be read]`,
        mimeType: file.type || "application/octet-stream",
      },
    ];
  }
}
