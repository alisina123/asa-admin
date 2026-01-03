import favicon from "./extensions/favicon.ico";

const config = {
  head: {
    favicon: favicon,
  },
  translations: {
    en: {
      "Auth.form.welcome.subtitle": "Log in to your ASA account",
      "Auth.form.welcome.title": "Welcome to ASA Panel!",
      "app.components.LeftMenu.navbrand.title": "ASA Dashboard",
      "app.components.LeftMenu.navbrand.workplace": "ASA CMS",
    },
  },
};

const bootstrap = (app) => {
  console.log(app);
};

export default {
  config,
  bootstrap,
};
