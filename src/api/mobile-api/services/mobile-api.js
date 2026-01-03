'use strict';

/**
 * mobile-api service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::mobile-api.mobile-api');
