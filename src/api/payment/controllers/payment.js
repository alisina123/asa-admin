'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const axios = require('axios');

module.exports = createCoreController('api::payment.payment', ({ strapi }) => ({
  
  // Create payment for an order using cart_id
  async createPayment(ctx) {
    try {
      console.log('📥 Request body:', ctx.request.body);
      
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      const { cartId } = ctx.request.body;
      
      console.log('🔍 Extracted cartId:', cartId);
      console.log('👤 Current user ID:', user.id);
      console.log('👤 Current user email:', user.email);

      if (!cartId) {
        return ctx.badRequest('cartId is required');
      }

      // Fetch cart details
      const cart = await strapi.db.query('api::cart.cart').findOne({
        where: { 
          id: parseInt(cartId)
        },
        populate: ['items', 'users_permissions_user']
      });

      if (!cart) {
        return ctx.notFound('Cart not found');
      }

      console.log('🛒 Cart found:', cart);

      // Check if cart belongs to current user
      if (!cart.users_permissions_user || cart.users_permissions_user.id !== user.id) {
        return ctx.unauthorized('This cart does not belong to you');
      }

      // Check if cart has items
      if (!cart.items || cart.items.length === 0) {
        return ctx.badRequest('Cart is empty');
      }

      // Check cart status
      if (cart.status === 'paid') {
        return ctx.badRequest('Cart is already paid');
      }

      // Calculate total
      const amount = parseFloat(cart.total);
      
      // Prepare payment payload
      const payload = {
        email: user.email,
        items: [
          {
            id: cartId,
            name: `Cart #${cartId} - ${cart.items.length} item(s)`,
            price: amount
          }
        ]
      };

      // Add redirects if available
      if (process.env.HESABPAY_REDIRECT_SUCCESS) {
        payload.redirect_success_url = `${process.env.HESABPAY_REDIRECT_SUCCESS}?cartId=${encodeURIComponent(cartId)}`;
      }
      if (process.env.HESABPAY_REDIRECT_FAILURE) {
        payload.redirect_failure_url = `${process.env.HESABPAY_REDIRECT_FAILURE}?cartId=${encodeURIComponent(cartId)}`;
      }

      console.log('📤 Sending to HesabPay:', payload);

      // Send request to HesabPay
      const response = await axios.post(
        `${process.env.HESABPAY_BASE_URL}/payment/create-session`,
        payload,
        {
          headers: {
            Authorization: `API-KEY ${process.env.HESABPAY_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        }
      );

      const paymentUrl = response.data?.payment_url || response.data?.redirect_url;
      const transactionId = response.data?.transaction_id || null;

      console.log('📥 HesabPay Response:', response.data);

      // Update cart status to processing
      await strapi.db.query('api::cart.cart').update({
        where: { id: cart.id },
        data: { 
          status: 'processing_payment',
          updatedAt: new Date()
        }
      });

      ctx.body = {
        success: true,
        payment_url: paymentUrl,
        transaction_id: transactionId,
        cart_id: cartId,
        user_id: user.id,
        amount: amount,
        items: cart.items.map(item => ({
          id: item.itemId,
          title: item.title,
          price: item.price,
          quantity: item.quantity
        })),
        data: response.data
      };
    } catch (error) {
      console.error('❌ Payment Error:', error.response?.data || error.message);
      ctx.body = {
        success: false,
        message: 'Payment initiation failed',
        error: error.response?.data || error.message
      };
    }
  },

  // Handle success callback
  async paymentSuccess(ctx) {
    try {
      console.log('==========================================');
      console.log('🚀 PAYMENT SUCCESS CALLBACK STARTED');
      console.log('🌐 Full URL:', ctx.request.url);
      console.log('📦 Query params:', JSON.stringify(ctx.query, null, 2));
      console.log('==========================================');

      // Extract cartId and data from query
      let cartId = ctx.query.cartId;
      let rawData = ctx.query.data;

      // Handle malformed URL - extract from full URL if needed
      if (!cartId || !rawData) {
        const fullUrl = ctx.request.url;
        console.log('⚠️ Missing params, parsing from URL:', fullUrl);

        // Extract cartId
        const cartIdMatch = fullUrl.match(/cartId=(\d+)/);
        if (cartIdMatch) {
          cartId = cartIdMatch[1];
          console.log('✅ Extracted cartId:', cartId);
        }

        // Extract data
        const dataMatch = fullUrl.match(/data=([^&]+)/);
        if (dataMatch) {
          rawData = decodeURIComponent(dataMatch[1]);
          console.log('✅ Extracted rawData:', rawData);
        }
      }

      // Validate parameters
      if (!cartId) {
        console.error('❌ NO CART ID FOUND');
        ctx.status = 400;
        return ctx.body = { 
          success: false, 
          message: 'cartId is required',
          url: ctx.request.url
        };
      }

      if (!rawData) {
        console.error('❌ NO DATA FOUND');
        ctx.status = 400;
        return ctx.body = { 
          success: false, 
          message: 'data parameter is required',
          url: ctx.request.url
        };
      }

      // Parse JSON data
      let parsed;
      try {
        parsed = JSON.parse(rawData);
        console.log('✅ Parsed payment data:', JSON.stringify(parsed, null, 2));
      } catch (parseError) {
        console.error('❌ JSON PARSE ERROR:', parseError.message);
        console.error('Raw data:', rawData);
        ctx.status = 400;
        return ctx.body = { 
          success: false, 
          message: 'Invalid JSON in data parameter',
          error: parseError.message
        };
      }

      const transaction_id = parsed.transaction_id;
      if (!transaction_id) {
        console.error('❌ NO TRANSACTION ID');
        ctx.status = 400;
        return ctx.body = { 
          success: false, 
          message: 'No transaction_id in payment data'
        };
      }

      console.log('🔑 Transaction ID:', transaction_id);
      console.log('🛒 Cart ID:', cartId);

      // Fetch cart WITHOUT locale requirement
      console.log('🔍 Fetching cart from database...');
      const cart = await strapi.db.query('api::cart.cart').findOne({
        where: { 
          id: parseInt(cartId)
        },
        populate: ['users_permissions_user', 'items']
      });

      if (!cart) {
        console.error('❌ CART NOT FOUND:', cartId);
        ctx.status = 404;
        return ctx.body = { 
          success: false, 
          message: 'Cart not found',
          cartId: cartId
        };
      }

      console.log('✅ Cart found:', {
        id: cart.id,
        total: cart.total,
        status: cart.status,
        items: cart.items?.length,
        user_id: cart.users_permissions_user?.id,
        user_email: cart.users_permissions_user?.email
      });

      // Check for existing payment WITHOUT locale
      console.log('🔍 Checking for existing payment...');
      const existingPayment = await strapi.db.query('api::payment.payment').findOne({
        where: { 
          order_id: parseInt(cartId)
        }
      });

      if (existingPayment) {
        console.log('⚠️ Payment already exists, updating it');
        
        const updated = await strapi.db.query('api::payment.payment').update({
          where: { id: existingPayment.id },
          data: {
            transaction_id: transaction_id,
            status: 'SUCCESS',
            updatedAt: new Date()
          }
        });

        console.log('✅ Payment updated:', updated);
      } else {
        console.log('🆕 Creating new payment record...');

        // Prepare payment data WITHOUT locale
        const paymentData = {
          order_id: parseInt(cartId),
          amount: parseFloat(cart.total).toFixed(2),
          description: `Payment for Cart #${cartId}`,
          customer_email: cart.users_permissions_user?.email || 'no-email@provided.com',
          transaction_id: transaction_id,
          status: 'SUCCESS',
          user: cart.users_permissions_user?.id || null,
          publishedAt: new Date()
        };

        console.log('📝 Payment data to insert:', JSON.stringify(paymentData, null, 2));

        try {
          const savedPayment = await strapi.db.query('api::payment.payment').create({
            data: paymentData
          });

          console.log('✅✅✅ PAYMENT SAVED SUCCESSFULLY ✅✅✅');
          console.log('💾 Saved payment ID:', savedPayment.id);
          console.log('💾 Full payment record:', JSON.stringify(savedPayment, null, 2));
        } catch (dbError) {
          console.error('❌❌❌ DATABASE INSERT FAILED ❌❌❌');
          console.error('Error message:', dbError.message);
          console.error('Error details:', dbError.details);
          console.error('Error stack:', dbError.stack);
          throw dbError;
        }
      }

      // Update cart status
      console.log('🔄 Updating cart status to paid...');
      await strapi.db.query('api::cart.cart').update({
        where: { id: parseInt(cartId) },
        data: { 
          status: 'paid',
          updatedAt: new Date()
        }
      });

      console.log('✅ Cart updated to paid status');
      console.log('==========================================');

      // Redirect to frontend
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const redirectUrl = `${frontendUrl}/payment/success?cartId=${cartId}&transactionId=${transaction_id}`;
      
      console.log('🔀 Redirecting to:', redirectUrl);
      return ctx.redirect(redirectUrl);

    } catch (error) {
      console.error('==========================================');
      console.error('❌❌❌ CRITICAL ERROR ❌❌❌');
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
      console.error('==========================================');

      ctx.status = 500;
      return ctx.body = {
        success: false,
        message: 'Internal server error',
        error: error.message
      };
    }
  },

  // Handle failure callback
  async paymentFailure(ctx) {
    try {
      let { data: rawData, cartId } = ctx.query;

      console.log('❌ Payment Failure Callback:', { rawData, cartId });

      if (!rawData && ctx.request.url.includes('?data=')) {
        const urlParts = ctx.request.url.split('?data=');
        rawData = decodeURIComponent(urlParts[1]);
      }

      if (!rawData || !cartId) {
        return (ctx.body = { 
          success: false, 
          message: 'No data or cartId provided' 
        });
      }

      // Update cart status to payment_failed
      await strapi.db.query('api::cart.cart').update({
        where: { id: parseInt(cartId) },
        data: { 
          status: 'payment_failed',
          updatedAt: new Date()
        }
      });

      console.log('❌ Payment failed, cart status updated');

      // Redirect to frontend failure page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const redirectUrl = `${frontendUrl}/payment/failed?cartId=${cartId}`;
      
      return ctx.redirect(redirectUrl);
    } catch (err) {
      console.error('❌ Failure callback error:', err);
      ctx.body = { 
        success: false, 
        message: 'Error updating payment',
        error: err.message
      };
    }
  },
// ========== JOURNAL HANDLERS (aliases that work with generic cart system) ==========
  
  // Get user's purchased journals
  async myJournals(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in to view your journals');
      }

      console.log('📚 Fetching journals for user:', user.id);

      // Find all successful payments
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { 
          user: user.id,
          status: 'SUCCESS'
        },
        orderBy: { createdAt: 'desc' }
      });

      if (payments.length === 0) {
        return ctx.body = {
          success: true,
          journals: [],
          message: 'No purchased journals found'
        };
      }

      const cartIds = payments
        .map(p => parseInt(p.order_id))
        .filter(id => !isNaN(id));

      if (cartIds.length === 0) {
        return ctx.body = {
          success: true,
          journals: [],
          message: 'No valid orders found'
        };
      }

      // Get paid carts with items
      const paidCarts = await strapi.db.query('api::cart.cart').findMany({
        where: { 
          id: { $in: cartIds }
        },
        populate: ['items']
      });

      // Extract unique journals
      const journalsMap = new Map();
      
      for (const cart of paidCarts) {
        if (!cart.items || !Array.isArray(cart.items)) continue;

        for (const item of cart.items) {
          const journalId = parseInt(item.itemId);
          
          if (!journalId || isNaN(journalId)) continue;
          if (journalsMap.has(journalId)) continue;

          try {
            // Try to fetch as journal first, fallback to book
            let journal = null;
            
            try {
              journal = await strapi.entityService.findOne('api::journal.journal', journalId, {
                populate: ['image', 'pdf', 'cover']
              });
            } catch (e) {
              // If journal doesn't exist, try book
              journal = await strapi.entityService.findOne('api::book.book', journalId, {
                populate: ['image', 'pdf']
              });
            }

            if (journal) {
              // Handle cover image
              let coverImage = null;
              if (journal.image) {
                coverImage = Array.isArray(journal.image) 
                  ? journal.image[0]?.url 
                  : journal.image.url;
              } else if (journal.cover) {
                coverImage = Array.isArray(journal.cover) 
                  ? journal.cover[0]?.url 
                  : journal.cover.url;
              }

              // Handle PDF
              let pdfUrl = null;
              if (journal.pdf) {
                pdfUrl = Array.isArray(journal.pdf) 
                  ? journal.pdf[0]?.url 
                  : journal.pdf.url;
              }

              journalsMap.set(journalId, {
                id: journal.id,
                title: journal.title,
                author: journal.author || journal.publisher,
                description: journal.description || journal.abstract,
                price: journal.price,
                coverImage: coverImage,
                pdfUrl: pdfUrl,
                purchasedAt: cart.createdAt,
                cartId: cart.id
              });
            } else {
              // Fallback to cart data
              journalsMap.set(journalId, {
                id: journalId,
                title: item.title || 'Untitled',
                author: item.author || 'Unknown',
                description: '',
                price: item.price || 0,
                coverImage: item.image || null,
                pdfUrl: null,
                purchasedAt: cart.createdAt,
                cartId: cart.id
              });
            }
          } catch (err) {
            console.error(`Error fetching journal ${journalId}:`, err.message);
          }
        }
      }

      const journals = Array.from(journalsMap.values());

      return ctx.body = {
        success: true,
        journals: journals,
        count: journals.length,
        user_id: user.id
      };
    } catch (error) {
      console.error('Error fetching journals:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching your journals',
        error: error.message,
        journals: []
      };
    }
  },

  // Check journal access
  async checkJournalAccess(ctx) {
    try {
      const user = ctx.state.user;
      const { journalId } = ctx.params;
      
      if (!user) {
        return ctx.body = {
          success: false,
          message: 'You must be logged in',
          has_access: false
        };
      }

      if (!journalId) {
        return ctx.badRequest('journalId is required');
      }

      console.log('🔍 JOURNAL ACCESS CHECK');
      console.log('   User:', user.id);
      console.log('   Journal:', journalId);

      // Get all successful payments
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { 
          user: user.id,
          status: 'SUCCESS'
        }
      });

      if (payments.length === 0) {
        console.log('   ❌ No successful payments found');
        return ctx.body = {
          success: true,
          has_access: false,
          message: 'No purchases found'
        };
      }

      const cartIds = payments
        .map(p => parseInt(p.order_id))
        .filter(id => !isNaN(id));

      // Check if any paid cart contains this journal
      const paidCarts = await strapi.db.query('api::cart.cart').findMany({
        where: { 
          id: { $in: cartIds }
        },
        populate: ['items']
      });

      let hasAccess = false;
      let foundInCart = null;

      for (const cart of paidCarts) {
        if (cart.items && Array.isArray(cart.items)) {
          const found = cart.items.some(item => {
            const itemId = item.itemId || item.id;
            return itemId && parseInt(itemId) === parseInt(journalId);
          });

          if (found) {
            hasAccess = true;
            foundInCart = cart.id;
            console.log(`   ✅ Access granted via Cart #${cart.id}`);
            break;
          }
        }
      }

      if (!hasAccess) {
        console.log('   ❌ Access denied - journal not in any paid cart');
      }

      return ctx.body = {
        success: true,
        has_access: hasAccess,
        cart_id: foundInCart
      };
    } catch (error) {
      console.error('❌ Error checking journal access:', error);
      return ctx.body = {
        success: false,
        message: 'Error checking journal access',
        error: error.message,
        has_access: false
      };
    }
  },
  // ========== ARTICLE HANDLERS ==========
  
  // Get user's purchased articles
  async myArticles(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in to view your articles');
      }

      console.log('📰 Fetching articles for user:', user.id);

      // Find all successful payments
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { 
          user: user.id,
          status: 'SUCCESS'
        },
        orderBy: { createdAt: 'desc' }
      });

      if (payments.length === 0) {
        return ctx.body = {
          success: true,
          articles: [],
          message: 'No purchased articles found'
        };
      }

      const cartIds = payments
        .map(p => parseInt(p.order_id))
        .filter(id => !isNaN(id));

      if (cartIds.length === 0) {
        return ctx.body = {
          success: true,
          articles: [],
          message: 'No valid orders found'
        };
      }

      // Get paid carts with items
      const paidCarts = await strapi.db.query('api::cart.cart').findMany({
        where: { 
          id: { $in: cartIds }
        },
        populate: ['items']
      });

      // Extract unique articles
      const articlesMap = new Map();
      
      for (const cart of paidCarts) {
        if (!cart.items || !Array.isArray(cart.items)) continue;

        for (const item of cart.items) {
          const articleId = parseInt(item.itemId);
          
          if (!articleId || isNaN(articleId)) continue;
          if (articlesMap.has(articleId)) continue;

          try {
            // Try to fetch as article first, then journal, then book
            let article = null;
            
            try {
              article = await strapi.entityService.findOne('api::article.article', articleId, {
                populate: ['image', 'pdf', 'cover']
              });
            } catch (e) {
              try {
                article = await strapi.entityService.findOne('api::journal.journal', articleId, {
                  populate: ['image', 'pdf', 'cover']
                });
              } catch (e2) {
                article = await strapi.entityService.findOne('api::book.book', articleId, {
                  populate: ['image', 'pdf']
                });
              }
            }

            if (article) {
              // Handle cover image
              let coverImage = null;
              if (article.image) {
                coverImage = Array.isArray(article.image) 
                  ? article.image[0]?.url 
                  : article.image.url;
              } else if (article.cover) {
                coverImage = Array.isArray(article.cover) 
                  ? article.cover[0]?.url 
                  : article.cover.url;
              }

              // Handle PDF
              let pdfUrl = null;
              if (article.pdf) {
                pdfUrl = Array.isArray(article.pdf) 
                  ? article.pdf[0]?.url 
                  : article.pdf.url;
              }

              articlesMap.set(articleId, {
                id: article.id,
                title: article.title,
                author: article.author || article.publisher,
                description: article.description || article.abstract || article.summary,
                price: article.price,
                coverImage: coverImage,
                pdfUrl: pdfUrl,
                // Article-specific fields
                doi: article.doi,
                publishedDate: article.publishedDate || article.publication_date,
                journal: article.journal,
                volume: article.volume,
                issue: article.issue,
                pages: article.pages,
                purchasedAt: cart.createdAt,
                cartId: cart.id
              });
            } else {
              // Fallback to cart data
              articlesMap.set(articleId, {
                id: articleId,
                title: item.title || 'Untitled',
                author: item.author || 'Unknown',
                description: '',
                price: item.price || 0,
                coverImage: item.image || null,
                pdfUrl: null,
                purchasedAt: cart.createdAt,
                cartId: cart.id
              });
            }
          } catch (err) {
            console.error(`Error fetching article ${articleId}:`, err.message);
          }
        }
      }

      const articles = Array.from(articlesMap.values());

      return ctx.body = {
        success: true,
        articles: articles,
        count: articles.length,
        user_id: user.id
      };
    } catch (error) {
      console.error('Error fetching articles:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching your articles',
        error: error.message,
        articles: []
      };
    }
  },

  // Check article access
  async checkArticleAccess(ctx) {
    try {
      const user = ctx.state.user;
      const { articleId } = ctx.params;
      
      if (!user) {
        return ctx.body = {
          success: false,
          message: 'You must be logged in',
          has_access: false
        };
      }

      if (!articleId) {
        return ctx.badRequest('articleId is required');
      }

      console.log('🔍 ARTICLE ACCESS CHECK');
      console.log('   User:', user.id);
      console.log('   Article:', articleId);

      // Get all successful payments
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { 
          user: user.id,
          status: 'SUCCESS'
        }
      });

      if (payments.length === 0) {
        console.log('   ❌ No successful payments found');
        return ctx.body = {
          success: true,
          has_access: false,
          message: 'No purchases found'
        };
      }

      const cartIds = payments
        .map(p => parseInt(p.order_id))
        .filter(id => !isNaN(id));

      // Check if any paid cart contains this article
      const paidCarts = await strapi.db.query('api::cart.cart').findMany({
        where: { 
          id: { $in: cartIds }
        },
        populate: ['items']
      });

      let hasAccess = false;
      let foundInCart = null;

      for (const cart of paidCarts) {
        if (cart.items && Array.isArray(cart.items)) {
          const found = cart.items.some(item => {
            const itemId = item.itemId || item.id;
            return itemId && parseInt(itemId) === parseInt(articleId);
          });

          if (found) {
            hasAccess = true;
            foundInCart = cart.id;
            console.log(`   ✅ Access granted via Cart #${cart.id}`);
            break;
          }
        }
      }

      if (!hasAccess) {
        console.log('   ❌ Access denied - article not in any paid cart');
      }

      return ctx.body = {
        success: true,
        has_access: hasAccess,
        cart_id: foundInCart
      };
    } catch (error) {
      console.error('❌ Error checking article access:', error);
      return ctx.body = {
        success: false,
        message: 'Error checking article access',
        error: error.message,
        has_access: false
      };
    }
  },

   // Get all purchased content (magazine view)
