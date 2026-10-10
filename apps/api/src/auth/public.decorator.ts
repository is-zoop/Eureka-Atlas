import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE = "atlas:public-route";
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
