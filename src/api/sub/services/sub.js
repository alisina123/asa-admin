'use strict';

/**
 * sub service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::sub.sub');