async myMagazine(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view your purchased content');
    }

    console.log('📰 Fetching purchased content for user:', user.id);
    console.log('👤 User ID:', user.id, 'Email:', user.email);

    // Find all successful payments for THIS user
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { 
        user: user.id,
        status: 'SUCCESS'
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('💰 Found payments:', payments.length);
    console.log('📊 Payments:', payments.map(p => ({
      id: p.id,
      order_id: p.order_id,
      user: p.user?.id,
      status: p.status
    })));

    if (payments.length === 0) {
      console.log('❌ No successful payments found for user');
      return ctx.body = {
        success: true,
        items: [],
        message: 'No purchased content found'
      };
    }

    const cartIds = payments
      .map(p => parseInt(p.order_id))
      .filter(id => !isNaN(id));

    console.log('🛒 Cart IDs from payments:', cartIds);

    if (cartIds.length === 0) {
      console.log('❌ No valid cart IDs found');
      return ctx.body = {
        success: true,
        items: [],
        message: 'No valid orders found'
      };
    }

    // Get paid carts with items
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { 
        id: { $in: cartIds }
      },
      populate: ['items', 'user']  // Also populate user
    });

    console.log('🛍️ Found carts:', paidCarts.length);
    console.log('📦 Carts:', paidCarts.map(cart => ({
      id: cart.id,
      userId: cart.user?.id,
      itemCount: cart.items?.length || 0,
      items: cart.items?.map(i => ({ itemId: i.itemId, itemType: i.itemType, title: i.title }))
    })));

    // Verify each cart belongs to the current user
    const userCarts = paidCarts.filter(cart => {
      const cartUserId = cart.user?.id || cart.user;
      return cartUserId === user.id;
    });

    console.log('✅ User carts after filtering:', userCarts.length);
    if (userCarts.length < paidCarts.length) {
      console.log('⚠️ Some carts don\'t belong to current user!');
    }

    // Extract unique items
    const itemsMap = new Map();
    
    for (const cart of userCarts) {
      if (!cart.items || !Array.isArray(cart.items)) {
        console.log(`Cart ${cart.id} has no items`);
        continue;
      }

      console.log(`📋 Processing cart ${cart.id} with ${cart.items.length} items`);
      
      for (const item of cart.items) {
        const itemId = parseInt(item.itemId);
        const itemType = item.itemType || 'article';
        
        console.log(`   Item: ${itemId} (${itemType}) - ${item.title}`);
        
        if (!itemId || isNaN(itemId)) {
          console.log('   ⚠️ Invalid item ID, skipping');
          continue;
        }
        
        // Create unique key using both id and type
        const uniqueKey = `${itemType}_${itemId}`;
        if (itemsMap.has(uniqueKey)) {
          console.log(`   ⚠️ Duplicate item, skipping`);
          continue;
        }

        try {
          let contentItem = null;
          let contentType = itemType;
          
          console.log(`   🔍 Fetching ${contentType} ${itemId}...`);
          
          // Fetch based on content type
          switch (itemType.toLowerCase()) {
            case 'article':
              contentItem = await strapi.entityService.findOne('api::article.article', itemId, {
                populate: ['image', 'pdf', 'cover']
              });
              break;
              
            case 'journal':
              contentItem = await strapi.entityService.findOne('api::journal.journal', itemId, {
                populate: ['image', 'pdf', 'cover']
              });
              break;
              
            case 'book':
              contentItem = await strapi.entityService.findOne('api::book.book', itemId, {
                populate: ['image', 'pdf', 'cover', 'author']
              });
              break;
              
            default:
              // Try to determine type automatically
              console.log(`   🔄 Auto-detecting type for ${itemId}...`);
              try {
                contentItem = await strapi.entityService.findOne('api::article.article', itemId, {
                  populate: ['image', 'pdf']
                });
                contentType = 'article';
              } catch (e1) {
                try {
                  contentItem = await strapi.entityService.findOne('api::journal.journal', itemId, {
                    populate: ['image', 'pdf']
                  });
                  contentType = 'journal';
                } catch (e2) {
                  contentItem = await strapi.entityService.findOne('api::book.book', itemId, {
                    populate: ['image', 'pdf']
                  });
                  contentType = 'book';
                }
              }
          }

          if (contentItem) {
            console.log(`   ✅ Found ${contentType}: ${contentItem.title || contentItem.name}`);
            
            // Handle cover image
            let coverImage = null;
            if (contentItem.image) {
              coverImage = Array.isArray(contentItem.image) 
                ? contentItem.image[0]?.url 
                : contentItem.image.url;
            } else if (contentItem.cover) {
              coverImage = Array.isArray(contentItem.cover) 
                ? contentItem.cover[0]?.url 
                : contentItem.cover.url;
            }

            // Handle PDF
            let pdfUrl = null;
            if (contentItem.pdf) {
              pdfUrl = Array.isArray(contentItem.pdf) 
                ? contentItem.pdf[0]?.url 
                : contentItem.pdf.url;
            }

            // Type-specific fields
            let typeSpecificData = {};
            
            switch (contentType) {
              case 'article':
                typeSpecificData = {
                  author: contentItem.author,
                  doi: contentItem.doi,
                  publishedDate: contentItem.publishedDate,
                  journal: contentItem.journal,
                  volume: contentItem.volume,
                  issue: contentItem.issue,
                  pages: contentItem.pages
                };
                break;
                
              case 'journal':
                typeSpecificData = {
                  publisher: contentItem.publisher,
                  issn: contentItem.issn,
                  publication_date: contentItem.publication_date,
                  volume: contentItem.volume,
                  issue: contentItem.issue
                };
                break;
                
              case 'book':
                typeSpecificData = {
                  author: contentItem.author,
                  isbn: contentItem.isbn,
                  publisher: contentItem.publisher,
                  published_date: contentItem.published_date,
                  pages: contentItem.pages,
                  edition: contentItem.edition
                };
                break;
            }

            itemsMap.set(uniqueKey, {
              id: contentItem.id,
              type: contentType,
              title: contentItem.title || contentItem.name,
              description: contentItem.description || contentItem.abstract || contentItem.summary,
              price: item.price || contentItem.price || 0,
              purchasedAt: cart.createdAt,
              cartId: cart.id,
              itemId: itemId,
              ...typeSpecificData,
              coverImage,
              pdfUrl
            });
          } else {
            console.log(`   ❌ ${contentType} ${itemId} not found, using cart data`);
            // Fallback to cart data
            itemsMap.set(uniqueKey, {
              id: itemId,
              type: itemType,
              title: item.title || 'Untitled',
              author: item.author || 'Unknown',
              description: '',
              price: item.price || 0,
              coverImage: item.image || null,
              pdfUrl: null,
              purchasedAt: cart.createdAt,
              cartId: cart.id,
              itemId: itemId
            });
          }
        } catch (err) {
          console.error(`   ❌ Error fetching ${itemType} ${itemId}:`, err.message);
        }
      }
    }

    const items = Array.from(itemsMap.values());
    console.log('🎉 Final items found:', items.length);
    console.log('📚 Items:', items.map(i => `${i.type} ${i.id}: ${i.title}`));

    // Group by type for better organization
    const groupedItems = {
      articles: items.filter(item => item.type === 'article'),
      journals: items.filter(item => item.type === 'journal'),
      books: items.filter(item => item.type === 'book'),
      all: items
    };

    return ctx.body = {
      success: true,
      items: groupedItems,
      counts: {
        total: items.length,
        articles: groupedItems.articles.length,
        journals: groupedItems.journals.length,
        books: groupedItems.books.length
      },
      user_id: user.id,
      debug: {
        payments_count: payments.length,
        cart_ids: cartIds,
        user_carts_count: userCarts.length,
        all_carts_count: paidCarts.length
      }
    };
  } catch (error) {
    console.error('❌ Error fetching magazine content:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching your content',
      error: error.message,
      items: {
        articles: [],
        journals: [],
        books: [],
        all: []
      }
    };
  }
},

