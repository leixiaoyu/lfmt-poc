#!/bin/bash

# LFMT POC GitHub Setup Script
# Automates repository setup and initial push

set -e

echo "🚀 LFMT POC GitHub Setup"
echo "========================"

REPO_URL="https://github.com/leixiaoyu/lfmt-poc.git"
PROJECT_DIR="/Users/raymondl/Documents/LFMT POC/LFMT/lfmt-poc"

echo "📁 Project Directory: $PROJECT_DIR"
echo "📦 GitHub Repository: $REPO_URL"
echo ""

# Navigate to project directory
cd "$PROJECT_DIR"

echo "🔍 Current Git Status:"
git status
echo ""

# Check if remote is already configured
if git remote get-url origin &> /dev/null; then
    echo "✅ GitHub remote already configured"
    CURRENT_REMOTE=$(git remote get-url origin)
    echo "   Current remote: $CURRENT_REMOTE"
else
    echo "⚙️  Adding GitHub remote..."
    git remote add origin "$REPO_URL"
    echo "✅ GitHub remote added"
fi

# Ensure main branch
echo "🌿 Configuring main branch..."
git branch -M main

echo ""
echo "📋 Ready to push to GitHub!"
echo "🔐 You'll need to authenticate with GitHub when prompted"
echo ""

# Attempt to push
echo "🚀 Pushing code to GitHub..."
if git push -u origin main; then
    echo ""
    echo "🎉 SUCCESS! Code pushed to GitHub repository"
    echo "📍 Repository URL: $REPO_URL"
    echo ""
    echo "✅ Next Steps:"
    echo "1. Visit your GitHub repository to verify the code"
    echo "2. Set up AWS credentials in GitHub Secrets"
    echo "3. Configure deployment environments"
    echo "4. Run CI/CD pipeline"
    echo ""
else
    echo ""
    echo "⚠️  Push failed - likely authentication needed"
    echo ""
    echo "🔧 Solutions:"
    echo "1. If you have GitHub CLI installed:"
    echo "   gh auth login"
    echo "   git push -u origin main"
    echo ""
    echo "2. Or configure Git credentials:"
    echo "   git config --global user.name 'Your Name'"
    echo "   git config --global user.email 'your.email@example.com'"
    echo "   git push -u origin main"
    echo ""
    echo "3. Or use SSH instead of HTTPS:"
    echo "   git remote set-url origin git@github.com:leixiaoyu/lfmt-poc.git"
    echo "   git push -u origin main"
    echo ""
fi

# Show current repository info
echo "📊 Repository Information:"
echo "   Local path: $(pwd)"
echo "   Remote URL: $(git remote get-url origin)"
echo "   Current branch: $(git branch --show-current)"
echo "   Last commit: $(git log --oneline -1)"
echo ""

echo "🎯 Ready for next phase: AWS credential setup!"