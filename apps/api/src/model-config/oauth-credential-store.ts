import type { Credential, CredentialStore } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };
import { prisma } from "@eureka-atlas/database";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";

/** One Atlas provider row owns its credentials; Pi serializes refresh through modify. */
export class OAuthCredentialStore implements CredentialStore {
  constructor(private readonly id: string, private readonly builtinId: string, private readonly crypto: CredentialCryptoService) {}
  private check(providerId: string) { if (providerId !== this.builtinId) throw new Error("Credential provider mismatch"); }
  private decode(value: string | null): Credential | undefined {
    return value ? JSON.parse(this.crypto.decrypt(value)) as Credential : undefined;
  }
  async read(providerId: string): Promise<Credential | undefined> {
    this.check(providerId);
    const row = await prisma.modelProvider.findUnique({ where: { id: this.id } });
    return row ? this.decode(row.oauthEncrypted) : undefined;
  }
  async list() {
    return await this.read(this.builtinId) ? [{ providerId: this.builtinId, type: "oauth" as const }] : [];
  }
  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: { signal?: AbortSignal }) {
    this.check(providerId);
    return prisma.$transaction(async (tx) => {
      options?.signal?.throwIfAborted();
      await tx.$queryRaw`SELECT id FROM model_provider WHERE id = ${this.id} FOR UPDATE`;
      const row = await tx.modelProvider.findUniqueOrThrow({ where: { id: this.id } });
      if (row.authMode !== "OAUTH") throw new Error("Provider is not an OAuth configuration");
      const current = this.decode(row.oauthEncrypted);
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next) {
        if (next.type !== "oauth") throw new Error("Only OAuth credentials are accepted");
        await tx.modelProvider.update({ where: { id: this.id }, data: { oauthEncrypted: this.crypto.encrypt(JSON.stringify(next)) } });
      }
      return next ?? current;
    }, { maxWait: 60_000, timeout: 70_000 });
  }
  async delete(providerId: string) {
    this.check(providerId);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM model_provider WHERE id = ${this.id} FOR UPDATE`;
      await tx.modelProvider.update({ where: { id: this.id }, data: { oauthEncrypted: null } });
    });
  }
}
