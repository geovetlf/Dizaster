-- ADR 0137: quién puede mencionarte (sin perfil privado en V1, decisión del propietario).
ALTER TABLE social.profiles ADD COLUMN mentions_from text NOT NULL DEFAULT 'EVERYONE'
  CHECK (mentions_from IN ('EVERYONE','FOLLOWING','NOBODY'));