// Check magazine access
async checkMagazineAccess(ctx) {
  try {
    const user = ctx.state.user;
    const { itemId, itemType } = ctx.params;
    
    if (!user) {
      return ctx.body = {
        success: false,
        message: 'You must be logged in',
        has_access: false
      };
    }

    if (!itemId) {
      return ctx.badRequest('itemId is required');
    }

    console.log('🔍 MAGAZINE ACCESS CHECK');
    console.log('   User:', user.id);
    console.log('   Item ID:', itemId);
    console.log('   Item Type:', itemType || 'any');

    // Get all successful payments
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { 
        user: user.id,
        status: 'SUCCESS'
      }
    });

    if (payments.length === 0) {
      console.log('   ❌ No successful payments found');
      return ctx.body = {
        success: true,
        has_access: false,
        message: 'No purchases found'
      };
    }

    const cartIds = payments
      .map(p => parseInt(p.order_id))
      .filter(id => !isNaN(id));

    // Check if any paid cart contains this item
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { 
        id: { $in: cartIds }
      },
      populate: ['items']
    });

    let hasAccess = false;
    let foundInCart = null;
    let foundItemType = null;

    for (const cart of paidCarts) {
      if (cart.items && Array.isArray(cart.items)) {
        const foundItem = cart.items.find(item => {
          const currentItemId = item.itemId || item.id;
          
          // If itemType is specified, check both id and type
          if (itemType) {
            return currentItemId && 
                   parseInt(currentItemId) === parseInt(itemId) && 
                   (item.itemType || 'article').toLowerCase() === itemType.toLowerCase();
          }
          
          // Otherwise just check id
          return currentItemId && parseInt(currentItemId) === parseInt(itemId);
        });

        if (foundItem) {
          hasAccess = true;
          foundInCart = cart.id;
          foundItemType = foundItem.itemType || 'article';
          console.log(`   ✅ Access granted via Cart #${cart.id} (Type: ${foundItemType})`);
          break;
        }
      }
    }

    if (!hasAccess) {
      console.log('   ❌ Access denied - item not in any paid cart');
    }

    return ctx.body = {
      success: true,
      has_access: hasAccess,
      cart_id: foundInCart,
      item_type: foundItemType,
      item_id: parseInt(itemId)
    };
  } catch (error) {
    console.error('❌ Error checking magazine access:', error);
    return ctx.body = {
      success: false,
      message: 'Error checking access',
      error: error.message,
      has_access: false
    };
  }
},

