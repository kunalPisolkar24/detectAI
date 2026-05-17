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
4.  **Set up Docker environment variables**

    The root `Makefile` is the entrypoint for both Docker stacks.

    For the local stack:
    ```sh
    cp infra/docker/local/.env.example infra/docker/local/.env
    ```

    For the prod-like stack:
    ```sh
    cp infra/docker/prod/.env.example infra/docker/prod/.env
    ```

    Update the env file for the stack you plan to run.

5.  **Discover available commands**

    ```sh
    make help
    ```

6.  **Run a stack**

    Start the lightweight local stack:
    ```sh
    make local-up
    ```

    Start the prod-like stack from the repo root:
    ```sh
    make up
    ```

7.  **Build images without starting containers**

    ```sh
    make build STACK=local SERVICE=frontend
    make build STACK=prod
    ```



## 🐳 Kubernetes & Local Deployment (Helm)

For advanced local development and to simulate a production-like environment, this project includes a comprehensive Kubernetes setup managed by **Helm**. This allows you to deploy the entire application stack—including the API, web app, and a full monitoring suite—with a single command.

The Helm chart automatically configures:
*   **Staging & Production Environments**: Deploys isolated versions of the application with environment-specific configurations.
*   **Prometheus & Grafana**: A full `kube-prometheus-stack` for real-time monitoring of application and cluster metrics.
*   **Horizontal Pod Autoscaling (HPA)**: Pre-configured to automatically scale services based on CPU load.
*   **Automated Database Migrations**: A Helm Hook runs `prisma migrate` before every deployment to ensure the database schema is always in sync with the application code.

### Prerequisites

*   **Kind**: For running a local Kubernetes cluster.
*   **Helm**: The package manager for Kubernetes.
*   **kubectl**: The Kubernetes command-line tool.
*   **Docker**: Required by Kind to run the cluster nodes.

### Step-by-Step Deployment

#### 1. Start the Local Kubernetes Cluster
Run the provided setup script to create and configure your local environment.

```sh
sh ./setup-cluster.sh
```
This script automates the creation of:
*   A **Kind** cluster named `detectai-cluster`.
*   A local **Docker registry** for your custom images.
*   An **NGINX Ingress Controller** to route external traffic to your services.

#### 2. Build and Push Application Images
The API model image is pulled from Docker Hub, but you need to build the Next.js web app locally. The script can tag images for different environments.

```sh
# Build the image for the staging environment
sh ./build-and-push.sh staging

# Build the image for the production environment
sh ./build-and-push.sh prod
```

#### 3. Deploy the Application Stack using Helm
With the cluster running and images built, you can now deploy everything using the Helm chart located in the `detect-ai-chart` directory.

##### Deploying the Staging Environment
This command installs the chart into the `detect-ai` namespace, using the `values-staging.yaml` file for configuration.

```sh
helm install staging ./detect-ai-chart \
  --namespace detect-ai \
  --create-namespace \
  -f values-staging.yaml
```

##### Deploying the Production Environment
This command installs another instance of the chart into a separate `detect-ai-prod` namespace.

```sh
helm install prod ./detect-ai-chart \
  --namespace detect-ai-prod \
  --create-namespace \
  -f values-prod.yaml
```

The deployment will first run a `Prisma migration Job` to update the database schema before starting the application pods.

#### 4. Accessing Your Deployed Services

##### Application Access
You can now access both environments in your browser through the configured `nip.io` URLs.

*   **Staging:** `http://staging.detect-ai.127.0.0.1.nip.io`
*   **Production:** `http://detect-ai.127.0.0.1.nip.io`

##### Monitoring Dashboard (Grafana)
To access the Grafana dashboard for your production environment, run the port-forward command in a new terminal:

```sh
kubectl port-forward --namespace detect-ai-prod svc/prod-grafana 8080:80
```
Then navigate to `http://localhost:8080` and log in with the credentials `admin` / `prom-operator`.

### Managing Your Deployment

##### Upgrading a Release
To apply any changes from your `values` files or chart templates, use `helm upgrade`. For example, to upgrade the staging release:

```sh
helm upgrade staging ./detect-ai-chart -n detect-ai -f values-staging.yaml
```

##### Uninstalling a Release
To completely remove an environment and all its associated resources:

```sh
# Uninstall the staging environment
helm uninstall staging -n detect-ai

# Uninstall the production environment
helm uninstall prod -n detect-ai-prod
```

##### Deleting the Cluster
To destroy the entire local Kubernetes environment:

```sh
kind delete cluster --name detectai-cluster
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
