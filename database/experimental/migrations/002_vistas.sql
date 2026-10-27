-- =====================================================================
-- 002 · Vistas de apoyo para la interfaz y el análisis
-- =====================================================================

-- Estado actual de cada registro con su último evento
CREATE OR REPLACE VIEW v_registro_estado AS
SELECT r.registro_id, r.tipo, r.estrategia, r.estado_vigencia, r.estado_detalle,
       r.version_actual, e.evento_id AS ultimo_evento_id, e.operacion AS ultima_operacion,
       e.estado_confirmacion, e.fecha_experimental AS ultima_fecha
FROM registro r
LEFT JOIN evento e
  ON e.registro_id = r.registro_id AND e.version = r.version_actual;

-- Operaciones que el comando de conciliación debe revisar
CREATE OR REPLACE VIEW v_operaciones_por_conciliar AS
SELECT op_id, evento_id, estado, intentos, tx_id, actualizada_en,
       TIMESTAMPDIFF(SECOND, actualizada_en, NOW(3)) AS segundos_sin_cambio
FROM operacion
WHERE estado IN ('PENDIENTE','ENVIADA');

-- Resumen por corrida (latencias exactas se calculan en el análisis)
CREATE OR REPLACE VIEW v_resumen_corrida AS
SELECT c.corrida_id, c.estrategia, c.carga, c.tps_ofrecido, c.workers, c.repeticion,
       COUNT(m.medicion_id)                         AS solicitudes,
       SUM(m.resultado = 'CONFIRMADA')              AS confirmadas,
       SUM(m.resultado = 'FALLIDA')                 AS fallidas,
       SUM(m.resultado = 'TIMEOUT')                 AS timeouts,
       SUM(m.resultado = 'TARDIA')                  AS tardias,
       AVG(CASE WHEN m.resultado = 'CONFIRMADA' THEN m.t_total_ms END) AS t_total_prom_ms,
       AVG(m.bytes_onchain)                         AS bytes_onchain_prom
FROM corrida c
LEFT JOIN medicion m ON m.corrida_id = c.corrida_id
GROUP BY c.corrida_id, c.estrategia, c.carga, c.tps_ofrecido, c.workers, c.repeticion;
