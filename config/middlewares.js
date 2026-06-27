module.exports = [
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: '1024mb',
      jsonLimit: '1024mb',
      textLimit: '1024mb',
      formidable: {
        maxFileSize: 1024 * 1024 * 1024,
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
