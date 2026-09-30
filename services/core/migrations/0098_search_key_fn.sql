-- Clave de búsqueda en SQL igual a `searchKey` (geo/names.ts, ADR 0247): minúsculas, sin tildes ni signos.
-- Así "canete" y "Cañete" coinciden al buscar en títulos de fuentes.
CREATE FUNCTION platform.search_key(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(regexp_replace(
    translate(lower(t), 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ', 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy'),
    '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;
