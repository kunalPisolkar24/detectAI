import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Next.js API Docs',
      version: '1.0.0',
      description: 'API documentation for Next.js 15 app',
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Health Check Endpoint',
          description: 'Returns a JSON object indicating the API health.',
          responses: {
            '200': {
              description: 'Successful API health check',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                    example: {
                      message: 'API route test successful!',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ['app/api/**/*.ts', 'app/api/**/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
