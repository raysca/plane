import { S3Client } from "bun";
import { join } from "path";

const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

/** Whether S3 is configured via environment variables */
function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET)
  );
}

/** Get S3 credentials from env */
function getS3Options() {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    bucket: process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET!,
    region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1",
    endpoint: process.env.AWS_S3_ENDPOINT_URL || process.env.MINIO_ENDPOINT_URL || process.env.S3_ENDPOINT,
  };
}

/** Local uploads directory */
function getUploadDir(): string {
  return process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
}

export interface PresignedUploadData {
  url: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
}

export interface StorageProvider {
  /** Generate a presigned URL for uploading a file */
  generatePresignedUpload(objectKey: string, fileType: string, fileSize: number): PresignedUploadData;
  /** Generate a presigned URL for downloading/viewing a file */
  generatePresignedUrl(objectKey: string, disposition?: "inline" | "attachment", filename?: string): string;
  /** Get object metadata (size, content type, etc.) */
  getObjectMetadata(objectKey: string): Promise<Record<string, unknown> | null>;
  /** Write data directly to storage */
  writeFile(objectKey: string, data: Blob | ArrayBuffer | string, contentType?: string): Promise<boolean>;
  /** Delete a file from storage */
  deleteFile(objectKey: string): Promise<boolean>;
  /** Check if a file exists */
  exists(objectKey: string): Promise<boolean>;
}

/** S3-backed storage using Bun's built-in S3Client */
class S3StorageProvider implements StorageProvider {
  private opts: ReturnType<typeof getS3Options>;
  private expiresIn: number;

  constructor() {
    this.opts = getS3Options();
    this.expiresIn = parseInt(process.env.SIGNED_URL_EXPIRATION || "3600", 10);
  }

  generatePresignedUpload(objectKey: string, fileType: string, _fileSize: number): PresignedUploadData {
    const url = S3Client.presign(objectKey, {
      ...this.opts,
      method: "PUT",
      expiresIn: this.expiresIn,
      type: fileType,
    });
    return { url, method: "PUT", headers: { "Content-Type": fileType } };
  }

  generatePresignedUrl(objectKey: string, disposition: "inline" | "attachment" = "inline", filename?: string): string {
    const contentDisposition = filename
      ? `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
      : disposition;

    return S3Client.presign(objectKey, {
      ...this.opts,
      method: "GET",
      expiresIn: this.expiresIn,
      contentDisposition,
    });
  }

  async getObjectMetadata(objectKey: string): Promise<Record<string, unknown> | null> {
    try {
      const stat = await S3Client.stat(objectKey, this.opts);
      return {
        size: stat.size,
        type: stat.type,
        etag: stat.etag,
        lastModified: stat.lastModified,
      };
    } catch {
      return null;
    }
  }

  async writeFile(objectKey: string, data: Blob | ArrayBuffer | string, contentType?: string): Promise<boolean> {
    try {
      await S3Client.write(objectKey, data, {
        ...this.opts,
        ...(contentType ? { type: contentType } : {}),
      });
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(objectKey: string): Promise<boolean> {
    try {
      await S3Client.unlink(objectKey, this.opts);
      return true;
    } catch {
      return false;
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await S3Client.stat(objectKey, this.opts);
      return true;
    } catch {
      return false;
    }
  }
}

/** Local file-based storage fallback */
class LocalStorageProvider implements StorageProvider {
  private uploadDir: string;
  private baseUrl: string;

  constructor() {
    this.uploadDir = getUploadDir();
    this.baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8000}`;
  }

  generatePresignedUpload(objectKey: string, fileType: string, _fileSize: number): PresignedUploadData {
    // For local storage, the client uploads directly to our API
    const url = `${this.baseUrl}/api/assets/v2/upload/${encodeURIComponent(objectKey)}`;
    return { url, method: "PUT", headers: { "Content-Type": fileType } };
  }

  generatePresignedUrl(objectKey: string, disposition: "inline" | "attachment" = "inline", _filename?: string): string {
    return `${this.baseUrl}/api/assets/v2/local/${encodeURIComponent(objectKey)}`;
  }

  async getObjectMetadata(objectKey: string): Promise<Record<string, unknown> | null> {
    const filePath = join(this.uploadDir, objectKey);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return {
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified),
    };
  }

  async writeFile(objectKey: string, data: Blob | ArrayBuffer | string, _contentType?: string): Promise<boolean> {
    try {
      const filePath = join(this.uploadDir, objectKey);
      // Ensure directory exists
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      await Bun.write(dir + "/.gitkeep", "");
      await Bun.write(filePath, data);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(objectKey: string): Promise<boolean> {
    try {
      const filePath = join(this.uploadDir, objectKey);
      const { unlinkSync } = require("fs");
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    const filePath = join(this.uploadDir, objectKey);
    return Bun.file(filePath).exists();
  }
}

/** Get the appropriate storage provider */
export function getStorage(): StorageProvider {
  if (isS3Configured()) {
    return new S3StorageProvider();
  }
  return new LocalStorageProvider();
}

export { FILE_SIZE_LIMIT, isS3Configured };
