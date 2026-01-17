// src/api/payment/routes/payment.js

module.exports = {
  routes: [
    // Payment creation
    {
      method: 'POST',
      path: '/payments/create',
      handler: 'payment.createPayment',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Payment callbacks (no auth required)
    {
      method: 'GET',
      path: '/payments/success',
      handler: 'payment.paymentSuccess',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/payments/failure',
      handler: 'payment.paymentFailure',
      config: {
        auth: false,
      },
    },
    
    // Get all user's payments
    {
      method: 'GET',
      path: '/payments/my-payments',
      handler: 'payment.myPayments',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // ========== BOOKS ENDPOINTS ==========
    
    // Get user's purchased books
    {
      method: 'GET',
      path: '/payments/my-books',
      handler: 'payment.myBooks',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check if user has access to specific book
    {
      method: 'GET',
      path: '/payments/check-access/book/:bookId',
      handler: 'payment.checkBookAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get book with PDF (if user has access)
    {
      method: 'GET',
      path: '/payments/book/:bookId',
      handler: 'payment.getBookWithPDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Download book PDF (secure)
    {
      method: 'GET',
      path: '/payments/download-book/:bookId',
      handler: 'payment.downloadBook',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // ========== JOURNALS ENDPOINTS ==========
    
    // Get user's purchased journals
    {
      method: 'GET',
      path: '/payments/my-journals',
      handler: 'payment.myJournals',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check if user has access to specific journal
    {
      method: 'GET',
      path: '/payments/check-access/journal/:journalId',
      handler: 'payment.checkJournalAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get journal with PDF
    {
      method: 'GET',
      path: '/payments/journal/:journalId',
      handler: 'payment.getJournalWithPDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Download journal PDF
    {
      method: 'GET',
      path: '/payments/download-journal/:journalId',
      handler: 'payment.downloadJournal',
      config: {
        policies: [],
        middlewares: [],
      },
    },

    // Get all purchased content (magazine view)
    {
      method: 'GET',
      path: '/payments/my-magazine',
      handler: 'payment.myMagazine',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check access for specific content
    {
      method: 'GET',
      path: '/payments/check-access/:itemId',
      handler: 'payment.checkMagazineAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check access with type
    {
      method: 'GET',
      path: '/payments/check-access/:itemType/:itemId',
      handler: 'payment.checkMagazineAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get content for viewing
    {
      method: 'GET',
      path: '/payments/magazine-content/:itemType/:itemId',
      handler: 'payment.getMagazineContent',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // ========== UTILITY ENDPOINTS ==========
    
    // Check payment status for cart
    {
      method: 'GET',
      path: '/payments/check-status',
      handler: 'payment.createPaymentStatus',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    // Get user's purchased articles
    {
      method: 'GET',
      path: '/payments/my-articles',
      handler: 'payment.myArticles',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check if user has access to specific article
    {
      method: 'GET',
      path: '/payments/check-access/article/:articleId',
      handler: 'payment.checkArticleAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get article with PDF
    {
      method: 'GET',
      path: '/payments/article/:articleId',
      handler: 'payment.getArticleWithPDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Download article PDF
    {
      method: 'GET',
      path: '/payments/download-article/:articleId',
      handler: 'payment.downloadArticle',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Test endpoints (remove in production)
    {
      method: 'POST',
      path: '/payments/test-insert',
      handler: 'payment.testInsert',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/payments/test-my-books',
      handler: 'payment.testMyBooks',
      config: {
        auth: false,
      },
    },
  ],
};