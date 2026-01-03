'use strict';

/**
 * book controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::book.book', ({ strapi }) => ({
  
  // Get user's purchased books (WORKS WITHOUT purchased_books FIELD)
  async getMyBooks(ctx) {
    try {
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('Please login to view your books');
      }
      
      console.log('📚 Get My Books request from user:', user.id);
      
      // METHOD 1: Get books from user-book-access table
      const accessRecords = await strapi.db.query('api::user-book-access.user-book-access').findMany({
        where: {
          user: user.id,
          access_granted: true
        },
        populate: {
          book: {
            populate: ['coverImage', 'pdf']
          }
        },
        orderBy: { granted_at: 'desc' }
      });
      
      // METHOD 2: Get books from payment-books table (since purchased_books doesn't exist)
      const paymentBooksRecords = await strapi.db.query('api::payment-books.payment-books').findMany({
        where: {
          user_id: user.id
        }
      });
      
      const allBookIds = new Set();
      const books = [];
      
      // Add books from access records
      accessRecords.forEach(record => {
        if (record.book) {
          allBookIds.add(record.book.id);
          books.push({
            ...record.book,
            access_granted_at: record.granted_at,
            access_via: 'access-record'
          });
        }
      });
      
      // Collect book IDs from payment-books
      const paymentBookIds = [];
      paymentBooksRecords.forEach(record => {
        if (record.book_ids && Array.isArray(record.book_ids)) {
          record.book_ids.forEach(bookId => {
            if (!allBookIds.has(bookId)) {
              paymentBookIds.push(bookId);
            }
          });
        }
      });
      
      // Fetch books from payment records
      if (paymentBookIds.length > 0) {
        const paymentBooks = await strapi.db.query('api::book.book').findMany({
          where: {
            id: { $in: paymentBookIds }
          },
          populate: ['coverImage', 'pdf']
        });
        
        paymentBooks.forEach(book => {
          if (!allBookIds.has(book.id)) {
            allBookIds.add(book.id);
            books.push({
              ...book,
              access_granted_at: new Date(),
              access_via: 'payment'
            });
          }
        });
      }
      
      console.log(`✅ Found ${books.length} books for user`);
      
      // Format response
      const baseUrl = strapi.config.get('server.url', 'http://localhost:1337');
      const formattedBooks = books.map(book => ({
        id: book.id,
        title: book.title,
        author: book.author,
        description: book.description,
        price: book.price,
        coverImage: book.coverImage ? {
          url: `${baseUrl}${book.coverImage.url}`,
          name: book.coverImage.name
        } : null,
        pdf: book.pdf ? {
          url: `${baseUrl}${book.pdf.url}`,
          name: book.pdf.name,
          size: book.pdf.size
        } : null,
        access_info: {
          granted_at: book.access_granted_at,
          via: book.access_via || 'unknown'
        }
      }));
      
      return {
        success: true,
        count: formattedBooks.length,
        books: formattedBooks
      };
      
    } catch (error) {
      console.error('❌ Error in getMyBooks:', error);
      ctx.status = 500;
      return {
        success: false,
        message: 'Failed to fetch your books',
        error: error.message
      };
    }
  },
  
  // Download/Read book (WORKS WITHOUT purchased_books FIELD)
  async download(ctx) {
    try {
      const { id } = ctx.params;
      const user = ctx.state.user;
      
      console.log('📖 Book download request - Book ID:', id, 'User ID:', user?.id);
      
      if (!user) {
        return ctx.unauthorized('Please login to access this book');
      }
      
      // METHOD 1: Check user-book-access
      let hasAccess = false;
      const accessRecord = await strapi.db.query('api::user-book-access.user-book-access').findOne({
        where: {
          user: user.id,
          book: parseInt(id),
          access_granted: true
        }
      });
      
      if (accessRecord) {
        hasAccess = true;
        console.log('✅ Access via user-book-access');
      } else {
        // METHOD 2: Check payment-books table (since purchased_books doesn't exist)
        const paymentBooks = await strapi.db.query('api::payment-books.payment-books').findOne({
          where: {
            user_id: user.id,
            book_ids: { $contains: parseInt(id) }
          }
        });
        
        if (paymentBooks) {
          hasAccess = true;
          console.log('✅ Access via payment-books table');
          
          // Create access record for future
          try {
            await strapi.db.query('api::user-book-access.user-book-access').create({
              data: {
                user: user.id,
                book: parseInt(id),
                access_granted: true,
                granted_at: new Date(),
                payment_id: paymentBooks.payment_id,
                publishedAt: new Date()
              }
            });
            console.log('📝 Created access record');
          } catch (error) {
            console.error('Error creating access record:', error);
          }
        }
      }
      
      if (!hasAccess) {
        return ctx.forbidden('You do not have access to this book. Please purchase it first.');
      }
      
      // Get book with PDF
      const book = await strapi.db.query('api::book.book').findOne({
        where: { id: parseInt(id) },
        populate: ['pdf', 'coverImage']
      });
      
      if (!book) {
        return ctx.notFound('Book not found');
      }
      
      if (!book.pdf) {
        return ctx.badRequest('PDF not available for this book');
      }
      
      const baseUrl = strapi.config.get('server.url', 'http://localhost:1337');
      
      return {
        success: true,
        canDownload: true,
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          description: book.description,
          coverImage: book.coverImage ? {
            url: `${baseUrl}${book.coverImage.url}`,
            name: book.coverImage.name
          } : null,
          pdf: {
            url: `${baseUrl}${book.pdf.url}`,
            name: book.pdf.name,
            mime: book.pdf.mime,
            size: book.pdf.size
          }
        }
      };
      
    } catch (error) {
      console.error('❌ Book download error:', error);
      ctx.status = 500;
      return {
        success: false,
        message: 'Error accessing book',
        error: error.message
      };
    }
  },
  
  // Check access for specific book (WORKS WITHOUT purchased_books FIELD)
  async checkAccess(ctx) {
    try {
      const { id } = ctx.params;
      const user = ctx.state.user;
      
      if (!user) {
        return ctx.unauthorized('Please login');
      }
      
      let hasAccess = false;
      let accessInfo = null;
      
      // Check user-book-access
      const accessRecord = await strapi.db.query('api::user-book-access.user-book-access').findOne({
        where: {
          user: user.id,
          book: parseInt(id),
          access_granted: true
        }
      });
      
      if (accessRecord) {
        hasAccess = true;
        accessInfo = {
          via: 'user-book-access',
          granted_at: accessRecord.granted_at
        };
      } else {
        // Check payment-books table
        const paymentBooks = await strapi.db.query('api::payment-books.payment-books').findOne({
          where: {
            user_id: user.id,
            book_ids: { $contains: parseInt(id) }
          }
        });
        
        if (paymentBooks) {
          hasAccess = true;
          accessInfo = {
            via: 'payment-record',
            payment_id: paymentBooks.payment_id
          };
        }
      }
      
      return {
        success: true,
        has_access: hasAccess,
        book_id: parseInt(id),
        user_id: user.id,
        access_info: accessInfo,
        message: hasAccess ? 'You have access to this book' : 'You do not have access to this book'
      };
      
    } catch (error) {
      console.error('❌ Check access error:', error);
      return {
        success: false,
        message: 'Error checking access',
        error: error.message
      };
    }
  }
  
}));