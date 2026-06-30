module.exports = () => ({
  upload: {
    config: {
    formLimit: '1024mb',
    jsonLimit: '1024mb',
    formidable: { maxFileSize: 1024 * 1024 * 1024 },
  },
  },
  email: {
    config: {
      provider: "nodemailer",
      providerOptions: {
        host: "smtp.gmail.com",
        port: 587,
        auth: {
          user: "alisina123kpu@gmail.com",
          pass: "wurf ccut ycoc pcmq"
        },
      },
      settings: {
        defaultFrom: "alisina123kpu@gmail.com",
        defaultReplyTo: "alisina123kpu@gmail.com",
      },
    },
  },
});