// Get magazine content for viewing
async getMagazineContent(ctx) {
  try {
    const user = ctx.state.user;
    const { itemId, itemType } = ctx.params;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    if (!itemId || !itemType) {
      return ctx.badRequest('itemId and itemType are required');
    }

    // First check if user has access
    const accessCheck = await this.checkMagazineAccess(ctx);
    if (!accessCheck.body.has_access) {
      return ctx.body = {
        success: false,
        message: 'You do not have access to this content'
      };
    }

    let contentItem = null;
    let contentType = itemType.toLowerCase();
    
    // Fetch content based on type
    switch (contentType) {
      case 'article':
        contentItem = await strapi.entityService.findOne('api::article.article', parseInt(itemId), {
          populate: ['image', 'pdf', 'cover', 'journal', 'author']
        });
        break;
        
      case 'journal':
        contentItem = await strapi.entityService.findOne('api::journal.journal', parseInt(itemId), {
          populate: ['image', 'pdf', 'cover', 'publisher']
        });
        break;
        
      case 'book':
        contentItem = await strapi.entityService.findOne('api::book.book', parseInt(itemId), {
          populate: ['image', 'pdf', 'cover', 'author', 'publisher']
        });
        break;
        
      default:
        return ctx.badRequest(`Unsupported content type: ${itemType}`);
    }

    if (!contentItem) {
      return ctx.notFound('Content not found');
    }

    // Prepare response data
    const responseData = {
      id: contentItem.id,
      type: contentType,
      title: contentItem.title || contentItem.name,
      description: contentItem.description || contentItem.abstract || contentItem.summary || '',
      content: contentItem.content || '',
      pdfUrl: contentItem.pdf?.url || null,
      coverImage: contentItem.image?.url || contentItem.cover?.url || null,
      createdAt: contentItem.createdAt,
      updatedAt: contentItem.updatedAt
    };

    // Add type-specific fields
    if (contentType === 'article') {
      Object.assign(responseData, {
        author: contentItem.author,
        doi: contentItem.doi,
        publishedDate: contentItem.publishedDate,
        journal: contentItem.journal,
        volume: contentItem.volume,
        issue: contentItem.issue,
        pages: contentItem.pages,
        keywords: contentItem.keywords || [],
        citations: contentItem.citations || []
      });
    } else if (contentType === 'journal') {
      Object.assign(responseData, {
        publisher: contentItem.publisher,
        issn: contentItem.issn,
        publication_date: contentItem.publication_date,
        volume: contentItem.volume,
        issue: contentItem.issue,
        frequency: contentItem.frequency
      });
    } else if (contentType === 'book') {
      Object.assign(responseData, {
        author: contentItem.author,
        isbn: contentItem.isbn,
        publisher: contentItem.publisher,
        published_date: contentItem.published_date,
        pages: contentItem.pages,
        edition: contentItem.edition,
        language: contentItem.language,
        category: contentItem.category
      });
    }

    return ctx.body = {
      success: true,
      data: responseData,
      permissions: {
        can_download: true,
        can_print: true,
        can_share: false
      }
    };
    
  } catch (error) {
    console.error('Error fetching magazine content:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching content',
      error: error.message
    };
  }
},
  // Get article with PDF
  async getArticleWithPDF(ctx) {
    try {
      const user = ctx.state.user;
      const { articleId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Check access
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { user: user.id, status: 'SUCCESS' }
      });

      const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
      
      const carts = await strapi.db.query('api::cart.cart').findMany({
        where: { id: { $in: cartIds } },
        populate: ['items']
      });

      let hasAccess = false;
      for (const cart of carts) {
        if (cart.items?.some(item => parseInt(item.itemId) === parseInt(articleId))) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('You do not have access to this article');
      }

      // Try to get as article first, fallback to journal/book
      let article = null;
      try {
        article = await strapi.entityService.findOne('api::article.article', parseInt(articleId), {
          populate: ['image', 'pdf', 'cover']
        });
      } catch (e) {
        try {
          article = await strapi.entityService.findOne('api::journal.journal', parseInt(articleId), {
            populate: ['image', 'pdf', 'cover']
          });
        } catch (e2) {
          article = await strapi.entityService.findOne('api::book.book', parseInt(articleId), {
            populate: ['image', 'pdf']
          });
        }
      }

      if (!article) {
        return ctx.notFound('Article not found');
      }

      // Handle image
      let coverImage = null;
      if (article.image) {
        coverImage = Array.isArray(article.image) ? article.image[0]?.url : article.image.url;
      } else if (article.cover) {
        coverImage = Array.isArray(article.cover) ? article.cover[0]?.url : article.cover.url;
      }

      // Handle PDF
      let pdfUrl = null;
      if (article.pdf) {
        pdfUrl = Array.isArray(article.pdf) ? article.pdf[0]?.url : article.pdf.url;
      }

      return ctx.body = {
        success: true,
        article: {
          id: article.id,
          title: article.title,
          author: article.author || article.publisher,
          description: article.description || article.abstract || article.summary,
          coverImage: coverImage,
          pdfUrl: pdfUrl,
          doi: article.doi,
          publishedDate: article.publishedDate || article.publication_date,
          journal: article.journal,
          volume: article.volume,
          issue: article.issue,
          pages: article.pages
        }
      };
    } catch (error) {
      console.error('Error fetching article:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching article',
        error: error.message
      };
    }
  },

  // Download article PDF
  async downloadArticle(ctx) {
    try {
      const user = ctx.state.user;
      const { articleId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Verify access
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { user: user.id, status: 'SUCCESS' }
      });

      const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
      
      const carts = await strapi.db.query('api::cart.cart').findMany({
        where: { id: { $in: cartIds } },
        populate: ['items']
      });

      let hasAccess = false;
      for (const cart of carts) {
        if (cart.items?.some(item => parseInt(item.itemId) === parseInt(articleId))) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('Access denied');
      }

      // Get article PDF
      let article = null;
      try {
        article = await strapi.entityService.findOne('api::article.article', parseInt(articleId), {
          populate: ['pdf']
        });
      } catch (e) {
        try {
          article = await strapi.entityService.findOne('api::journal.journal', parseInt(articleId), {
            populate: ['pdf']
          });
        } catch (e2) {
          article = await strapi.entityService.findOne('api::book.book', parseInt(articleId), {
            populate: ['pdf']
          });
        }
      }

      if (!article || !article.pdf) {
        return ctx.notFound('PDF not found');
      }

      // Handle PDF URL
      let pdfUrl = null;
      if (Array.isArray(article.pdf)) {
        pdfUrl = article.pdf[0]?.url || null;
      } else {
        pdfUrl = article.pdf.url || null;
      }

      if (!pdfUrl) {
        return ctx.notFound('PDF URL not found');
      }

      return ctx.redirect(pdfUrl);
    } catch (error) {
      console.error('Error downloading article:', error);
      return ctx.internalServerError('Download failed');
    }
  },


  // Get journal with PDF
  async getJournalWithPDF(ctx) {
    try {
      const user = ctx.state.user;
      const { journalId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Check access
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { user: user.id, status: 'SUCCESS' }
      });

      const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
      
      const carts = await strapi.db.query('api::cart.cart').findMany({
        where: { id: { $in: cartIds } },
        populate: ['items']
      });

      let hasAccess = false;
      for (const cart of carts) {
        if (cart.items?.some(item => parseInt(item.itemId) === parseInt(journalId))) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('You do not have access to this journal');
      }

      // Try to get as journal first, fallback to book
      let journal = null;
      try {
        journal = await strapi.entityService.findOne('api::journal.journal', parseInt(journalId), {
          populate: ['image', 'pdf', 'cover']
        });
      } catch (e) {
        journal = await strapi.entityService.findOne('api::book.book', parseInt(journalId), {
          populate: ['image', 'pdf']
        });
      }

      if (!journal) {
        return ctx.notFound('Journal not found');
      }

      // Handle image
      let coverImage = null;
      if (journal.image) {
        coverImage = Array.isArray(journal.image) ? journal.image[0]?.url : journal.image.url;
      } else if (journal.cover) {
        coverImage = Array.isArray(journal.cover) ? journal.cover[0]?.url : journal.cover.url;
      }

      // Handle PDF
      let pdfUrl = null;
      if (journal.pdf) {
        pdfUrl = Array.isArray(journal.pdf) ? journal.pdf[0]?.url : journal.pdf.url;
      }

      return ctx.body = {
        success: true,
        journal: {
          id: journal.id,
          title: journal.title,
          author: journal.author || journal.publisher,
          description: journal.description || journal.abstract,
          coverImage: coverImage,
          pdfUrl: pdfUrl
        }
      };
    } catch (error) {
      console.error('Error fetching journal:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching journal',
        error: error.message
      };
    }
  },

  // Download journal PDF
  async downloadJournal(ctx) {
    try {
      const user = ctx.state.user;
      const { journalId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Verify access
      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { user: user.id, status: 'SUCCESS' }
      });

      const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
      
      const carts = await strapi.db.query('api::cart.cart').findMany({
        where: { id: { $in: cartIds } },
        populate: ['items']
      });

      let hasAccess = false;
      for (const cart of carts) {
        if (cart.items?.some(item => parseInt(item.itemId) === parseInt(journalId))) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('Access denied');
      }

      // Get journal PDF
      let journal = null;
      try {
        journal = await strapi.entityService.findOne('api::journal.journal', parseInt(journalId), {
          populate: ['pdf']
        });
      } catch (e) {
        journal = await strapi.entityService.findOne('api::book.book', parseInt(journalId), {
          populate: ['pdf']
        });
      }

      if (!journal || !journal.pdf) {
        return ctx.notFound('PDF not found');
      }

      // Handle PDF URL
      let pdfUrl = null;
      if (Array.isArray(journal.pdf)) {
        pdfUrl = journal.pdf[0]?.url || null;
      } else {
        pdfUrl = journal.pdf.url || null;
      }

      if (!pdfUrl) {
        return ctx.notFound('PDF URL not found');
      }

      return ctx.redirect(pdfUrl);
    } catch (error) {
      console.error('Error downloading journal:', error);
      return ctx.internalServerError('Download failed');
    }
  },

  // Get user's payments (only successful ones)
  async myPayments(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      const payments = await strapi.db.query('api::payment.payment').findMany({
        where: { 
          user: user.id,
          status: 'SUCCESS'
        },
        populate: {
          user: true
        },
        orderBy: { createdAt: 'desc' }
      });

      ctx.body = {
        success: true,
        data: payments
      };
    } catch (error) {
      console.error('❌ Error fetching payments:', error);
      ctx.body = {
        success: false,
        message: 'Error fetching payments',
        error: error.message
      };
    }
  },

  // Test insert function
  async testInsert(ctx) {
    try {
      console.log('🧪 Testing payment insert...');
      
      const testData = {
        order_id: 999,
        amount: "100.00",
        description: "Test payment",
        customer_email: "test@test.com",
        transaction_id: "TEST_" + Date.now(),
        status: 'SUCCESS',
        publishedAt: new Date()
      };
      
      console.log('📝 Test data:', testData);
      
      const result = await strapi.db.query('api::payment.payment').create({
        data: testData
      });
      
      console.log('✅ Test insert successful:', result);
      
      ctx.body = {
        success: true,
        message: 'Test insert successful',
        data: result
      };
    } catch (error) {
      console.error('❌ Test insert failed:', error);
      ctx.body = {
        success: false,
        message: 'Test insert failed',
        error: error.message,
        stack: error.stack
      };
    }
  },
   // Get user's purchased books from paid carts
