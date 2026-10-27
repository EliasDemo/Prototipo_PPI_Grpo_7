import mysql, { type RowDataPacket } from "mysql2/promise";

// Huella de la base de origen: filas y CHECKSUM TABLE de cada tabla (con app_ro).
// Sirve para demostrar que una suite no modificó el origen (ADR-001).

export type HuellaOrigen = Record<string, { filas: number; checksum: string }>;

export async function huellaOrigen(): Promise<HuellaOrigen> {
  const c = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT), user: process.env.MYSQL_RO_USER,
    password: process.env.MYSQL_RO_PASSWORD, database: process.env.MYSQL_DB_ORIGEN,
  });
  try {
    const [tablas] = await c.query<RowDataPacket[]>(
      "SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
    );
    const huella: HuellaOrigen = {};
    for (const { t } of tablas) {
      const [[n]] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM \`${t}\``);
      const [[ck]] = await c.query<RowDataPacket[]>(`CHECKSUM TABLE \`${t}\` EXTENDED`);
      huella[t] = { filas: Number(n!.n), checksum: String(ck!.Checksum) };
    }
    return huella;
  } finally {
    await c.end();
  }
}
