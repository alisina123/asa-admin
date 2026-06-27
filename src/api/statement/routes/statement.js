'use strict';

/**
 * statement router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::statement.statement');
