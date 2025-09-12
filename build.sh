#!/bin/bash

# Build script for Render
echo "Starting build process..."

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Build TypeScript
npm run build

echo "Build completed!"
