'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// ✅ Add helper function at the top
const isAdmin = async (user) => {
  if (!user) return false;
  
  try {
    const userWithRole = await strapi.entityService.findOne(
      'plugin::users-permissions.user',
      user.id,
      { populate: ['role'] }
    );
    
    return userWithRole?.role?.type === 'admin' || 
           userWithRole?.role?.name?.toLowerCase() === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
  
  async checkoutCart(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      console.log('🔍 Checkout for user:', user.id);

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

      // Create order
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

  // ✅ UPDATED: Admin can view all orders
  async myOrders(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      console.log('📦 Fetching orders for user:', user.id);

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      console.log('👤 Is Admin:', userIsAdmin);

      // Build query based on role
      const orderQuery = {
        populate: ['books', 'payment', 'user'],
        orderBy: { createdAt: 'desc' }
      };

      // If NOT admin, filter by user ID
      if (!userIsAdmin) {
        orderQuery.where = { user: user.id };
      }

      const orders = await strapi.db.query('api::order.order').findMany(orderQuery);

      // Format response
      const formattedOrders = orders.map(order => ({
        id: order.id,
        cart_id: order.cart_id,
        total_amount: order.total_amount,
        status: order.status,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        books: order.books || [],
        payment: order.payment || null,
        // Show customer info only if admin
        customer: userIsAdmin ? {
          id: order.user?.id,
          email: order.user?.email,
          username: order.user?.username
        } : null
      }));

      return ctx.body = {
        success: true,
        data: formattedOrders,
        count: formattedOrders.length,
        user_id: user.id,
        is_admin: userIsAdmin,
        viewing_all: userIsAdmin
      };
    } catch (error) {
      console.error('❌ Error fetching orders:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching orders',
        error: error.message
      };
    }
  },

  // ✅ UPDATED: Admin can view any order
  async getOrder(ctx) {
    try {
      const user = ctx.state.user;
      const { id } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      console.log('🔍 Fetching order:', id);

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      console.log('👤 Is Admin:', userIsAdmin);

      // Build query
      const orderQuery = {
        where: { id: id },
        populate: ['books', 'payment', 'user']
      };

      // If NOT admin, also filter by user
      if (!userIsAdmin) {
        orderQuery.where.user = user.id;
      }

      const order = await strapi.db.query('api::order.order').findOne(orderQuery);

      if (!order) {
        return ctx.notFound('Order not found or you do not have access');
      }

      // Format response
      const formattedOrder = {
        id: order.id,
        cart_id: order.cart_id,
        total_amount: order.total_amount,
        status: order.status,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        books: order.books || [],
        payment: order.payment || null,
        // Show customer info only if admin
        customer: userIsAdmin ? {
          id: order.user?.id,
          email: order.user?.email,
          username: order.user?.username
        } : null
      };

      return ctx.body = {
        success: true,
        order: formattedOrder,
        is_admin: userIsAdmin
      };
    } catch (error) {
      console.error('❌ Error fetching order:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching order',
        error: error.message
      };
    }
  },

  // ✅ NEW: Get order statistics (admin only)
  async getOrderStats(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      
      if (!userIsAdmin) {
        return ctx.forbidden('This endpoint is only available to administrators');
      }

      console.log('📊 Generating order statistics...');

      // Get all orders
      const allOrders = await strapi.db.query('api::order.order').findMany({
        populate: ['books', 'payment']
      });

      // Calculate statistics
      const totalOrders = allOrders.length;
      const pendingOrders = allOrders.filter(o => o.status === 'PENDING').length;
      const completedOrders = allOrders.filter(o => o.status === 'COMPLETED').length;
      const cancelledOrders = allOrders.filter(o => o.status === 'CANCELLED').length;

      const totalRevenue = allOrders
        .filter(o => o.status === 'COMPLETED')
        .reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

      // Get unique customers
      const uniqueCustomers = new Set(
        allOrders
          .map(o => o.user)
          .filter(Boolean)
      );

      return ctx.body = {
        success: true,
        stats: {
          orders: {
            total: totalOrders,
            pending: pendingOrders,
            completed: completedOrders,
            cancelled: cancelledOrders
          },
          revenue: {
            total: totalRevenue.toFixed(2),
            currency: 'EUR',
            average_order_value: totalOrders > 0 
              ? (totalRevenue / totalOrders).toFixed(2) 
              : '0.00'
          },
          customers: {
            total: uniqueCustomers.size
          }
        },
        is_admin: true
      };
    } catch (error) {
      console.error('Error generating order stats:', error);
      return ctx.body = {
        success: false,
        message: 'Error generating statistics',
        error: error.message
      };
    }
  },

  // ✅ NEW: Update order status (admin only)
  async updateOrderStatus(ctx) {
    try {
      const user = ctx.state.user;
      const { id } = ctx.params;
      const { status } = ctx.request.body;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      
      if (!userIsAdmin) {
        return ctx.forbidden('Only administrators can update order status');
      }

      if (!status) {
        return ctx.badRequest('Status is required');
      }

      const validStatuses = ['PENDING', 'COMPLETED', 'CANCELLED', 'PROCESSING'];
      if (!validStatuses.includes(status)) {
        return ctx.badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }

      console.log(`🔄 Updating order ${id} status to ${status}`);

      // Find order
      const order = await strapi.db.query('api::order.order').findOne({
        where: { id: id }
      });

      if (!order) {
        return ctx.notFound('Order not found');
      }

      // Update order
      const updatedOrder = await strapi.db.query('api::order.order').update({
        where: { id: id },
        data: { 
          status: status,
          updatedAt: new Date()
        },
        populate: ['books', 'payment', 'user']
      });

      console.log('✅ Order status updated');

      return ctx.body = {
        success: true,
        message: 'Order status updated successfully',
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          updated_at: updatedOrder.updatedAt
        }
      };
    } catch (error) {
      console.error('Error updating order status:', error);
      return ctx.body = {
        success: false,
        message: 'Error updating order status',
        error: error.message
      };
    }
  }

}));