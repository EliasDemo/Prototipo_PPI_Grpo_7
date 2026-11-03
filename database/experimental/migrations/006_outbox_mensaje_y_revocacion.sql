-- =====================================================================
-- 006 · Mensaje de la bandeja y revocación (F6, F7, ADR-019)
-- =====================================================================

-- La bandeja guarda el mensaje exacto para reenviarlo tras una interrupción.
-- Nunca contiene datos del conjunto: B lleva ids opacos y HMAC; A, el evento sintético.
-- Se vacía al confirmarse.
ALTER TABLE operacion
  ADD COLUMN funcion_ledger VARCHAR(40) NULL AFTER evento_id,
  ADD COLUMN mensaje_ledger MEDIUMTEXT  NULL AFTER funcion_ledger;

-- En el ledger, REVOCAR no ocupa una versión (ADR-016): tampoco aquí.
CREATE TABLE revocacion (
  revocacion_id  CHAR(36)    NOT NULL,
  registro_id    CHAR(36)    NOT NULL,
  evidencia_id   CHAR(36)    NOT NULL,
  motivo_codigo  ENUM('ERROR_DE_REGISTRO','DUPLICADO','ORDEN_ADMINISTRATIVA','SOLICITUD_DEL_TITULAR','PRUEBA_DE_LABORATORIO') NOT NULL,
  actor          VARCHAR(60) NOT NULL,
  estado         ENUM('PENDIENTE','ENVIADA','CONFIRMADA','FALLIDA') NOT NULL DEFAULT 'PENDIENTE',
  intentos       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  tx_id          VARCHAR(128) NULL,
  error          VARCHAR(1000) NULL,
  corrida_id     CHAR(36)    NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  creada_en      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  confirmada_en  DATETIME(3) NULL,
  PRIMARY KEY (revocacion_id),
  UNIQUE KEY uq_revocacion_registro (registro_id),
  KEY idx_revocacion_estado (estado, creada_en),
  CONSTRAINT fk_revocacion_registro FOREIGN KEY (registro_id) REFERENCES registro (registro_id),
  CONSTRAINT fk_revocacion_evento   FOREIGN KEY (evidencia_id) REFERENCES evento (evento_id)
) ENGINE=InnoDB;

-- Revocaciones del NullLedger (solo desarrollo y pruebas).
CREATE TABLE ledger_simulado_revocacion (
  evidencia_id  CHAR(36)    NOT NULL,
  motivo_codigo VARCHAR(40) NOT NULL,
  tx_id         CHAR(64)    NOT NULL,
  registrada_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidencia_id)
) ENGINE=InnoDB;