async myBooks(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view your books');
    }

    console.log('📚 Fetching books for user:', user.id);

    // Find all successful payments
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { 
        user: user.id,
        status: 'SUCCESS'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        books: [],
        message: 'No purchased books found'
      };
    }

    // Extract cart IDs
    const cartIds = payments
      .map(p => parseInt(p.order_id))
      .filter(id => !isNaN(id));

    if (cartIds.length === 0) {
      return ctx.body = {
        success: true,
        books: [],
        message: 'No valid orders found'
      };
    }

    // Get paid carts with items
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { 
        id: { $in: cartIds }
      },
      populate: ['items']
    });

    // Extract unique books
    const booksMap = new Map();
    
    for (const cart of paidCarts) {
      if (!cart.items || !Array.isArray(cart.items)) continue;

      for (const item of cart.items) {
        const bookId = parseInt(item.itemId);
        
        if (!bookId || isNaN(bookId)) continue;
        if (booksMap.has(bookId)) continue;

        try {
          // Fetch book details - populate 'image' instead of 'cover'
          const book = await strapi.entityService.findOne('api::book.book', bookId, {
            populate: ['image', 'pdf']  // ← Changed 'cover' to 'image'
          });

          if (book) {
            // Handle cover image URL - use 'image' field
            let coverImage = null;
            if (book.image) {
              if (Array.isArray(book.image)) {
                coverImage = book.image[0]?.url || null;
              } else {
                coverImage = book.image.url || null;
              }
            }

            // Handle PDF URL
            let pdfUrl = null;
            if (book.pdf) {
              if (Array.isArray(book.pdf)) {
                pdfUrl = book.pdf[0]?.url || null;
              } else {
                pdfUrl = book.pdf.url || null;
              }
            }

            booksMap.set(bookId, {
              id: book.id,
              title: book.title,
              author: book.author,
              description: book.description,
              price: book.price,
              coverImage: coverImage,
              pdfUrl: pdfUrl,
              purchasedAt: cart.createdAt,
              cartId: cart.id
            });
          } else {
            // Fallback to cart data if book not found
            booksMap.set(bookId, {
              id: bookId,
              title: item.title || 'Untitled',
              author: item.author || 'Unknown',
              description: '',
              price: item.price || 0,
              coverImage: item.image || null,
              pdfUrl: null,
              purchasedAt: cart.createdAt,
              cartId: cart.id
            });
          }
        } catch (err) {
          console.error(`Error fetching book ${bookId}:`, err.message);
        }
      }
    }

    const books = Array.from(booksMap.values());

    return ctx.body = {
      success: true,
      books: books,
      count: books.length,
      user_id: user.id
    };
  } catch (error) {
    console.error('Error fetching books:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching your books',
      error: error.message,
      books: []
    };
  }
},
  // Get book with PDF if user has access
  async getBookWithPDF(ctx) {
  try {
    const user = ctx.state.user;
    const { bookId } = ctx.params;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Check access
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { user: user.id, status: 'SUCCESS' }
    });

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
    
    const carts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } },
      populate: ['items']
    });

    let hasAccess = false;
    for (const cart of carts) {
      if (cart.items?.some(item => parseInt(item.itemId) === parseInt(bookId))) {
        hasAccess = true;
        break;
      }
    }

    if (!hasAccess) {
      return ctx.forbidden('You do not have access to this book');
    }

    // Get book - use 'image' instead of 'cover'
    const book = await strapi.entityService.findOne('api::book.book', parseInt(bookId), {
      populate: ['image', 'pdf']  // ← Changed 'cover' to 'image'
    });

    if (!book) {
      return ctx.notFound('Book not found');
    }

    // Handle image URL
    let coverImage = null;
    if (book.image) {
      if (Array.isArray(book.image)) {
        coverImage = book.image[0]?.url || null;
      } else {
        coverImage = book.image.url || null;
      }
    }

    // Handle PDF URL
    let pdfUrl = null;
    if (book.pdf) {
      if (Array.isArray(book.pdf)) {
        pdfUrl = book.pdf[0]?.url || null;
      } else {
        pdfUrl = book.pdf.url || null;
      }
    }

    return ctx.body = {
      success: true,
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        description: book.description,
        coverImage: coverImage,
        pdfUrl: pdfUrl
      }
    };
  } catch (error) {
    console.error('Error fetching book:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching book',
      error: error.message
    };
  }
},

  // Download book PDF
