'use strict';

/**
 * complain-from service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::complain-from.complain-from');
