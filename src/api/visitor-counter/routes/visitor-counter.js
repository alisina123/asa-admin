'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/visitor-counter/increment',
      handler: 'visitor-counter.increment',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/visitor-counter/count',
      handler: 'visitor-counter.getCount',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/visitor-counter/reset',
      handler: 'visitor-counter.reset',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
  ],
};
