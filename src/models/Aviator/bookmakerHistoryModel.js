const db = require('../../config/database');

class BookmakerHistoryModel {
  // Crear entrada de historial
  static async createHistoryEntry(bookmakerId, action, fieldName = null, oldValue = null, newValue = null) {
    try {
      const query = `
        INSERT INTO bookmaker_history (bookmaker_id, action, field_name, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const values = [bookmakerId, action, fieldName, oldValue, newValue];
      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating history entry:', error);
      throw error;
    }
  }

  // Obtener historial de un bookmaker específico
  static async getBookmakerHistory(bookmakerId) {
    try {
      const query = `
        SELECT 
          bh.*
        FROM bookmaker_history bh
        WHERE bh.bookmaker_id = $1
        ORDER BY bh.created_at DESC
      `;
      const result = await db.query(query, [bookmakerId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting bookmaker history:', error);
      throw error;
    }
  }

  // Obtener historial de todos los bookmakers
  static async getAllHistory() {
    try {
      const query = `
        SELECT 
          bh.*,
          b.name as bookmaker_name
        FROM bookmaker_history bh
        JOIN bookmakers b ON bh.bookmaker_id = b.id
        ORDER BY bh.created_at DESC
        LIMIT 100
      `;
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting all history:', error);
      throw error;
    }
  }

  // Obtener estadísticas de modificaciones
  static async getModificationStats() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_modifications,
          COUNT(DISTINCT bookmaker_id) as bookmakers_modified,
          MAX(created_at) as last_modification
        FROM bookmaker_history
      `;
      const result = await db.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting modification stats:', error);
      throw error;
    }
  }
}

module.exports = BookmakerHistoryModel;
