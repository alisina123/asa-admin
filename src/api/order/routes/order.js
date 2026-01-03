'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orders/checkout',
      handler: 'order.checkoutCart',
      config: {
        policies: [],
        middlewares: [],
      }
    },
    {
      method: 'GET',
      path: '/orders/my-orders',
      handler: 'order.myOrders',
      config: {
        policies: [],
        middlewares: [],
      }
    },
    {
      method: 'GET',
      path: '/orders/:id',
      handler: 'order.getOrder',
      config: {
        policies: [],
        middlewares: [],
      }
    }
  ]
};