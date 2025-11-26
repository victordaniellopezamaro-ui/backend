const db = require('../../config/database');

const SignalModel = {
  /**
   * Crear una nueva señal
   */
  async createSignal(bookmakerId, patternDetected) {
    const query = `
      INSERT INTO signals (bookmaker_id, pattern_detected, signal_timestamp, status)
      VALUES ($1, $2, CURRENT_TIMESTAMP, 'pending')
      RETURNING *
    `;
    // PostgreSQL convierte automáticamente JSON string a JSONB
    const values = [bookmakerId, JSON.stringify(patternDetected)];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  /**
   * Obtener señales pendientes de un bookmaker
   */
  async getPendingSignals(bookmakerId) {
    const query = `
      SELECT * FROM signals 
      WHERE bookmaker_id = $1 AND status = 'pending'
      ORDER BY signal_timestamp DESC
    `;
    const { rows } = await db.query(query, [bookmakerId]);
    return rows;
  },

  /**
   * Actualizar resultado del primer intento
   */
  async updateFirstAttempt(signalId, result, roundId) {
    const isWin = parseFloat(result) > 1.50;
    const newStatus = isWin ? 'won' : 'pending'; // Si gana, terminamos. Si pierde, esperamos gale
    
    const query = `
      UPDATE signals 
      SET first_attempt_result = $1,
          first_attempt_timestamp = CURRENT_TIMESTAMP,
          status = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    const { rows } = await db.query(query, [result, newStatus, signalId]);
    
    // Registrar resultado en signal_results
    await this.addSignalResult(signalId, 1, result, isWin, roundId);
    
    return rows[0];
  },

  /**
   * Actualizar resultado del segundo intento (gale)
   */
  async updateSecondAttempt(signalId, result, roundId) {
    const isWin = parseFloat(result) > 1.50;
    const newStatus = isWin ? 'won' : 'lost';
    
    const query = `
      UPDATE signals 
      SET second_attempt_result = $1,
          second_attempt_timestamp = CURRENT_TIMESTAMP,
          gale_used = true,
          status = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    const { rows } = await db.query(query, [result, newStatus, signalId]);
    
    // Registrar resultado en signal_results
    await this.addSignalResult(signalId, 2, result, isWin, roundId);
    
    return rows[0];
  },

  /**
   * Agregar resultado de un intento
   */
  async addSignalResult(signalId, attemptNumber, resultMultiplier, isWin, roundId = null) {
    const query = `
      INSERT INTO signal_results (signal_id, attempt_number, result_multiplier, is_win, result_timestamp, round_id)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
      RETURNING *
    `;
    const values = [signalId, attemptNumber, resultMultiplier, isWin, roundId];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  /**
   * Obtener todas las señales de un bookmaker
   */
  async getSignalsByBookmaker(bookmakerId, limit = 100) {
    const query = `
      SELECT s.*, 
             COUNT(DISTINCT sr.id) as total_attempts,
             SUM(CASE WHEN sr.is_win THEN 1 ELSE 0 END) as wins_count
      FROM signals s
      LEFT JOIN signal_results sr ON s.id = sr.signal_id
      WHERE s.bookmaker_id = $1
      GROUP BY s.id
      ORDER BY s.signal_timestamp DESC
      LIMIT $2
    `;
    const { rows } = await db.query(query, [bookmakerId, limit]);
    return rows;
  },

  /**
   * Obtener estadísticas de señales
   */
  async getSignalStats(bookmakerId = null) {
    let query, values;
    
    if (bookmakerId) {
      query = `
        SELECT 
          COUNT(*) as total_signals,
          COUNT(CASE WHEN status = 'won' THEN 1 END) as won_signals,
          COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_signals,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_signals,
          COUNT(CASE WHEN gale_used = true THEN 1 END) as gales_used
        FROM signals
        WHERE bookmaker_id = $1
      `;
      values = [bookmakerId];
    } else {
      query = `
        SELECT 
          COUNT(*) as total_signals,
          COUNT(CASE WHEN status = 'won' THEN 1 END) as won_signals,
          COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_signals,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_signals,
          COUNT(CASE WHEN gale_used = true THEN 1 END) as gales_used
        FROM signals
      `;
      values = [];
    }
    
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  /**
   * Obtener señales recientes con sus resultados
   */
  async getSignalsWithResults(bookmakerId = null, limit = 50) {
    let query, values;
    
    if (bookmakerId) {
      query = `
        SELECT 
          s.*,
          json_agg(
            json_build_object(
              'attempt_number', sr.attempt_number,
              'result_multiplier', sr.result_multiplier,
              'is_win', sr.is_win,
              'result_timestamp', sr.result_timestamp,
              'round_id', sr.round_id
            )
            ORDER BY sr.attempt_number
          ) as results
        FROM signals s
        LEFT JOIN signal_results sr ON s.id = sr.signal_id
        WHERE s.bookmaker_id = $1
        GROUP BY s.id
        ORDER BY s.signal_timestamp DESC
        LIMIT $2
      `;
      values = [bookmakerId, limit];
    } else {
      query = `
        SELECT 
          s.*,
          json_agg(
            json_build_object(
              'attempt_number', sr.attempt_number,
              'result_multiplier', sr.result_multiplier,
              'is_win', sr.is_win,
              'result_timestamp', sr.result_timestamp,
              'round_id', sr.round_id
            )
            ORDER BY sr.attempt_number
          ) as results
        FROM signals s
        LEFT JOIN signal_results sr ON s.id = sr.signal_id
        GROUP BY s.id
        ORDER BY s.signal_timestamp DESC
        LIMIT $1
      `;
      values = [limit];
    }
    
    const { rows } = await db.query(query, values);
    return rows;
  }
};

module.exports = SignalModel;

