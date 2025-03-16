import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Next.js API Docs',
      version: '1.0.0',
      description: 'API documentation for Next.js 15 app',
    }
  },
  apis: ['app/api/**/*.ts', 'app/api/**/*.js'], // Matches all API routes
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;