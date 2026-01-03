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
    
    // Get user's purchased books (MAIN ENDPOINT)
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
      path: '/payments/check-access/:bookId',
      handler: 'payment.checkBookAccess',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Get book with PDF (if user has access) - ADD THIS METHOD TO CONTROLLER
    {
      method: 'GET',
      path: '/payments/book/:bookId',
      handler: 'payment.getBookWithPDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
    // Download book PDF (secure) - ADD THIS METHOD TO CONTROLLER
    {
      method: 'GET',
      path: '/payments/download-book/:bookId',
      handler: 'payment.downloadBook',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    
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
    
    // Test endpoints (remove in production)
    {
      method: 'POST',
      path: '/payments/test-insert',
      handler: 'payment.testInsert',
      config: {
        auth: false,
      },
    },
  ],
};