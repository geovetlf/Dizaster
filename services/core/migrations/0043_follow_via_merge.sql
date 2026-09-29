-- ADR 0093: al fusionar un EVENT, quien seguía el duplicado pasa a seguir el destino.
-- via_merge guarda de qué duplicado vino el seguimiento, para deshacerlo si se revierte la fusión.
ALTER TABLE social.follows ADD COLUMN via_merge uuid;
CREATE INDEX follows_via_merge_idx ON social.follows (via_merge) WHERE via_merge IS NOT NULL;
