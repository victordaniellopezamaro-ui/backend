const db = require('../../config/database');

const Bookmaker = {
  async create(name, description, urlImage, recommended, active, urlWebsocket, firstMessage, secondMessage, thirdMessage, decoderType = 'auto') {
    const query = `
      INSERT INTO bookmakers (name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type
    `;
    const values = [name, description, urlImage, recommended, active, urlWebsocket, firstMessage, secondMessage, thirdMessage, decoderType];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async findAll() {
    const query = 'SELECT * FROM bookmakers';
    const { rows } = await db.query(query);
    return rows;
  },

  async getBookmakersWithConfigs() {
    const query = 'SELECT id, name AS nombre, url_websocket, first_message, second_message, third_message, active, decoder_type FROM bookmakers WHERE active = true';
    const { rows } = await db.query(query);
    return rows;
  },

  async findById(id) {
    const query = 'SELECT * FROM bookmakers WHERE id = $1';
    const { rows } = await db.query(query, [id]);
    return rows[0];
  },

  async update(id, name, description, urlImage, recommended, active, urlWebsocket, firstMessage, secondMessage, thirdMessage, decoderType = 'auto') {
    const query = `
      UPDATE bookmakers 
      SET name = $1, description = $2, url_image = $3, recomendado = $4, active = $5, url_websocket = $6, first_message = $7, second_message = $8, third_message = $9, decoder_type = $10
      WHERE id = $11
      RETURNING id, name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type
    `;
    const values = [name, description, urlImage, recommended, active, urlWebsocket, firstMessage, secondMessage, thirdMessage, decoderType, id];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async delete(id) {
    const query = 'DELETE FROM bookmakers WHERE id = $1 RETURNING *';
    const { rows } = await db.query(query, [id]);
    return rows[0];
  },
};

module.exports = Bookmaker;