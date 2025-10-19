# LFMT Frontend - React SPA

Long-Form Translation Service - Client-side Application

## Technology Stack

- **Framework**: React 18 with TypeScript 5
- **Build Tool**: Vite 5
- **UI Library**: Material-UI (MUI) v5
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **Form Management**: React Hook Form + Zod validation
- **State Management**: React Context + Hooks
- **Testing**: Vitest + React Testing Library + Playwright
- **Shared Types**: `@lfmt/shared-types` package

## Project Structure

```
frontend/
├── src/
│   ├── components/       # React components organized by feature
│   │   ├── Auth/         # Authentication components
│   │   ├── Translation/  # Translation workflow components
│   │   └── Shared/       # Reusable UI components
│   ├── services/         # API service layer
│   ├── hooks/            # Custom React hooks
│   ├── contexts/         # React Context providers
│   ├── utils/            # Utility functions
│   ├── App.tsx           # Root component
│   └── main.tsx          # Application entry point
├── public/               # Static assets
└── index.html            # HTML template
```

## Development

### Prerequisites

- Node.js 18+ and npm 9+
- Backend API running at https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/

### Getting Started

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint
```

### Testing

```bash
# Run unit tests with Vitest
npm test

# Run tests in watch mode
npm run test:ui

# Generate coverage report
npm run test:coverage

# Run E2E tests with Playwright
npm run test:e2e

# Run E2E tests in UI mode
npm run test:e2e:ui
```

### Building

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Testing Philosophy

Following **Test-Driven Development (TDD)** principles:

1. **Write Tests First**: Define expected behavior before implementation
2. **Red-Green-Refactor**: Fail → Pass → Improve
3. **Test Pyramid**: Many unit tests, some integration tests, few E2E tests
4. **Coverage Goals**: 80%+ for critical paths

### Test Organization

- `__tests__/` directories alongside source files
- `*.test.tsx` for component tests
- `*.test.ts` for utility/service tests
- Playwright tests in separate `e2e/` directory (when added)

## Code Quality Standards

- **TypeScript Strict Mode**: All code must pass strict type checking
- **ESLint**: Follow configured rules, no warnings allowed
- **No `any` types**: Use proper TypeScript types or `unknown`
- **Functional Components**: Use hooks, avoid class components
- **Accessibility**: WCAG 2.1 AA compliance for all UI components

## API Integration

The development server proxies `/api` requests to the backend:

```typescript
// Proxied automatically in development
fetch('/api/auth/login', { ... })

// Resolves to:
// https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login
```

## Environment Variables

Create `.env.local` for local overrides (not committed):

```bash
VITE_API_URL=http://localhost:4000  # Override API URL if needed
```

## Contributing

### Before Committing

1. Ensure all tests pass: `npm test`
2. Verify type safety: `npm run type-check`
3. Check for linting errors: `npm run lint`
4. Update relevant documentation
5. Follow conventional commit messages

### Git Workflow

```bash
# Feature development
git checkout -b feature/authentication-ui
# ... make changes, test, commit ...
git push origin feature/authentication-ui
# Create pull request
```

## Performance Considerations

- **Code Splitting**: Routes are lazy-loaded
- **Bundle Size**: Target <200KB initial bundle
- **Lighthouse Score**: Target 90+ for all metrics
- **Tree Shaking**: Unused code automatically removed by Vite

## Security Best Practices

- ✅ No API keys in frontend code
- ✅ Tokens stored in httpOnly cookies (when backend supports)
- ✅ Input validation with Zod schemas
- ✅ XSS prevention via React's built-in escaping
- ✅ CORS properly configured on backend

## Deployment

Built files are production-ready and can be deployed to:

- AWS S3 + CloudFront (recommended for this POC)
- Vercel / Netlify (alternative options)
- Any static hosting service

```bash
# Build for production
npm run build

# Output in dist/ directory
# Upload to S3 bucket configured for static hosting
```

## Troubleshooting

### Port 3000 already in use

```bash
# Kill process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in vite.config.ts
```

### Module resolution errors

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Type errors after dependency updates

```bash
# Rebuild TypeScript
npm run type-check
```

## Resources

- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Material-UI Components](https://mui.com/material-ui/getting-started/)
- [Vite Guide](https://vitejs.dev/guide/)
- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)

## Phase 3 Status: Authentication UI ✅ COMPLETE

**Completed Features:**
- ✅ LoginForm component with email/password validation
- ✅ RegisterForm component with comprehensive validation
- ✅ ForgotPasswordForm component with success state
- ✅ AuthProvider integration with global state management
- ✅ React Router configuration with protected routes
- ✅ ProtectedRoute component with authentication guards
- ✅ Material-UI theme configuration
- ✅ All page components (Login, Register, ForgotPassword, Dashboard)
- ✅ 111/111 tests passing (100% pass rate)
- ✅ TypeScript strict mode - 0 errors

**How to Verify:**
See [VERIFICATION.md](./VERIFICATION.md) for complete testing guide.

**Quick Verification:**
```bash
# Start the development server
npm run dev

# Open http://localhost:3000 in your browser
# You should see the login page

# Try these flows:
# 1. Login with any email/password → redirects to dashboard
# 2. Navigate to /register → test registration form
# 3. Navigate to /forgot-password → test password reset
# 4. Access /dashboard without login → redirects to login
```

---

**Project Status**: Phase 3 - Authentication UI Complete ✅

Last Updated: October 19, 2025
