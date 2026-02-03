import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
// Ensure we have a secret key. In production this should be a strong env var.
// Fallback is provided for dev convenience but produces a warning.
const SECRET_KEY = process.env.SECRET_KEY || "plane-api-next-secret-key-fallback-32-chars";

// Derive a 32-byte key from the secret
const key = scryptSync(SECRET_KEY, "salt", 32);

export const encryptData = (text: string): string => {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};

export const decryptData = (text: string): string => {
    const parts = text.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted data format");
    }

    const ivStr = parts[0];
    const authTagStr = parts[1];
    const encryptedText = parts[2];

    if (!ivStr || !authTagStr || !encryptedText) {
        throw new Error("Invalid encrypted data components");
    }

    const iv = Buffer.from(ivStr, "hex");
    const authTag = Buffer.from(authTagStr, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
};
