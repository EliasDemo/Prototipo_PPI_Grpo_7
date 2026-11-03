-- =====================================================================
-- 005 · El ledger simulado guarda el rol del actor, como el chaincode (ADR-017)
-- =====================================================================
ALTER TABLE ledger_simulado
  ADD COLUMN actor_rol ENUM('operador','benchmark') NOT NULL DEFAULT 'operador' AFTER version;
