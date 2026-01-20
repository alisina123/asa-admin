'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/carts',
      handler: 'cart.create',
    },
    {
      method: 'GET',
      path: '/carts',
      handler: 'cart.find',
    },
    {
      method: 'GET',
      path: '/carts/:id',
      handler: 'cart.findOne',
    },
    {
      method: 'GET',
      path: '/carts/stats/all',
      handler: 'cart.getStats',
    },
    {
      method: 'PUT',
      path: '/carts/:id/status',
      handler: 'cart.updateStatus',
    },
  ],
};

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::cart.cart');
