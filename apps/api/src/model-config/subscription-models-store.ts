import type { ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };
import { prisma } from "@eureka-atlas/database";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";

/** Preserve provider-owned dynamic catalogs across API restarts. */
export class SubscriptionModelsStore implements ModelsStore {
  constructor(private readonly id: string, private readonly builtinId: string, private readonly crypto: CredentialCryptoService) {}
  private key() { return "subscription_model_catalog:" + this.id; }
  async read(providerId: string) {
    if (providerId !== this.builtinId) return undefined;
    const setting = await prisma.systemSetting.findUnique({ where: { key: this.key() } });
    return setting ? JSON.parse(this.crypto.decrypt(setting.value)) as ModelsStoreEntry : undefined;
  }
  async write(providerId: string, entry: ModelsStoreEntry, options?: { signal?: AbortSignal }) {
    if (providerId !== this.builtinId) throw new Error("Catalog provider mismatch");
    options?.signal?.throwIfAborted();
    const value = this.crypto.encrypt(JSON.stringify(entry));
    await prisma.systemSetting.upsert({ where: { key: this.key() }, create: { key: this.key(), value }, update: { value } });
  }
  async delete(providerId: string) {
    if (providerId !== this.builtinId) throw new Error("Catalog provider mismatch");
    await prisma.systemSetting.deleteMany({ where: { key: this.key() } });
  }
}
