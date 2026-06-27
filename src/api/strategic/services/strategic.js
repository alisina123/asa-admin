'use strict';

/**
 * strategic service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::strategic.strategic');