async downloadBook(ctx) {
  try {
    const user = ctx.state.user;
    const { bookId } = ctx.params;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Verify access
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { user: user.id, status: 'SUCCESS' }
    });

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(Boolean);
    
    const carts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } },
      populate: ['items']
    });

    let hasAccess = false;
    for (const cart of carts) {
      if (cart.items?.some(item => parseInt(item.itemId) === parseInt(bookId))) {
        hasAccess = true;
        break;
      }
    }

    if (!hasAccess) {
      return ctx.forbidden('Access denied');
    }

    // Get book PDF
    const book = await strapi.entityService.findOne('api::book.book', parseInt(bookId), {
      populate: ['pdf']
    });

    if (!book || !book.pdf) {
      return ctx.notFound('PDF not found');
    }

    // Handle PDF URL
    let pdfUrl = null;
    if (Array.isArray(book.pdf)) {
      pdfUrl = book.pdf[0]?.url || null;
    } else {
      pdfUrl = book.pdf.url || null;
    }

    if (!pdfUrl) {
      return ctx.notFound('PDF URL not found');
    }

    return ctx.redirect(pdfUrl);
  } catch (error) {
    console.error('Error downloading book:', error);
    return ctx.internalServerError('Download failed');
  }
},

  // Check if user has access to a specific book
 // Check if user has access to a specific book
