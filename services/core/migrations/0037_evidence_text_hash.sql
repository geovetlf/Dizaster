-- ADR 0074: huella del texto de cada reporte en su evidencia. Reportes con el mismo texto (normalizado, ≥ 4 palabras)
-- cuentan como un solo corroborador. Solo el hash: el texto vive en el post del reporte.
ALTER TABLE event.evidence ADD COLUMN text_hash text;
