'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::visitor-counter.visitor-counter', ({ strapi }) => ({
  async increment(ctx) {
    let entry = await strapi.db.query('api::visitor-counter.visitor-counter').findOne();
    if (!entry) {
      entry = await strapi.entityService.create('api::visitor-counter.visitor-counter', {
        data: { count: 1253 },
      });
      return ctx.send({ count: Number(entry.count) });
    }
    const next = BigInt(entry.count || 1252) + BigInt(1);
    const updated = await strapi.entityService.update('api::visitor-counter.visitor-counter', entry.id, {
      data: { count: next.toString() },
    });
    return ctx.send({ count: Number(updated.count) });
  },

  async reset(ctx) {
    const entry = await strapi.db.query('api::visitor-counter.visitor-counter').findOne();
    const resetValue = ctx.request.body?.count ?? 0;
    if (!entry) {
      const created = await strapi.entityService.create('api::visitor-counter.visitor-counter', {
        data: { count: String(resetValue) },
      });
      return ctx.send({ count: Number(created.count), reset: true });
    }
    const updated = await strapi.entityService.update('api::visitor-counter.visitor-counter', entry.id, {
      data: { count: String(resetValue) },
    });
    return ctx.send({ count: Number(updated.count), reset: true });
  },

  async getCount(ctx) {
    const entry = await strapi.db.query('api::visitor-counter.visitor-counter').findOne();
    return ctx.send({ count: entry ? Number(entry.count) : 1252 });
  },
}));
