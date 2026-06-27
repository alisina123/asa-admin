'use strict';

/**
 * jobcard service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::jobcard.jobcard');
