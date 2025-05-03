# Combined Deployment Script for Multimedia RAG and NovaSonic

This script combines the deployment of two separate projects:
1. Multimedia RAG Chat Assistant (guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration)
2. NovaSonic Backend (novasonic)

## Prerequisites

- AWS CLI installed and configured
- Node.js and npm installed
- Docker installed (for NovaSonic backend)
- Both project folders in the same directory

## Usage

```bash
./deploy-combined.sh [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-e ENV` | Environment name (default: dev) |
| `-r REGION` | AWS region (default: from AWS CLI config, must be us-east-1 if using NovaSonic) |
| `-p PROFILE` | AWS profile name to use (default: default) |
| `-l` | Deploy Lambda@Edge functions (always in us-east-1) |
| `-f` | Skip frontend deployment (infrastructure only) |
| `-s` | Skip infrastructure (frontend only) |
| `-i` | Generate local configuration only (no deployment) |
| `-n` | Deploy NovaSonic backend (requires us-east-1 region) |
| `-N` | Skip NovaSonic backend deployment |
| `-h` | Show help |

## Deployment Scenarios

### Full Deployment (Both Stacks + Frontend)

Deploy both the Multimedia RAG stack and NovaSonic backend in us-east-1:

```bash
./deploy-combined.sh -r us-east-1 -n
```

### Multimedia RAG Only

Deploy only the Multimedia RAG stack (can be in any region):

```bash
./deploy-combined.sh -r us-west-2
```

### NovaSonic Only

Deploy only the NovaSonic backend (must be in us-east-1):

```bash
./deploy-combined.sh -r us-east-1 -s -n
```

### Frontend Only

Deploy only the frontend using existing infrastructure:

```bash
./deploy-combined.sh -s
```

### Configuration Only

Generate configuration files without deploying:

```bash
./deploy-combined.sh -i
```

## Region Considerations

- NovaSonic backend must be deployed in us-east-1
- Lambda@Edge functions must be deployed in us-east-1
- Multimedia RAG stack can be deployed in any region if not using NovaSonic
- If deploying both stacks, you must use us-east-1

## Integration

The script automatically:
1. Deploys the infrastructure stacks in the correct order
2. Collects outputs from both stacks
3. Generates a complete .env file for the React frontend
4. Configures the React app to use both backends when deployed together
