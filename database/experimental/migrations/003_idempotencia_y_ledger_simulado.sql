-- =====================================================================
-- 003 · Idempotencia de solicitudes y ledger simulado (F3)
-- =====================================================================

-- Respuesta guardada por Idempotency-Key. La misma key con el mismo cuerpo devuelve
-- la misma respuesta; con otro cuerpo, 422.
CREATE TABLE solicitud_idempotente (
  idempotency_key VARCHAR(100) NOT NULL,
  ruta            VARCHAR(200) NOT NULL,
  cuerpo_sha256   CHAR(64)     NOT NULL,           -- SHA-256 de canonical({ ruta, cuerpo })
  estado          ENUM('EN_CURSO','COMPLETADA') NOT NULL DEFAULT 'EN_CURSO',
  status_http     SMALLINT UNSIGNED NULL,
  respuesta       JSON         NULL,
  creada_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completada_en   DATETIME(3)  NULL,
  PRIMARY KEY (idempotency_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Ledger simulado del NullLedger: SOLO desarrollo y pruebas, nunca producción
-- ni corridas del benchmark. Reemplaza a Fabric con la misma forma de evidencia
-- y es append-only como un ledger real.
-- ---------------------------------------------------------------------
CREATE TABLE ledger_simulado (
  evidencia_id        CHAR(36)     NOT NULL,       -- = evento_id
  registro_id         CHAR(36)     NOT NULL,
  prev_id             CHAR(36)     NULL,
  operacion           ENUM('CREAR','RECTIFICAR','REVOCAR','SUPRIMIR') NOT NULL,
  version             INT UNSIGNED NOT NULL,
  fecha_experimental  VARCHAR(30)  NOT NULL,       -- ISO 8601 UTC, tal como se firmó
  hmac                CHAR(64)     NOT NULL,
  schema_version      TINYINT UNSIGNED NOT NULL,
  tx_id               CHAR(64)     NOT NULL,       -- id simulado: SHA-256 de la evidencia
  registrada_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidencia_id),
  UNIQUE KEY uq_ledger_version (registro_id, version)
) ENGINE=InnoDB;

DELIMITER $$
CREATE TRIGGER trg_ledger_simulado_sin_update
BEFORE UPDATE ON ledger_simulado FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger_simulado es append-only';
END$$

CREATE TRIGGER trg_ledger_simulado_sin_delete
BEFORE DELETE ON ledger_simulado FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger_simulado es append-only (use pnpm db:reset-exp)';
END$$
DELIMITER ;
