const db = require('../../config/database');

const GameRound = {
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
    const query = `
      INSERT INTO game_rounds (
        bookmaker_id, round_id, bets_count, total_bet_amount, 
        online_players, max_multiplier, total_cashout, 
        casino_profit, loss_percentage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    const { rows } = await db.query(query, values);
    return rows[0];
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
};

module.exports = GameRound;
