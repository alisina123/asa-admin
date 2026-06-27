'use strict';

/**
 * videocard service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::videocard.videocard');
