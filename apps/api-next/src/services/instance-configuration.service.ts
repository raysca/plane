import { db } from "../db";
import { instanceConfigurations } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { encryptData, decryptData } from "../lib/encryption";

export class InstanceConfigurationService {
    /**
     * Get all configurations
     */
    async getConfigurations() {
        const configs = await db.select().from(instanceConfigurations);

        // We generally don't decrypt everything on list, usually just return the list.
        // However, if the frontend needs values, we might need to (but secrets usually stay hidden/masked).
        // For now, mirroring Django: it serializers values. If encrypted, Django decrypts them on access in some utils, 
        // but the API lists them.
        // Wait, Django `get_configuration_value` decrypts. 
        // The Admin API `InstanceConfigurationEndpoint.get` returns `InstanceConfigurationSerializer`.
        // We'll return raw values, assuming the frontend handles masking if needed? 
        // Actually, for security, we should probably NOT return decrypted values of encrypted fields unless necessary.
        // Checking Django: `InstanceConfigurationSerializer` just returns the model fields.
        // If it's encrypted in DB, it returns the encrypted string? 
        // Checking Django View: `patch` encrypts. `get` just serializes.
        // So if it is encrypted, the frontend gets the encrypted string (or specific fields are marked encrypted).
        // Let's stick to returning what keys exist.

        return configs;
    }

    /**
     * Bulk update configurations
     */
    async updateConfigurations(data: Record<string, any>) {
        const dataKeys = Object.keys(data);
        if (dataKeys.length === 0) return [];

        const existingConfigs = await db
            .select()
            .from(instanceConfigurations)
            .where(inArray(instanceConfigurations.key, dataKeys));

        const existingConfigMap = new Map(existingConfigs.map((c) => [c.key, c]));
        const results = [];

        for (const key of dataKeys) {
            let value = data[key];
            const existing = existingConfigMap.get(key);

            // Determine if encryption is needed. 
            // Django uses a meta flag on the row `is_encrypted`.
            // If we are creating a new one, we need to know if it should be encrypted.
            // For migration parity, we rely on the existing row's flag. 
            // If it's a new key, we default to false unless we have a map of sensitive keys.

            const isEncrypted = existing?.isEncrypted ?? false; // Default false for new keys for now

            if (isEncrypted && value) {
                value = encryptData(String(value));
            }

            if (existing) {
                // Update
                const updated = await db
                    .update(instanceConfigurations)
                    .set({
                        value: String(value),
                        updatedAt: new Date(),
                    })
                    .where(eq(instanceConfigurations.id, existing.id))
                    .returning();
                results.push(updated[0]);
            } else {
                // Create (New config)
                // We need a category. Defaulting to "GENERAL" if unknown.
                const created = await db
                    .insert(instanceConfigurations)
                    .values({
                        key,
                        value: String(value),
                        category: "GENERAL", // Logic to determine category might be needed in future
                        isEncrypted: false, // New keys default to not encrypted
                    })
                    .returning();
                results.push(created[0]);
            }
        }

        return results;
    }

    /**
     * Disable email feature (Clear email config)
     */
    async disableEmailFeature() {
        const emailKeys = [
            "EMAIL_HOST",
            "EMAIL_HOST_USER",
            "EMAIL_HOST_PASSWORD",
            "ENABLE_SMTP",
            "EMAIL_PORT",
            "EMAIL_FROM",
        ];

        // logic: Set confirmed keys to empty string, set ENABLE_SMTP to "0"

        await db.transaction(async (tx) => {
            // Set ENABLE_SMTP specific value
            await tx
                .update(instanceConfigurations)
                .set({ value: "0", updatedAt: new Date() })
                .where(eq(instanceConfigurations.key, "ENABLE_SMTP"));

            // Clear others
            const keysToClear = emailKeys.filter(k => k !== "ENABLE_SMTP");
            await tx
                .update(instanceConfigurations)
                .set({ value: "", updatedAt: new Date() })
                .where(inArray(instanceConfigurations.key, keysToClear));
        });
    }
}
