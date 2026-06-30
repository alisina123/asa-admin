'use strict';

const path = require('path');

module.exports = (config, webpack) => {
  // Alias Strapi's RelationInput.js with our paginated version.
  // This replaces the component for ALL relation fields in the admin panel,
  // adding Previous / Next pagination when more than 5 connected items exist.
  config.resolve.alias = {
    ...config.resolve.alias,
    [path.resolve(
      __dirname,
      '../../node_modules/@strapi/admin/admin/src/content-manager/components/RelationInput/RelationInput.js'
    )]: path.resolve(__dirname, 'extensions/RelationInputPaginated.js'),
  };

  return config;
};
