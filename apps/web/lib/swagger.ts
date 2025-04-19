import swaggerJsdoc from 'swagger-jsdoc';
import { UserProfileData, UserProfileConnectedAccount } from '@/app/api/user/profile/route';
import { SubscriptionStatus } from "@prisma/client";

const userProfileConnectedAccountSchema: any = {
  type: 'object',
  properties: {
    provider: { type: 'string', example: 'github' },
    id: { type: 'string', example: 'acc_12345' },
    userId: { type: 'string', example: 'user_abcde' },
    providerAccountId: { type: 'string', example: '987654321' },
  },
  required: ['provider', 'id', 'userId', 'providerAccountId'],
};

const userProfileDataSchema: any = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid', example: 'clxkzshf00000unpfy8nd48ah' },
    firstName: { type: 'string', nullable: true, example: 'John' },
    lastName: { type: 'string', nullable: true, example: 'Doe' },
    email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
    memberSince: { type: 'string', format: 'date-time', example: '2023-10-26T10:00:00.000Z' },
    isPremium: { type: 'boolean', example: true },
    premiumPlanId: { type: 'string', nullable: true, example: 'price_12345abc' },
    premiumExpiry: { type: 'string', format: 'date-time', nullable: true, example: '2024-10-26T10:00:00.000Z' },
    subscriptionStatus: {
       type: 'string',
       nullable: true,
       enum: Object.values(SubscriptionStatus),
       example: 'ACTIVE'
    },
    paddleSubscriptionId: { type: 'string', nullable: true, example: 'sub_abcdef123' },
    isCancellationScheduled: { type: 'boolean', example: false },
    connectedAccounts: {
      type: 'array',
      items: { $ref: '#/components/schemas/UserProfileConnectedAccount' },
    },
    usage: {
      type: 'object',
      properties: {
        apiCalls: {
          type: 'object',
          properties: {
            current: { type: 'integer', example: 50 },
            limit: { type: 'integer', nullable: true, example: 100 },
            period: { type: 'string', enum: ['Daily'], example: 'Daily' },
          },
          required: ['current', 'limit', 'period'],
        },
        totalApiCallCount: { type: 'integer', example: 1500 },
      },
      required: ['apiCalls', 'totalApiCallCount'],
    },
  },
  required: [
    'id',
    'email',
    'memberSince',
    'isPremium',
    'isCancellationScheduled',
    'connectedAccounts',
    'usage',
  ],
};

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DetectAI API Documentation',
      version: '1.0.0',
      description: 'API documentation for the DetectAI Next.js application, covering authentication, user management, model interactions, and billing.',
    },
    servers: [
      {
        url: '/api',
        description: 'Development server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication related endpoints' },
      { name: 'User', description: 'User profile and settings management' },
      { name: 'Subscription', description: 'Subscription and billing endpoints' },
      { name: 'Model Proxy', description: 'Endpoints proxying requests to the AI model' },
      { name: 'Webhooks', description: 'Endpoints for receiving external webhooks' },
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Verification', description: 'Verification endpoints (e.g., CAPTCHA)' },
      { name: 'Meta', description: 'API meta endpoints' },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Invalid input' },
            details: { type: 'object', additionalProperties: true, example: { field: ['Error message'] } },
          },
          required: ['error'],
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation successful' },
          },
          required: ['success'],
        },
        UserRegistrationInput: {
          type: 'object',
          properties: {
            firstName: { type: 'string', minLength: 1, example: 'John' },
            lastName: { type: 'string', minLength: 1, example: 'Doe' },
            // name: { type: 'string', minLength: 3, example: 'John Doe' }, // Name is derived now
            email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
            password: { type: 'string', format: 'password', minLength: 8, example: 'yourSecurePassword123' },
          },
          required: ['firstName', 'lastName', 'email', 'password'],
        },
        UserRegistrationOutput: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'clxkzshf00000unpfy8nd48ah' },
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
            firstName: { type: 'string', example: 'John' },
            lastName: { type: 'string', example: 'Doe' },
            createdAt: { type: 'string', format: 'date-time', example: '2023-10-26T10:00:00.000Z' },
          },
          required: ['id', 'name', 'email', 'firstName', 'lastName', 'createdAt'],
        },
        CredentialsLoginInput: {
           type: 'object',
           properties: {
              email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
              password: { type: 'string', format: 'password', example: 'yourSecurePassword123' },
           },
           required: ['email', 'password'],
        },
        SessionUser: {
           type: 'object',
           properties: {
             id: { type: 'string', example: 'clxkzshf00000unpfy8nd48ah' },
             name: { type: 'string', nullable: true, example: 'John Doe' },
             email: { type: 'string', format: 'email', nullable: true, example: 'john.doe@example.com' },
             image: { type: 'string', format: 'url', nullable: true, example: 'https://example.com/avatar.png' },
             isPremium: { type: 'boolean', example: false },
           },
        },
        Session: {
           type: 'object',
           properties: {
              user: { '$ref': '#/components/schemas/SessionUser' },
              expires: { type: 'string', format: 'date-time', example: '2024-11-26T10:00:00.000Z' },
           }
        },
        ModelHealthResponse: {
           type: 'object',
           description: 'Response from the external model health check',
           additionalProperties: true,
           example: { status: 'ok', model_version: '1.2.3' }
        },
        UserProfileConnectedAccount: userProfileConnectedAccountSchema,
        UserProfileData: userProfileDataSchema,
        UserProfileUpdateInput: {
          type: 'object',
          properties: {
            firstName: { type: 'string', minLength: 1, example: 'Jonathan' },
            lastName: { type: 'string', minLength: 1, example: 'Doering' },
          },
          description: 'Provide at least one field to update.',
        },
        UserProfileUpdateOutput: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'clxkzshf00000unpfy8nd48ah' },
            firstName: { type: 'string', nullable: true, example: 'Jonathan' },
            lastName: { type: 'string', nullable: true, example: 'Doering' },
            name: { type: 'string', nullable: true, example: 'Jonathan Doering' },
            updatedAt: { type: 'string', format: 'date-time', example: '2023-10-27T11:00:00.000Z' },
          },
          required: ['id', 'updatedAt'],
        },
        ProxyRequestInput: {
            type: 'object',
            description: 'The request body to be forwarded to the ML model endpoint.',
            additionalProperties: true,
            example: { text: "This is a sample text for analysis." }
        },
        ProxyResponseOutput: {
            type: 'object',
            description: 'The response body received from the ML model endpoint.',
            additionalProperties: true,
            example: { prediction: 'human', probability: 0.1 }
        },
        TurnstileVerificationInput: {
           type: 'object',
           properties: {
              token: { type: 'string', description: 'The Cloudflare Turnstile token from the frontend.', example: '0x4AAAAAA...'}
           },
           required: ['token']
        },
        PaddleWebhookInput: {
           type: 'object',
           description: 'Payload received from Paddle Webhooks.',
           properties: {
              event_type: { type: 'string', example: 'subscription.updated' },
              data: {
                 type: 'object',
                 additionalProperties: true,
                 example: { id: 'sub_123', status: 'active', customer_id: 'ctm_123', custom_data: { userId: 'user_abc' } }
              }
           },
           required: ['event_type', 'data']
        },
        PaddleWebhookResponse: {
           type: 'object',
           properties: {
              message: { type: 'string', example: 'Webhook processed successfully.' },
              received: { type: 'boolean', example: true },
              error: { type: 'string', example: 'Missing userId' }
           },
           description: "Indicates webhook processing status. Returns 200 OK even for handled errors to prevent Paddle retries.",
        }
      },
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'next-auth.session-token', // Or '__Secure-next-auth.session-token' if using HTTPS and secure prefix
          description: 'Session cookie set automatically after login. Include credentials (cookies) in requests.',
        },
        // Note: Paddle signature is handled via a specific header, documented per-endpoint.
      },
    },
    security: [
      {
        cookieAuth: [], // Apply cookie auth globally to endpoints that need authentication
      },
    ],
    paths: {
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          description: 'Creates a new user account using first name, last name, email, and password.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UserRegistrationInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'User created successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserRegistrationOutput' },
                },
              },
            },
            '400': {
              description: 'Invalid input data',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '409': {
              description: 'Email already in use',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/auth/session': {
         get: {
           tags: ['Auth'],
           summary: 'Get current session',
           description: 'Retrieves the session information for the currently authenticated user.',
           security: [{ cookieAuth: [] }], // Endpoint requires authentication
           responses: {
             '200': {
               description: 'Session data retrieved successfully',
               content: {
                 'application/json': {
                   schema: { $ref: '#/components/schemas/Session' },
                 },
               },
             },
             '401': {
               description: 'Not authenticated',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
             }
           }
         }
      },
      '/docs': {
        get: {
          tags: ['Meta'],
          summary: 'Get OpenAPI Specification',
          description: 'Returns the OpenAPI (Swagger) JSON definition for this API.',
          responses: {
            '200': {
              description: 'Successful retrieval of OpenAPI specification',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: 'OpenAPI 3.0 specification document.',
                  },
                },
              },
            },
          },
        },
      },
      '/health': { // Added back the original example endpoint
        get: {
          tags: ['Health'],
          summary: 'Basic API Health Check',
          description: 'Returns a simple JSON object indicating the API route is working.',
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
      '/health/model': {
        get: {
          tags: ['Health'],
          summary: 'Check external model health',
          description: 'Pings the backend ML model\'s health endpoint and returns its response.',
          responses: {
            '200': {
              description: 'Model health check successful',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ModelHealthResponse' },
                },
              },
            },
            '500': {
              description: 'Failed to fetch health data or internal error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            // Specific statuses like 502, 503 might be returned depending on the fetch error
          },
        },
      },
      '/user/profile': {
        get: {
          tags: ['User'],
          summary: 'Get current user profile',
          description: 'Retrieves detailed profile information, subscription status, and usage stats for the authenticated user.',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'User profile data retrieved successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserProfileData' },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '404': {
              description: 'User not found',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Internal server error',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
        put: {
          tags: ['User'],
          summary: 'Update user profile',
          description: 'Updates the first name and/or last name for the authenticated user. The full name field is updated automatically.',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UserProfileUpdateInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'User profile updated successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserProfileUpdateOutput' },
                },
              },
            },
             '400': {
               description: 'Invalid input data or no fields provided',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
             },
            '401': {
              description: 'Not authenticated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Internal server error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/user/subscription/cancel': {
        post: {
          tags: ['User', 'Subscription'],
          summary: 'Schedule subscription cancellation',
          description: 'Requests cancellation of the user\'s active Paddle subscription at the end of the current billing period. This marks the subscription to be cancelled, but it remains active until the period ends.',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Subscription cancellation scheduled successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
            },
            '400': {
               description: 'Subscription is not active, already cancelled, or cancellation already scheduled.',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '401': {
              description: 'Not authenticated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '404': {
              description: 'User or subscription details not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': { // Also covers potential Paddle API errors mapped to 500
              description: 'Internal server error or error communicating with payment provider',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/proxy/{endpoint}': {
        post: {
          tags: ['Model Proxy'],
          summary: 'Proxy request to ML model endpoint',
          description: 'Forwards a request to the specified backend ML model prediction endpoint.',
          parameters: [
            {
              name: 'endpoint',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'The specific prediction endpoint name on the ML model server (e.g., "text_analysis", "image_classification").',
              example: 'sentiment'
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProxyRequestInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Prediction successful',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ProxyResponseOutput' },
                },
              },
            },
            '500': {
              description: 'Failed to fetch prediction or internal proxy error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            // Other statuses might be passed through from the model API
          },
        },
      },
      '/user/usage/increment': {
        post: {
          tags: ['User', 'Usage'],
          summary: 'Increment API usage count',
          description: 'Records one API call for the authenticated user. Increments total count always. Increments daily count for premium users or free users within their limit. Does not require a request body.',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Usage count updated successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
            },
            '401': {
              description: 'Not authenticated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '404': {
              description: 'User not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Failed to update usage data',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/verify-turnstile': {
        post: {
          tags: ['Verification', 'Security'],
          summary: 'Verify Cloudflare Turnstile token',
          description: 'Verifies a Cloudflare Turnstile (CAPTCHA) token provided by the client.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TurnstileVerificationInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Turnstile token verified successfully',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
            },
            '400': {
              description: 'Turnstile token is required',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '401': {
              description: 'Invalid Turnstile token',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Internal server error during verification (e.g., missing secret key)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/webhooks/paddle': {
        post: {
          tags: ['Webhooks', 'Subscription'],
          summary: 'Handle Paddle webhooks',
          description: 'Receives and processes subscription and transaction event notifications from Paddle. Requires a valid `Paddle-Signature` header for verification.',
          parameters: [
            {
              name: 'Paddle-Signature',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'The signature provided by Paddle to verify the webhook authenticity. Format: `ts=<timestamp>,h1=<hash>`',
            },
          ],
          requestBody: {
            required: true,
            description: 'The event payload sent by Paddle.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaddleWebhookInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook received and acknowledged. This status is returned even if processing fails for certain conditions (like missing userId) to prevent Paddle retries for unprocessable events.',
              content: {
                'application/json': {
                   schema: { $ref: '#/components/schemas/PaddleWebhookResponse' }
                }
              }
            },
            '400': {
              description: 'Missing Paddle signature or invalid JSON body',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '401': {
              description: 'Invalid Paddle signature',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Internal server error during webhook processing or webhook secret not configured',
               content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
    },
  },
  apis: [
      './app/api/**/*.ts',
      './lib/authOptions.ts',
      './schemas/**/*.ts' 
    ], 
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;