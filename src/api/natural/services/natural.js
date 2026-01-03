'use strict';

/**
 * natural service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::natural.natural');
