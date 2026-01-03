'use strict';
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::cart.cart', ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { items, total } = ctx.request.body.data;

    try {
      // Use entityService instead of raw SQL - it handles relations properly
      const cart = await strapi.entityService.create('api::cart.cart', {
        data: {
          items: items,
          total: total,
          users_permissions_user: user.id,  // Correct field name
          publishedAt: new Date()
        },
        populate: {
          users_permissions_user: {
            fields: ['id', 'username', 'email']
          }
        }
      });

      // Format response with attributes (Strapi format)
      const response = {
        id: cart.id,
        attributes: {
          items: cart.items,
          total: cart.total,
          createdAt: cart.createdAt,
          updatedAt: cart.updatedAt,
          publishedAt: cart.publishedAt,
          locale: cart.locale,
          users_permissions_user: cart.users_permissions_user ? {
            data: {
              id: cart.users_permissions_user.id,
              attributes: {
                username: cart.users_permissions_user.username,
                email: cart.users_permissions_user.email
              }
            }
          } : null
        }
      };

      console.log('Created cart with user_id:', user.id);
      
      return { data: response };
    } catch (error) {
      console.error('Cart creation error:', error);
      return ctx.badRequest('Failed to create cart', { error: error.message });
    }
  },

  // Filter by logged-in user
  async find(ctx) {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      // Get only carts for this user using entityService (returns proper format)
      const carts = await strapi.entityService.findMany('api::cart.cart', {
        filters: {
          users_permissions_user: {
            id: user.id
          }
        },
        sort: { createdAt: 'desc' },
        populate: {
          users_permissions_user: {
            fields: ['id', 'username', 'email']
          }
        }
      });

      // Transform to Strapi API format with attributes
      const formattedCarts = carts.map(cart => ({
        id: cart.id,
        attributes: {
          items: cart.items,
          total: cart.total,
          status: cart.status || 'pending_payment',
          createdAt: cart.createdAt,
          updatedAt: cart.updatedAt,
          publishedAt: cart.publishedAt,
          locale: cart.locale,
          users_permissions_user: cart.users_permissions_user ? {
            data: {
              id: cart.users_permissions_user.id,
              attributes: {
                username: cart.users_permissions_user.username,
                email: cart.users_permissions_user.email
              }
            }
          } : null
        }
      }));

      return { data: formattedCarts };
    } catch (error) {
      console.error('Error fetching carts:', error);
      return ctx.badRequest('Failed to fetch carts', { error: error.message });
    }
  },
}));