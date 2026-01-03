module.exports = (plugin) => {
  // Add the updateMe controller method
  plugin.controllers.user.updateMe = async (ctx) => {
    // Ensure user is authenticated
    if (!ctx.state.user || !ctx.state.user.id) {
      return ctx.unauthorized('You must be logged in');
    }

    // Prevent updating sensitive fields
    const { password, email, username, role, confirmed, blocked, provider, ...allowedData } = ctx.request.body;

    try {
      // Update the user using the authenticated user's ID
      const user = await strapi.entityService.update(
        'plugin::users-permissions.user',
        ctx.state.user.id,
        { data: allowedData }
      );

      // Manually remove sensitive fields
      const { password: pwd, resetPasswordToken, confirmationToken, ...sanitizedUser } = user;

      ctx.body = sanitizedUser;
    } catch (error) {
      ctx.badRequest('Unable to update user', { error: error.message });
    }
  };

  // Add the route BEFORE other routes to ensure it matches first
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