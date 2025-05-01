const {defineConfig} = require("cypress");

module.exports = defineConfig({
  e2e: {
    // @ts-ignore
    setupNodeEvents(on, config) {
    },
    baseUrl: 'https://detect-ai-staging.vercel.app/'
  },
});