// Check if user has access to a specific book
async checkBookAccess(ctx) {
  try {
    const user = ctx.state.user;
    const { bookId } = ctx.params; // This is correct for route param
    
    if (!user) {
      return ctx.body = {
        success: false,
        message: 'You must be logged in',
        has_access: false
      };
    }

    if (!bookId) {
      return ctx.badRequest('bookId is required');
    }

    console.log('🔍 ACCESS CHECK');
    console.log('   User:', user.id);
    console.log('   Book:', bookId);

    // Get all successful payments for this user
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { 
        user: user.id,
        status: 'SUCCESS'
      }
    });

    if (payments.length === 0) {
      console.log('   ❌ No successful payments found');
      return ctx.body = {
        success: true,
        has_access: false,
        message: 'No purchases found'
      };
    }

    // Get cart IDs from payments
    const cartIds = payments
      .map(p => parseInt(p.order_id))
      .filter(id => !isNaN(id));

    console.log(`   Found ${cartIds.length} paid carts`);

    // Check if any paid cart contains this book
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { 
        id: { $in: cartIds }
      },
      populate: ['items']
    });

    let hasAccess = false;
    let foundInCart = null;

    for (const cart of paidCarts) {
      if (cart.items && Array.isArray(cart.items)) {
        const found = cart.items.some(item => {
          const itemBookId = item.itemId || item.id;
          return itemBookId && parseInt(itemBookId) === parseInt(bookId);
        });

        if (found) {
          hasAccess = true;
          foundInCart = cart.id;
          console.log(`   ✅ Access granted via Cart #${cart.id}`);
          break;
        }
      }
    }

    if (!hasAccess) {
      console.log('   ❌ Access denied - book not in any paid cart');
    }

    return ctx.body = {
      success: true,
      has_access: hasAccess,
      cart_id: foundInCart
    };
  } catch (error) {
    console.error('❌ Error checking book access:', error);
    return ctx.body = {
      success: false,
      message: 'Error checking book access',
      error: error.message,
      has_access: false
    };
  }
},


  // Check payment status for a cart
  async createPaymentStatus(ctx) {
    try {
      const user = ctx.state.user;
      const { cartId } = ctx.query;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      if (!cartId) {
        return ctx.badRequest('cartId is required');
      }

      console.log('🔍 PAYMENT STATUS CHECK');
      console.log('   Cart ID:', cartId);
      console.log('   User ID:', user.id);

      // Get cart details
      const cart = await strapi.db.query('api::cart.cart').findOne({
        where: { 
          id: parseInt(cartId)
        },
        populate: ['users_permissions_user', 'items']
      });

      if (!cart) {
        console.log('   ❌ Cart not found');
        return ctx.body = {
          success: false,
          message: 'Cart not found',
          data: {
            cart_exists: false
          }
        };
      }

      // Check if payment exists for this cart
      const payment = await strapi.db.query('api::payment.payment').findOne({
        where: { 
          order_id: parseInt(cartId)
        }
      });

      const isPaid = cart.status === 'paid';
      const hasPayment = payment && payment.status === 'SUCCESS';

      console.log('   Cart Status:', cart.status);
      console.log('   Payment Exists:', !!payment);
      console.log('   Payment Status:', payment?.status);
      console.log('   Is Paid:', isPaid);

      ctx.body = {
        success: true,
        data: {
          cart_exists: true,
          cart_status: cart.status,
          cart_belongs_to_user: cart.users_permissions_user?.id === user.id,
          payment_exists: !!payment,
          payment_status: payment?.status || null,
          is_paid: isPaid || hasPayment,
          book_count: cart.items?.length || 0,
          book_ids: cart.items?.map(item => item.itemId).filter(Boolean) || []
        }
      };
    } catch (error) {
      console.error('❌ Error checking payment status:', error);
      ctx.body = {
        success: false,
        message: 'Error checking payment status',
        error: error.message
      };
    }
  },
 

  // Check payment status for a cart
