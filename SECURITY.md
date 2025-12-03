# Security Policy

## Supported Versions

We currently support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue. Instead, please report it via one of the following methods:

1. **Email**: Send details to the maintainer
2. **Private Security Advisory**: Create a private security advisory on GitHub (if available)

### What to Include

When reporting a vulnerability, please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Time

We aim to respond to security reports within 48 hours and provide a fix within 7 days for critical issues.

## Security Best Practices

### API Keys

- **Never commit API keys** to the repository
- Store API keys in environment variables or secure configuration
- Use the extension's built-in secure storage for API keys
- Rotate API keys regularly

### Configuration

- Review extension settings before enabling
- Use environment variables for sensitive configuration
- Keep the extension updated to the latest version

## Known Security Considerations

1. **API Key Storage**: API keys are stored in VS Code/Cursor settings, which are encrypted by the IDE
2. **Network Communication**: All communication with ODAM API uses HTTPS
3. **Data Privacy**: Memory data is stored in ODAM cloud service - review ODAM's privacy policy

## Updates

We regularly update dependencies and address security issues. Always use the latest version of the extension.




















