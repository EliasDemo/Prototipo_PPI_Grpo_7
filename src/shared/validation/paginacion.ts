import { z } from "zod";

export const PAGE_SIZE_MAX = 200;
export const PAGE_SIZE_DEFECTO = 50;

export const paginacion = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFECTO),
});

export type Paginacion = z.infer<typeof paginacion>;

export const offset = ({ page, pageSize }: Paginacion) => (page - 1) * pageSize;
