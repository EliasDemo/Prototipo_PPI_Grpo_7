import { describe, expect, it } from "vitest";
import { filtrosAsistencias, filtrosCalificaciones, filtrosEstudiantes } from "@/modules/academico/esquemas";

describe("paginación", () => {
  it("usa page=1 y pageSize=50 por defecto", () => {
    expect(filtrosEstudiantes.parse({})).toEqual({ page: 1, pageSize: 50 });
  });

  it.each([{ pageSize: "201" }, { pageSize: "0" }, { page: "0" }, { page: "1.5" }, { page: "abc" }])(
    "rechaza %o",
    (q) => expect(filtrosEstudiantes.safeParse(q).success).toBe(false),
  );

  it("acepta pageSize=200", () => {
    expect(filtrosEstudiantes.parse({ pageSize: "200" }).pageSize).toBe(200);
  });
});

describe("filtros", () => {
  it("rechaza parámetros desconocidos", () => {
    expect(filtrosCalificaciones.safeParse({ nombre: "x" }).success).toBe(false);
  });

  it("valida el formato de identificadores", () => {
    expect(filtrosEstudiantes.safeParse({ seccion: "SEC-00ED1D59363A88B2AE2F" }).success).toBe(true);
    expect(filtrosEstudiantes.safeParse({ seccion: "SEC-1' OR '1'='1" }).success).toBe(false);
  });

  it.each([
    ["true", true], ["1", true], ["false", false], ["0", false],
  ])("registrada=%s -> %s", (v, esperado) => {
    expect(filtrosCalificaciones.parse({ registrada: v }).registrada).toBe(esperado);
  });

  it("rechaza registrada con otro valor", () => {
    expect(filtrosCalificaciones.safeParse({ registrada: "si" }).success).toBe(false);
  });

  it("exige fechas ISO y desde <= hasta", () => {
    expect(filtrosAsistencias.safeParse({ anio: "2025", desde: "2025-08-01", hasta: "2025-08-31" }).success).toBe(true);
    expect(filtrosAsistencias.safeParse({ anio: "2025", desde: "2025-09-01", hasta: "2025-08-31" }).success).toBe(false);
    expect(filtrosAsistencias.safeParse({ anio: "2025", desde: "01/08/2025" }).success).toBe(false);
    expect(filtrosAsistencias.safeParse({ anio: "2025", desde: "2025-02-30" }).success).toBe(false);
  });

  it.each([{ seccion: "SEC-00ED1D59363A88B2AE2F" }, { desde: "2025-08-01" }, { hasta: "2025-08-31" }])(
    "asistencias exige anio con %o",
    (q) => {
      const r = filtrosAsistencias.safeParse(q);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(["anio"]);
      expect(filtrosAsistencias.safeParse({ ...q, anio: "2025" }).success).toBe(true);
    },
  );

  it("asistencias sin filtros no exige anio", () => {
    expect(filtrosAsistencias.safeParse({ page: "3" }).success).toBe(true);
  });
});
