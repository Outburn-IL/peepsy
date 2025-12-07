# Contributing to Peepsy

Thank you for your interest in contributing to Peepsy! This guide will help you get started with contributing to the project.

## 🚀 Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm 7.0.0 or higher
- Git

### Setting Up Development Environment

1. **Fork the repository**
   ```bash
   # Fork the repo on GitHub, then clone your fork
   git clone https://github.com/Outburn-IL/peepsy.git
   cd peepsy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Run linting**
   ```bash
   npm run lint
   ```

## 🔄 Development Workflow

### Branch Naming Convention

- `feature/description` - For new features
- `fix/description` - For bug fixes
- `docs/description` - For documentation updates
- `refactor/description` - For refactoring
- `test/description` - For test improvements

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clean, readable code
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation if needed

3. **Run the development checks**
   ```bash
   # Format your code
   npm run format
   
   # Run linting
   npm run lint:fix
   
   # Run tests
   npm test
   
   # Build the project
   npm run build
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Test additions or updates
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for custom load balancing strategies
fix: resolve memory leak in priority queue cleanup
docs: update API documentation for PeepsyMaster
test: add integration tests for error handling
refactor: simplify request timeout logic
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- master.test.ts
```

### Writing Tests

- Write tests for all new functionality
- Maintain or improve test coverage
- Use descriptive test names
- Follow the existing test structure

Example test structure:
```typescript
describe('FeatureName', () => {
  let instance: SomeClass;

  beforeEach(() => {
    instance = new SomeClass();
  });

  afterEach(() => {
    // cleanup
  });

  describe('methodName', () => {
    it('should handle normal case', () => {
      // test implementation
    });

    it('should handle edge case', () => {
      // test implementation
    });

    it('should throw error for invalid input', () => {
      // test implementation
    });
  });
});
```

## 📝 Documentation

### Code Documentation

- Use JSDoc comments for public APIs
- Include parameter types and return types
- Provide usage examples for complex functions
- Document any side effects or important behavior

Example:
```typescript
/**
 * Sends a request to a child process or process group
 * 
 * @param action - The action to perform
 * @param targetOrGroup - Target process name or group ID
 * @param data - Data to send with the request
 * @param options - Request options (timeout, retries)
 * @returns Promise that resolves to the response
 * 
 * @example
 * ```typescript
 * const response = await master.sendRequest('processData', 'worker1', { 
 *   input: [1, 2, 3] 
 * });
 * ```
 */
public async sendRequest(
  action: string,
  targetOrGroup: string,
  data: unknown = {},
  options: RequestOptions = {}
): Promise<ResponseMessage> {
  // implementation
}
```

### README Updates

- Update the README if you add new features
- Include examples for new functionality
- Update the API reference section
- Keep the feature list current

## 🔍 Code Quality

### Code Style

- Use TypeScript strict mode
- Follow the ESLint configuration
- Use Prettier for code formatting
- Prefer explicit types over `any`
- Use meaningful variable and function names

### Best Practices

- **Error Handling**: Always handle errors appropriately
- **Type Safety**: Leverage TypeScript's type system
- **Performance**: Consider performance implications
- **Backwards Compatibility**: Avoid breaking changes
- **Security**: Be mindful of security implications

### Code Review Checklist

- [ ] Code follows the style guidelines
- [ ] Tests are included and pass
- [ ] Documentation is updated
- [ ] No breaking changes (or properly documented)
- [ ] Performance implications considered
- [ ] Error handling is appropriate
- [ ] Type safety is maintained

## 📋 Pull Request Process

1. **Ensure your branch is up to date**
   ```bash
   git checkout main
   git pull upstream main
   git checkout feature/your-feature
   git rebase main
   ```

2. **Push your changes**
   ```bash
   git push origin feature/your-feature
   ```

3. **Create a Pull Request**
   - Use a clear, descriptive title
   - Fill out the PR template
   - Link any related issues
   - Add screenshots for UI changes

4. **Address feedback**
   - Respond to code review comments
   - Make requested changes
   - Update tests if needed

5. **Merge**
   - Once approved, the PR will be merged
   - Delete your feature branch after merge

### Pull Request Template

```markdown
## Description
Brief description of the changes made.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] I have tested the changes manually

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
```

## 🐛 Reporting Issues

### Bug Reports

When reporting bugs, please include:

- **Environment**: Node.js version, OS, npm version
- **Steps to reproduce**: Clear, minimal steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Code sample**: Minimal reproduction case
- **Error messages**: Full error output

### Feature Requests

When requesting features:

- **Use case**: Describe the problem you're trying to solve
- **Proposed solution**: How you think it should work
- **Alternatives**: Other solutions you've considered
- **Examples**: Similar features in other libraries

## 📞 Getting Help

- **Discord**: [Join our Discord community](https://discord.gg/peepsy)
- **Discussions**: [GitHub Discussions](https://github.com/Outburn-IL/peepsy/discussions)
- **Issues**: [GitHub Issues](https://github.com/Outburn-IL/peepsy/issues)
- **Email**: maintainers@peepsy.dev

## 🏆 Recognition

Contributors are recognized in:
- README.md contributors section
- CHANGELOG.md release notes
- GitHub contributors page

## 📜 Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

---

Thank you for contributing to Peepsy! 🚀