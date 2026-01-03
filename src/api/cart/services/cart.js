'use strict';

/**
 * cart service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::cart.cart', ({ strapi }) => ({
  /**
   * Custom method to create a cart
   * @param {Object} data - items, total
   * @param {Object} user - authenticated user from ctx.state.user
   */
  async createCart(data, user) {
    if (!user) {
      throw new Error('User must be logged in');
    }

    return await strapi.entityService.create('api::cart.cart', {
      data: {
        ...data,
        users_permissions_user: user.id, // link to frontend user
      },
      populate: {
        users_permissions_user: true,
        createdBy: true,
        updatedBy: true,
      },
    });
  },

  /**
   * Custom method to update a cart
   * @param {Number} cartId
   * @param {Object} data - updated fields
   * @param {Object} user - authenticated user
   */
  async updateCart(cartId, data, user) {
    if (!user) {
      throw new Error('User must be logged in');
    }

    return await strapi.entityService.update('api::cart.cart', cartId, {
      data,
      populate: {
        users_permissions_user: true,
        createdBy: true,
        updatedBy: true,
      },
    });
  },
}));
