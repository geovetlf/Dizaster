-- La IA nunca produce FALSE (ADR 0231, CLAUDE.md): ni siquiera como sugerencia guardada. Defensa en profundidad
-- junto al servicio. Las sugerencias previas con FALSE (no debería haber) se anulan antes de añadir la regla.
UPDATE verification.ai_suggestions SET suggested_negative = NULL WHERE suggested_negative = 'FALSE';
ALTER TABLE verification.ai_suggestions ADD CONSTRAINT ai_never_false CHECK (suggested_negative IS DISTINCT FROM 'FALSE');
