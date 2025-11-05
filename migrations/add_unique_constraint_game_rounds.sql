-- Migración: Agregar restricción UNIQUE para evitar rondas duplicadas
-- Fecha: 2025-01-22
-- Descripción: Previene que se guarden múltiples registros con el mismo bookmaker_id y round_id

-- Eliminar duplicados existentes primero (mantener el más reciente)
DO $$ 
DECLARE
    duplicate_record RECORD;
BEGIN
    -- Encontrar y eliminar duplicados, manteniendo solo el más reciente
    FOR duplicate_record IN 
        SELECT bookmaker_id, round_id, MAX(id) as keep_id
        FROM game_rounds
        GROUP BY bookmaker_id, round_id
        HAVING COUNT(*) > 1
    LOOP
        DELETE FROM game_rounds
        WHERE bookmaker_id = duplicate_record.bookmaker_id
          AND round_id = duplicate_record.round_id
          AND id != duplicate_record.keep_id;
        
        RAISE NOTICE 'Eliminados duplicados para bookmaker_id: %, round_id: %, mantenido id: %', 
            duplicate_record.bookmaker_id, duplicate_record.round_id, duplicate_record.keep_id;
    END LOOP;
END $$;

-- Agregar restricción UNIQUE si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'unique_game_rounds_bookmaker_round'
    ) THEN
        ALTER TABLE game_rounds 
        ADD CONSTRAINT unique_game_rounds_bookmaker_round 
        UNIQUE (bookmaker_id, round_id);
        
        RAISE NOTICE 'Restricción UNIQUE agregada exitosamente';
    ELSE
        RAISE NOTICE 'Restricción UNIQUE ya existe';
    END IF;
END $$;

-- Crear índice único compuesto para mejorar rendimiento (si no existe ya)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_game_rounds_bookmaker_round 
ON game_rounds(bookmaker_id, round_id);

