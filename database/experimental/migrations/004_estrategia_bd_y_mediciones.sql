-- =====================================================================
-- 004 · Línea base sin ledger (estrategia BD) y mediciones fuera de corrida (F5, ADR-017)
-- =====================================================================

-- BD = solo base de datos: misma lógica de aplicación, sin anclaje (RQ3 del artículo).
ALTER TABLE registro MODIFY estrategia ENUM('A','B','BD') NOT NULL;
ALTER TABLE corrida  MODIFY estrategia ENUM('A','B','BD') NOT NULL;

-- Cada operación se mide aunque no pertenezca a una corrida del benchmark
-- (uso desde la interfaz o pruebas); corrida_id llega en la cabecera X-Corrida-Id.
ALTER TABLE medicion
  MODIFY corrida_id CHAR(36) NULL,
  ADD COLUMN estrategia ENUM('A','B','BD','NULL') NOT NULL AFTER op_id,
  ADD COLUMN operacion  ENUM('CREAR','RECTIFICAR','REVOCAR','SUPRIMIR') NOT NULL AFTER estrategia,
  ADD KEY idx_medicion_estrategia (estrategia, registrada_en);
