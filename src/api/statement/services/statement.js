'use strict';

/**
 * statement service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::statement.statement');