async testMyBooks(ctx) {
  try {
    console.log('🧪 TEST MY BOOKS - No Auth Required');
    
    // Hard-code user ID for testing
    const userId = 1; // Change this to your user ID
    
    // Try without status first
    const allCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { 
        users_permissions_user: userId
      },
      populate: ['items']
    });

    console.log(`Found ${allCarts.length} total carts for user ${userId}`);
    
    // Show all carts and their data
    allCarts.forEach((cart, index) => {
      console.log(`\nCart ${index + 1}:`);
      console.log(`  ID: ${cart.id}`);
      console.log(`  User: ${cart.users_permissions_user}`);
      console.log(`  Created: ${cart.createdAt}`);
      console.log(`  Items: ${cart.items?.length || 0}`);
      console.log(`  Full data:`, JSON.stringify(cart, null, 2));
    });

    // Try to find paid carts by looking at payments
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { 
        user: userId
      }
    });

    console.log(`\nFound ${payments.length} payments for user ${userId}`);
    payments.forEach(payment => {
      console.log(`  Payment: ${payment.order_id} - ${payment.status}`);
    });

    ctx.body = {
      success: true,
      total_carts: allCarts.length,
      carts: allCarts.map(cart => ({
        id: cart.id,
        user: cart.users_permissions_user,
        items: cart.items?.map(item => ({
          itemId: item.itemId,
          title: item.title
        })),
        createdAt: cart.createdAt
      })),
      payments: payments
    };
  } catch (error) {
    console.error('Test error:', error);
    ctx.body = {
      success: false,
      error: error.message
    };
  }
}
 

}));