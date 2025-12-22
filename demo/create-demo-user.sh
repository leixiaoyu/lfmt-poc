#!/bin/bash

# LFMT POC - Create Demo User Account
# Usage: ./create-demo-user.sh

set -e

# Configuration
USER_POOL_ID="us-east-1_tyG2buO70"
DEMO_EMAIL="demo@lfmt-poc.dev"
DEMO_PASSWORD="DemoUser2025!"  # Strong password for dev environment

echo "======================================"
echo "Creating LFMT POC Demo User Account"
echo "======================================"
echo ""
echo "User Pool ID: $USER_POOL_ID"
echo "Email: $DEMO_EMAIL"
echo ""

# Check if user already exists
echo "Checking if user already exists..."
if aws cognito-idp admin-get-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$DEMO_EMAIL" \
    2>/dev/null; then
    echo ""
    echo "✅ User already exists: $DEMO_EMAIL"
    echo ""
    echo "To reset password:"
    echo "aws cognito-idp admin-set-user-password \\"
    echo "  --user-pool-id $USER_POOL_ID \\"
    echo "  --username $DEMO_EMAIL \\"
    echo "  --password \"$DEMO_PASSWORD\" \\"
    echo "  --permanent"
    exit 0
fi

echo "User does not exist. Creating..."
echo ""

# Create user with admin command (bypasses signup flow)
echo "Creating user account..."
aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$DEMO_EMAIL" \
    --user-attributes \
        Name=email,Value="$DEMO_EMAIL" \
        Name=email_verified,Value=true \
    --message-action SUPPRESS

echo "✅ User created successfully"
echo ""

# Set permanent password (no password reset required on first login)
echo "Setting permanent password..."
aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$DEMO_EMAIL" \
    --password "$DEMO_PASSWORD" \
    --permanent

echo "✅ Password set successfully"
echo ""

# Verify user attributes
echo "Verifying user attributes..."
aws cognito-idp admin-get-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$DEMO_EMAIL" \
    --query '[Username, UserStatus, UserAttributes]' \
    --output table

echo ""
echo "======================================"
echo "✅ Demo Account Created Successfully"
echo "======================================"
echo ""
echo "Login Credentials:"
echo "  Email: $DEMO_EMAIL"
echo "  Password: $DEMO_PASSWORD"
echo ""
echo "Frontend URL: https://d39xcun7144jgl.cloudfront.net"
echo ""
echo "Next Steps:"
echo "1. Open frontend URL in browser"
echo "2. Login with credentials above"
echo "3. Upload test documents from demo/test-documents/"
echo "4. Monitor translation progress"
echo "5. Document metrics in demo/results/"
echo ""
