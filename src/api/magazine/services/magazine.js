'use strict';

/**
 * magazine service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::magazine.magazine');
