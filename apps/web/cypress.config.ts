const {defineConfig} = require("cypress");

module.exports = defineConfig({
  e2e: {
    // @ts-ignore
    setupNodeEvents(on, config) {
    },
    baseUrl: 'https://3000-01js66k20jtjspdjdgk9d72g9s.cloudspaces.litng.ai/'
  },
});