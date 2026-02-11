'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const axios = require('axios');

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

      // console.log('📥 HesabPay Response:', response.data);

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
          customer_email: cart.users_permissions_user?.email || '',
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

       
          console.log('💾 Full payment record:', JSON.stringify(savedPayment, null, 2));
        } catch (dbError) {
      
          throw dbError;
        }
      }

      // Update cart status
      await strapi.db.query('api::cart.cart').update({
        where: { id: parseInt(cartId) },
        data: { 
          status: 'paid',
          updatedAt: new Date()
        }
      });
  
      // Redirect to frontend
      const frontendUrl = process.env.HESABPAY_REDIRECT_SUCCESS || 'http://localhost:3001';
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
  async getAvailableContentTypes(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    console.log('🔍 Checking available content types for user:', user.id);

    const userIsAdmin = await isAdmin(user);

    const paymentQuery = {
      status: 'SUCCESS',
      orderBy: { createdAt: 'desc' }
    };

    if (!userIsAdmin) {
      paymentQuery.where = { user: user.id };
    }

    const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        available_types: [],
        counts: {},
        message: 'No purchases found'
      };
    }

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));

    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } },
      populate: ['items']
    });

    // Count each content type
    const typeCounts = {
      book: 0,
      article: 0,
      journal: 0,
      magazine: 0
    };

    const uniqueItems = new Set();

    for (const cart of paidCarts) {
      if (!cart.items || !Array.isArray(cart.items)) continue;

      for (const item of cart.items) {
        const itemId = parseInt(item.itemId);
        const itemType = (item.itemType || 'book').toLowerCase();
        
        const uniqueKey = `${itemType}-${itemId}`;
        if (uniqueItems.has(uniqueKey)) continue;
        uniqueItems.add(uniqueKey);

        if (typeCounts.hasOwnProperty(itemType)) {
          typeCounts[itemType]++;
        }
      }
    }

    // Get available types (types with count > 0)
    const availableTypes = Object.keys(typeCounts).filter(type => typeCounts[type] > 0);

    console.log('📊 Content type counts:', typeCounts);
    console.log('✅ Available types:', availableTypes);

    return ctx.body = {
      success: true,
      available_types: availableTypes,
      counts: typeCounts,
      has_books: typeCounts.book > 0,
      has_articles: typeCounts.article > 0,
      has_journals: typeCounts.journal > 0,
      has_magazines: typeCounts.magazine > 0,
      total_items: uniqueItems.size,
      user_id: user.id,
      is_admin: userIsAdmin
    };
  } catch (error) {
    console.error('Error checking available content types:', error);
    return ctx.body = {
      success: false,
      message: 'Error checking content types',
      error: error.message,
      available_types: []
    };
  }
},


  // ========== BOOKS ENDPOINT (WORKING) ==========
// ========== UPDATED MY BOOKS - Only returns if user has books ==========
async myBooks(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view books');
    }

    console.log('📚 Fetching books for user:', user.id);

    const userIsAdmin = await isAdmin(user);

    const paymentQuery = {
      status: 'SUCCESS',
      orderBy: { createdAt: 'desc' }
    };

    if (!userIsAdmin) {
      paymentQuery.where = { user: user.id };
    }

    const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        books: [],
        count: 0,
        has_content: false,
        message: 'No purchases found'
      };
    }

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));

    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } },
      populate: ['items']
    });

    const booksMap = new Map();
    
    for (const cart of paidCarts) {
      if (!cart.items || !Array.isArray(cart.items)) continue;

      for (const item of cart.items) {
        const itemId = parseInt(item.itemId);
        const itemType = (item.itemType || 'book').toLowerCase();
        
        console.log(`   Item ${itemId}: type = "${itemType}"`);
        
        // ✅ STRICT: Only process if itemType === 'book'
        if (itemType !== 'book') {
          console.log(`   ⏭️ Skipping ${itemType} item`);
          continue;
        }
        
        if (!itemId || isNaN(itemId)) continue;
        if (booksMap.has(itemId)) continue;

        try {
          const book = await strapi.entityService.findOne('api::book.book', itemId, {
            populate: ['image', 'pdf']
          });

          if (book) {
            console.log(`   ✅ Found book: ${book.title}`);
            
            let coverImage = null;
            if (book.image) {
              coverImage = Array.isArray(book.image) ? book.image[0]?.url : book.image.url;
            }

            let pdfUrl = null;
            if (book.pdf) {
              pdfUrl = Array.isArray(book.pdf) ? book.pdf[0]?.url : book.pdf.url;
            }

            booksMap.set(itemId, {
              id: book.id,
              title: book.title,
              author: book.author,
              description: book.description,
              price: book.price,
              coverImage: coverImage,
              pdfUrl: pdfUrl,
              isbn: book.isbn,
              publisher: book.publisher,
              itemType: 'book',
              purchasedAt: cart.createdAt,
              cartId: cart.id
            });
          }
        } catch (err) {
          console.error(`   ❌ Error fetching book ${itemId}:`, err.message);
        }
      }
    }

    const books = Array.from(booksMap.values());

    console.log(`📊 Total books found: ${books.length}`);

    return ctx.body = {
      success: true,
      books: books,
      count: books.length,
      has_content: books.length > 0,
      user_id: user.id,
      is_admin: userIsAdmin
    };
  } catch (error) {
    console.error('Error fetching books:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching books',
      error: error.message,
      books: [],
      has_content: false
    };
  }
},

