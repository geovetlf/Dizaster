-- De dónde viene el estado negativo (ADR 0251): RULE (motor) o MODERATOR. Lo que decide moderación no lo deshacen
-- las reglas con la siguiente evidencia; solo una fuente oficial (desmentido o confirmación) o la propia moderación.
ALTER TABLE verification.state ADD COLUMN negative_source text NOT NULL DEFAULT 'RULE' CHECK (negative_source IN ('RULE','MODERATOR'));
-- Estados que hoy vienen de una decisión de moderación (la última transición negativa fue suya).
UPDATE verification.state s SET negative_source = 'MODERATOR'
  WHERE (SELECT cause FROM verification.transitions t WHERE t.event_id = s.event_id AND t.from_negative IS DISTINCT FROM t.to_negative
          ORDER BY t.at DESC LIMIT 1) = 'MODERATOR';
