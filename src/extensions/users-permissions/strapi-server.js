'use strict';

const crypto = require('crypto');

module.exports = (plugin) => {

  // Auto-confirm users on registration so they can log in immediately
  const originalRegister = plugin.controllers.auth.register;
  plugin.controllers.auth.register = async (ctx) => {
    await originalRegister(ctx);
    try {
      const user = ctx.body?.user;
      if (user?.id && !user.confirmed) {
        await strapi.query('plugin::users-permissions.user').update({
          where: { id: user.id },
          data: { confirmed: true, blocked: false },
        });
        ctx.body.user.confirmed = true;
        ctx.body.user.blocked = false;
      }
    } catch (err) {
      strapi.log.warn('Auto-confirm on register failed:', err.message);
    }
  };

  // ✅ Fix forgot-password
  plugin.controllers.auth.forgotPassword = async (ctx) => {
    const { email } = ctx.request.body;

    if (!email) {
      return ctx.badRequest('email is required');
    }

    const user = await strapi.query('plugin::users-permissions.user').findOne({
      where: { email: email.toLowerCase() },
    });

    console.log('🔍 Found user:', user ? user.id : 'NOT FOUND');

    if (!user) {
      return ctx.send({ ok: true });
    }

    const resetPasswordToken = crypto.randomBytes(64).toString('hex');
    console.log('🔑 Generated token:', resetPasswordToken);

    const updated = await strapi.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { resetPasswordToken },
    });

    console.log('💾 Saved token:', updated.resetPasswordToken);

    const resetLink = `http://localhost:3000/en/reset-password?code=${resetPasswordToken}`;

    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: 'alisina123kpu@gmail.com',
      subject: 'Reset Your Password',
      text: `Click this link to reset your password: ${resetLink}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="background:linear-gradient(135deg,#6366f1,#9333ea);width:56px;height:56px;border-radius:14px;display:inline-block;margin-bottom:16px;line-height:56px;font-size:28px;">🔐</div>
            <h2 style="color:#111827;margin:0;font-size:22px;">Reset Your Password</h2>
            <p style="color:#6b7280;margin-top:8px;font-size:14px;">Click the button below — no code needed</p>
          </div>
          <a href="${resetLink}"
             style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#9333ea);color:white;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px;margin:24px 0;">
            Reset Password →
          </a>
          <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
            This link can only be used once. If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    });

    ctx.send({ ok: true });
  };

  // ✅ updateMe
  plugin.controllers.user.updateMe = async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.id) {
      return ctx.unauthorized('You must be logged in');
    }

    const { password, email, username, role, confirmed, blocked, provider, ...allowedData } = ctx.request.body;

    try {
      const user = await strapi.entityService.update(
        'plugin::users-permissions.user',
        ctx.state.user.id,
        { data: allowedData }
      );

      const { password: pwd, resetPasswordToken, confirmationToken, ...sanitizedUser } = user;
      ctx.body = sanitizedUser;
    } catch (error) {
      ctx.badRequest('Unable to update user', { error: error.message });
    }
  };

  plugin.routes['content-api'].routes.unshift({
    method: 'PUT',
    path: '/users/me',
    handler: 'user.updateMe',
    config: {
      prefix: '',
      policies: [],
    },
  });

  return plugin;
};