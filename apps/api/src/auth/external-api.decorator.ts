import { SetMetadata } from "@nestjs/common";

export const EXTERNAL_API = Symbol("EXTERNAL_API");
/** Selects personal-credential authentication, never Cookie authentication. */
export const ExternalApi = () => SetMetadata(EXTERNAL_API, true);
