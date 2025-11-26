const db = require('../../config/database');

// Crear referencia local para usar dentro de los métodos
const GameRound = {
  /**
   * Verificar si ya existe una ronda similar (SOLO para IDs temporales como fallback)
   * Busca por bookmaker_id, multiplicador similar y timestamp cercano (dentro de 2 minutos)
   * 
   * ⚠️ IMPORTANTE: Esta función SOLO debe usarse cuando no hay round_id válido.
   * Para rondas con round_id real, usar findByRoundId() que es el criterio correcto.
   * Dos rondas diferentes pueden tener el mismo multiplicador, eso es normal.
   */
  async findSimilarRound(bookmaker_id, max_multiplier, timestamp = null) {
    const multiplierTolerance = 0.01; // Tolerancia de 0.01 para multiplicadores
    const timeWindow = 2 * 60 * 1000; // 2 minutos en milisegundos
    
    let query, values;
    
    if (timestamp) {
      // Buscar por timestamp específico
      const timeStart = new Date(new Date(timestamp).getTime() - timeWindow);
      const timeEnd = new Date(new Date(timestamp).getTime() + timeWindow);
      
      query = `
        SELECT * FROM game_rounds 
        WHERE bookmaker_id = $1 
          AND ABS(max_multiplier - $2) < $3
          AND timestamp BETWEEN $4 AND $5
        ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $6))) ASC
        LIMIT 1
      `;
      values = [bookmaker_id, max_multiplier, multiplierTolerance, timeStart, timeEnd, timestamp];
    } else {
      // Buscar por multiplicador en los últimos 5 minutos
      query = `
        SELECT * FROM game_rounds 
        WHERE bookmaker_id = $1 
          AND ABS(max_multiplier - $2) < $3
          AND timestamp > NOW() - INTERVAL '5 minutes'
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      values = [bookmaker_id, max_multiplier, multiplierTolerance];
    }
    
    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  /**
   * Verificar si existe una ronda con el mismo round_id y bookmaker_id
   */
  async findByRoundId(bookmaker_id, round_id) {
    const query = `
      SELECT * FROM game_rounds 
      WHERE bookmaker_id = $1 AND round_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(query, [bookmaker_id, round_id]);
    return rows[0] || null;
  },

  /**
   * Actualizar round_id de una ronda temporal cuando llega el ID real
   */
  async updateRoundId(oldRoundId, newRoundId, bookmaker_id) {
    // Verificar si el nuevo round_id ya existe
    const existing = await GameRound.findByRoundId(bookmaker_id, newRoundId);
    if (existing) {
      // Si ya existe, eliminar la ronda temporal
      await GameRound.deleteByRoundId(bookmaker_id, oldRoundId);
      return existing;
    }
    
    // Actualizar el round_id
    const query = `
      UPDATE game_rounds 
      SET round_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE bookmaker_id = $2 AND round_id = $3
      RETURNING *
    `;
    const { rows } = await db.query(query, [newRoundId, bookmaker_id, oldRoundId]);
    return rows[0] || null;
  },

  /**
   * Eliminar ronda por round_id y bookmaker_id
   */
  async deleteByRoundId(bookmaker_id, round_id) {
    const query = `
      DELETE FROM game_rounds 
      WHERE bookmaker_id = $1 AND round_id = $2
      RETURNING *
    `;
    const { rows } = await db.query(query, [bookmaker_id, round_id]);
    return rows[0] || null;
  },

  async addRound(
    bookmaker_id,
    round_id,
    bets_count,
    total_bet_amount,
    online_players,
    max_multiplier,
    total_cashout,
    casino_profit,
    loss_percentage
  ) {
    // CORREGIDO: Verificar duplicados SOLO por round_id (criterio principal)
    // El round_id es único por ronda, independientemente del multiplicador
    const existingByRoundId = await GameRound.findByRoundId(bookmaker_id, round_id);
    if (existingByRoundId) {
      // Ya existe con este round_id, actualizar datos y retornar el existente
      console.log(`[GameRound] 🔄 Ronda ${round_id} ya existe, actualizando datos`);
      return existingByRoundId;
    }

    // SOLO si el round_id es temporal, verificar por multiplicador + timestamp como fallback
    // Esto es para casos donde no llega el round_id real y se generan IDs temporales
    // IMPORTANTE: Si el round_id NO es temporal (es un ID real del servidor), 
    // no verificamos por multiplicador porque dos rondas diferentes pueden tener el mismo multiplicador
    const isTemporaryId = round_id.startsWith('temp_') || round_id.startsWith('round_');
    if (isTemporaryId) {
      // Solo para IDs temporales: verificar si hay una ronda similar muy reciente
      const similarRound = await GameRound.findSimilarRound(bookmaker_id, max_multiplier);
      if (similarRound) {
        const isExistingTemporary = similarRound.round_id.startsWith('temp_') || similarRound.round_id.startsWith('round_');
        
        // Si ambas son temporales, verificar timestamp para evitar duplicados muy cercanos
        if (isExistingTemporary) {
          const timeDiff = Math.abs(new Date() - new Date(similarRound.timestamp || similarRound.created_at));
          // Si la ronda similar es muy reciente (menos de 30 segundos), probablemente es la misma
          if (timeDiff < 30000) {
            console.log(`[GameRound] ⚠️ Ronda temporal similar muy reciente (${similarRound.round_id}), omitiendo duplicado`);
            return similarRound;
          }
        } else {
          // Si la existente tiene ID real pero la nueva es temporal, 
          // y tienen el mismo multiplicador, probablemente la temporal es duplicada
          // Pero mejor no hacer nada y dejar que se inserte, el constraint único protegerá
          console.log(`[GameRound] ℹ️ Ronda temporal ${round_id} con multiplicador similar a ronda real ${similarRound.round_id}, insertando de todas formas`);
        }
      }
    }
    
    // Si llegamos aquí, es una ronda nueva con round_id único, proceder a insertar

    // Insertar nueva ronda
    const query = `
      INSERT INTO game_rounds (
        bookmaker_id, round_id, bets_count, total_bet_amount, 
        online_players, max_multiplier, total_cashout, 
        casino_profit, loss_percentage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (bookmaker_id, round_id) 
      DO UPDATE SET
        bets_count = EXCLUDED.bets_count,
        total_bet_amount = EXCLUDED.total_bet_amount,
        online_players = EXCLUDED.online_players,
        max_multiplier = EXCLUDED.max_multiplier,
        total_cashout = EXCLUDED.total_cashout,
        casino_profit = EXCLUDED.casino_profit,
        loss_percentage = EXCLUDED.loss_percentage,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const values = [
      bookmaker_id,
      round_id,
      bets_count,
      total_bet_amount,
      online_players,
      max_multiplier,
      total_cashout,
      casino_profit,
      loss_percentage
    ];
    
    try {
      const { rows } = await db.query(query, values);
      return rows[0];
    } catch (error) {
      // Si hay conflicto de constraint único, buscar y retornar el existente
      if (error.code === '23505') {
        const existing = await GameRound.findByRoundId(bookmaker_id, round_id);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  },

  async findByBookmakerId(bookmaker_id) {
    const query = 'SELECT id, bookmaker_id, round_id, bets_count, total_bet_amount, online_players, max_multiplier, total_cashout, casino_profit, loss_percentage, timestamp, created_at FROM game_rounds WHERE bookmaker_id = $1 ORDER BY timestamp DESC';
    const { rows } = await db.query(query, [bookmaker_id]);
    return rows;
  },

  async invalidateCache(bookmaker_id) {
    // No usamos caché en este proyecto, pero mantenemos la función por compatibilidad
    console.log(`Cache invalidated for bookmaker ${bookmaker_id}`);
  },

  /**
   * Obtener los últimos N resultados de un bookmaker (sin duplicados)
   * Filtra duplicados por round_id, manteniendo el más reciente
   */
  async getLastResults(bookmaker_id, limit = 5) {
    const query = `
      SELECT DISTINCT ON (round_id)
        max_multiplier, round_id, timestamp, created_at
      FROM game_rounds 
      WHERE bookmaker_id = $1 
      ORDER BY round_id, timestamp DESC
    `;
    const { rows } = await db.query(query, [bookmaker_id]);
    
    // Ordenar por timestamp DESC y tomar los N más recientes
    const sorted = rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return sorted.slice(0, limit);
  },
};

module.exports = GameRound;