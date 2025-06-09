# Detect AI - Advanced AI-Generated Text Detection

[![CI](https://github.com/kunalPisolkar24/detectAI/actions/workflows/ci.yml/badge.svg)](https://github.com/kunalPisolkar24/detectAI/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://lbesson.mit-license.org/)
[![Code Coverage](https://img.shields.io/badge/coverage-75%2B-brightgreen)](https://github.com/kunalPisolkar24/detectAI)

An advanced, full-stack platform designed to accurately distinguish between human-written and AI-generated text. It leverages a dual-model approach, combining a state-of-the-art transformer model with a deep neural network, all delivered through a secure, high-performance, and scalable web application with a built-in subscription management system.

## ✨ Core Features

*   **Advanced AI Text Detection**: Utilizes a powerful dual-model system to analyze text and determine the probability of it being AI-generated. It offers two tiers of detection accuracy: a highly precise premium model and a robust standard model.
*   **Subscription-Based Access**: A complete subscription system powered by Paddle.js allows users to subscribe to monthly or yearly plans for premium features. The system includes seamless payment processing and automated handling of subscription events via webhooks.
*   **Secure & Modern User Experience**:
    *   **Multi-Provider Authentication**: A comprehensive authentication system using Next-Auth supports email/password, Google, and GitHub logins.
    *   **Intuitive & Animated UI**: A clean, responsive interface built with Shadcn UI and enhanced with fluid animations from Framer Motion.
    *   **Helpful Error Feedback**: Provides clear, parameter-based error messages for an improved user experience.
*   **Human Verification**: Employs Cloudflare Turnstile to prevent automated bots and ensure fair usage.

## 🚀 Technical Architecture

### Monorepo & Build System
*   **Turborepo**: Manages the monorepo for high-performance build caching, leading to significantly faster development and deployment cycles.

### Full-Stack Framework
*   **Next.js 15**: The entire user-facing application and backend-for-frontend are built with the latest version of Next.js.
*   **Vercel Deployment**: The application is deployed on Vercel with separate staging and production environments for robust release cycles.

### AI Model Service
*   **Python, Flask & Lightning AI**: A RESTful API developed with Flask serves the AI models. It includes health check endpoints for monitoring.
*   **Secure Communication**: A secure proxy within the Next.js backend ensures the Lightning AI secret key is never exposed on the client-side.
*   **Containerized Deployment**: The AI service is packaged in a Docker container for consistent and portable execution.
*   **Scalable Hosting**: Deployed on Lightning AI, the service is configured with powerful resources (16GB RAM, 4 vCPUs) and autoscaling capabilities to handle high demand.

### AI Model & Training
*   **Training Dataset**: The models are trained and fine-tuned on the gold-rated DIAGT Proper Train Dataset.
*   **Premium Model (Transformer)**:
    *   **Model**: A fine-tuned BERT_BASE_UNCASED model.
    *   **Performance**: Achieves a test accuracy of 99.77%, with perfect AUC-PR and ROC AUC scores of 1.0.
*   **Standard Model (DNN)**:
    *   **Architecture**: A 3-layer sequential model with TF-IDF Vectorizer for text preprocessing.
    *   **Performance**: Reaches a high test accuracy of 97.25% and an AUC-ROC of 0.9940.

### Backend & Database
*   **Prisma & Neon DB**: Prisma is used as the ORM for type-safe database interactions with a Neon DB PostgreSQL instance that autoscales based on traffic.
*   **Authentication**: A multi-provider authentication system (Credentials, Google, GitHub) is implemented with Next-Auth, using JWT sessions stored in cookies.
*   **Input Validation**: Zod ensures robust schema validation for all API inputs, enhancing data integrity and security.
*   **Payment Webhooks**: Secure backend endpoints handle webhooks from Paddle for managing subscription events.

### API Documentation
*   **OpenAPI & Swagger UI**: A comprehensive OpenAPI specification is defined for all backend endpoints, with interactive documentation provided by Swagger UI.

## ⚙️ Performance & Monitoring

*   **Build Caching**: Turborepo optimizes build times, significantly speeding up the development and CI pipelines.
*   **Database Monitoring**: Neon DB's integrated tools are used to monitor database performance and traffic patterns.
*   **Frontend Performance**: Achieves Lighthouse scores of over 90% across all metrics for both mobile and desktop, ensuring a fast and accessible user experience.

## 🛡️ Security Measures

*   **Password Hashing**: Bcrypt is used to securely hash and salt user passwords.
*   **Bot & Spam Prevention**: Cloudflare Turnstile provides effective human verification.
*   **API Rate Limiting**: Upstash Redis implements a rate limiter, restricting users to 50 requests per 60 seconds to prevent abuse.
*   **DDoS Protection**: Vercel's built-in DDoS protection secures the frontend and API endpoints.
*   **Input Sanitization**: Strict schema-based input validation with Zod prevents injection attacks and ensures data integrity.

## 🧪 Testing & Quality Assurance

*   **Unit Testing**: Frontend components and backend APIs are unit-tested using Vitest and React Testing Library, achieving over 75% code coverage.
*   **End-to-End (E2E) Testing**: A comprehensive suite of E2E tests using Cypress validates complete user flows and application functionality.

## 🛠️ DevOps & Development Workflow

*   **Continuous Integration (CI)**: A CI pipeline with GitHub Actions automatically builds and tests the application on every push and pull request.
*   **Containerized Local Development**: Docker Compose is used to manage the multi-service local environment for a consistent end-to-end development experience.
*   **Continuous Deployment (CD)**: Vercel's CD capabilities enable automated, zero-downtime deployments to staging and production environments.

## 🚀 Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   pnpm
*   Docker

### Installation

1.  **Clone the repo**
    ```sh
    git clone https://github.com/kunalPisolkar24/detectAI.git
    ```
2.  **Navigate to the project directory**
    ```sh
    cd detectAI
    ```
3.  **Install NPM packages**
    ```sh
    pnpm install
    ```
4.  **Set up environment variables**

    Create a `.env` file in `apps/web` and populate it with the necessary variables from `.env.example`.

    **`apps/web/.env`:**
    ```env
    DATABASE_URL=""

    GITHUB_ID=""
    GITHUB_SECRET=""

    GOOGLE_ID=""
    GOOGLE_SECRET= ""

    NEXTAUTH_SECRET="my_auth_secret"
    NEXTAUTH_URL=""

    TURNSTILE_SECRET_KEY=""
    TURNSTILE_SITE_KEY=""

    UPSTASH_REDIS_REST_URL=""
    UPSTASH_REDIS_REST_TOKEN=""


    NEXT_PUBLIC_LOCAL_MODEL_URL=""

    NEXT_PUBLIC_MODEL_URL=""
    NEXT_PUBLIC_MODEL_API_SECRET=""

    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=""
    PADDLE_WEBHOOK_SECRET=""
    PADDLE_API_KEY=""

    DAILY_API_LIMIT_FREE=100
    ```
5.  **Run the development environment**

    This will start both the AI model service and the web application.
    ```sh
    docker-compose up --build
    ```

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
