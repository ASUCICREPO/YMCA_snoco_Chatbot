#!/bin/bash

# YMCA AI CDK Deployment Script
# This script handles the complete deployment of the YMCA AI infrastructure
# Including CDK stack deployment and S3 Vectors + Bedrock Knowledge Base setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}$1${NC}"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Usage: $0 [--help]"
            echo ""
            echo "Options:"
            echo "  --help, -h         Show this help message"
            echo ""
            echo "Deploys complete YMCA AI infrastructure via CDK including:"
            echo "  - Document processing pipeline (Step Functions + Lambda)"
            echo "  - S3 Vectors + Bedrock Knowledge Base"
            echo "  - RAG Lambda with multilingual support"
            echo "  - API Gateway endpoints"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

print_header "🚀 YMCA AI - Complete Deployment Script"
print_header "======================================"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS CLI is not configured or credentials are invalid"
    print_error "Please run 'aws configure' to set up your credentials"
    exit 1
fi

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region || echo "us-east-1")

print_status "Deploying YMCA AI Stack to account: $AWS_ACCOUNT in region: $AWS_REGION"

# Set environment variables
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT
export CDK_DEFAULT_REGION=$AWS_REGION
export NODE_ENV=${NODE_ENV:-development}

# Navigate to backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

print_status "Working directory: $(pwd)"

# Install dependencies
print_status "Installing dependencies..."
npm install

# Build TypeScript
print_status "Building TypeScript..."
npm run build

# Bootstrap CDK if needed
print_status "Checking CDK bootstrap status..."
BOOTSTRAP_VERSION=$(aws ssm get-parameter --name "/cdk-bootstrap/hnb659fds/version" --region $AWS_REGION --query "Parameter.Value" --output text 2>/dev/null || echo "0")

if [ "$BOOTSTRAP_VERSION" -lt "30" ]; then
    print_warning "CDK bootstrap version ($BOOTSTRAP_VERSION) is outdated. Updating to latest version..."
    npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION --force
else
    print_status "CDK bootstrap version $BOOTSTRAP_VERSION is up to date"
fi

# Acknowledge CDK notices to clean up output
npx cdk acknowledge 34892 > /dev/null 2>&1 || true

# Synthesize the stack
print_status "Synthesizing CDK stack..."
npx cdk synth

# Deploy the stack
print_header "\n📦 YMCA AI Infrastructure Deployment"
print_header "====================================="
print_status "Deploying complete YMCA AI Stack..."
print_status "This includes: Document processing, S3 Vectors, Knowledge Base (Titan Text v2), and RAG Lambda"
npx cdk deploy YmcaAiStack --require-approval never

print_status "CDK deployment completed successfully!"

# Final Summary
print_header "\n🎉 DEPLOYMENT COMPLETE!"
print_header "======================="

# Get stack outputs
print_status "Retrieving stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks --stack-name YmcaAiStack --query "Stacks[0].Outputs" --output json 2>/dev/null || echo "[]")

if [ "$OUTPUTS" != "[]" ]; then
    echo -e "\n${BLUE}📋 Stack Outputs:${NC}"
    echo "$OUTPUTS" | jq -r '.[] | "   \(.OutputKey): \(.OutputValue)"'
else
    print_warning "Could not retrieve stack outputs"
fi

echo ""
print_status "✅ YMCA AI infrastructure deployed successfully!"
print_status "✅ Document processing pipeline ready"
print_status "✅ S3 Vectors + Bedrock Knowledge Base configured (Titan Text v2)"
print_status "✅ RAG Lambda with multilingual support ready"
print_status "✅ API Gateway endpoints configured"

echo ""
print_header "🚀 Next Steps:"
echo -e "1. ${BLUE}Upload documents${NC}: Place PDFs in the S3 input bucket"
echo -e "2. ${BLUE}Process documents${NC}: They'll be automatically processed via Textract"
echo -e "3. ${BLUE}Test RAG Lambda${NC}: Use API Gateway endpoint to query the knowledge base"
echo -e "4. ${BLUE}Monitor costs${NC}: Enjoy ~90% savings with S3 Vectors!"

echo ""
print_status "🎯 Your YMCA AI system is ready to use!"

# Save outputs to file for reference
if [ "$OUTPUTS" != "[]" ]; then
    echo "$OUTPUTS" > outputs.json
    print_status "Stack outputs saved to: outputs.json"
fi