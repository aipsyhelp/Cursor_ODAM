# Contributing to ODAM Memory for Cursor

Thank you for your interest in contributing to ODAM Memory for Cursor! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- TypeScript 5.0+
- VS Code or Cursor IDE
- Git

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/aipsyhelp/Cursor_ODAM.git
   cd Cursor_ODAM
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Compile**
   ```bash
   npm run compile
   ```

4. **Open in VS Code/Cursor**
   ```bash
   code .
   ```

5. **Run Extension**
   - Press `F5` to launch a new Extension Development Host
   - Test your changes in the new window

## Development Workflow

### Making Changes

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Write clean, readable code
   - Follow existing code style
   - Add comments in English
   - Update documentation if needed

3. **Test Your Changes**
   ```bash
   npm run compile
   # Test in Extension Development Host
   ```

4. **Commit**
   ```bash
   git commit -m "feat: add your feature description"
   ```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

### Code Style

- **Language**: All code comments and documentation in English
- **TypeScript**: Use TypeScript strict mode
- **Formatting**: Use consistent indentation (2 spaces)
- **Naming**: Use descriptive names, camelCase for variables/functions

### Pull Request Process

1. **Update Documentation**
   - Update README if needed
   - Add/update code comments
   - Update CHANGELOG.md

2. **Create Pull Request**
   - Provide clear description
   - Reference related issues
   - Add screenshots if UI changes

3. **Review Process**
   - Address review comments
   - Keep PR focused and small
   - Ensure all tests pass

## Project Structure

```
Cursor_ODAM/
├── github-release/   # Extension source code
│   ├── src/          # TypeScript source files
│   ├── out/          # Compiled JavaScript (generated)
│   ├── scripts/      # Testing and utility scripts
│   └── ...
├── docs/             # Project documentation
└── ...
```

## Testing

### Running Tests

```bash
# Compile
npm run compile

# Run extension tests (if available)
npm test
```

### Testing Checklist

- [ ] Extension activates correctly
- [ ] API connection works
- [ ] Memory file updates correctly
- [ ] Commands work as expected
- [ ] No console errors

## Documentation

- **Code Comments**: All in English, explain "why" not just "what"
- **README**: Keep main README up to date
- **API Docs**: Document public APIs
- **Examples**: Add examples for new features

## Questions?

- Open an issue for questions
- Check existing issues first
- Be patient and respectful

Thank you for contributing! 🎉




















