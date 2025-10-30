#!/bin/bash

# Script to create Gemini API key secret in AWS Secrets Manager
# Usage: ./scripts/create-gemini-secret.sh <environment> <api-key>
# Example: ./scripts/create-gemini-secret.sh dev AIzaSyYourGeminiApiKey123

set -e

# Check if environment and API key are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <environment> <gemini-api-key>"
    echo "Example: $0 dev AIzaSyYourGeminiApiKey123"
    echo ""
    echo "Environments: dev, staging, prod"
    exit 1
fi

ENVIRONMENT=$1
API_KEY=$2

# Map environment to stack name
case $ENVIRONMENT in
    dev)
        STACK_NAME="dev"
        ;;
    staging)
        STACK_NAME="staging"
        ;;
    prod)
        STACK_NAME="prod"
        ;;
    *)
        echo "Error: Invalid environment '$ENVIRONMENT'. Must be one of: dev, staging, prod"
        exit 1
        ;;
esac

SECRET_NAME="lfmt/gemini-api-key-${STACK_NAME}"

echo "🔐 Creating Gemini API key secret..."
echo "Environment: $ENVIRONMENT"
echo "Secret Name: $SECRET_NAME"
echo ""

# Check if secret already exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" 2>/dev/null; then
    echo "⚠️  Secret already exists. Updating existing secret..."
    aws secretsmanager put-secret-value \
        --secret-id "$SECRET_NAME" \
        --secret-string "$API_KEY"
    echo "✅ Secret updated successfully!"
else
    echo "Creating new secret..."
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "Gemini API key for LFMT translation service ($ENVIRONMENT)" \
        --secret-string "$API_KEY" \
        --tags Key=Environment,Value="$ENVIRONMENT" Key=Project,Value=LFMT
    echo "✅ Secret created successfully!"
fi

echo ""
echo "📋 Secret Details:"
echo "   Name: $SECRET_NAME"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $(aws configure get region)"
echo ""
echo "💡 To verify the secret was created:"
echo "   aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query SecretString --output text"
echo ""
echo "🚀 You can now deploy the infrastructure with:"
echo "   cd backend/infrastructure"
echo "   npx cdk deploy --context environment=$ENVIRONMENT"
