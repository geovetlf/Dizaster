-- ADR 0050: la zona horaria del contexto ahora sale de polígonos. La memoria de contextos es derivada y se
-- recalcula sola; se vacía para que los países con varias zonas dejen de tener timezone = null.
TRUNCATE geo.context_cache;
