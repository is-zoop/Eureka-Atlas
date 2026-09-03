import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@eureka-atlas/database";
import { CredentialCryptoService } from "./credential-crypto.service";
import { MaxComputeClient } from "../metadata/maxcompute.client";

export type CreateDataSourceInput = {
  name: string;
  region: string;
  endpoint: string;
  defaultProject: string;
  accessKey: string;
  secretKey: string;
};

@Injectable()
export class DatasourceService {
  constructor(private readonly crypto: CredentialCryptoService) {}

  async create(input: CreateDataSourceInput) {
    if (Object.values(input).some((value) => !value?.trim())) {
      throw new BadRequestException("All data source fields are required");
    }
    const exists = await prisma.dataSource.findUnique({ where: { name: input.name.trim() } });
    if (exists) throw new ConflictException("A data source with this name already exists");
    return this.toResponse(await prisma.dataSource.create({
      data: {
        name: input.name.trim(), region: input.region.trim(), endpoint: input.endpoint.trim().replace(/\/$/, ""),
        defaultProject: input.defaultProject.trim(), accessKeyEncrypted: this.crypto.encrypt(this.cleanCredential(input.accessKey)),
        secretKeyEncrypted: this.crypto.encrypt(this.cleanCredential(input.secretKey)),
      },
    }));
  }

  async list() {
    return (await prisma.dataSource.findMany({ orderBy: { createdAt: "desc" } })).map((source) => this.toResponse(source));
  }

  async getWithCredentials(id: string) {
    const source = await prisma.dataSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException("Data source not found");
    return { ...source, accessKey: this.crypto.decrypt(source.accessKeyEncrypted), secretKey: this.crypto.decrypt(source.secretKeyEncrypted) };
  }

  async test(id: string) {
    const source = await this.getWithCredentials(id);
    try {
      const project = await new MaxComputeClient(source).getProject();
      const updated = await prisma.dataSource.update({ where: { id }, data: { status: "ACTIVE", lastTestedAt: new Date() } });
      return { success: true, project: { name: project.name, description: project.description }, dataSource: this.toResponse(updated) };
    } catch (error) {
      await prisma.dataSource.update({ where: { id }, data: { status: "FAILED", lastTestedAt: new Date() } });
      throw error;
    }
  }

  private toResponse(source: { accessKeyEncrypted: string; secretKeyEncrypted: string; [key: string]: unknown }) {
    const { accessKeyEncrypted, secretKeyEncrypted, ...safeSource } = source;
    return { ...safeSource, hasCredentials: Boolean(accessKeyEncrypted && secretKeyEncrypted) };
  }

  private cleanCredential(value: string) {
    const credential = value.trim();
    return (credential.startsWith('"') && credential.endsWith('"')) || (credential.startsWith("'") && credential.endsWith("'"))
      ? credential.slice(1, -1).trim()
      : credential;
  }
}
