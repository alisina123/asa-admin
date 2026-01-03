'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
  
  async checkoutCart(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      console.log('🔍 Checkout for user:', user.id);

      // ✅ FIXED: Remove locale filter
      const cart = await strapi.db.query('api::cart.cart').findOne({
        where: { 
          users_permissions_user: user.id
        }
      });

      console.log('🛒 Cart found:', cart ? `Cart #${cart.id}` : 'No cart');

      if (!cart) {
        return ctx.badRequest('Cart not found. Please add items to cart first.');
      }

      if (!cart.items || cart.items.length === 0) {
        return ctx.badRequest('Cart is empty. Please add items before checkout.');
      }

      // Extract book IDs from cart items
      const bookIds = cart.items.map(item => parseInt(item.itemId));
      console.log('📚 Book IDs:', bookIds);

      // Fetch book details
      const books = await strapi.db.query('api::book.book').findMany({
        where: { id: { $in: bookIds } }
      });

      console.log('📚 Books found:', books.length);

      if (books.length === 0) {
        return ctx.badRequest('No valid books found in cart');
      }

      // Calculate total from cart
      const totalAmount = parseFloat(cart.total);

      // ✅ Create order (locale will be set automatically)
      const order = await strapi.db.query('api::order.order').create({
        data: {
          user: user.id,
          books: bookIds,
          cart_id: cart.id,
          total_amount: totalAmount,
          status: 'PENDING',
          publishedAt: new Date()
        }
      });

      console.log('✅ Order created:', order.id);

      ctx.body = {
        success: true,
        order: {
          id: order.id,
          cart_id: cart.id,
          total_amount: totalAmount,
          item_count: cart.items.length,
          books: books.map(b => ({
            id: b.id,
            title: b.title,
            price: b.price
          })),
          status: order.status
        }
      };
    } catch (error) {
      console.error('❌ Error creating order:', error);
      ctx.body = {
        success: false,
        message: 'Error creating order',
        error: error.message
      };
    }
  },

  async myOrders(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // ✅ FIXED: Remove locale filter
      const orders = await strapi.db.query('api::order.order').findMany({
        where: { 
          user: user.id
        },
        populate: ['books', 'payment'],
        orderBy: { createdAt: 'desc' }
      });

      ctx.body = {
        success: true,
        data: orders
      };
    } catch (error) {
      console.error('❌ Error fetching orders:', error);
      ctx.body = {
        success: false,
        message: 'Error fetching orders',
        error: error.message
      };
    }
  },

  async getOrder(ctx) {
    try {
      const user = ctx.state.user;
      const { id } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // ✅ FIXED: Remove locale filter
      const order = await strapi.db.query('api::order.order').findOne({
        where: { 
          id: id,
          user: user.id
        },
        populate: ['books', 'payment']
      });

      if (!order) {
        return ctx.notFound('Order not found');
      }

      ctx.body = {
        success: true,
        order: order
      };
    } catch (error) {
      console.error('❌ Error fetching order:', error);
      ctx.body = {
        success: false,
        message: 'Error fetching order',
        error: error.message
      };
    }
  }

}));