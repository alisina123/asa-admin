// src/api/book/routes/book.js
'use strict';

module.exports = {
  routes: [
    // 🚨 CUSTOM ROUTES FIRST 🚨
    {
      method: 'GET',
      path: '/books/my-books',
      handler: 'book.getMyBooks',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/books/:id/download',
      handler: 'book.download',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/books/:id/check-access',
      handler: 'book.checkAccess',
      config: {
        policies: [],
      },
    },
    
    // Default routes come AFTER
    {
      method: 'GET',
      path: '/books',
      handler: 'book.find',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/books/:id',
      handler: 'book.findOne',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/books',
      handler: 'book.create',
      config: {
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/books/:id',
      handler: 'book.update',
      config: {
        policies: [],
      },
    },
    {
      method: 'DELETE',
      path: '/books/:id',
      handler: 'book.delete',
      config: {
        policies: [],
      },
    }
  ],
};