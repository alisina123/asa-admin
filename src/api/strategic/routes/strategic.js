'use strict';

/**
 * strategic router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::strategic.strategic');
