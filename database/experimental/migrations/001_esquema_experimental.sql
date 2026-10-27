-- =====================================================================
-- 001 · Esquema de la base experimental (laboratorio)
-- Base: investigacion_experimental  ·  MySQL 8.4 / InnoDB / utf8mb4
--
-- Reglas:
--  * Nunca contiene nombres ni la correspondencia privada.
--  * La referencia al origen (origen_id) solo vive aquí y se borra al suprimir.
--  * Todos los identificadores de laboratorio son UUID aleatorios (CHAR(36)).
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migraciones (
  version      VARCHAR(50)  NOT NULL,
  aplicada_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sha256       CHAR(64)     NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Experimentos y corridas (se crean ANTES porque otras tablas los citan)
-- ---------------------------------------------------------------------
CREATE TABLE experimento (
  experimento_id  CHAR(36)     NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  config          JSON         NOT NULL,          -- matriz completa
  config_sha256   CHAR(64)     NOT NULL,
  creado_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (experimento_id),
  UNIQUE KEY uq_experimento_hash (config_sha256)
) ENGINE=InnoDB;

CREATE TABLE corrida (
  corrida_id      CHAR(36)     NOT NULL,
  experimento_id  CHAR(36)     NOT NULL,
  estrategia      ENUM('A','B') NOT NULL,
  carga           ENUM('NOTAS','ASISTENCIAS') NOT NULL,
  tps_ofrecido    SMALLINT UNSIGNED NOT NULL,
  workers         TINYINT  UNSIGNED NOT NULL,
  repeticion      TINYINT  UNSIGNED NOT NULL,
  semilla         BIGINT   UNSIGNED NOT NULL,
  git_commit      CHAR(40)     NULL,
  estado          ENUM('PREPARADA','EN_CURSO','CONCILIANDO','TERMINADA','ABORTADA')
                  NOT NULL DEFAULT 'PREPARADA',
  inicio          DATETIME(3)  NULL,
  fin             DATETIME(3)  NULL,
  notas           VARCHAR(500) NULL,
  PRIMARY KEY (corrida_id),
  UNIQUE KEY uq_corrida_escenario
    (experimento_id, estrategia, carga, tps_ofrecido, workers, repeticion),
  CONSTRAINT fk_corrida_experimento
    FOREIGN KEY (experimento_id) REFERENCES experimento (experimento_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Registros de ensayo (copias de una nota o asistencia del origen)
-- ---------------------------------------------------------------------
CREATE TABLE registro (
  registro_id     CHAR(36)     NOT NULL,          -- UUID aleatorio de laboratorio
  tipo            ENUM('NOTA','ASISTENCIA') NOT NULL,
  estrategia      ENUM('A','B') NOT NULL,         -- fija durante toda su vida
  origen_tabla    ENUM('calificaciones','asistencias') NULL,
  origen_id       VARCHAR(24)  NULL,              -- calificacion_id / asistencia_id; NULL tras suprimir
  estado_vigencia ENUM('VIGENTE','REVOCADO') NOT NULL DEFAULT 'VIGENTE',
  estado_detalle  ENUM('PRESENTE','RETIRADO') NOT NULL DEFAULT 'PRESENTE',
  version_actual  INT UNSIGNED NOT NULL DEFAULT 0,
  corrida_id      CHAR(36)     NULL,              -- NULL = creado desde la interfaz
  creado_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                               ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (registro_id),
  KEY idx_registro_origen (origen_tabla, origen_id),
  KEY idx_registro_corrida (corrida_id),
  CONSTRAINT fk_registro_corrida
    FOREIGN KEY (corrida_id) REFERENCES corrida (corrida_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Eventos: cadena de versiones de un registro
-- ---------------------------------------------------------------------
CREATE TABLE evento (
  evento_id           CHAR(36)     NOT NULL,      -- = evidenciaId en Fabric
  registro_id         CHAR(36)     NOT NULL,
  version             INT UNSIGNED NOT NULL,
  operacion           ENUM('CREAR','RECTIFICAR','REVOCAR','SUPRIMIR') NOT NULL,
  prev_evento_id      CHAR(36)     NULL,
  actor               VARCHAR(60)  NOT NULL,      -- actor de laboratorio, nunca un nombre real
  motivo              VARCHAR(300) NULL,
  fecha_experimental  DATETIME(3)  NOT NULL,
  schema_version      TINYINT UNSIGNED NOT NULL DEFAULT 1,   -- serialización canónica
  hmac                CHAR(64)     NULL,          -- modo B: HMAC-SHA256 hex; modo A: NULL
  estado_confirmacion ENUM('PENDIENTE','CONFIRMADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  creado_en           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evento_id),
  UNIQUE KEY uq_evento_version (registro_id, version),      -- rechaza versiones duplicadas
  UNIQUE KEY uq_evento_prev (prev_evento_id),               -- una cadena lineal, sin bifurcaciones
  KEY idx_evento_estado (estado_confirmacion),
  CONSTRAINT fk_evento_registro FOREIGN KEY (registro_id) REFERENCES registro (registro_id),
  CONSTRAINT fk_evento_prev     FOREIGN KEY (prev_evento_id) REFERENCES evento (evento_id),
  CONSTRAINT ck_evento_version  CHECK (version >= 1),
  CONSTRAINT ck_evento_prev     CHECK ((version = 1 AND prev_evento_id IS NULL)
                                    OR (version > 1 AND prev_evento_id IS NOT NULL))
) ENGINE=InnoDB;

-- Detalle académico del evento.
--  Modo B: persistente; se borra al suprimir.
--  Modo A: temporal (temporal = 1); se borra al confirmarse en Fabric.
CREATE TABLE evento_detalle (
  evento_id   CHAR(36)    NOT NULL,
  payload     JSON        NOT NULL,
  temporal    BOOLEAN     NOT NULL DEFAULT FALSE,
  bytes       INT UNSIGNED NOT NULL,              -- tamaño de la serialización canónica
  creado_en   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evento_id),
  CONSTRAINT fk_detalle_evento FOREIGN KEY (evento_id)
    REFERENCES evento (evento_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Clave HMAC aleatoria por evento (solo modo B). Borrarla = desvinculación.
CREATE TABLE evento_clave (
  evento_id   CHAR(36)      NOT NULL,
  clave       VARBINARY(32) NOT NULL,
  creado_en   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evento_id),
  CONSTRAINT fk_clave_evento FOREIGN KEY (evento_id)
    REFERENCES evento (evento_id) ON DELETE CASCADE,
  CONSTRAINT ck_clave_largo CHECK (LENGTH(clave) = 32)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Operaciones hacia Fabric (consistencia, idempotencia, conciliación)
-- ---------------------------------------------------------------------
CREATE TABLE operacion (
  op_id            CHAR(36)     NOT NULL,
  idempotency_key  VARCHAR(100) NOT NULL,
  evento_id        CHAR(36)     NOT NULL,
  estado           ENUM('PENDIENTE','ENVIADA','CONFIRMADA','FALLIDA','TARDIA')
                   NOT NULL DEFAULT 'PENDIENTE',
  intentos         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  tx_id            VARCHAR(128) NULL,             -- id de transacción de Fabric
  codigo_validacion VARCHAR(60) NULL,             -- p. ej. VALID, MVCC_READ_CONFLICT
  error            VARCHAR(1000) NULL,
  corrida_id       CHAR(36)     NULL,
  solicitada_en    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  enviada_en       DATETIME(3)  NULL,
  confirmada_en    DATETIME(3)  NULL,
  actualizada_en   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (op_id),
  UNIQUE KEY uq_operacion_idem   (idempotency_key),
  UNIQUE KEY uq_operacion_evento (evento_id),
  KEY idx_operacion_conciliar (estado, actualizada_en),
  CONSTRAINT fk_operacion_evento  FOREIGN KEY (evento_id)  REFERENCES evento (evento_id),
  CONSTRAINT fk_operacion_corrida FOREIGN KEY (corrida_id) REFERENCES corrida (corrida_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Supresión (modo B): constancia de qué se retiró, sin guardar el contenido
-- ---------------------------------------------------------------------
CREATE TABLE supresion (
  supresion_id         CHAR(36)     NOT NULL,
  registro_id          CHAR(36)     NOT NULL,
  evento_suprimir_id   CHAR(36)     NULL,         -- evento SUPRIMIR anclado en Fabric
  versiones_afectadas  INT UNSIGNED NOT NULL,
  detalles_eliminados  INT UNSIGNED NOT NULL,
  claves_eliminadas    INT UNSIGNED NOT NULL,
  solicitada_en        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completada_en        DATETIME(3)  NULL,
  PRIMARY KEY (supresion_id),
  UNIQUE KEY uq_supresion_registro (registro_id),
  CONSTRAINT fk_supresion_registro FOREIGN KEY (registro_id) REFERENCES registro (registro_id),
  CONSTRAINT fk_supresion_evento   FOREIGN KEY (evento_suprimir_id) REFERENCES evento (evento_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Mediciones por operación (fuente de los CSV del benchmark)
-- ---------------------------------------------------------------------
CREATE TABLE medicion (
  medicion_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  corrida_id          CHAR(36)     NOT NULL,
  op_id               CHAR(36)     NULL,
  resultado           ENUM('CONFIRMADA','FALLIDA','TIMEOUT','TARDIA','RECHAZADA') NOT NULL,
  t_mysql_ms          DECIMAL(10,3) NULL,
  t_fabric_submit_ms  DECIMAL(10,3) NULL,
  t_fabric_commit_ms  DECIMAL(10,3) NULL,
  t_total_ms          DECIMAL(10,3) NOT NULL,
  bytes_onchain       INT UNSIGNED  NULL,
  bytes_offchain      INT UNSIGNED  NULL,
  registrada_en       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (medicion_id),
  KEY idx_medicion_corrida (corrida_id, resultado),
  CONSTRAINT fk_medicion_corrida FOREIGN KEY (corrida_id) REFERENCES corrida (corrida_id)
) ENGINE=InnoDB;

-- Muestras de recursos (docker stats / generador), cada N segundos
CREATE TABLE muestra_recursos (
  muestra_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  corrida_id   CHAR(36)     NOT NULL,
  componente   VARCHAR(60)  NOT NULL,     -- ppi-mysql, peer0.org1, orderer, nextjs, caliper...
  cpu_pct      DECIMAL(6,2) NULL,
  mem_mb       DECIMAL(10,2) NULL,
  tomada_en    DATETIME(3)  NOT NULL,
  PRIMARY KEY (muestra_id),
  KEY idx_muestra_corrida (corrida_id, componente),
  CONSTRAINT fk_muestra_corrida FOREIGN KEY (corrida_id) REFERENCES corrida (corrida_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Inmutabilidad de la configuración de experimentos
-- ---------------------------------------------------------------------
DELIMITER $$
CREATE TRIGGER trg_experimento_inmutable
BEFORE UPDATE ON experimento FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'experimento es inmutable: cree uno nuevo';
END$$

-- Historial append-only: un evento no se modifica salvo su estado de confirmación
CREATE TRIGGER trg_evento_append_only
BEFORE UPDATE ON evento FOR EACH ROW
BEGIN
  IF NEW.registro_id <> OLD.registro_id OR NEW.version <> OLD.version
     OR NEW.operacion <> OLD.operacion
     OR NOT (NEW.prev_evento_id <=> OLD.prev_evento_id)
     OR NOT (NEW.hmac <=> OLD.hmac)
     OR NEW.fecha_experimental <> OLD.fecha_experimental THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'evento es append-only: registre una rectificacion';
  END IF;
END$$
DELIMITER ;
