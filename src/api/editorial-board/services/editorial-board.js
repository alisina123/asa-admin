'use strict';

/**
 * editorial-board service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::editorial-board.editorial-board');
