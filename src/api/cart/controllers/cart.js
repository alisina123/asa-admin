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
          status: 'pending_payment',
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
          status: cart.status,
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

      console.log('✅ Created cart with user_id:', user.id);
      
      return { data: response };
    } catch (error) {
      console.error('❌ Cart creation error:', error);
      return ctx.badRequest('Failed to create cart', { error: error.message });
    }
  },

  // ✅ UPDATED: Filter by logged-in user OR show all for admin
  async find(ctx) {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      console.log('🛒 Fetching carts for user:', user.id);

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      console.log('👤 Is Admin:', userIsAdmin);

      // Build query based on role
      const queryOptions = {
        sort: { createdAt: 'desc' },
        populate: {
          users_permissions_user: {
            fields: ['id', 'username', 'email', 'blocked', 'confirmed']
          }
        }
      };

      // If NOT admin, filter by user ID
      if (!userIsAdmin) {
        queryOptions.filters = {
          users_permissions_user: {
            id: user.id
          }
        };
      }
      // If admin, no filters = get all carts

      const carts = await strapi.entityService.findMany('api::cart.cart', queryOptions);

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
                email: cart.users_permissions_user.email,
                // Only show these fields to admin
                ...(userIsAdmin && {
                  blocked: cart.users_permissions_user.blocked,
                  confirmed: cart.users_permissions_user.confirmed
                })
              }
            }
          } : null
        }
      }));

      console.log(`✅ Found ${formattedCarts.length} carts`);

      return { 
        data: formattedCarts,
        meta: {
          pagination: {
            total: formattedCarts.length
          },
          is_admin: userIsAdmin,
          viewing_all: userIsAdmin,
          user_id: user.id
        }
      };
    } catch (error) {
      console.error('❌ Error fetching carts:', error);
      return ctx.badRequest('Failed to fetch carts', { error: error.message });
    }
  },

  // ✅ NEW: Get single cart (admin can view any, users only their own)
  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      console.log('🔍 Fetching cart:', id);

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);

      const cart = await strapi.entityService.findOne('api::cart.cart', id, {
        populate: {
          users_permissions_user: {
            fields: ['id', 'username', 'email', 'blocked', 'confirmed']
          }
        }
      });

      if (!cart) {
        return ctx.notFound('Cart not found');
      }

      // Check access: must be admin OR cart owner
      if (!userIsAdmin && cart.users_permissions_user?.id !== user.id) {
        return ctx.forbidden('You do not have access to this cart');
      }

      const response = {
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
                email: cart.users_permissions_user.email,
                // Only show these fields to admin
                ...(userIsAdmin && {
                  blocked: cart.users_permissions_user.blocked,
                  confirmed: cart.users_permissions_user.confirmed
                })
              }
            }
          } : null
        }
      };

      return { 
        data: response,
        meta: {
          is_admin: userIsAdmin,
          can_modify: userIsAdmin || cart.users_permissions_user?.id === user.id
        }
      };
    } catch (error) {
      console.error('❌ Error fetching cart:', error);
      return ctx.badRequest('Failed to fetch cart', { error: error.message });
    }
  },

  // ✅ NEW: Get cart statistics (admin only)
  async getStats(ctx) {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      
      if (!userIsAdmin) {
        return ctx.forbidden('This endpoint is only available to administrators');
      }

      console.log('📊 Generating cart statistics...');

      // Get all carts
      const allCarts = await strapi.entityService.findMany('api::cart.cart', {
        populate: {
          users_permissions_user: {
            fields: ['id', 'email']
          }
        }
      });

      // Calculate statistics
      const totalCarts = allCarts.length;
      const pendingCarts = allCarts.filter(c => c.status === 'pending_payment').length;
      const processingCarts = allCarts.filter(c => c.status === 'processing_payment').length;
      const paidCarts = allCarts.filter(c => c.status === 'paid').length;
      const failedCarts = allCarts.filter(c => c.status === 'payment_failed').length;

      const totalValue = allCarts.reduce((sum, cart) => sum + parseFloat(cart.total || 0), 0);
      const paidValue = allCarts
        .filter(c => c.status === 'paid')
        .reduce((sum, cart) => sum + parseFloat(cart.total || 0), 0);

      // Count items across all carts
      const totalItems = allCarts.reduce((sum, cart) => {
        return sum + (cart.items?.length || 0);
      }, 0);

      // Get unique customers
      const uniqueCustomers = new Set(
        allCarts
          .map(c => c.users_permissions_user?.id)
          .filter(Boolean)
      );

      // Status breakdown
      const statusBreakdown = {
        pending_payment: pendingCarts,
        processing_payment: processingCarts,
        paid: paidCarts,
        payment_failed: failedCarts
      };

      return ctx.body = {
        success: true,
        statistics: {
          carts: {
            total: totalCarts,
            ...statusBreakdown
          },
          value: {
            total: totalValue.toFixed(2),
            paid: paidValue.toFixed(2),
            pending: (totalValue - paidValue).toFixed(2),
            average_cart_value: totalCarts > 0 ? (totalValue / totalCarts).toFixed(2) : '0.00',
            currency: 'EUR'
          },
          items: {
            total: totalItems,
            average_per_cart: totalCarts > 0 ? (totalItems / totalCarts).toFixed(2) : '0.00'
          },
          customers: {
            unique: uniqueCustomers.size,
            average_carts_per_customer: uniqueCustomers.size > 0 
              ? (totalCarts / uniqueCustomers.size).toFixed(2) 
              : '0.00'
          },
          conversion: {
            rate: totalCarts > 0 ? ((paidCarts / totalCarts) * 100).toFixed(2) : '0.00',
            abandoned_rate: totalCarts > 0 ? (((pendingCarts + failedCarts) / totalCarts) * 100).toFixed(2) : '0.00'
          }
        },
        is_admin: true
      };
    } catch (error) {
      console.error('❌ Error generating cart statistics:', error);
      return ctx.body = {
        success: false,
        message: 'Error generating statistics',
        error: error.message
      };
    }
  },

  // ✅ NEW: Update cart status (admin only)
  async updateStatus(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const { status } = ctx.request.body;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      
      if (!userIsAdmin) {
        return ctx.forbidden('Only administrators can update cart status');
      }

      if (!status) {
        return ctx.badRequest('Status is required');
      }

      const validStatuses = ['pending_payment', 'processing_payment', 'paid', 'payment_failed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return ctx.badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }

      console.log(`🔄 Updating cart ${id} status to ${status}`);

      const updatedCart = await strapi.entityService.update('api::cart.cart', id, {
        data: { 
          status: status,
          updatedAt: new Date()
        },
        populate: {
          users_permissions_user: {
            fields: ['id', 'username', 'email']
          }
        }
      });

      console.log('✅ Cart status updated');

      return ctx.body = {
        success: true,
        message: 'Cart status updated successfully',
        data: {
          id: updatedCart.id,
          status: updatedCart.status,
          updated_at: updatedCart.updatedAt
        }
      };
    } catch (error) {
      console.error('❌ Error updating cart status:', error);
      return ctx.body = {
        success: false,
        message: 'Error updating cart status',
        error: error.message
      };
    }
  }
}));