// ========== UPDATED MY ARTICLES - Only returns if user has articles ==========
async myArticles(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view articles');
    }

    console.log('📰 FETCHING ARTICLES - User:', user.id);

    const userIsAdmin = await isAdmin(user);

    const paymentQuery = {
      status: 'SUCCESS',
      orderBy: { createdAt: 'desc' }
    };

    if (!userIsAdmin) {
      paymentQuery.where = { user: user.id };
    }

    const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        articles: [],
        count: 0,
        has_content: false,
        message: 'No purchases found'
      };
    }

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));
    console.log('🛒 Paid Cart IDs:', cartIds);

    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } }
    });

    // Get ALL articles from database for matching
    const allArticles = await strapi.db.query('api::article.article').findMany({
      populate: ['image', 'pdf', 'cover']
    });
    
    console.log(`📚 Found ${allArticles.length} articles in database`);

    const articlesMap = new Map();
    
    for (const cart of paidCarts) {
      console.log(`\n📦 Processing Cart #${cart.id}, Total: $${cart.total}`);
      
      // Parse cart items
      let items = [];
      
      if (cart.items) {
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            console.error('Failed to parse JSON:', e.message);
          }
        }
      }
      
      if (items.length === 0) {
        console.log('No items in cart');
        continue;
      }
      
      console.log(`Found ${items.length} items`);
      
      // Process each cart item
      for (const cartItem of items) {
        console.log('\n  Cart Item:', JSON.stringify(cartItem, null, 2));
        
        // Check if this is an article
        if (!cartItem.itemType || cartItem.itemType.toLowerCase() !== 'article') {
          console.log(`  Skipping ${cartItem.itemType || 'unknown'} item`);
          continue;
        }
        
        console.log(`  Looking for article with price $${cartItem.price}`);
        
        // Try to find matching article by PRICE (since no ID)
        const matchingArticles = allArticles.filter(article => {
          // Match by price (exact or close match)
          const articlePrice = parseFloat(article.price) || 0;
          const cartPrice = parseFloat(cartItem.price) || 0;
          
          return articlePrice === cartPrice;
        });
        
        console.log(`  Found ${matchingArticles.length} matching articles by price`);
        
        // If multiple matches, try to match by image too
        let matchedArticle = null;
        if (matchingArticles.length === 1) {
          matchedArticle = matchingArticles[0];
        } else if (matchingArticles.length > 1 && cartItem.image) {
          // Try to match by image
          for (const article of matchingArticles) {
            let articleImage = null;
            if (article.image) {
              articleImage = Array.isArray(article.image) ? article.image[0]?.url : article.image.url;
            } else if (article.cover) {
              articleImage = Array.isArray(article.cover) ? article.cover[0]?.url : article.cover.url;
            }
            
            if (articleImage && articleImage.includes(cartItem.image)) {
              matchedArticle = article;
              console.log(`  Matched by image: ${cartItem.image}`);
              break;
            }
          }
        }
        
        if (matchedArticle) {
          console.log(`  ✅ Matched: ${matchedArticle.label} (ID: ${matchedArticle.id})`);
          
          if (articlesMap.has(matchedArticle.id)) {
            console.log(`  Already have this article`);
            continue;
          }
          
          // Get cover image
          let coverImage = null;
          if (matchedArticle.image) {
            coverImage = Array.isArray(matchedArticle.image) ? matchedArticle.image[0]?.url : matchedArticle.image.url;
          } else if (matchedArticle.cover) {
            coverImage = Array.isArray(matchedArticle.cover) ? matchedArticle.cover[0]?.url : matchedArticle.cover.url;
          }
          
          // Get PDF
          let pdfUrl = null;
          if (matchedArticle.pdf) {
            pdfUrl = Array.isArray(matchedArticle.pdf) ? matchedArticle.pdf[0]?.url : matchedArticle.pdf.url;
          }
          
          articlesMap.set(matchedArticle.id, {
            id: matchedArticle.id,
            title: matchedArticle.label || 'Untitled Article',
            author: matchedArticle.author || 'Unknown Author',
            description: matchedArticle.description || '',
            price: matchedArticle.price,
            coverImage: coverImage || cartItem.image,
            pdfUrl: pdfUrl,
            doi: matchedArticle.doi,
            publishedDate: matchedArticle.publishDate || matchedArticle.publishedAt,
            journal: matchedArticle.journal,
            volume: matchedArticle.volume,
            issue: matchedArticle.issue,
            pages: matchedArticle.pages,
            itemType: 'article',
            purchasedAt: cart.createdAt,
            cartId: cart.id,
            matchMethod: 'price_match'
          });
        } else {
          console.log(`  ❌ No matching article found for price $${cartItem.price}`);
          
          // Create placeholder
          const placeholderId = `cart-${cart.id}-price-${cartItem.price}`;
          if (!articlesMap.has(placeholderId)) {
            articlesMap.set(placeholderId, {
              id: placeholderId,
              title: `Article ($${cartItem.price})`,
              author: 'Unknown',
              description: 'Purchased article - original ID not stored',
              price: cartItem.price,
              coverImage: cartItem.image,
              pdfUrl: null,
              itemType: 'article',
              purchasedAt: cart.createdAt,
              cartId: cart.id,
              matchMethod: 'placeholder',
              note: 'Item ID was not stored in cart'
            });
          }
        }
      }
    }

    const articles = Array.from(articlesMap.values());

    console.log(`\n📊 FINAL: Found ${articles.length} articles`);

    return ctx.body = {
      success: true,
      articles: articles,
      count: articles.length,
      has_content: articles.length > 0,
      user_id: user.id,
      is_admin: userIsAdmin,
      debug: {
        total_payments: payments.length,
        paid_carts: paidCarts.length,
        note: articles.some(a => a.matchMethod === 'placeholder') 
          ? 'Some articles are placeholders because item IDs were not stored'
          : 'All articles matched successfully'
      }
    };
  } catch (error) {
    console.error('❌ Error fetching articles:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching articles',
      error: error.message,
      articles: [],
      has_content: false
    };
  }
},
async deepDebugCart(ctx) {
  try {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    
    console.log('🔍 DEEP DEBUG - User:', user.id, user.email);
    
    // Get ALL payments first
    const payments = await strapi.db.query('api::payment.payment').findMany({
      where: { user: user.id }
    });
    
    console.log('📊 All payments:', payments.map(p => ({
      id: p.id,
      order_id: p.order_id,
      status: p.status,
      amount: p.amount
    })));
    
    // Get successful payments only
    const successfulPayments = payments.filter(p => p.status === 'SUCCESS');
    console.log('✅ Successful payments:', successfulPayments.length);
    
    // Get cart IDs from successful payments
    const cartIds = successfulPayments
      .map(p => parseInt(p.order_id))
      .filter(id => !isNaN(id));
    
    console.log('🛒 Cart IDs from payments:', cartIds);
    
    // Get the actual carts
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } }
      // Don't populate, we want to see raw structure
    });
    
    console.log('📦 Found carts:', paidCarts.map(c => ({
      id: c.id,
      status: c.status,
      total: c.total,
      hasItems: !!c.items,
      itemsType: typeof c.items
    })));
    
    // Now let's manually inspect each cart's items
    const cartDetails = [];
    
    for (const cart of paidCarts) {
      console.log(`\n=== CART ${cart.id} DETAILS ===`);
      console.log('Cart object keys:', Object.keys(cart));
      console.log('Items value:', cart.items);
      console.log('Items type:', typeof cart.items);
      
      let itemsArray = [];
      
      if (cart.items) {
        // Try to parse it
        if (typeof cart.items === 'string') {
          try {
            itemsArray = JSON.parse(cart.items);
            console.log('✅ Parsed as JSON string');
          } catch (e) {
            console.log('❌ Failed to parse JSON:', e.message);
          }
        } else if (Array.isArray(cart.items)) {
          itemsArray = cart.items;
          console.log('✅ Items is already an array');
        } else if (typeof cart.items === 'object') {
          // Check if it's a Strapi response object
          if (cart.items.data && Array.isArray(cart.items.data)) {
            itemsArray = cart.items.data;
            console.log('✅ Items is Strapi response object with data array');
          } else {
            // Try to convert object to array
            itemsArray = Object.values(cart.items);
            console.log('⚠️ Converted object to array');
          }
        }
      }
      
      console.log(`Items array length: ${itemsArray.length}`);
      
      // Show each item's structure
      for (let i = 0; i < Math.min(itemsArray.length, 5); i++) {
        const item = itemsArray[i];
        console.log(`\nItem ${i + 1}:`);
        console.log('  Type:', typeof item);
        if (item && typeof item === 'object') {
          console.log('  Keys:', Object.keys(item));
          console.log('  Full object:', JSON.stringify(item, null, 2));
          
          // Check for article IDs
          const possibleIdFields = ['id', 'itemId', 'articleId', 'productId'];
          for (const field of possibleIdFields) {
            if (item[field] !== undefined) {
              console.log(`  Found ${field}:`, item[field]);
            }
          }
          
          const possibleTypeFields = ['itemType', 'type', 'contentType'];
          for (const field of possibleTypeFields) {
            if (item[field] !== undefined) {
              console.log(`  Found ${field}:`, item[field]);
            }
          }
        }
      }
      
      cartDetails.push({
        cartId: cart.id,
        status: cart.status,
        total: cart.total,
        itemsCount: itemsArray.length,
        items: itemsArray,
        itemsSample: itemsArray.length > 0 ? itemsArray[0] : null
      });
    }
    
    // Check what articles exist in the database WITHOUT specifying fields
    console.log('\n=== CHECKING ARTICLE DATABASE ===');
    try {
      const allArticles = await strapi.db.query('api::article.article').findMany({
        limit: 5
        // Don't specify fields, let Strapi handle it
      });
      
      console.log('First 5 articles in database:', JSON.stringify(allArticles, null, 2));
      
      // Check the structure of the first article
      if (allArticles.length > 0) {
        console.log('\nArticle structure example:');
        const sampleArticle = allArticles[0];
        console.log('Keys:', Object.keys(sampleArticle));
        console.log('Full structure:', JSON.stringify(sampleArticle, null, 2));
      }
      
      return ctx.body = {
        success: true,
        user: {
          id: user.id,
          email: user.email
        },
        payment_summary: {
          total: payments.length,
          successful: successfulPayments.length,
          cart_ids: cartIds
        },
        carts: cartDetails,
        articles_in_db: allArticles,
        message: 'Check server console for detailed logs'
      };
      
    } catch (dbError) {
      console.error('Database query error:', dbError.message);
      
      // Try to get article table structure
      console.log('\n=== CHECKING ARTICLE TABLE STRUCTURE ===');
      try {
        const tableInfo = await strapi.db.connection.raw(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'articles'
          ORDER BY ordinal_position
        `);
        
        console.log('Article table columns:', tableInfo.rows);
        
        return ctx.body = {
          success: true,
          user: {
            id: user.id,
            email: user.email
          },
          payment_summary: {
            total: payments.length,
            successful: successfulPayments.length,
            cart_ids: cartIds
          },
          carts: cartDetails,
          article_table_structure: tableInfo.rows,
          error: 'Article query failed, but got table structure',
          original_error: dbError.message
        };
        
      } catch (tableError) {
        console.error('Table structure error:', tableError);
        
        return ctx.body = {
          success: true,
          user: {
            id: user.id,
            email: user.email
          },
          payment_summary: {
            total: payments.length,
            successful: successfulPayments.length,
            cart_ids: cartIds
          },
          carts: cartDetails,
          error: 'Multiple errors occurred',
          errors: {
            article_query: dbError.message,
            table_structure: tableError.message
          }
        };
      }
    }
    
  } catch (error) {
    console.error('Deep debug error:', error);
    return ctx.body = { 
      success: false, 
      error: error.message,
      stack: error.stack 
    };
  }
},
  // ========== JOURNALS ENDPOINT (FIXED - MATCHES BOOKS STRUCTURE) ==========
async myJournals(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view journals');
    }

    console.log('📖 Fetching purchased journals for user:', user.id);

    const userIsAdmin = await isAdmin(user);

    const paymentQuery = {
      status: 'SUCCESS',
      orderBy: { createdAt: 'desc' }
    };

    if (!userIsAdmin) {
      paymentQuery.where = { user: user.id };
    }

    const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        journals: [],
        count: 0,
        has_content: false,
        message: 'No purchases found'
      };
    }

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));
    console.log('🛒 Paid Cart IDs:', cartIds);

    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } }
    });

    // Get ALL journals from database for matching
    const allJournals = await strapi.db.query('api::journal.journal').findMany({
      populate: ['image', 'pdf', 'cover']
    });
    
    console.log(`📚 Found ${allJournals.length} journals in database`);

    const journalsMap = new Map();
    
    for (const cart of paidCarts) {
      console.log(`\n📦 Processing Cart #${cart.id}, Total: $${cart.total}`);
      
      // Parse cart items
      let items = [];
      
      if (cart.items) {
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            console.error('Failed to parse JSON:', e.message);
          }
        }
      }
      
      if (items.length === 0) {
        console.log('No items in cart');
        continue;
      }
      
      console.log(`Found ${items.length} items`);
      
      // Process each cart item
      for (const cartItem of items) {
        console.log('\n  Cart Item:', JSON.stringify(cartItem, null, 2));
        
        // Check if this is a journal
        const itemType = cartItem.itemType ? cartItem.itemType.toLowerCase() : '';
        
        // Try to detect journal by type or by trying to match
        if (itemType !== 'journal') {
          console.log(`  Skipping ${itemType || 'unknown'} item`);
          continue;
        }
        
        console.log(`  Looking for journal with price $${cartItem.price}`);
        
        // Try to find matching journal by PRICE (since no ID)
        const matchingJournals = allJournals.filter(journal => {
          // Match by price (exact or close match)
          const journalPrice = parseFloat(journal.price) || 0;
          const cartPrice = parseFloat(cartItem.price) || 0;
          
          return journalPrice === cartPrice;
        });
        
        console.log(`  Found ${matchingJournals.length} matching journals by price`);
        
        // If multiple matches, try to match by image too
        let matchedJournal = null;
        if (matchingJournals.length === 1) {
          matchedJournal = matchingJournals[0];
        } else if (matchingJournals.length > 1 && cartItem.image) {
          // Try to match by image
          for (const journal of matchingJournals) {
            let journalImage = null;
            if (journal.image) {
              journalImage = Array.isArray(journal.image) ? journal.image[0]?.url : journal.image.url;
            } else if (journal.cover) {
              journalImage = Array.isArray(journal.cover) ? journal.cover[0]?.url : journal.cover.url;
            }
            
            if (journalImage && journalImage.includes(cartItem.image)) {
              matchedJournal = journal;
              console.log(`  Matched by image: ${cartItem.image}`);
              break;
            }
          }
        }
        
        if (matchedJournal) {
          console.log(`  ✅ Matched: ${matchedJournal.title} (ID: ${matchedJournal.id})`);
          
          if (journalsMap.has(matchedJournal.id)) {
            console.log(`  Already have this journal`);
            continue;
          }
          
          // Get cover image
          let coverImage = null;
          if (matchedJournal.image) {
            coverImage = Array.isArray(matchedJournal.image) ? matchedJournal.image[0]?.url : matchedJournal.image.url;
          } else if (matchedJournal.cover) {
            coverImage = Array.isArray(matchedJournal.cover) ? matchedJournal.cover[0]?.url : matchedJournal.cover.url;
          }
          
          // Get PDF
          let pdfUrl = null;
          if (matchedJournal.pdf) {
            pdfUrl = Array.isArray(matchedJournal.pdf) ? matchedJournal.pdf[0]?.url : matchedJournal.pdf.url;
          }
          
          journalsMap.set(matchedJournal.id, {
            id: matchedJournal.id,
            title: matchedJournal.title || matchedJournal.label || 'Untitled Journal',
            author: matchedJournal.author || matchedJournal.publisher || 'Unknown',
            description: matchedJournal.description || matchedJournal.abstract || '',
            price: matchedJournal.price,
            coverImage: coverImage || cartItem.image,
            pdfUrl: pdfUrl,
            issn: matchedJournal.issn,
            publication_date: matchedJournal.publication_date || matchedJournal.publishedAt,
            volume: matchedJournal.volume,
            issue: matchedJournal.issue,
            // type: 'journal',
            purchasedAt: cart.createdAt,
            cartId: cart.id,
            matchMethod: 'price_match'
          });
        } else {
          console.log(`  ❌ No matching journal found for price $${cartItem.price}`);
          
          // Create placeholder
          const placeholderId = `cart-${cart.id}-price-${cartItem.price}`;
          if (!journalsMap.has(placeholderId)) {
            journalsMap.set(placeholderId, {
              id: placeholderId,
              title: `Journal ($${cartItem.price})`,
              author: 'Unknown',
              description: 'Purchased journal - original ID not stored',
              price: cartItem.price,
              coverImage: cartItem.image,
              pdfUrl: null,
              // type: 'journal',
              purchasedAt: cart.createdAt,
              cartId: cart.id,
              matchMethod: 'placeholder',
              note: 'Item ID was not stored in cart'
            });
          }
        }
      }
    }

    const journals = Array.from(journalsMap.values());

    console.log(`\n📊 FINAL: Found ${journals.length} journals`);

    return ctx.body = {
      success: true,
      journals: journals,
      count: journals.length,
      has_content: journals.length > 0,
      user_id: user.id,
      is_admin: userIsAdmin,
      debug: {
        total_payments: payments.length,
        paid_carts: paidCarts.length,
        note: journals.some(j => j.matchMethod === 'placeholder') 
          ? 'Some journals are placeholders because item IDs were not stored'
          : 'All journals matched successfully'
      }
    };
  } catch (error) {
    console.error('❌ Error fetching journals:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching journals',
      error: error.message,
      journals: [],
      has_content: false
    };
  }
},

  // ========== MAGAZINES ENDPOINT (FIXED - MATCHES BOOKS STRUCTURE) ==========
 async myMagazines(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in to view magazines');
    }

    console.log('📖 Fetching purchased magazines for user:', user.id);

    const userIsAdmin = await isAdmin(user);

    const paymentQuery = {
      status: 'SUCCESS',
      orderBy: { createdAt: 'desc' }
    };

    if (!userIsAdmin) {
      paymentQuery.where = { user: user.id };
    }

    const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

    if (payments.length === 0) {
      return ctx.body = {
        success: true,
        magazines: [],
        message: 'No purchases found'
      };
    }

    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));

    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } }
    });

    // Get ALL magazines from database
    const allMagazines = await strapi.db.query('api::magazine.magazine').findMany({
      populate: ['image', 'pdf', 'cover']
    });
    
    console.log(`📚 Found ${allMagazines.length} magazines in database`);

    const magazinesMap = new Map();
    
    for (const cart of paidCarts) {
      console.log(`\n📦 Processing Cart #${cart.id}`);
      
      let items = [];
      
      if (cart.items) {
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            console.error('Failed to parse JSON:', e.message);
          }
        }
      }
      
      if (items.length === 0) continue;
      
      for (const cartItem of items) {
        // Check if this is a magazine
        if (!cartItem.itemType || cartItem.itemType.toLowerCase() !== 'magazine') {
          continue;
        }
        
        // Match by price
        const matchingMagazines = allMagazines.filter(magazine => {
          const magazinePrice = parseFloat(magazine.price) || 0;
          const cartPrice = parseFloat(cartItem.price) || 0;
          return magazinePrice === cartPrice;
        });
        
        if (matchingMagazines.length > 0) {
          const magazine = matchingMagazines[0];
          
          if (magazinesMap.has(magazine.id)) continue;
          
          // Get cover image
          let coverImage = null;
          if (magazine.image) {
            coverImage = Array.isArray(magazine.image) ? magazine.image[0]?.url : magazine.image.url;
          } else if (magazine.cover) {
            coverImage = Array.isArray(magazine.cover) ? magazine.cover[0]?.url : magazine.cover.url;
          }
          
          // Get PDF
          let pdfUrl = null;
          if (magazine.pdf) {
            pdfUrl = Array.isArray(magazine.pdf) ? magazine.pdf[0]?.url : magazine.pdf.url;
          }
          
          magazinesMap.set(magazine.id, {
            id: magazine.id,
            title: magazine.title || magazine.label || 'Untitled Magazine',
            publisher: magazine.publisher,
            description: magazine.description || magazine.summary,
            price: magazine.price,
            coverImage: coverImage,
            pdfUrl: pdfUrl,
            issue: magazine.issue,
            volume: magazine.volume,
            publication_date: magazine.publication_date,
            issn: magazine.issn,
            type: 'magazine',
            purchasedAt: cart.createdAt,
            cartId: cart.id
          });
        }
      }
    }

    const magazines = Array.from(magazinesMap.values());

    console.log(`📊 Found ${magazines.length} magazines`);

    return ctx.body = {
      success: true,
      magazines: magazines,
      count: magazines.length,
      user_id: user.id,
      is_admin: userIsAdmin
    };
  } catch (error) {
    console.error('Error fetching magazines:', error);
    return ctx.body = {
      success: false,
      message: 'Error fetching magazines',
      error: error.message,
      magazines: []
    };
  }
},

  // ========== ACCESS CHECK FUNCTIONS ==========
  async checkBookAccess(ctx) {
    try {
      const user = ctx.state.user;
      const { bookId } = ctx.params;
      
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

      console.log('🔍 BOOK ACCESS CHECK');
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

      const cartIds = payments
        .map(p => parseInt(p.order_id))
        .filter(id => !isNaN(id));

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
            const itemId = item.itemId || item.id;
            return itemId && parseInt(itemId) === parseInt(bookId);
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

      const userIsAdmin = await isAdmin(user);
      if (userIsAdmin) {
        console.log('   ✅ Admin access granted');
        return ctx.body = {
          success: true,
          has_access: true,
          is_admin: true,
          message: 'Admin access granted'
        };
      }

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
        cart_id: foundInCart,
        is_admin: false
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

  async checkMagazineAccess(ctx) {
    try {
      const user = ctx.state.user;
      const { magazineId } = ctx.params;
      
      if (!user) {
        return ctx.body = {
          success: false,
          message: 'You must be logged in',
          has_access: false
        };
      }

      if (!magazineId) {
        return ctx.badRequest('magazineId is required');
      }

      console.log('🔍 MAGAZINE ACCESS CHECK');
      console.log('   User:', user.id);
      console.log('   Magazine:', magazineId);

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

      // Check if any paid cart contains this magazine
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
            const itemType = (item.itemType || '').toLowerCase();
            return itemId && 
                   parseInt(itemId) === parseInt(magazineId) && 
                   itemType === 'magazine';
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
        console.log('   ❌ Access denied - magazine not in any paid cart');
      }

      return ctx.body = {
        success: true,
        has_access: hasAccess,
        cart_id: foundInCart
      };
    } catch (error) {
      console.error('❌ Error checking magazine access:', error);
      return ctx.body = {
        success: false,
        message: 'Error checking magazine access',
        error: error.message,
        has_access: false
      };
    }
  },

  // ========== GET WITH PDF FUNCTIONS ==========
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

      // Get book
      const book = await strapi.entityService.findOne('api::book.book', parseInt(bookId), {
        populate: ['image', 'pdf']
      });

      if (!book) {
        return ctx.notFound('Book not found');
      }

      let coverImage = null;
      if (book.image) {
        coverImage = Array.isArray(book.image) ? book.image[0]?.url : book.image.url;
      }

      let pdfUrl = null;
      if (book.pdf) {
        pdfUrl = Array.isArray(book.pdf) ? book.pdf[0]?.url : book.pdf.url;
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

  async getArticleWithPDF(ctx) {
    try {
      const user = ctx.state.user;
      const { articleId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      const userIsAdmin = await isAdmin(user);
      
      if (!userIsAdmin) {
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
      }

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

      let coverImage = null;
      if (article.image) {
        coverImage = Array.isArray(article.image) ? article.image[0]?.url : article.image.url;
      } else if (article.cover) {
        coverImage = Array.isArray(article.cover) ? article.cover[0]?.url : article.cover.url;
      }

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
        },
        is_admin: userIsAdmin
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

  async getMagazineWithPDF(ctx) {
    try {
      const user = ctx.state.user;
      const { magazineId } = ctx.params;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      // Check access first
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
        if (cart.items?.some(item => {
          const itemId = parseInt(item.itemId);
          const itemType = (item.itemType || '').toLowerCase();
          return itemId === parseInt(magazineId) && itemType === 'magazine';
        })) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('You do not have access to this magazine');
      }

      // Get magazine
      const magazine = await strapi.entityService.findOne('api::magazine.magazine', parseInt(magazineId), {
        populate: ['image', 'pdf', 'cover']
      });

      if (!magazine) {
        return ctx.notFound('Magazine not found');
      }

      // Handle image
      let coverImage = null;
      if (magazine.image) {
        coverImage = Array.isArray(magazine.image) 
          ? magazine.image[0]?.url 
          : magazine.image.url;
      } else if (magazine.cover) {
        coverImage = Array.isArray(magazine.cover) 
          ? magazine.cover[0]?.url 
          : magazine.cover.url;
      }

      // Handle PDF
      let pdfUrl = null;
      if (magazine.pdf) {
        pdfUrl = Array.isArray(magazine.pdf) 
          ? magazine.pdf[0]?.url 
          : magazine.pdf.url;
      }

      return ctx.body = {
        success: true,
        magazine: {
          id: magazine.id,
          title: magazine.title,
          publisher: magazine.publisher,
          description: magazine.description,
          coverImage: coverImage,
          pdfUrl: pdfUrl,
          issue: magazine.issue,
          volume: magazine.volume,
          publication_date: magazine.publication_date
        }
      };
    } catch (error) {
      console.error('Error fetching magazine:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching magazine',
        error: error.message
      };
    }
  },

  // ========== DOWNLOAD PDF FUNCTIONS ==========
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

  async downloadMagazine(ctx) {
    try {
      const user = ctx.state.user;
      const { magazineId } = ctx.params;
      
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
        if (cart.items?.some(item => {
          const itemId = parseInt(item.itemId);
          const itemType = (item.itemType || '').toLowerCase();
          return itemId === parseInt(magazineId) && itemType === 'magazine';
        })) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return ctx.forbidden('Access denied');
      }

      // Get magazine PDF
      const magazine = await strapi.entityService.findOne('api::magazine.magazine', parseInt(magazineId), {
        populate: ['pdf']
      });

      if (!magazine || !magazine.pdf) {
        return ctx.notFound('PDF not found');
      }

      // Handle PDF URL
      let pdfUrl = null;
      if (Array.isArray(magazine.pdf)) {
        pdfUrl = magazine.pdf[0]?.url || null;
      } else {
        pdfUrl = magazine.pdf.url || null;
      }

      if (!pdfUrl) {
        return ctx.notFound('PDF URL not found');
      }

      return ctx.redirect(pdfUrl);
    } catch (error) {
      console.error('Error downloading magazine:', error);
      return ctx.internalServerError('Download failed');
    }
  },

  // ========== OTHER UTILITY FUNCTIONS ==========
  async myPayments(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      console.log('💳 Fetching payments for user:', user.id);

      // Check if user is admin
      const userIsAdmin = await isAdmin(user);
      console.log('👤 Is Admin:', userIsAdmin);

      // Build query based on role
      const paymentQuery = {
        populate: ['user'],
        orderBy: { createdAt: 'desc' }
      };

      // If NOT admin, filter by user
      if (!userIsAdmin) {
        paymentQuery.where = { 
          user: user.id,
          status: 'SUCCESS'
        };
      }
      // If admin, no where clause = get all payments (all statuses)

      const payments = await strapi.db.query('api::payment.payment').findMany(paymentQuery);

      // Get cart details for each payment to show items
      const paymentsWithDetails = await Promise.all(
        payments.map(async (payment) => {
          let cartDetails = null;
          
          try {
            const cart = await strapi.db.query('api::cart.cart').findOne({
              where: { id: parseInt(payment.order_id) },
              populate: ['items', 'users_permissions_user']
            });

            if (cart) {
              cartDetails = {
                cart_id: cart.id,
                status: cart.status,
                total: cart.total,
                item_count: cart.items?.length || 0,
                items: cart.items?.map(item => ({
                  id: item.itemId,
                  title: item.title,
                  type: item.itemType || 'book',
                  price: item.price,
                  quantity: item.quantity || 1
                })) || [],
                customer_email: cart.users_permissions_user?.email || payment.customer_email
              };
            }
          } catch (err) {
            console.error('Error fetching cart details:', err);
          }

          return {
            id: payment.id,
            transaction_id: payment.transaction_id,
            order_id: payment.order_id,
            amount: payment.amount,
            status: payment.status,
            customer_email: payment.customer_email,
            description: payment.description,
            created_at: payment.createdAt,
            updated_at: payment.updatedAt,
            // Cart details
            cart: cartDetails,
            // Show customer details only if admin
            customer: userIsAdmin ? {
              id: payment.user?.id,
              email: payment.user?.email,
              username: payment.user?.username,
              blocked: payment.user?.blocked,
              confirmed: payment.user?.confirmed
            } : null,
            // Admin-only metadata
            metadata: userIsAdmin ? {
              user_id: payment.user?.id,
              is_success: payment.status?.toUpperCase() === 'SUCCESS',
              has_cart: !!cartDetails,
              payment_method: payment.payment_method || 'HesabPay'
            } : null
          };
        })
      );

      // Calculate statistics for admin
      let statistics = null;
      if (userIsAdmin) {
        const successPayments = paymentsWithDetails.filter(p => p.status?.toUpperCase() === 'SUCCESS');
        const failedPayments = paymentsWithDetails.filter(p => p.status?.toUpperCase() === 'FAILED' || p.status?.toLowerCase().includes('fail'));
        const pendingPayments = paymentsWithDetails.filter(p => !['SUCCESS', 'FAILED'].includes(p.status?.toUpperCase()));
        
        statistics = {
          total_payments: paymentsWithDetails.length,
          successful: successPayments.length,
          failed: failedPayments.length,
          pending: pendingPayments.length,
          total_revenue: successPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0).toFixed(2),
          average_transaction: successPayments.length > 0 
            ? (successPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) / successPayments.length).toFixed(2)
            : '0.00',
          unique_customers: new Set(paymentsWithDetails.map(p => p.customer_email).filter(Boolean)).size,
          currency: 'EUR'
        };
      }

      return ctx.body = {
        success: true,
        data: paymentsWithDetails,
        count: paymentsWithDetails.length,
        statistics: statistics,
        user_id: user.id,
        is_admin: userIsAdmin,
        viewing_all: userIsAdmin,
        filters_applied: !userIsAdmin ? ['user_id', 'status:SUCCESS'] : []
      };
    } catch (error) {
      console.error('❌ Error fetching payments:', error);
      return ctx.body = {
        success: false,
        message: 'Error fetching payments',
        error: error.message,
        data: []
      };
    }
  },

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
  },
  // ========== ADMIN REPORTS ==========
 async adminReports(ctx) {
  try {
    const user = ctx.state.user;
    
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user);
    if (!userIsAdmin) {
      return ctx.forbidden('Admin access required');
    }

    console.log('📊 ADMIN REPORTS - User:', user.id);

    const { 
      startDate, 
      endDate, 
      groupBy = 'day', // day, week, month, year
      limit = 100,
      page = 1,
      // New filters
      search = '',
      customerEmail = '',
      minAmount = '',
      maxAmount = '',
      itemType = '',
      sortBy = 'date', // date, amount, customer
      sortOrder = 'desc', // asc, desc
      export_format = '' // csv, json
    } = ctx.query;

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.$lte = new Date(endDate);
    }

    // Build payment filter with amount range
    const paymentFilter = { 
      status: 'SUCCESS',
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    };

    // Add amount filters
    if (minAmount) {
      paymentFilter.amount = { ...paymentFilter.amount, $gte: parseFloat(minAmount) };
    }
    if (maxAmount) {
      paymentFilter.amount = { ...paymentFilter.amount, $lte: parseFloat(maxAmount) };
    }

    // Add customer email filter
    if (customerEmail) {
      paymentFilter.customer_email = { $containsi: customerEmail };
    }

    // Get ALL successful payments with filters
    let payments = await strapi.db.query('api::payment.payment').findMany({
      where: paymentFilter,
      populate: ['user'],
      orderBy: { createdAt: 'desc' }
    });

    // Apply search filter (searches in customer email and order ID)
    if (search) {
      const searchLower = search.toLowerCase();
      payments = payments.filter(p => {
        const email = (p.customer_email || p.user?.email || '').toLowerCase();
        const orderId = (p.order_id || '').toString();
        const transactionId = (p.transaction_id || '').toLowerCase();
        return email.includes(searchLower) || 
               orderId.includes(searchLower) || 
               transactionId.includes(searchLower);
      });
    }

    // Get all cart IDs to filter by item type if needed
    if (itemType) {
      const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));
      const cartsWithType = await strapi.db.query('api::cart.cart').findMany({
        where: { id: { $in: cartIds } }
      });

      // Filter payments that have carts with the specified item type
      const validPaymentIds = new Set();
      for (const cart of cartsWithType) {
        let items = [];
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            continue;
          }
        }
        
        const hasItemType = items.some(item => 
          (item.itemType || '').toLowerCase() === itemType.toLowerCase()
        );
        
        if (hasItemType) {
          const payment = payments.find(p => parseInt(p.order_id) === cart.id);
          if (payment) validPaymentIds.add(payment.id);
        }
      }

      payments = payments.filter(p => validPaymentIds.has(p.id));
    }

    // Apply sorting
    payments = payments.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'amount':
          comparison = parseFloat(a.amount || 0) - parseFloat(b.amount || 0);
          break;
        case 'customer':
          const emailA = (a.customer_email || a.user?.email || '').toLowerCase();
          const emailB = (b.customer_email || b.user?.email || '').toLowerCase();
          comparison = emailA.localeCompare(emailB);
          break;
        case 'date':
        default:
          comparison = new Date(a.createdAt) - new Date(b.createdAt);
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Store total count before pagination
    const totalPayments = payments.length;

    // Apply pagination (only if not exporting)
    if (!export_format) {
      const offset = (parseInt(page) - 1) * parseInt(limit);
      payments = payments.slice(offset, offset + parseInt(limit));
    }

    if (totalPayments === 0) {
      return ctx.body = {
        success: true,
        message: 'No payments found matching your filters',
        reports: {
          summary: {
            total_payments: 0,
            total_revenue: '0.00',
            average_transaction: '0.00',
            unique_customers: 0,
            total_items_sold: 0,
            revenue_growth_percent: '0.00',
            most_active_day: 'N/A',
            transactions_on_most_active_day: 0,
            average_items_per_order: '0.00',
            currency: 'USD'
          },
          revenue_by_type: {},
          top_selling_items: [],
          top_customers: [],
          sales_timeline: [],
          item_type_analysis: {
            counts: { book: 0, article: 0, journal: 0, magazine: 0, other: 0 },
            percentage_of_total: {}
          }
        },
        filters_applied: {
          search, customerEmail, minAmount, maxAmount, itemType,
          startDate: startDate || 'Not specified',
          endDate: endDate || 'Not specified'
        },
        pagination: {
          current_page: parseInt(page),
          page_size: parseInt(limit),
          total_payments: 0,
          total_pages: 0,
          has_more: false
        }
      };
    }

    // Get all cart IDs
    const cartIds = payments.map(p => parseInt(p.order_id)).filter(id => !isNaN(id));

    // Get all carts with items
    const paidCarts = await strapi.db.query('api::cart.cart').findMany({
      where: { id: { $in: cartIds } }
    });

    // Collect all items from all carts
    const allCartItems = [];
    const customerMap = new Map();
    const itemTypeCounts = {
      book: 0, article: 0, journal: 0, magazine: 0, other: 0
    };
    const itemDetails = new Map();

    for (const cart of paidCarts) {
      let items = [];
      
      if (cart.items) {
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            console.error(`Failed to parse cart ${cart.id} items:`, e.message);
            continue;
          }
        }
      }

      const payment = payments.find(p => parseInt(p.order_id) === cart.id);
      if (!payment) continue;

      const userId = payment.user?.id || 'unknown';
      const userEmail = payment.user?.email || payment.customer_email || 'unknown@example.com';

      if (!customerMap.has(userId)) {
        customerMap.set(userId, {
          user_id: userId,
          email: userEmail,
          total_spent: 0,
          total_orders: 0,
          items_purchased: 0,
          first_purchase: payment.createdAt,
          last_purchase: payment.createdAt,
          item_types: {}
        });
      }

      const customer = customerMap.get(userId);
      customer.total_spent += parseFloat(payment.amount || 0);
      customer.total_orders += 1;
      customer.last_purchase = payment.createdAt > customer.last_purchase ? payment.createdAt : customer.last_purchase;

      for (const item of items) {
        allCartItems.push({
          cart_id: cart.id,
          payment_id: payment.id,
          user_id: userId,
          user_email: userEmail,
          item_type: item.itemType || 'unknown',
          price: parseFloat(item.price || 0),
          quantity: parseInt(item.quantity || 1),
          purchase_date: payment.createdAt,
          transaction_id: payment.transaction_id || ''
        });

        const itemType = (item.itemType || 'other').toLowerCase();
        if (itemTypeCounts.hasOwnProperty(itemType)) {
          itemTypeCounts[itemType] += (item.quantity || 1);
        } else {
          itemTypeCounts.other += (item.quantity || 1);
        }

        if (!customer.item_types[itemType]) {
          customer.item_types[itemType] = 0;
        }
        customer.item_types[itemType] += (item.quantity || 1);
        customer.items_purchased += (item.quantity || 1);

        const itemKey = `${itemType}_${item.price}`;
        if (!itemDetails.has(itemKey)) {
          itemDetails.set(itemKey, {
            item_type: itemType,
            price: parseFloat(item.price || 0),
            quantity_sold: 0,
            total_revenue: 0,
            first_sold: payment.createdAt,
            last_sold: payment.createdAt
          });
        }
        
        const itemDetail = itemDetails.get(itemKey);
        itemDetail.quantity_sold += (item.quantity || 1);
        itemDetail.total_revenue += (parseFloat(item.price || 0) * (item.quantity || 1));
        itemDetail.last_sold = payment.createdAt > itemDetail.last_sold ? payment.createdAt : itemDetail.last_sold;
      }
    }

    // Calculate revenue by type
    const revenueByType = {};
    const totalRevenue = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    
    for (const [key, detail] of itemDetails) {
      const type = detail.item_type;
      if (!revenueByType[type]) {
        revenueByType[type] = {
          revenue: 0,
          items_sold: 0,
          average_price: 0
        };
      }
      revenueByType[type].revenue += detail.total_revenue;
      revenueByType[type].items_sold += detail.quantity_sold;
    }
    
    for (const type in revenueByType) {
      revenueByType[type].revenue = parseFloat(revenueByType[type].revenue.toFixed(2));
      revenueByType[type].average_price = revenueByType[type].items_sold > 0 
        ? parseFloat((revenueByType[type].revenue / revenueByType[type].items_sold).toFixed(2))
        : 0;
    }

    const topItems = Array.from(itemDetails.values())
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 10)
      .map(item => ({
        type: item.item_type,
        price: parseFloat(item.price.toFixed(2)),
        quantity_sold: item.quantity_sold,
        total_revenue: parseFloat(item.total_revenue.toFixed(2)),
        first_sold: item.first_sold,
        last_sold: item.last_sold
      }));

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 10)
      .map(customer => ({
        user_id: customer.user_id,
        email: customer.email,
        total_spent: parseFloat(customer.total_spent.toFixed(2)),
        total_orders: customer.total_orders,
        items_purchased: customer.items_purchased,
        first_purchase: customer.first_purchase,
        last_purchase: customer.last_purchase,
        favorite_type: Object.keys(customer.item_types).length > 0
          ? Object.keys(customer.item_types).reduce((a, b) => 
              customer.item_types[a] > customer.item_types[b] ? a : b
            )
          : 'none'
      }));

    // Create timeline data
    const timelineMap = new Map();
    
    for (const payment of payments) {
      let dateKey;
      const date = new Date(payment.createdAt);
      
      switch (groupBy) {
        case 'day':
          dateKey = date.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          dateKey = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'year':
          dateKey = date.getFullYear().toString();
          break;
        default:
          dateKey = date.toISOString().split('T')[0];
      }
      
      if (!timelineMap.has(dateKey)) {
        timelineMap.set(dateKey, {
          date: dateKey,
          total_revenue: 0,
          transactions: 0,
          items_sold: 0,
          unique_customers: new Set()
        });
      }
      
      const period = timelineMap.get(dateKey);
      period.total_revenue += parseFloat(payment.amount || 0);
      period.transactions += 1;
      
      const cart = paidCarts.find(c => c.id === parseInt(payment.order_id));
      if (cart && cart.items) {
        let items = [];
        if (Array.isArray(cart.items)) {
          items = cart.items;
        } else if (typeof cart.items === 'string') {
          try {
            items = JSON.parse(cart.items);
          } catch (e) {
            console.error(`Timeline: Failed to parse cart ${cart.id}:`, e.message);
          }
        }
        period.items_sold += items.reduce((sum, item) => sum + (item.quantity || 1), 0);
      }
      
      if (payment.user?.id) {
        period.unique_customers.add(payment.user.id);
      }
    }

    const timeline = Array.from(timelineMap.values())
      .map(period => ({
        date: period.date,
        total_revenue: parseFloat(period.total_revenue.toFixed(2)),
        transactions: period.transactions,
        items_sold: period.items_sold,
        unique_customers: period.unique_customers.size,
        average_order_value: period.transactions > 0 
          ? parseFloat((period.total_revenue / period.transactions).toFixed(2))
          : 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalItemsSold = allCartItems.reduce((sum, item) => sum + item.quantity, 0);
    
    const summary = {
      total_payments: payments.length,
      total_revenue: parseFloat(totalRevenue.toFixed(2)),
      average_transaction: payments.length > 0 
        ? parseFloat((totalRevenue / payments.length).toFixed(2))
        : 0,
      unique_customers: customerMap.size,
      total_items_sold: totalItemsSold,
      date_range: {
        start: payments[payments.length - 1]?.createdAt || null,
        end: payments[0]?.createdAt || null
      },
      item_type_breakdown: itemTypeCounts
    };

    let revenueGrowth = '0.00';
    if (timeline.length >= 2) {
      const currentPeriod = timeline[timeline.length - 1];
      const previousPeriod = timeline[timeline.length - 2];
      
      if (previousPeriod.total_revenue > 0) {
        const growth = ((currentPeriod.total_revenue - previousPeriod.total_revenue) / previousPeriod.total_revenue * 100);
        revenueGrowth = growth.toFixed(2);
      } else if (currentPeriod.total_revenue > 0) {
        revenueGrowth = '100.00';
      }
    }

    const mostActiveDay = timeline.length > 0
      ? timeline.reduce((max, day) => 
          day.transactions > max.transactions ? day : max,
          timeline[0]
        )
      : { transactions: 0, date: 'N/A', total_revenue: 0 };

    const avgItemsPerOrder = payments.length > 0 
      ? (totalItemsSold / payments.length).toFixed(2)
      : '0.00';

    const reportData = {
      success: true,
      reports: {
        summary: {
          total_payments: summary.total_payments,
          total_revenue: summary.total_revenue,
          average_transaction: summary.average_transaction,
          unique_customers: summary.unique_customers,
          total_items_sold: summary.total_items_sold,
          revenue_growth_percent: revenueGrowth,
          most_active_day: mostActiveDay.date,
          transactions_on_most_active_day: mostActiveDay.transactions,
          average_items_per_order: avgItemsPerOrder,
          currency: 'USD',
          date_range: summary.date_range,
          item_type_breakdown: summary.item_type_breakdown
        },
        revenue_by_type: revenueByType,
        top_selling_items: topItems,
        top_customers: topCustomers,
        sales_timeline: timeline,
        item_type_analysis: {
          counts: itemTypeCounts,
          percentage_of_total: totalItemsSold > 0
            ? Object.keys(itemTypeCounts).reduce((acc, type) => {
                acc[type] = ((itemTypeCounts[type] / totalItemsSold) * 100).toFixed(2);
                return acc;
              }, {})
            : {}
        }
      },
      filters_applied: {
        search: search || 'None',
        customer_email: customerEmail || 'None',
        min_amount: minAmount || 'None',
        max_amount: maxAmount || 'None',
        item_type: itemType || 'None',
        start_date: startDate || 'Not specified',
        end_date: endDate || 'Not specified',
        group_by: groupBy,
        sort_by: sortBy,
        sort_order: sortOrder
      },
      pagination: {
        current_page: parseInt(page),
        page_size: parseInt(limit),
        total_payments: totalPayments,
        total_pages: Math.ceil(totalPayments / parseInt(limit)),
        has_more: (parseInt(page) * parseInt(limit)) < totalPayments
      }
    };

    // Handle export formats
    if (export_format === 'csv') {
      const csv = generateCSVReport(allCartItems, payments, summary);
      ctx.set('Content-Type', 'text/csv');
      ctx.set('Content-Disposition', `attachment; filename="sales-report-${new Date().toISOString().split('T')[0]}.csv"`);
      return ctx.body = csv;
    } else if (export_format === 'json') {
      ctx.set('Content-Type', 'application/json');
      ctx.set('Content-Disposition', `attachment; filename="sales-report-${new Date().toISOString().split('T')[0]}.json"`);
      return ctx.body = JSON.stringify(reportData, null, 2);
    }

    return ctx.body = reportData;

  } catch (error) {
    console.error('❌ Admin reports error:', error);
    return ctx.body = {
      success: false,
      message: 'Error generating reports',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
},




}));