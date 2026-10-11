-- D3 (decisión del propietario, ADR 0315 y 0321): el perfil público puede mostrar «N reportes corroborados» y cada
-- persona puede ocultarlo. Visible por defecto, como aprobó el propietario.
ALTER TABLE social.profiles ADD COLUMN show_corroborated_reports boolean NOT NULL DEFAULT true;
