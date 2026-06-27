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
    // Add to routes/payment.js
{
  method: 'GET',
  path: '/payments/available-content-types',
  handler: 'payment.getAvailableContentTypes',
  config: {
    policies: [],
    middlewares: [],
  },
},
{
  method: 'GET',
   path: '/payments/deep-debug-cart',
      handler: 'payment.deepDebugCart',
  config: {
    policies: [],
    middlewares: [],
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
    
    // ========== ARTICLES ENDPOINTS ==========
    
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

    // ========== MAGAZINES ENDPOINTS ==========
    
    // Get user's purchased magazines
    {
      method: 'GET',
      path: '/payments/my-magazines',
      handler: 'payment.myMagazines',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Check if user has access to specific magazine
    {
      method: 'GET',
      path: '/payments/check-access/magazine/:magazineId',
      handler: 'payment.checkMagazineAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get magazine with PDF
    {
      method: 'GET',
      path: '/payments/magazine/:magazineId',
      handler: 'payment.getMagazineWithPDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Download magazine PDF
    {
      method: 'GET',
      path: '/payments/download-magazine/:magazineId',
      handler: 'payment.downloadMagazine',
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
    {
      method: 'GET',
      path: '/payments/admin/reports',
      handler: 'payment.adminReports',
      config: {
            policies: [],
            middlewares: [],
          },
    },
// {
//   method: 'GET',
//   path: '/payments/admin/customer-history',
//   handler: 'payment.customerPurchaseHistory',
//   config: {
//     auth: { strategies: ['jwt'] },
//     policies: []
//   }
// },
// {
//   method: 'GET',
//   path: '/payments/admin/daily-sales',
//   handler: 'payment.dailySalesReport',
//   config: {
//     auth: { strategies: ['jwt'] },
//     policies: []
//   }
// },
// {
//   method: 'GET',
//   path: '/payments/admin/export',
//   handler: 'payment.exportReportData',
//   config: {
//     auth: { strategies: ['jwt'] },
//     policies: []
//   }
// },
    
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