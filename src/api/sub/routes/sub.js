'use strict';

/**
 * sub router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::sub.sub');
